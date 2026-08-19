import path from 'path';
import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { TransferRepo } from './services/transferRepo';
import { TransferGroupRepo } from './services/transferGroupRepo';
import { AuditLogRepo } from './services/auditLogRepo';
import { StorageService } from './services/storageService';
import { createIapAuthMiddleware } from './middleware/iapAuth';
import { createRateLimiter } from './middleware/rateLimit';
import { createUploadRouter } from './routes/uploadRoutes';
import { createTransferGroupRouter } from './routes/transferGroupRoutes';
import { createAuditLogRouter } from './routes/auditLogRoutes';

async function main(): Promise<void> {
  const config = await loadConfig();
  const logger = pino({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });

  if (config.nodeEnv === 'production' && config.iapAudiences.length === 0) {
    throw new Error('IAP_AUDIENCE is required in production (upload-service must sit behind IAP)');
  }
  if (!config.downloadBaseUrl) {
    throw new Error('DOWNLOAD_BASE_URL is required (used to build the recipient-facing download link)');
  }
  if (!config.scanServiceUrl) {
    throw new Error('SCAN_SERVICE_URL is required (upload-service calls it synchronously after upload)');
  }

  const pool = createPool(config);
  const transferRepo = new TransferRepo(pool);
  const transferGroupRepo = new TransferGroupRepo(pool);
  const auditLogRepo = new AuditLogRepo(pool);
  const storageService = new StorageService(config.storageBucket);

  const app = express();
  // Cloud Run本番ではGoogle Front Endが1ホップ手前でTLS終端しX-Forwarded-Forを付与するため、
  // req.ipが正しいクライアントIPを指すようにtrust proxyを有効化する(IPレート制限で使用)。
  app.set('trust proxy', true);
  app.use(pinoHttp({ logger }));
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  app.use(createIapAuthMiddleware(config.iapAudiences, config.nodeEnv, logger));
  app.use('/api/transfers', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }));
  app.use('/api/transfers', createUploadRouter(transferRepo, auditLogRepo, storageService, config));
  app.use('/api/transfer-groups', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 }));
  app.use('/api/transfer-groups', createTransferGroupRouter(transferGroupRepo, auditLogRepo, config));
  app.use('/api/audit-logs', createAuditLogRouter(auditLogRepo));

  app.use(express.static(path.join(__dirname, '../public/upload')));

  app.listen(config.port, () => {
    logger.info(`ppap-file-transfer upload-service listening on :${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
