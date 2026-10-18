import type { TenantContext } from '../domain/tenantAuthorization';
import { assertSender } from '../domain/tenantAuthorization';
import { requireValue, retentionDeadline, assertNewSend } from '../domain/commercialUsage';
import type { Reservation } from '../domain/commercialUsage';
import type { CommercialUsageService } from './commercialUsageService';
import type { CommercialGcs } from './commercialGcs';
import type { UsageSqlPool } from './pgCommercialUsageStore';

/** Per-request bridge. All period/reservation identifiers come from scoped persistence. */
export class CommercialSendConnection {
  constructor(private readonly principal: TenantContext, private readonly pool: UsageSqlPool,
    private readonly usageService: CommercialUsageService, private readonly gcs: CommercialGcs,
    private readonly now: () => number = Date.now) {}

  private async query(sql: string, values: unknown[]) {
    const c = await this.pool.connect(); try { return await c.query(sql, values); } finally { c.release(); }
  }
  async currentUsage() {
    assertSender(this.principal);
    const { rows } = await this.query(`SELECT period_id FROM send_usage_periods WHERE organization_id=$1
      AND (allowance->>'startsAt')::bigint <= $2 AND (allowance->>'endsAt')::bigint > $2`,
    [this.principal.organization.id,this.now()]);
    requireValue(rows.length === 1, 'ALLOWANCE_NOT_CONFIGURED');
    return this.usageService.usage(this.principal, String(rows[0]!.period_id));
  }
  async groupDeadline(requestedDays?: number): Promise<Date> {
    const usage = await this.currentUsage(); requireValue(!usage.sendingRestricted,'CAPACITY_EXHAUSTED');
    const days = requestedDays ?? usage.period.plan.retentionDays;
    requireValue(Number.isSafeInteger(days) && days > 0 && days <= usage.period.plan.retentionDays,'INVALID_RETENTION');
    return new Date(retentionDeadline(this.now(), { ...usage.period.plan, retentionDays: days }));
  }
  async assertGroup(groupId: string, sizeBytes?: number): Promise<void> {
    assertSender(this.principal);
    const result = await this.query(`SELECT id FROM transfer_groups WHERE organization_id=$1 AND sender_user_id=$2
      AND id=$3 AND revoked_at IS NULL AND expires_at>now()`,
    [this.principal.organization.id,this.principal.user.id,groupId]);
    requireValue(result.rows.length === 1,'TRANSFER_NOT_FOUND');
    // Early rejection avoids needless pending rows; reserve() is still the authoritative concurrent gate.
    if (sizeBytes !== undefined) assertNewSend((await this.currentUsage()).period,sizeBytes,this.now());
  }
  async reserve(transferId: string, groupId: string, sizeBytes: number, contentType: string) {
    const u = await this.currentUsage();
    const r = await this.usageService.reserve(this.principal,u.period.periodId,
      {requestId:transferId,transferId,groupId,bytes:sizeBytes});
    const grant = await this.gcs.uploadGrant(r,contentType,this.now());
    return { uploadUrl: grant.url, uploadHeaders: grant.headers };
  }
  async complete(transferId: string, groupId: string): Promise<Reservation> {
    assertSender(this.principal);
    const { rows } = await this.query(`SELECT period_id,reservation_id FROM send_usage_reservations
      WHERE organization_id=$1 AND transfer_id=$2 AND payload->>'senderUserId'=$3 AND payload->>'groupId'=$4`,
    [this.principal.organization.id,transferId,this.principal.user.id,groupId]);
    requireValue(rows.length === 1,'RESERVATION_NOT_FOUND');
    return this.usageService.complete(this.principal,String(rows[0]!.period_id),String(rows[0]!.reservation_id));
  }
}
