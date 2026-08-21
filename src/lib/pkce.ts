import { randomBytes, createHash } from 'crypto';

/** OAuth Authorization Code + PKCE用のcode_verifier/code_challenge(S256)。 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** state/nonceも同じ形式(高エントロピーなbase64url文字列)で十分なので使い回す。 */
export function generateOpaqueValue(): string {
  return randomBytes(24).toString('base64url');
}
