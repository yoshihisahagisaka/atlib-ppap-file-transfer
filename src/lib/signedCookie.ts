import { createHmac } from 'crypto';
import { safeEqual } from '../services/tokenService';

/**
 * Cloud Runが複数インスタンスにスケールしうるため、state/sessionをサーバー側(インメモリ/DB)に
 * 保持せず、HMAC署名付きの自己完結Cookieとして持ち回る。フォーマット: base64url(json).base64url(hmac)
 */
export function signValue(secret: string, payload: unknown): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(json).digest('base64url');
  return `${json}.${sig}`;
}

export function verifyValue<T>(secret: string, cookieValue: string): T | null {
  const dot = cookieValue.lastIndexOf('.');
  if (dot === -1) return null;
  const json = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expectedSig = createHmac('sha256', secret).update(json).digest('base64url');
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    return JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
