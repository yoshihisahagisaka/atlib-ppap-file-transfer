import { assertMembership, assertSender, assertOwnedTransfer, assertCustomerAdmin } from '../domain/tenantAuthorization';
import type { TenantContext } from '../domain/tenantAuthorization';
import { requireValue, identifier, integer, sum, validateAllowance, limit,
  assertNewSend, retentionDeadline, downloadWindow } from '../domain/commercialUsage';
import type { Allowance, Period, Reservation, Notice, DownloadObservation } from '../domain/commercialUsage';
import type { UsageStore, UsageTransaction } from './commercialUsageStore';

export interface StaffContext { actorId: string; permissions: readonly ('allowance:apply' | 'capacity:grant' | 'usage:process')[]; }
export interface TransferScope {
  organizationId: string; senderUserId: string; groupId: string; transferId: string;
  objectName: string; createdAt: number; accessExpiresAt: number;
}
export interface UsageDependencies {
  now(): number; newId(): string;
  /** Must load existing transfer ownership from DB, never from the POST body. */
  transfer(groupId: string, transferId: string, organizationId: string): Promise<TransferScope | null>;
  metadata(objectName: string): Promise<{ sizeBytes: number; generation: string } | null>;
  deleteGeneration(objectName: string, generation: string): Promise<void>;
  /** Positive reconciliation evidence, not just "URL expired". False keeps the reservation. */
  uploadClosed(reservation: Reservation): Promise<boolean>;
}
function staff(context: StaffContext, permission: StaffContext['permissions'][number]): string {
  identifier(context.actorId); requireValue(context.permissions.includes(permission), 'STAFF_PERMISSION_DENIED'); return context.actorId;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }

