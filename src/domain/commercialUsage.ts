/** Service-local entitlements. No prices, billing, union ordering or default unlimited quota. */
export class UsageError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function requireValue(ok: unknown, code: string): asserts ok {
  if (!ok) throw new UsageError(code);
}
export function integer(value: number, name: string, minimum = 0): number {
  requireValue(Number.isSafeInteger(value) && value >= minimum, `INVALID_${name}`); return value;
}
export function sum(...values: number[]): number {
  return integer(values.reduce((a, b) => a + integer(b, 'BYTES'), 0), 'TOTAL');
}
export function identifier(value: string): string {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value), 'INVALID_ID'); return value;
}
export interface UsagePlan {
  id: string; version: string; bytesPerContractedSender: number; maxFileBytes: number;
  warningPercent: number; reservationTtlMs: number; retentionDays: number;
  downloadWindowMs: number; downloadAlertBytes: number;
  countingMode: 'received_bytes';
}
export function validatePlan(plan: UsagePlan): void {
  requireValue(plan && typeof plan === 'object', 'INVALID_POLICY');
  identifier(plan.id); identifier(plan.version);
  for (const [name, v] of Object.entries(plan)) {
    if (typeof v === 'number') integer(v, name, 1);
  }
  requireValue(plan.warningPercent < 100 && plan.countingMode === 'received_bytes', 'UNSUPPORTED_POLICY');
  // Missing properties must not bypass Object.entries checks.
  for (const v of [plan.bytesPerContractedSender, plan.maxFileBytes, plan.warningPercent,
    plan.reservationTtlMs, plan.retentionDays, plan.downloadWindowMs, plan.downloadAlertBytes]) integer(v, 'POLICY', 1);
}
export function fullMonthCapacity(plan: UsagePlan, contractedSenders: number): number {
  validatePlan(plan); return integer(plan.bytesPerContractedSender * integer(contractedSenders, 'CONTRACTED_SENDERS'), 'CAPACITY');
}
export function retentionDeadline(createdAt: number, plan: UsagePlan): number {
  validatePlan(plan); return sum(integer(createdAt, 'CREATED_AT'), integer(plan.retentionDays * 86400000, 'RETENTION'));
}
export interface Allowance {
  organizationId: string; periodId: string; startsAt: number; endsAt: number;
  contractedSenders: number; baseQuotaBytes: number; sourceOrderId: string;
  sourceRevision: number; effectiveAt: number; sendingEnabled: boolean; plan: UsagePlan;
}
export interface Period extends Allowance { consumedBytes: number; reservedBytes: number; extraBytes: number; }
export function validateAllowance(a: Allowance, now: number): void {
  identifier(a.organizationId); identifier(a.periodId); identifier(a.sourceOrderId); validatePlan(a.plan);
  for (const v of [a.startsAt, a.endsAt, a.effectiveAt]) integer(v, 'TIME');
  integer(a.sourceRevision, 'REVISION', 1); integer(a.contractedSenders, 'CONTRACTED_SENDERS');
  integer(a.baseQuotaBytes, 'CAPACITY'); requireValue(typeof a.sendingEnabled === 'boolean', 'INVALID_STATUS');
  requireValue(a.startsAt < a.endsAt && a.effectiveAt <= now && a.effectiveAt >= a.startsAt && a.effectiveAt < a.endsAt, 'ALLOWANCE_NOT_EFFECTIVE');
  // Explicit external snapshot: partial-period treatment is NOT inferred here.
  requireValue(a.baseQuotaBytes <= fullMonthCapacity(a.plan, a.contractedSenders), 'CAPACITY_EXCEEDS_CONTRACT');
}
export function limit(period: Period): number { return sum(period.baseQuotaBytes, period.extraBytes); }
export function assertNewSend(period: Period, bytes: number, now: number): void {
  integer(bytes, 'SIZE', 1);
  requireValue(period.sendingEnabled && now >= period.startsAt && now < period.endsAt, 'SENDING_UNAVAILABLE');
  requireValue(bytes <= period.plan.maxFileBytes, 'FILE_TOO_LARGE');
  requireValue(sum(period.consumedBytes, period.reservedBytes, bytes) <= limit(period), 'QUOTA_EXCEEDED');
}
export interface Reservation {
  id: string; organizationId: string; periodId: string; senderUserId: string;
  groupId: string; transferId: string; objectName: string; bytes: number;
  createdAt: number; expiresAt: number; accessExpiresAt: number;
  state: 'reserved' | 'committed' | 'released' | 'deleted'; generation: string | null;
  scan: 'pending' | 'clean' | 'infected';
}
export interface UsageEvent { id: string; kind: string; actor: string; at: number; data: Record<string, unknown>; }
export interface Notice {
  id: string; kind: 'quota_warning' | 'quota_full' | 'download_anomaly';
  periodStartsAt: number; periodEndsAt: number;
  state: 'pending' | 'sending' | 'sent' | 'failed' | 'superseded'; attempts: number;
  nextAttemptAt: number; leaseId: string | null; leaseUntil: number;
  thresholdBytes: number; observedBytes: number; lastError: string | null;
}
export interface DownloadObservation {
  id: string; organizationId: string; periodId: string; at: number; bytes: number;
  kind: 'issued_estimate' | 'observed_egress'; purpose: 'recipient' | 'scan';
}
/** Persisted windows keep estimates and measured recipient traffic strictly separate. */
export function downloadWindow(o: DownloadObservation, plan: UsagePlan): string {
  return `${o.kind}:${Math.floor(o.at / plan.downloadWindowMs)}`;
}
