import { identifier, integer, requireValue, validatePlan } from '../domain/commercialUsage';
import type { Period, Reservation, UsageEvent, Notice, DownloadObservation } from '../domain/commercialUsage';
import type { UsageStore, UsageTransaction } from './commercialUsageStore';

export interface UsageSqlClient {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface UsageSqlPool { connect(): Promise<UsageSqlClient>; }
function payload<T>(rows: Record<string, unknown>[]): T | null { return rows[0] ? rows[0].payload as T : null; }

/** All reads/writes include trusted org and period. Advisory lock covers initial creation too. */
export class PgCommercialUsageStore implements UsageStore {
  private pool: UsageSqlPool;
  constructor(pool: UsageSqlPool) { this.pool = pool; }
  async transaction<T>(org: string, periodId: string, work: (tx: UsageTransaction) => Promise<T>): Promise<T> {
    identifier(org); identifier(periodId); const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      // Serialize all periods of one org to protect global transfer uniqueness and allowance updates.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`send-usage:${org}`]);
      const q = (sql: string, args: unknown[] = []) => c.query(sql, [org, periodId, ...args]);
      const read = async <V>(table: string, keyColumn: string, key: string): Promise<V | null> =>
        payload<V>((await q(`SELECT payload FROM ${table} WHERE organization_id=$1 AND period_id=$2 AND ${keyColumn}=$3`, [key])).rows);
      const tx: UsageTransaction = {
        overlapsOtherPeriod: async (startsAt,endsAt) => (await q(`SELECT 1 FROM send_usage_periods WHERE organization_id=$1 AND period_id<>$2
          AND (allowance->>'startsAt')::BIGINT < $3 AND (allowance->>'endsAt')::BIGINT > $4 LIMIT 1`,[endsAt,startsAt])).rows.length > 0,
        period: async () => {
          const row = (await q('SELECT allowance, consumed_bytes, reserved_bytes, extra_bytes FROM send_usage_periods WHERE organization_id=$1 AND period_id=$2')).rows[0];
          if (!row) return null;
          const a = row.allowance as Period;
          requireValue(a.organizationId === org && a.periodId === periodId, 'PERSISTENCE_SCOPE_MISMATCH'); validatePlan(a.plan);
          return { ...a, consumedBytes: integer(Number(row.consumed_bytes), 'CONSUMED'), reservedBytes: integer(Number(row.reserved_bytes), 'RESERVED'), extraBytes: integer(Number(row.extra_bytes), 'EXTRA') };
        },
        savePeriod: async p => {
          requireValue(p.organizationId === org && p.periodId === periodId, 'PERSISTENCE_SCOPE_MISMATCH');
          const { consumedBytes, reservedBytes, extraBytes, ...allowance } = p;
          await q(`INSERT INTO send_usage_periods(organization_id,period_id,allowance,consumed_bytes,reserved_bytes,extra_bytes)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,period_id) DO UPDATE SET
            allowance=EXCLUDED.allowance,consumed_bytes=EXCLUDED.consumed_bytes,reserved_bytes=EXCLUDED.reserved_bytes,extra_bytes=EXCLUDED.extra_bytes`,
          [JSON.stringify(allowance), integer(consumedBytes,'CONSUMED'), integer(reservedBytes,'RESERVED'), integer(extraBytes,'EXTRA')]);
        },
        reservation: id => read<Reservation>('send_usage_reservations','reservation_id',id),
        saveReservation: async r => {
          requireValue(r.organizationId === org && r.periodId === periodId, 'PERSISTENCE_SCOPE_MISMATCH');
          await q(`INSERT INTO send_usage_reservations(organization_id,period_id,reservation_id,transfer_id,object_name,payload)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,period_id,reservation_id) DO UPDATE SET payload=EXCLUDED.payload`,
          [r.id,r.transferId,r.objectName,JSON.stringify(r)]);
        },
        event: id => read<UsageEvent>('send_usage_events','event_id',id),
        appendEvent: async e => { await q('INSERT INTO send_usage_events(organization_id,period_id,event_id,payload) VALUES($1,$2,$3,$4)',[e.id,JSON.stringify(e)]); },
        notice: id => read<Notice>('send_usage_outbox','notice_id',id),
        saveNotice: async n => { await q(`INSERT INTO send_usage_outbox(organization_id,period_id,notice_id,payload)
          VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,period_id,notice_id) DO UPDATE SET payload=EXCLUDED.payload`,[n.id,JSON.stringify(n)]); },
        observation: id => read<DownloadObservation>('send_download_observations','observation_id',id),
        insertObservation: async o => {
          requireValue(o.organizationId === org && o.periodId === periodId, 'PERSISTENCE_SCOPE_MISMATCH');
          const p = await tx.period(); requireValue(p, 'ALLOWANCE_NOT_CONFIGURED');
          const window = `${o.kind}:${Math.floor(o.at / p.plan.downloadWindowMs)}`;
          await q('INSERT INTO send_download_observations(organization_id,period_id,observation_id,window_key,bytes,payload) VALUES($1,$2,$3,$4,$5,$6)',[o.id,window,integer(o.bytes,'OBSERVED_BYTES'),JSON.stringify(o)]);
        },
        windowBytes: async window => {
          const row = (await q('SELECT COALESCE(sum(bytes),0)::text AS total FROM send_download_observations WHERE organization_id=$1 AND period_id=$2 AND window_key=$3',[window])).rows[0];
          return integer(Number(row?.total), 'WINDOW_BYTES');
        },
      };
      const result = await work(tx); await c.query('COMMIT'); return result;
    } catch (e) { try { await c.query('ROLLBACK'); } catch { /* Preserve the originating failure. */ } throw e; } finally { c.release(); }
  }
}
