import type { NextFunction, Request, Response } from 'express';

/**
 * 固定ウィンドウ・レート制限ミドルウェアの汎用ファクトリ(msp-customer-portalと同一方式のインメモリ実装)。
 * 注意: インメモリのため、Cloud Runが複数インスタンスにスケールした場合はインスタンスごとに独立してカウントされる
 * (低トラフィックのため許容する割り切り)。
 * keyByは既定でreq.ip(Cloud Run環境で正しく機能させるにはapp.set('trust proxy', true)が必要)。
 */
export function createRateLimiter(opts: {
  windowMs: number;
  maxRequests: number;
  keyBy?: (req: Request) => string;
}): (req: Request, res: Response, next: NextFunction) => void {
  const hits = new Map<string, { count: number; windowStart: number }>();
  const keyBy = opts.keyBy ?? ((req: Request) => req.ip ?? 'unknown');

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyBy(req);
    const now = Date.now();
    const record = hits.get(key);

    if (!record || now - record.windowStart >= opts.windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    if (record.count >= opts.maxRequests) {
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }

    record.count += 1;
    next();
  };
}
