import { Router } from 'express';
import type pino from 'pino';
import type { OidcProvider } from '../lib/oidcProvider';
import type { SsoVerifyRepo } from '../services/ssoVerifyRepo';
import { generateCodeVerifier, codeChallengeFromVerifier, generateOpaqueValue } from '../lib/pkce';
import { setCookie, clearCookie, parseCookies } from '../lib/cookies';
import { signValue, verifyValue } from '../lib/signedCookie';
import {
  SSO_STATE_COOKIE,
  SSO_SESSION_COOKIE,
  SSO_STATE_TTL_SECONDS,
  SSO_SESSION_TTL_SECONDS,
  type SsoStateCookiePayload,
  type SsoSessionCookiePayload,
} from '../lib/ssoSessionCookie';
import { provisionUser } from '../services/jitProvisioning';
import type { SsoProvider } from '../domain/ssoVerify';

/**
 * Google/Microsoftどちらにも使う共通ルーター。sso-verify-server.tsから
 * `/auth/google`・`/auth/microsoft`としてprovider毎に2回マウントする想定。
 * state/nonce/PKCE code_verifierはCloud Runの複数インスタンス化に耐えるよう、
 * サーバー側に保持せずHMAC署名Cookieに載せて往復させる(src/lib/signedCookie.ts)。
 */
export function createSsoAuthRouter(
  provider: SsoProvider,
  oidc: OidcProvider,
  repo: SsoVerifyRepo,
  sessionSecret: string,
  nodeEnv: string,
  logger: pino.Logger,
) {
  const router = Router();
  const secureCookies = nodeEnv === 'production';

  router.get('/login', async (_req, res) => {
    const state = generateOpaqueValue();
    const nonce = generateOpaqueValue();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeChallengeFromVerifier(codeVerifier);

    const statePayload: SsoStateCookiePayload = { state, nonce, codeVerifier, provider };
    setCookie(res, SSO_STATE_COOKIE, signValue(sessionSecret, statePayload), {
      maxAgeSeconds: SSO_STATE_TTL_SECONDS,
      secure: secureCookies,
    });

    try {
      const url = await oidc.buildAuthorizationUrl({ state, nonce, codeChallenge });
      res.redirect(url);
    } catch (err) {
      logger.error({ err, provider }, 'Failed to build OIDC authorization URL');
      res.status(500).send('SSO configuration error. Check server logs.');
    }
  });

  router.get('/callback', async (req, res) => {
    const rawState = parseCookies(req)[SSO_STATE_COOKIE];
    clearCookie(res, SSO_STATE_COOKIE);

    const stateCookie = rawState ? verifyValue<SsoStateCookiePayload>(sessionSecret, rawState) : null;
    if (!stateCookie || stateCookie.provider !== provider) {
      res.status(400).send('ログイン試行が見つからないか期限切れです。もう一度お試しください。');
      return;
    }

    const returnedState = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!returnedState || returnedState !== stateCookie.state) {
      res.status(400).send('state不一致。CSRFの疑いがあるため中断しました。');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    if (!code) {
      const errorParam = typeof req.query.error === 'string' ? req.query.error : 'unknown_error';
      res.status(400).send(`ログインが完了しませんでした(${errorParam})。`);
      return;
    }

    try {
      const { idToken } = await oidc.exchangeCode(code, stateCookie.codeVerifier);
      const { email } = await oidc.verifyIdToken(idToken, stateCookie.nonce);
      const result = await provisionUser(repo, email, provider);

      const sessionPayload: SsoSessionCookiePayload = { email, provider, result };
      setCookie(res, SSO_SESSION_COOKIE, signValue(sessionSecret, sessionPayload), {
        maxAgeSeconds: SSO_SESSION_TTL_SECONDS,
        secure: secureCookies,
      });
      res.redirect('/sso-verify/');
    } catch (err) {
      logger.error({ err, provider }, 'OIDC callback processing failed');
      res.status(401).send('ログインに失敗しました。もう一度お試しください。');
    }
  });

  return router;
}
