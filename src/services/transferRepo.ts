import type { Pool } from 'pg';
import type { Transfer, TransferStatus } from '../domain/transfer';

interface TransferRow {
  id: string;
  group_id: string | null;
  sender_email: string;
  original_filename: string;
  content_type: string;
  size_bytes: string;
  storage_object: string;
  status: TransferStatus;
  uploaded_at: Date | null;
  scanned_at: Date | null;
  created_at: Date;
}

function toTransfer(row: TransferRow): Transfer {
  return {
    id: row.id,
    groupId: row.group_id,
    senderEmail: row.sender_email,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    storageObject: row.storage_object,
    status: row.status,
    uploadedAt: row.uploaded_at,
    scannedAt: row.scanned_at,
    createdAt: row.created_at,
  };
}

export interface CreateTransferInput {
  groupId: string;
  senderEmail: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  storageObject: string;
}

export interface TransferHistoryRow {
  id: string;
  groupId: string;
  recipientEmail: string;
  filename: string;
  sizeBytes: number;
  status: TransferStatus;
  downloadCount: number;
  maxDownloads: number;
  expiresAt: Date;
  groupRevoked: boolean;
  createdAt: Date;
}

export class TransferRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateTransferInput): Promise<Transfer> {
    const { rows } = await this.pool.query<TransferRow>(
      `INSERT INTO transfers (group_id, sender_email, original_filename, content_type, size_bytes, storage_object)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.groupId, input.senderEmail, input.originalFilename, input.contentType, input.sizeBytes, input.storageObject],
    );
    const row = rows[0];
    if (!row) throw new Error('Failed to create transfer');
    return toTransfer(row);
  }

  /** 同じフォーム送信(グループ)内にまだスキャン中のファイルが残っているかを調べる。 */
  async countScanningInGroup(groupId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transfers WHERE group_id = $1 AND status = 'scanning'`,
      [groupId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** グループ完了時の統合通知メール・ダウンロード一覧作成用。clean判定のもののみ返す。 */
  async findCleanInGroup(groupId: string): Promise<Transfer[]> {
    const { rows } = await this.pool.query<TransferRow>(
      `SELECT * FROM transfers WHERE group_id = $1 AND status = 'clean' ORDER BY created_at ASC`,
      [groupId],
    );
    return rows.map(toTransfer);
  }

  async findById(id: string): Promise<Transfer | null> {
    const { rows } = await this.pool.query<TransferRow>('SELECT * FROM transfers WHERE id = $1', [id]);
    const row = rows[0];
    return row ? toTransfer(row) : null;
  }

  async findByStorageObject(storageObject: string): Promise<Transfer | null> {
    const { rows } = await this.pool.query<TransferRow>('SELECT * FROM transfers WHERE storage_object = $1', [
      storageObject,
    ]);
    const row = rows[0];
    return row ? toTransfer(row) : null;
  }

  /** 送信履歴画面向け。宛先・ダウンロード回数・期限・取消状態はグループ側の値を結合して返す。 */
  async listHistoryBySender(senderEmail: string, limit = 50): Promise<TransferHistoryRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      group_id: string;
      recipient_email: string;
      original_filename: string;
      size_bytes: string;
      status: TransferStatus;
      download_count: number;
      max_downloads: number;
      expires_at: Date;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `SELECT t.id, t.group_id,
              COALESCE(
                (SELECT string_agg(email, ', ' ORDER BY email) FROM transfer_group_recipients
                  WHERE group_id = g.id AND kind = 'to'),
                ''
              ) AS recipient_email,
              t.original_filename, t.size_bytes, t.status,
              g.download_count, g.max_downloads, g.expires_at, g.revoked_at, t.created_at
         FROM transfers t
         JOIN transfer_groups g ON g.id = t.group_id
        WHERE t.sender_email = $1
        ORDER BY t.created_at DESC
        LIMIT $2`,
      [senderEmail, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      recipientEmail: row.recipient_email,
      filename: row.original_filename,
      sizeBytes: Number(row.size_bytes),
      status: row.status,
      downloadCount: row.download_count,
      maxDownloads: row.max_downloads,
      expiresAt: row.expires_at,
      groupRevoked: row.revoked_at !== null,
      createdAt: row.created_at,
    }));
  }

  async markUploaded(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE transfers SET status = 'scanning', uploaded_at = now() WHERE id = $1 AND status = 'pending_upload'`,
      [id],
    );
  }

  async markScanResult(id: string, infected: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE transfers SET status = $2, scanned_at = now() WHERE id = $1 AND status = 'scanning'`,
      [id, infected ? 'infected' : 'clean'],
    );
  }
}
