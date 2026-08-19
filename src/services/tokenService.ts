import { randomBytes, createHash, randomInt, timingSafeEqual } from 'crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 10;

/** ダウンロードリンク用の高エントロピートークン。DBにはハッシュのみ保存し、生の値はリンクにのみ含める。 */
export function generateDownloadToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDownloadToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 受信者向けOTP(6桁数字)。総当たり耐性はbcryptハッシュ化+試行回数制限(otpService側)で担保する。 */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function verifyOtpCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
