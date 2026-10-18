import type { Pool } from 'pg';
import { generateOtpCode, hashOtpCode, verifyOtpCode } from './tokenService';

export type OtpVerifyStatus = 'ok' | 'invalid' | 'expired' | 'locked' | 'not_found';
export interface OtpVerifyResult {
  status: OtpVerifyStatus;
  /** 検証対象OTPが実際にどのTo宛先向けに発行されたか(監査ログ用。not_found時はnull)。 */
  recipientEmail: string | null;
}

interface OtpRow {
  id: string;
  code_hash: string;
  recipient_email: string | null;
  expires_at: Date;
  attempt_count: number;
  verified_at: Date | null;
}

export class OtpService {
  constructor(
    private readonly pool: Pool,
    private readonly expiresMinutes: number,
    private readonly maxAttempts: number,
  ) {}

  /**
   * 新しいOTPを発行する(既存の未検証OTPがあっても常に新規発行=最新のものだけが有効)。
   * recipientEmailは、複数To宛先のうちダウンロードページで指定・検証済みのアドレス
   * (呼び出し側でtransferGroupRepo.isToRecipientによる検証を済ませてから渡すこと)。
   */
  async issue(groupId: string, recipientEmail: string): Promise<string> {
    const code = generateOtpCode();
    const codeHash = await hashOtpCode(code);
    const expiresAt = new Date(Date.now() + this.expiresMinutes * 60 * 1000);
    await this.pool.query(
      `INSERT INTO download_otps (group_id, code_hash, recipient_email, expires_at) VALUES ($1, $2, $3, $4)`,
      [groupId, codeHash, recipientEmail, expiresAt],
    );
    return code;
  }

  /** 直近発行分のOTPを検証する。試行回数上限に達している場合はlockedを返す。 */
  async verify(groupId: string, code: string): Promise<OtpVerifyResult> {
    const { rows } = await this.pool.query<OtpRow>(
      `SELECT id, code_hash, recipient_email, expires_at, attempt_count, verified_at
         FROM download_otps
        WHERE group_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [groupId],
    );
    const otp = rows[0];
    if (!otp) return { status: 'not_found', recipientEmail: null };
    if (otp.attempt_count >= this.maxAttempts) return { status: 'locked', recipientEmail: otp.recipient_email };
    if (otp.expires_at.getTime() < Date.now()) return { status: 'expired', recipientEmail: otp.recipient_email };

    const matched = await verifyOtpCode(code, otp.code_hash);
    if (!matched) {
      await this.pool.query('UPDATE download_otps SET attempt_count = attempt_count + 1 WHERE id = $1', [
        otp.id,
      ]);
      return { status: 'invalid', recipientEmail: otp.recipient_email };
    }

    // verified_at is audit state, not an authentication bypass.
    if (!otp.verified_at) await this.pool.query('UPDATE download_otps SET verified_at = now() WHERE id = $1', [otp.id]);
    return { status: 'ok', recipientEmail: otp.recipient_email };
  }
}
