import type { Pool } from 'pg';
import type { GroupRecipient, TransferGroup } from '../domain/transfer';

interface TransferGroupRow {
  id: string;
  sender_email: string;
  sender_name: string | null;
  recipient_note: string | null;
  token_hash: string;
  expires_at: Date;
  max_downloads: number;
  download_count: number;
  revoked_at: Date | null;
  notified_at: Date | null;
  created_at: Date;
}

function toGroup(row: TransferGroupRow): TransferGroup {
  return {
    id: row.id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    recipientNote: row.recipient_note,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    maxDownloads: row.max_downloads,
    downloadCount: row.download_count,
    revokedAt: row.revoked_at,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
  };
}

export interface CreateTransferGroupInput {
  senderEmail: string;
  senderName: string;
  to: string[];
  cc: string[];
  recipientNote: string | null;
  tokenHash: string;
  expiresAt: Date;
  maxDownloads: number;
}

/**
 * 1回のフォーム送信(1〜複数ファイル)を表すエンティティ。ダウンロードURL・OTP認証・期限・DL回数は
 * ここに一本化されており、受信者はグループ単位で1つのリンク・1回のOTP認証で全ファイルにアクセスする。
 */
export class TransferGroupRepo {
  constructor(private readonly pool: Pool) {}

  /** transfer_groups本体とTo/CC宛先(transfer_group_recipients)を1トランザクションで作成する。 */
  async create(input: CreateTransferGroupInput): Promise<TransferGroup> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<TransferGroupRow>(
        `INSERT INTO transfer_groups
           (sender_email, sender_name, recipient_note, token_hash, expires_at, max_downloads)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [input.senderEmail, input.senderName, input.recipientNote, input.tokenHash, input.expiresAt, input.maxDownloads],
      );
      const row = rows[0];
      if (!row) throw new Error('Failed to create transfer group');

      const recipients: Array<{ email: string; kind: 'to' | 'cc' }> = [
        ...input.to.map((email) => ({ email, kind: 'to' as const })),
        ...input.cc.map((email) => ({ email, kind: 'cc' as const })),
      ];
      for (const r of recipients) {
        await client.query(
          'INSERT INTO transfer_group_recipients (group_id, email, kind) VALUES ($1, $2, $3)',
          [row.id, r.email, r.kind],
        );
      }

      await client.query('COMMIT');
      return toGroup(row);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findRecipients(groupId: string): Promise<GroupRecipient[]> {
    const { rows } = await this.pool.query<{ email: string; kind: 'to' | 'cc' }>(
      'SELECT email, kind FROM transfer_group_recipients WHERE group_id = $1 ORDER BY kind, email',
      [groupId],
    );
    return rows.map((r) => ({ email: r.email, kind: r.kind }));
  }

  /** ダウンロードページで入力されたメールアドレスが、このグループの登録済みTo宛先かどうか(大文字小文字を無視)。 */
  async isToRecipient(groupId: string, email: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM transfer_group_recipients
        WHERE group_id = $1 AND kind = 'to' AND lower(email) = lower($2)`,
      [groupId, email],
    );
    return rows.length > 0;
  }

  async findById(id: string): Promise<TransferGroup | null> {
    const { rows } = await this.pool.query<TransferGroupRow>('SELECT * FROM transfer_groups WHERE id = $1', [id]);
    const row = rows[0];
    return row ? toGroup(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<TransferGroup | null> {
    const { rows } = await this.pool.query<TransferGroupRow>(
      'SELECT * FROM transfer_groups WHERE token_hash = $1',
      [tokenHash],
    );
    const row = rows[0];
    return row ? toGroup(row) : null;
  }

  async listBySender(senderEmail: string, limit = 50): Promise<TransferGroup[]> {
    const { rows } = await this.pool.query<TransferGroupRow>(
      'SELECT * FROM transfer_groups WHERE sender_email = $1 ORDER BY created_at DESC LIMIT $2',
      [senderEmail, limit],
    );
    return rows.map(toGroup);
  }

  /**
   * 統合通知メールの送信権を排他的に獲得する。既に他のリクエストが獲得済みならfalseを返す
   * (グループ内の複数ファイルのスキャンがほぼ同時に完了した場合の二重送信防止)。
   */
  async claimForNotification(groupId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'UPDATE transfer_groups SET notified_at = now() WHERE id = $1 AND notified_at IS NULL',
      [groupId],
    );
    return (rowCount ?? 0) > 0;
  }

  async incrementDownload(id: string): Promise<void> {
    await this.pool.query('UPDATE transfer_groups SET download_count = download_count + 1 WHERE id = $1', [id]);
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query('UPDATE transfer_groups SET revoked_at = now() WHERE id = $1', [id]);
  }
}
