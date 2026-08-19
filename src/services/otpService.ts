import type { Pool } from 'pg';
import { generateOtpCode, hashOtpCode, verifyOtpCode } from './tokenService';

export type OtpVerifyResult = 'ok' | 'invalid' | 'expired' | 'locked' | 'not_found';

interface OtpRow {
  id: string;
  code_hash: string;
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

  /** 新しいOTPを発行する(既存の未検証OTPがあっても常に新規発行=最新のものだけが有効)。 */
  async issue(groupId: string): Promise<string> {
    const code = generateOtpCode();
    const codeHash = await hashOtpCode(code);
    const expiresAt = new Date(Date.now() + this.expiresMinutes * 60 * 1000);
    await this.pool.query(`INSERT INTO download_otps (group_id, code_hash, expires_at) VALUES ($1, $2, $3)`, [
      groupId,
      codeHash,
      expiresAt,
    ]);
    return code;
  }

  /** 直近発行分のOTPを検証する。試行回数上限に達している場合はlockedを返す。 */
  async verify(groupId: string, code: string): Promise<OtpVerifyResult> {
    const { rows } = await this.pool.query<OtpRow>(
      `SELECT id, code_hash, expires_at, attempt_count, verified_at
         FROM download_otps
        WHERE group_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [groupId],
    );
    const otp = rows[0];
    if (!otp) return 'not_found';
    if (otp.verified_at) return 'ok'; // 直近OTPが既に検証済み(署名付きURL再発行など)なら通す
    if (otp.attempt_count >= this.maxAttempts) return 'locked';
    if (otp.expires_at.getTime() < Date.now()) return 'expired';

    const matched = await verifyOtpCode(code, otp.code_hash);
    if (!matched) {
      await this.pool.query('UPDATE download_otps SET attempt_count = attempt_count + 1 WHERE id = $1', [
        otp.id,
      ]);
      return 'invalid';
    }

    await this.pool.query('UPDATE download_otps SET verified_at = now() WHERE id = $1', [otp.id]);
    return 'ok';
  }
}
