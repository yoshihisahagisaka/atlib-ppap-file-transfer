import type { Pool } from 'pg';
import type { AuditEvent } from '../domain/transfer';

export interface AuditLogEntry {
  id: string;
  createdAt: Date;
  event: AuditEvent;
  actor: string | null;
  ipAddress: string | null;
  detail: Record<string, unknown> | null;
  transferId: string | null;
  groupId: string | null;
  originalFilename: string | null;
  senderEmail: string | null;
  recipientEmail: string | null;
}

interface AuditLogRow {
  id: string;
  created_at: Date;
  event: AuditEvent;
  actor: string | null;
  ip_address: string | null;
  detail: Record<string, unknown> | null;
  transfer_id: string | null;
  group_id: string | null;
  original_filename: string | null;
  sender_email: string | null;
  recipient_email: string | null;
}

function toEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    event: row.event,
    actor: row.actor,
    ipAddress: row.ip_address,
    detail: row.detail,
    transferId: row.transfer_id,
    groupId: row.group_id,
    originalFilename: row.original_filename,
    senderEmail: row.sender_email,
    recipientEmail: row.recipient_email,
  };
}

export class AuditLogRepo {
  constructor(private readonly pool: Pool) {}

  async log(params: {
    transferId: string | null;
    groupId?: string | null;
    event: AuditEvent;
    actor: string | null;
    ipAddress: string | null;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (transfer_id, group_id, event, actor, ip_address, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.transferId, params.groupId ?? null, params.event, params.actor, params.ipAddress, params.detail ?? null],
    );
  }

  /**
   * 監査ログ閲覧画面向け。全ユーザー分を横断して直近分を新しい順に返す。
   * ファイル単位のイベント(uploaded/scan_clean等)はtransfersを、グループ単位のイベント
   * (created/otp_requested/otp_verified/downloaded/revoked等)はtransfer_groupsを参照して
   * ファイル名・送信者・宛先を補完する(COALESCEでどちらか存在する方を採用)。
   */
  async listRecent(limit = 200): Promise<AuditLogEntry[]> {
    const { rows } = await this.pool.query<AuditLogRow>(
      `SELECT al.id, al.created_at, al.event, al.actor, al.ip_address, al.detail, al.transfer_id, al.group_id,
              t.original_filename,
              COALESCE(t.sender_email, g.sender_email) AS sender_email,
              COALESCE(t.recipient_email, g.recipient_email) AS recipient_email
         FROM audit_logs al
         LEFT JOIN transfers t ON t.id = al.transfer_id
         LEFT JOIN transfer_groups g ON g.id = al.group_id
        ORDER BY al.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map(toEntry);
  }
}
