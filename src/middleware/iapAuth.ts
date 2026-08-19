import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type pino from 'pino';

const IAP_JWK_URL = 'https://www.gstatic.com/iap/verify/public_key-jwk';
const IAP_ISSUER = 'https://cloud.google.com/iap';
const IAP_HEADER = 'x-goog-iap-jwt-assertion';

/**
 * 既存のHTTPS LB + Cloud IAP配下にこのサービスのbackend serviceを追加する前提のミドルウェア。
 * IAPはLB側で未認証リクエストを既に弾いているため、ここでの検証は「誰か(email)」を安全に
 * 特定するためのものであり、認可そのものはIAP(Google Workspaceグループ)に委ねる。
 *
 * このCloud Runサービスは同一NEGを共有する複数backend service(一般アクセス用のppap-upload-bes、
 * 監査ログ専用でdirector@atlib.jpのみ許可するppap-audit-bes)からURL Mapのパスルールで振り分けられる。
 * backend serviceが違えばIAPが発行するJWTのaudienceも変わるため、両方を許可リストとして受け付ける。
 *
 * 重要: Cloud Runのデフォルト *.run.app URLはLBを経由しないためIAPを回避できてしまう。
 * デプロイ時に必ず `--ingress=internal-and-cloud-load-balancing` を設定し、
 * LB経由以外からの直接アクセスを遮断すること(docs/デプロイ手順書参照)。
 */
export function createIapAuthMiddleware(iapAudiences: string[], nodeEnv: string, logger: pino.Logger) {
  const jwks = iapAudiences.length > 0 ? createRemoteJWKSet(new URL(IAP_JWK_URL)) : null;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const assertion = req.header(IAP_HEADER);

    if (!assertion || !jwks) {
      if (nodeEnv !== 'production') {
        // ローカル開発用フォールバック。本番(NODE_ENV=production)ではIAP_AUDIENCE未設定/ヘッダ欠落は即エラーとする。
        req.userEmail = req.header('x-dev-user-email') ?? 'dev-user@atlib.jp';
        logger.warn({ path: req.path }, 'IAP assertion not present; using dev fallback user (non-production only)');
        next();
        return;
      }
      res.status(401).json({ error: 'IAP assertion missing' });
      return;
    }

    try {
      const { payload } = await jwtVerify(assertion, jwks, {
        issuer: IAP_ISSUER,
        audience: iapAudiences,
      });
      const email = typeof payload.email === 'string' ? payload.email : undefined;
      if (!email) {
        res.status(401).json({ error: 'IAP assertion missing email claim' });
        return;
      }
      req.userEmail = email;
      next();
    } catch (err) {
      logger.warn({ err }, 'IAP assertion verification failed');
      res.status(401).json({ error: 'Invalid IAP assertion' });
    }
  };
}
