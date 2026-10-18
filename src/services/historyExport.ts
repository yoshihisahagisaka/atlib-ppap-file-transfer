import type { TenantContext } from '../domain/tenantAuthorization';
import { assertCustomerAdmin, AuthorizationDenied } from '../domain/tenantAuthorization';
import type { UsageSqlPool } from './pgCommercialUsageStore';

export type ExportKind = 'transfers' | 'audit';
export interface ExportRange { kind: ExportKind; from: string; to: string; }
export interface ExportLimits { maxDays: number; maxRows: number; maxBytes: number; }
export class HistoryExportError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
/** One explicit model for list, CSV and a future string-cell XLSX writer. No raw audit detail. */
export interface HistoryRow {
  recordedAt: string; uploadedAt: string | null; sender: string | null;
  to: string | null; cc: string | null; filename: string | null; bytes: string | null;
  status: string | null; expiresAt: string | null; revokedAt: string | null;
  groupIssuedCount: number | null; lastGroupIssuedAt: string | null;
  transferId: string | null; groupId: string | null; auditId: string | null;
  event: string | null; actor: string | null;
}
export function validateExportRange(value: ExportRange, limits: ExportLimits): void {
  for (const n of Object.values(limits)) if (!Number.isSafeInteger(n) || n < 1) throw new HistoryExportError('INVALID_EXPORT_LIMITS',500);
  const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  const start=Date.parse(value.from),end=Date.parse(value.to);
  if (!['transfers','audit'].includes(value.kind) || !iso.test(value.from) || !iso.test(value.to) ||
      !Number.isFinite(start) || !Number.isFinite(end) || end<=start || end-start>limits.maxDays*86400000 ||
      new Date(start).toISOString() !== value.from.replace(/Z$/,value.from.includes('.')?'Z':'.000Z') ||
      new Date(end).toISOString() !== value.to.replace(/Z$/,value.to.includes('.')?'Z':'.000Z'))
    throw new HistoryExportError('INVALID_EXPORT_RANGE',400);
}
const columns: ReadonlyArray<readonly [keyof HistoryRow,string]> = [
  ['recordedAt','記録日時(UTC)'],['uploadedAt','アップロード確定日時(UTC)'],['sender','送信者'],
  ['to','To'],['cc','CC'],['filename','ファイル名'],['bytes','記録容量(bytes)'],['status','送信状態コード'],
  ['expiresAt','期限(UTC)'],['revokedAt','取消日時(UTC)'],['groupIssuedCount','送信グループの受信URL発行回数'],
  ['lastGroupIssuedAt','送信グループの最終受信URL発行監査日時(UTC)'],['transferId','送信ID'],['groupId','送信グループID'],
  ['auditId','監査ID'],['event','監査イベントコード'],['actor','監査操作主体'],
];
export function csvCell(value: unknown): string {
  let s=value===null||value===undefined?'':String(value);
  // Quoting alone does not prevent spreadsheet formulas, including whitespace-prefixed payloads.
  if (/^[\s\x00-\x1f\x7f]*[=+\-@]/u.test(s) || /^[\t\r\n]/.test(s)) s="'"+s;
  s=s.replace(/\x00/g,'');
  return '"'+s.replace(/"/g,'""')+'"';
}
export function writeHistoryCsv(rows: readonly HistoryRow[], maxBytes: number): Buffer {
  const lines=[columns.map(([,label])=>csvCell(label)).join(',')];
  let bytes=Buffer.byteLength('\ufeff'+lines[0]+'\r\n');
  for (const row of rows) {
    const line=columns.map(([key])=>csvCell(row[key])).join(','); bytes+=Buffer.byteLength(line+'\r\n');
    if(bytes>maxBytes)throw new HistoryExportError('EXPORT_TOO_LARGE',413);lines.push(line);
  }
  if(bytes>maxBytes)throw new HistoryExportError('EXPORT_TOO_LARGE',413);
  return Buffer.from('\ufeff'+lines.join('\r\n')+'\r\n','utf8');
}
const recipients=`LEFT JOIN LATERAL (SELECT
  string_agg(email, '; ' ORDER BY email) FILTER(WHERE kind='to') AS to_emails,
  string_agg(email, '; ' ORDER BY email) FILTER(WHERE kind='cc') AS cc_emails
  FROM transfer_group_recipients WHERE group_id=g.id) recipients ON true`;
const lastDownload=`LEFT JOIN LATERAL (SELECT max(d.created_at) AS last_issued_at FROM audit_logs d
  WHERE d.group_id=g.id AND d.event='downloaded' AND d.transfer_id IS NULL) dl ON true`;
const selectFields=`t.uploaded_at,COALESCE(t.sender_email,g.sender_email) AS sender,recipients.to_emails,recipients.cc_emails,
  t.original_filename,t.size_bytes,t.status,g.expires_at,g.revoked_at,g.download_count,dl.last_issued_at`;
function date(value: unknown): string | null { return value==null ? null : new Date(value as string).toISOString(); }
function nullable(value: unknown): string | null { return value==null ? null : String(value); }
function mapRow(r: Record<string,unknown>): HistoryRow {
  return {recordedAt:date(r.recorded_at)!,uploadedAt:date(r.uploaded_at),sender:nullable(r.sender),
    to:nullable(r.to_emails),cc:nullable(r.cc_emails),filename:nullable(r.original_filename),bytes:nullable(r.size_bytes),
    status:nullable(r.status),expiresAt:date(r.expires_at),revokedAt:date(r.revoked_at),
    groupIssuedCount:r.download_count==null?null:Number(r.download_count),lastGroupIssuedAt:date(r.last_issued_at),
    transferId:nullable(r.transfer_id),groupId:nullable(r.group_id),auditId:nullable(r.audit_id),
    event:nullable(r.event),actor:nullable(r.actor)};
}

export class HistoryExportService {
  constructor(private readonly pool: UsageSqlPool,private readonly limits: ExportLimits) {}
  async read(context: TenantContext, range: ExportRange, options: {exportCsv: boolean; offset?: number; limit?: number; ip?: string | null}) {
    assertCustomerAdmin(context);validateExportRange(range,this.limits);
    const offset=options.exportCsv?0:options.offset??0, count=options.exportCsv?this.limits.maxRows:options.limit??100;
    if(!Number.isSafeInteger(offset)||offset<0||offset>this.limits.maxRows||!Number.isSafeInteger(count)||count<1||count>this.limits.maxRows)
      throw new HistoryExportError('INVALID_PAGE',400);
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='15s'");
      // Same existing admin role, checked again from current DB under locks. No sender-seat requirement.
      const auth=await c.query(`SELECT m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id
        JOIN users u ON u.id=m.user_id WHERE o.id=$1 AND u.id=$2 AND o.status='active'
        AND u.status='active' AND m.status='active' AND m.role='admin' FOR SHARE OF o,m,u`,[context.organization.id,context.user.id]);
      if(auth.rows.length!==1)throw new AuthorizationDenied();
      const args=[context.organization.id,range.from,range.to,count+1,offset];
      const sql=range.kind==='transfers' ? `SELECT t.created_at AS recorded_at,${selectFields},
        t.id AS transfer_id,g.id AS group_id,uploaded.id AS audit_id,NULL::text AS event,NULL::text AS actor
        FROM transfers t JOIN transfer_groups g ON g.id=t.group_id AND g.organization_id=t.organization_id
        ${recipients} ${lastDownload}
        LEFT JOIN LATERAL (SELECT a.id FROM audit_logs a WHERE a.transfer_id=t.id AND a.event='uploaded'
          AND (a.group_id IS NULL OR a.group_id=g.id) ORDER BY a.created_at,a.id LIMIT 1) uploaded ON true
        WHERE t.organization_id=$1 AND t.created_at>=$2 AND t.created_at<$3
        ORDER BY t.created_at,t.id LIMIT $4 OFFSET $5` : `SELECT a.created_at AS recorded_at,${selectFields},
        t.id AS transfer_id,g.id AS group_id,a.id AS audit_id,a.event,a.actor
        FROM audit_logs a LEFT JOIN transfers t ON t.id=a.transfer_id AND t.organization_id=$1
        LEFT JOIN transfer_groups g ON g.id=COALESCE(a.group_id,t.group_id) AND g.organization_id=$1
        ${recipients} ${lastDownload}
        WHERE a.created_at>=$2 AND a.created_at<$3 AND (
          (a.transfer_id IS NOT NULL AND t.id IS NOT NULL AND g.id=t.group_id AND (a.group_id IS NULL OR a.group_id=t.group_id))
          OR (a.transfer_id IS NULL AND g.id IS NOT NULL)
          OR (a.transfer_id IS NULL AND a.group_id IS NULL AND a.event='history_exported' AND a.detail->>'organizationId'=$1::text))
        ORDER BY a.created_at,a.id LIMIT $4 OFFSET $5`;
      const result=await c.query(sql,args),more=result.rows.length>count;
      if(options.exportCsv&&more)throw new HistoryExportError('EXPORT_TOO_MANY_ROWS',413);
      const rows=result.rows.slice(0,count).map(mapRow);
      const csv=options.exportCsv?writeHistoryCsv(rows,this.limits.maxBytes):null;
      let operationId: string | null=null;
      if(options.exportCsv) {
        const audit=await c.query(`INSERT INTO audit_logs(transfer_id,group_id,event,actor,ip_address,detail)
          VALUES(NULL,NULL,'history_exported',$1,$2,$3) RETURNING id`,[context.user.id,options.ip??null,
          JSON.stringify({organizationId:context.organization.id,kind:range.kind,from:range.from,to:range.to,format:'csv',rows:rows.length,state:'generated'})]);
        if(!audit.rows[0]?.id)throw new HistoryExportError('EXPORT_AUDIT_FAILED',500);operationId=String(audit.rows[0].id);
      }
      await c.query('COMMIT');return {rows,hasMore:more,csv,operationId};
    } catch(e) {try{await c.query('ROLLBACK');}catch{}throw e;}finally{c.release();}
  }
}
