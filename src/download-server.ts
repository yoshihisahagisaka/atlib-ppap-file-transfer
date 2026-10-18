import { commercialHttpSerializers } from './lib/commercialHttpLogging';
import { commercialUsageRuntime, commercialDownloadObserver } from './services/commercialUsageRuntime';
import path from 'path';
import express, {type ErrorRequestHandler} from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { TransferRepo } from './services/transferRepo';
import { TransferGroupRepo } from './services/transferGroupRepo';
import { AuditLogRepo } from './services/auditLogRepo';
import { StorageService } from './services/storageService';
import { Mailer } from './services/mailer';
import { OtpService } from './services/otpService';
import { createRateLimiter } from './middleware/rateLimit';
import { createDownloadRouter } from './routes/downloadRoutes';

async function main(): Promise<void> {
  const config = await loadConfig();
  const logger = pino({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });

  const pool = createPool(config);
  const transferRepo = new TransferRepo(pool);
  const transferGroupRepo = new TransferGroupRepo(pool);
  const auditLogRepo = new AuditLogRepo(pool);
  const storageService = new StorageService(config.storageBucket);
  const mailer = new Mailer(config.smtp);
  const otpService = new OtpService(pool, config.transfer.otpExpiresMinutes, config.transfer.maxOtpAttempts);

  const app = express();
  app.set('trust proxy', true);
  app.use(pinoHttp({ logger, ...(config.commercial ? {serializers:commercialHttpSerializers} : {}) }));
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  // このサービスは社外の未認証ユーザー向けに公開する(IAPは適用しない)。
  // トークン自体は高エントロピーだが、OTP要求/検証エンドポイントはトークン単位でレート制限し、
  // 総当たりやリンク推測によるOTP連続送信を防ぐ(/statusは機微情報を含まないページ状態確認のため対象外)。
  const otpRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
    keyBy: (req) => req.params.token ?? 'unknown',
  });
  app.use(
    '/api/d',
    createDownloadRouter(
      transferRepo,
      transferGroupRepo,
      auditLogRepo,
      storageService,
      mailer,
      otpService,
      config,
      otpRateLimiter,
      config.commercial ? commercialDownloadObserver(pool,commercialUsageRuntime(pool,storageService.commercial())) : undefined,
    ),
  );

  const errors: ErrorRequestHandler = (_err,_req,res,_next) => {
    logger.warn({code:'DOWNLOAD_REQUEST_FAILED'},'Download request failed');
    res.status(500).json({error:'REQUEST_FAILED'});
  };
  app.use(errors);

  // /d/:token はSPA的に単一の静的ページを返し、トークンはクライアントJS側でURLから読み取る。
  app.get('/d/:token', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/download/download.html'));
  });
  app.use(express.static(path.join(__dirname, '../public/download')));

  app.listen(config.port, () => {
    logger.info(`ppap-file-transfer download-service listening on :${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