export class CommercialUsageService {
  private store: UsageStore; private deps: UsageDependencies;
  constructor(store: UsageStore, deps: UsageDependencies) { this.store = store; this.deps = deps; }
  private async period(tx: UsageTransaction): Promise<Period> {
    const p = await tx.period(); requireValue(p, 'ALLOWANCE_NOT_CONFIGURED'); return p;
  }
  private async thresholds(tx: UsageTransaction, p: Period): Promise<void> {
    const total = limit(p); if (!total) return;
    const warningBytes = Number((BigInt(total) * BigInt(p.plan.warningPercent) + 99n) / 100n);
    const crossed = p.consumedBytes >= warningBytes;
    // One full notice supersedes warning when a single upload crosses both thresholds.
    const kind = p.consumedBytes >= total ? 'quota_full' : crossed ? 'quota_warning' : null;
    if (!kind) return;
    const previous = await tx.notice(kind);
    if (previous && previous.thresholdBytes === total) return;
    if (kind === 'quota_full') {
      const warning = await tx.notice('quota_warning');
      if (warning?.state === 'pending') { warning.state = 'superseded'; await tx.saveNotice(warning); }
    }
    await tx.saveNotice({ id: kind, kind, state: 'pending', attempts: 0, nextAttemptAt: this.deps.now(),
      periodStartsAt: p.startsAt, periodEndsAt: p.endsAt,
      leaseId: null, leaseUntil: 0, thresholdBytes: total, observedBytes: p.consumedBytes, lastError: null });
  }
  private async supersedeOldQuotaNotices(tx: UsageTransaction, p: Period): Promise<void> {
    for (const id of ['quota_warning', 'quota_full']) {
      const n = await tx.notice(id);
      if (n && n.thresholdBytes !== limit(p) && (n.state === 'pending' || n.state === 'sending')) {
        n.state = 'superseded'; n.leaseId = null; n.leaseUntil = 0; await tx.saveNotice(n);
      }
    }
  }
  /** Only consumes an already approved external order snapshot. Does not accept orders or calculate invoices. */
  async applyAllowance(context: StaffContext, a: Allowance): Promise<void> {
    const actor = staff(context, 'allowance:apply'); validateAllowance(a, this.deps.now());
    await this.store.transaction(a.organizationId, a.periodId, async tx => {
      const id = `allowance:${a.sourceOrderId}:${a.sourceRevision}`;
      const oldEvent = await tx.event(id);
      if (oldEvent) { requireValue(same(oldEvent.data, a), 'IDEMPOTENCY_CONFLICT'); return; }
      const previous = await tx.period();
      requireValue(!await tx.overlapsOtherPeriod(a.startsAt, a.endsAt), 'OVERLAPPING_USAGE_PERIOD');
      if (previous) {
        requireValue(a.startsAt === previous.startsAt && a.endsAt === previous.endsAt, 'PERIOD_BOUNDARY_CONFLICT');
        requireValue(a.sourceRevision > previous.sourceRevision, 'STALE_ALLOWANCE');
        requireValue(a.contractedSenders >= previous.contractedSenders, 'DECREASE_REQUIRES_NEW_PERIOD');
        requireValue(a.baseQuotaBytes >= previous.baseQuotaBytes, 'CAPACITY_DECREASE_REQUIRES_NEW_PERIOD');
        requireValue(a.plan.id === previous.plan.id && a.plan.version === previous.plan.version && same(a.plan, previous.plan), 'PLAN_CHANGE_REQUIRES_NEW_PERIOD');
      }
      const p: Period = { ...a, plan: { ...a.plan }, consumedBytes: previous?.consumedBytes ?? 0,
        reservedBytes: previous?.reservedBytes ?? 0, extraBytes: previous?.extraBytes ?? 0 };
      limit(p); await tx.savePeriod(p);
      await tx.appendEvent({ id, kind: 'allowance_applied', actor, at: this.deps.now(), data: { ...a } });
      await this.supersedeOldQuotaNotices(tx, p);
      await this.thresholds(tx, p);
    });
  }
  async reserve(context: TenantContext, periodId: string, input: { requestId: string; groupId: string; transferId: string; bytes: number }): Promise<Reservation> {
    assertSender(context); identifier(input.requestId); identifier(periodId);
    const org = context.organization.id;
    const transfer = await this.deps.transfer(input.groupId, input.transferId, org);
    requireValue(transfer, 'TRANSFER_NOT_FOUND'); assertOwnedTransfer(context, transfer);
    requireValue(transfer.groupId === input.groupId && transfer.transferId === input.transferId, 'TRANSFER_NOT_FOUND');
    return this.store.transaction(org, periodId, async tx => {
      const p = await this.period(tx), old = await tx.reservation(input.requestId);
      if (old) {
        requireValue(old.organizationId === org && old.periodId === periodId, 'RESERVATION_NOT_FOUND');
        requireValue(old.senderUserId === context.user.id && old.transferId === input.transferId && old.groupId === input.groupId && old.bytes === input.bytes, 'IDEMPOTENCY_CONFLICT');
        requireValue(old.state === 'reserved' && old.expiresAt > this.deps.now(), 'RESERVATION_NOT_ACTIVE'); return old;
      }
      assertNewSend(p, input.bytes, this.deps.now());
      requireValue(transfer.accessExpiresAt > this.deps.now() && transfer.accessExpiresAt <= retentionDeadline(transfer.createdAt, p.plan), 'INVALID_TRANSFER_DEADLINE');
      const r: Reservation = { id: input.requestId, organizationId: org, periodId, senderUserId: context.user.id,
        groupId: input.groupId, transferId: input.transferId, objectName: transfer.objectName, bytes: input.bytes,
        createdAt: this.deps.now(), expiresAt: Math.min(sum(this.deps.now(), p.plan.reservationTtlMs), transfer.accessExpiresAt),
        accessExpiresAt: transfer.accessExpiresAt, state: 'reserved', generation: null, scan: 'pending' };
      p.reservedBytes = sum(p.reservedBytes, r.bytes);
      await tx.saveReservation(r); await tx.savePeriod(p);
      await tx.appendEvent({ id: `reserve:${r.id}`, kind: 'capacity_reserved', actor: context.user.id, at: this.deps.now(), data: { bytes: r.bytes, transferId: r.transferId } });
      return r;
    });
  }
  async complete(context: TenantContext, periodId: string, reservationId: string): Promise<Reservation> {
    assertSender(context);
    return this.store.transaction(context.organization.id, periodId, async tx => {
      const p = await this.period(tx), r = await tx.reservation(reservationId);
      requireValue(r && r.organizationId === context.organization.id && r.periodId === periodId && r.senderUserId === context.user.id, 'RESERVATION_NOT_FOUND');
      if (r.state === 'committed') return r;
      requireValue(r.state === 'reserved' && this.deps.now() < r.accessExpiresAt, 'RESERVATION_NOT_ACTIVE');
      const transfer = await this.deps.transfer(r.groupId, r.transferId, context.organization.id);
      requireValue(transfer && transfer.objectName === r.objectName && transfer.accessExpiresAt === r.accessExpiresAt, 'TRANSFER_NOT_FOUND');
      assertOwnedTransfer(context, transfer);
      const meta = await this.deps.metadata(r.objectName);
      requireValue(meta && meta.generation && integer(meta.sizeBytes, 'ACTUAL_SIZE', 1) === r.bytes, 'OBJECT_SIZE_MISMATCH');
      // Bytes were reserved in this period; completion remains possible after the month boundary.
      p.reservedBytes -= r.bytes; integer(p.reservedBytes, 'RESERVED'); p.consumedBytes = sum(p.consumedBytes, meta.sizeBytes);
      r.state = 'committed'; r.generation = meta.generation;
      await tx.saveReservation(r); await tx.savePeriod(p);
      await tx.appendEvent({ id: `commit:${r.id}`, kind: 'received_bytes_committed', actor: context.user.id, at: this.deps.now(), data: { bytes: meta.sizeBytes, generation: meta.generation } });
      await this.thresholds(tx, p); return r;
    });
  }
  async grantCapacity(context: StaffContext, org: string, periodId: string, input: { requestId: string; bytes: number; reason: string; externalReference: string }): Promise<void> {
    const actor = staff(context, 'capacity:grant'); identifier(input.requestId); integer(input.bytes, 'EXTRA_BYTES', 1);
    requireValue(typeof input.reason === 'string' && input.reason.trim().length > 0 && input.reason.length <= 1000 && typeof input.externalReference === 'string' && input.externalReference.trim().length > 0 && input.externalReference.length <= 200, 'GRANT_REASON_REQUIRED');
    await this.store.transaction(org, periodId, async tx => {
      const id = `grant:${input.requestId}`, old = await tx.event(id);
      if (old) { requireValue(same(old.data, input), 'IDEMPOTENCY_CONFLICT'); return; }
      const p = await this.period(tx); requireValue(this.deps.now() >= p.startsAt && this.deps.now() < p.endsAt, 'PERIOD_NOT_ACTIVE');
      p.extraBytes = sum(p.extraBytes, input.bytes); limit(p); await tx.savePeriod(p);
      await tx.appendEvent({ id, kind: 'extra_capacity_granted', actor, at: this.deps.now(), data: { ...input } });
      await this.supersedeOldQuotaNotices(tx, p); await this.thresholds(tx, p);
    });
  }
  /** A reservation is released only after upload authorization has expired AND storage is empty. */
  async releaseExpired(context: StaffContext, org: string, periodId: string, id: string): Promise<boolean> {
    const actor = staff(context, 'usage:process');
    return this.store.transaction(org, periodId, async tx => {
      const p = await this.period(tx), r = await tx.reservation(id);
      requireValue(r && r.organizationId === org && r.periodId === periodId, 'RESERVATION_NOT_FOUND'); if (r.state === 'released') return true;
      requireValue(r.state === 'reserved' && this.deps.now() > r.expiresAt, 'UPLOAD_AUTHORIZATION_NOT_EXPIRED');
      if (!await this.deps.uploadClosed(r)) return false;
      if (await this.deps.metadata(r.objectName)) return false;
      p.reservedBytes -= r.bytes; integer(p.reservedBytes, 'RESERVED'); r.state = 'released';
      await tx.saveReservation(r); await tx.savePeriod(p);
      await tx.appendEvent({ id: `release:${r.id}`, kind: 'reservation_released', actor, at: this.deps.now(), data: {} }); return true;
    });
  }
  async usage(context: TenantContext, periodId: string): Promise<{ period: Period; remainingBytes: number; sendingRestricted: boolean }> {
    assertMembership(context);
    return this.store.transaction(context.organization.id, periodId, async tx => {
      const p = await this.period(tx), available = limit(p) - sum(p.consumedBytes, p.reservedBytes);
      return { period: p, remainingBytes: Math.max(0, available), sendingRestricted: !p.sendingEnabled || available <= 0 || this.deps.now() < p.startsAt || this.deps.now() >= p.endsAt };
    });
  }
  async management(context: TenantContext, periodId: string, activeSenders: (org: string) => Promise<number>) {
    assertCustomerAdmin(context); const result = await this.usage(context, periodId);
    const active = integer(await activeSenders(context.organization.id), 'ACTIVE_SENDERS');
    return { ...result, activeSenders: active, contractedSenders: result.period.contractedSenders,
      senderMismatch: active > result.period.contractedSenders };
  }
  async recordDownload(context: StaffContext, observation: DownloadObservation): Promise<void> {
    const actor = staff(context, 'usage:process'); identifier(observation.id); integer(observation.bytes, 'OBSERVED_BYTES'); integer(observation.at, 'OBSERVATION_TIME');
    requireValue(['issued_estimate', 'observed_egress'].includes(observation.kind) && ['recipient', 'scan'].includes(observation.purpose), 'INVALID_OBSERVATION');
    if (observation.purpose === 'scan') return;
    await this.store.transaction(observation.organizationId, observation.periodId, async tx => {
      const p = await this.period(tx); requireValue(observation.at >= p.startsAt && observation.at < p.endsAt && observation.at <= this.deps.now(), 'OBSERVATION_OUTSIDE_PERIOD');
      const old = await tx.observation(observation.id);
      if (old) { requireValue(same(old, observation), 'IDEMPOTENCY_CONFLICT'); return; }
      await tx.insertObservation(observation); const window = downloadWindow(observation, p.plan), bytes = await tx.windowBytes(window);
      const id = `download:${window}`;
      if (bytes >= p.plan.downloadAlertBytes && !await tx.notice(id)) {
        await tx.saveNotice({ id, kind: 'download_anomaly', state: 'pending', attempts: 0, nextAttemptAt: this.deps.now(), leaseId: null,
          periodStartsAt: p.startsAt, periodEndsAt: p.endsAt,
          leaseUntil: 0, thresholdBytes: p.plan.downloadAlertBytes, observedBytes: bytes, lastError: null });
        await tx.appendEvent({ id, kind: 'download_anomaly_detected', actor, at: this.deps.now(), data: { window, bytes, kind: observation.kind } });
      }
    });
  }
  /** Claim outside SMTP, fence late workers. Failure does not roll back quota or prevent downloads. */
  async deliverNotice(context: StaffContext, org: string, periodId: string, id: string,
    options: { leaseMs: number; retryDelayMs: number; maxAttempts: number },
    sendToCurrentAdmins: (organizationId: string, notice: Notice) => Promise<void>): Promise<boolean> {
    staff(context, 'usage:process'); for (const value of Object.values(options)) integer(value, 'DELIVERY_OPTIONS', 1);
    const token = identifier(this.deps.newId()), now = this.deps.now();
    const notice = await this.store.transaction(org, periodId, async tx => {
      const n = await tx.notice(id); requireValue(n, 'NOTICE_NOT_FOUND');
      if (n.state === 'sent' || n.state === 'failed' || n.state === 'superseded' || n.nextAttemptAt > now || (n.state === 'sending' && n.leaseUntil > now)) return null;
      if (n.attempts >= options.maxAttempts) { n.state = 'failed'; n.lastError = 'RETRY_EXHAUSTED'; await tx.saveNotice(n); return null; }
      n.state = 'sending'; n.leaseId = token; n.leaseUntil = sum(now, options.leaseMs); n.attempts++;
      await tx.saveNotice(n); return n;
    });
    if (!notice) return false;
    let delivered = true; try { await sendToCurrentAdmins(org, notice); } catch { delivered = false; }
    await this.store.transaction(org, periodId, async tx => {
      const n = await tx.notice(id); requireValue(n, 'NOTICE_NOT_FOUND'); if (n.leaseId !== token) return;
      n.state = delivered ? 'sent' : n.attempts >= options.maxAttempts ? 'failed' : 'pending';
      n.lastError = delivered ? null : 'DELIVERY_FAILED'; n.nextAttemptAt = sum(this.deps.now(), options.retryDelayMs);
      n.leaseId = null; n.leaseUntil = 0; await tx.saveNotice(n);
    }); return delivered;
  }
  async deleteExpired(context: StaffContext, org: string, periodId: string, id: string): Promise<boolean> {
    const actor = staff(context, 'usage:process');
    return this.store.transaction(org, periodId, async tx => {
      const r = await tx.reservation(id); requireValue(r && r.organizationId === org && r.periodId === periodId, 'RESERVATION_NOT_FOUND');
      if (r.state === 'deleted') return true;
      requireValue(r.state === 'committed' && r.generation && this.deps.now() >= r.accessExpiresAt, 'OBJECT_NOT_DELETABLE');
      await this.deps.deleteGeneration(r.objectName, r.generation); // Conditional generation delete; 404 is success, 412 is failure.
      r.state = 'deleted'; await tx.saveReservation(r);
      await tx.appendEvent({ id: `delete:${id}`, kind: 'object_deleted', actor, at: this.deps.now(), data: { generation: r.generation } });
      // Monthly usage is not refunded by retention deletion.
      return true;
    });
  }
}
