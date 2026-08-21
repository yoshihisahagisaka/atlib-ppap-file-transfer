import { Router } from 'express';
import { clearCookie } from '../lib/cookies';
import { SSO_SESSION_COOKIE, readSsoSession } from '../lib/ssoSessionCookie';

export function createSsoSessionRouter(sessionSecret: string) {
  const router = Router();

  router.get('/session', (req, res) => {
    const session = readSsoSession(req, sessionSecret);
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      email: session.email,
      provider: session.provider,
      result: session.result,
    });
  });

  router.post('/logout', (_req, res) => {
    clearCookie(res, SSO_SESSION_COOKIE);
    res.json({ ok: true });
  });

  return router;
}
