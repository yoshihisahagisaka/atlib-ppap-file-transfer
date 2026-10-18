import { integer, requireValue } from '../domain/commercialUsage';
import type { Notice } from '../domain/commercialUsage';
import type { StaffContext, CommercialUsageService } from './commercialUsageService';
import type { UsageSqlPool } from './pgCommercialUsageStore';

export interface UsageWork { organizationId: string; periodId: string; id: string; kind: 'notice' | 'delete' | 'release'; }
/** Discovery does not grant access; service methods re-check worker authority and scope. */
export async function discoverUsageWork(pool: UsageSqlPool, context: StaffContext, now: number, max: number): Promise<UsageWork[]> {
  requireValue(context.permissions.includes('usage:process') && context.actorId, 'STAFF_PERMISSION_DENIED');
  integer(now, 'NOW'); integer(max, 'BATCH', 1); requireValue(max <= 500, 'BATCH_TOO_LARGE');
  const c = await pool.connect();
  try {
    const notices = await c.query(`SELECT organization_id::text,period_id,notice_id AS id FROM send_usage_outbox
      WHERE (payload->>'state'='pending' AND (payload->>'nextAttemptAt')::BIGINT <= $1)
      OR (payload->>'state'='sending' AND (payload->>'leaseUntil')::BIGINT <= $1)
      ORDER BY (payload->>'nextAttemptAt')::BIGINT,organization_id,period_id,notice_id LIMIT $2`, [now,max]);
    // Unproven expired uploads stay reserved and are reconciled explicitly. Do not let them starve deletion.
    const reservations = await c.query(`SELECT organization_id::text,period_id,reservation_id AS id,'delete' AS kind
      FROM send_usage_reservations WHERE
      payload->>'state'='committed' AND (payload->>'accessExpiresAt')::BIGINT <= $1
      ORDER BY organization_id,period_id,reservation_id LIMIT $2`, [now,max]);
    return [ ...notices.rows.map(r=>({organizationId:String(r.organization_id),periodId:String(r.period_id),id:String(r.id),kind:'notice' as const})),
      ...reservations.rows.map(r=>({organizationId:String(r.organization_id),periodId:String(r.period_id),id:String(r.id),kind:r.kind as 'delete'|'release'})) ];
  } finally { c.release(); }
}
/** Invoke from an authenticated job/scheduler after separate infrastructure approval. No background timer or auto-start. */
export async function processUsageWork(context: StaffContext, service: CommercialUsageService, work: readonly UsageWork[],
  options: { leaseMs: number; retryDelayMs: number; maxAttempts: number },
  notifier: (organizationId: string, notice: Notice) => Promise<void>) {
  requireValue(context.permissions.includes('usage:process'), 'STAFF_PERMISSION_DENIED');
  const result = { completed: 0, deferred: 0, failed: 0 };
  for (const item of work) {
    try {
      const ok = item.kind === 'notice' ? await service.deliverNotice(context,item.organizationId,item.periodId,item.id,options,notifier)
        : item.kind === 'delete' ? await service.deleteExpired(context,item.organizationId,item.periodId,item.id)
          : await service.releaseExpired(context,item.organizationId,item.periodId,item.id);
      if (ok) result.completed++; else result.deferred++;
    } catch { result.failed++; } // Never print raw SMTP/GCS errors, URLs or file names.
  }
  return result;
}
