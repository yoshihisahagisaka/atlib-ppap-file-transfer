import type { RequestHandler } from 'express';
import { parseCookies } from '../lib/cookies';
import { verifyValue } from '../lib/signedCookie';
import type { CommercialIdentityRepository, VerifiedIdentity } from '../services/commercialIdentity';

export const SEND_SESSION_COOKIE = 'secure_send_session';
export interface SendSession { audience: 'secure-send'; identity: VerifiedIdentity; expiresAt: number; }

export function commercialSession(repo: CommercialIdentityRepository, secret: string, origin: string): RequestHandler {
  return async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin') !== origin) {
      res.status(403).json({ error: 'ORIGIN_DENIED' }); return;
    }
    try {
      const raw = parseCookies(req)[SEND_SESSION_COOKIE];
      const session = raw ? verifyValue<SendSession>(secret, raw) : null;
      if (!session || session.audience !== 'secure-send' || !Number.isSafeInteger(session.expiresAt) ||
          session.expiresAt <= Date.now() || !session.identity) {
        res.status(401).json({ error: 'SSO_REQUIRED' }); return;
      }
      const selector = req.get('x-send-organization-id');
      if (selector && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selector)) {
        res.status(403).json({ error: 'MEMBERSHIP_DENIED' }); return;
      }
      // Re-read on every request: roles, membership and suspension are never trusted from a cookie.
      req.sendPrincipal = await repo.resolve(session.identity, selector);
      req.userEmail = req.sendPrincipal.email;
      next();
    } catch { res.status(403).json({ error: 'MEMBERSHIP_DENIED' }); }
  };
}
