import type { Request } from 'express';
import { parseCookies } from './cookies';
import { verifyValue } from './signedCookie';
import type { ProvisioningResult, SsoProvider } from '../domain/ssoVerify';

export const SSO_STATE_COOKIE = 'sso_oauth_state';
export const SSO_SESSION_COOKIE = 'sso_verify_session';
export const SSO_STATE_TTL_SECONDS = 10 * 60;
export const SSO_SESSION_TTL_SECONDS = 60 * 60;

export interface SsoStateCookiePayload {
  issuedAt?: number;
  state: string;
  nonce: string;
  codeVerifier: string;
  provider: SsoProvider;
}

export interface SsoSessionCookiePayload {
  email: string;
  provider: SsoProvider;
  result: ProvisioningResult;
}

export function readSsoSession(req: Request, sessionSecret: string): SsoSessionCookiePayload | null {
  const raw = parseCookies(req)[SSO_SESSION_COOKIE];
  if (!raw) return null;
  return verifyValue<SsoSessionCookiePayload>(sessionSecret, raw);
}
