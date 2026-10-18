import { randomUUID } from 'crypto';
import type { UsageSqlPool } from './pgCommercialUsageStore';
import { PgCommercialUsageStore } from './pgCommercialUsageStore';
import { CommercialUsageService, type StaffContext } from './commercialUsageService';
import type { CommercialGcs } from './commercialGcs';
import { createUsageAdminNotifier, type UsageAdminContact } from './commercialUsageNotifications';
import type { Mailer } from './mailer';
import { discoverUsageWork, processUsageWork } from './commercialUsageJobs';

/** Runtime composition only. Does not start a worker, accept customer staff grants, or create infrastructure. */
export function commercialUsageRuntime(pool: UsageSqlPool, gcs: CommercialGcs) {
  return new CommercialUsageService(new PgCommercialUsageStore(pool), {
    now: Date.now, newId: randomUUID,
    transfer: async () => { throw new Error('Transaction-bound transfer resolver required'); },
    metadata: n => gcs.metadata(n), deleteGeneration: (n,g) => gcs.deleteGeneration(n,g),
    uploadClosed: async () => false,
  });
}

export async function runCommercialUsageBatch(pool: UsageSqlPool, service: CommercialUsageService,
  staff: StaffContext, mailer: Pick<Mailer,'sendUsageNotice'>,
  options: { serviceName: string; maxWork: number; leaseMs: number; retryDelayMs: number; maxAttempts: number }) {
  const notifier = createUsageAdminNotifier(async org => {
    const c=await pool.connect();
    try {
      const {rows}=await c.query(`SELECT o.id AS organization_id,o.status AS organization_status,
        m.role,m.status AS membership_status,u.status AS user_status,i.email
        FROM organizations o JOIN memberships m ON m.organization_id=o.id JOIN users u ON u.id=m.user_id
        JOIN user_identities i ON i.user_id=u.id WHERE o.id=$1 AND o.status='active'
          AND m.role='admin' AND m.status='active' AND u.status='active'`,[org]);
      return rows.map(r => ({organizationId:String(r.organization_id),organizationStatus:r.organization_status,
        role:r.role,membershipStatus:r.membership_status,userStatus:r.user_status,email:String(r.email)}) as UsageAdminContact);
    } finally { c.release(); }
  },{send:(to,subject,text)=>mailer.sendUsageNotice(to,subject,text)},options);
  const work=await discoverUsageWork(pool,staff,Date.now(),options.maxWork);
  return processUsageWork(staff,service,work,options,notifier);
}

/** Records signed-URL issuance estimates only; not actual network egress or billing. */
export function commercialDownloadObserver(pool: UsageSqlPool, service: CommercialUsageService) {
  return async (groupId: string, bytes: number): Promise<void> => {
    const at=Date.now(), c=await pool.connect();
    let row: Record<string,unknown> | undefined;
    try {
      row=(await c.query(`SELECT p.organization_id,p.period_id FROM transfer_groups g
        JOIN send_usage_periods p ON p.organization_id=g.organization_id WHERE g.id=$1
        AND (p.allowance->>'startsAt')::bigint<=$2 AND (p.allowance->>'endsAt')::bigint>$2`,[groupId,at])).rows[0];
    } finally { c.release(); }
    if (!row) return; // Legacy/unconfigured period: no fabricated usage attribution, no receiving restriction.
    await service.recordDownload({actorId:'recipient-url-observer',permissions:['usage:process']},
      {id:randomUUID(),organizationId:String(row.organization_id),periodId:String(row.period_id),at,bytes,
        kind:'issued_estimate',purpose:'recipient'});
  };
}
