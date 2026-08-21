import path from 'path';
import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { SsoVerifyRepo } from './services/ssoVerifyRepo';
import { OidcProvider } from './lib/oidcProvider';
import { createRateLimiter } from './middleware/rateLimit';
import { createSsoAuthRouter } from './routes/ssoAuthRoutes';
import { createSsoSessionRouter } from './routes/ssoSessionRoutes';

const GOOGLE_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const OIDC_SCOPE = 'openid email profile';

/**
 * SSO検証スパイク専用サービス。upload-service(src/upload-server.ts、IAP配下・本番稼働中)とは
 * 完全に独立しており、既存のIAP認証・共有LB(msp-iap-urlmap)には一切関与しない。
 * 単独のCloud Runサービスとして--allow-unauthenticatedでデプロイし、既定の*.run.app URLで
 * アクセスする(アクセス制御はこのサービス自身のOIDCログインが担う)。
 */
async function main(): Promise<void> {
  const config = await loadConfig();
  const logger = pino({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });

  if (!config.sso.google && !config.sso.microsoft) {
    throw new Error(
      'sso-verify-server requires at least one provider configured (GOOGLE_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_ID)',
    );
  }
  if (!config.sso.sessionSecret) {
    throw new Error('SSO_SESSION_SECRET is required for sso-verify-server');
  }
  const sessionSecret = config.sso.sessionSecret;

  const pool = createPool(config);
  const repo = new SsoVerifyRepo(pool);

  const app = express();
  app.set('trust proxy', true);
  app.use(pinoHttp({ logger }));

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  const loginLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 20 });

  if (config.sso.google) {
    const googleOidc = new OidcProvider({
      discoveryUrl: GOOGLE_DISCOVERY_URL,
      clientId: config.sso.google.clientId,
      clientSecret: config.sso.google.clientSecret,
      redirectUri: config.sso.google.redirectUri,
      scope: OIDC_SCOPE,
    });
    app.use(
      '/auth/google',
      loginLimiter,
      createSsoAuthRouter('google', googleOidc, repo, sessionSecret, config.nodeEnv, logger),
    );
  } else {
    logger.warn('GOOGLE_OAUTH_CLIENT_ID not set; /auth/google is disabled');
  }

  if (config.sso.microsoft) {
    const microsoftOidc = new OidcProvider({
      discoveryUrl: `https://login.microsoftonline.com/${config.sso.microsoft.tenantId}/v2.0/.well-known/openid-configuration`,
      clientId: config.sso.microsoft.clientId,
      clientSecret: config.sso.microsoft.clientSecret,
      redirectUri: config.sso.microsoft.redirectUri,
      scope: OIDC_SCOPE,
    });
    app.use(
      '/auth/microsoft',
      loginLimiter,
      createSsoAuthRouter('microsoft', microsoftOidc, repo, sessionSecret, config.nodeEnv, logger),
    );
  } else {
    logger.warn('MICROSOFT_OAUTH_CLIENT_ID not set; /auth/microsoft is disabled');
  }

  app.use('/api', createSsoSessionRouter(sessionSecret));

  app.use('/sso-verify', express.static(path.join(__dirname, '../public/sso-verify')));

  app.listen(config.port, () => {
    logger.info(`ppap-file-transfer sso-verify-service listening on :${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
