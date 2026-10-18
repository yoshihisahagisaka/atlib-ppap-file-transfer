import { commercialHttpSerializers } from './lib/commercialHttpLogging';
import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { TransferRepo } from './services/transferRepo';
import { TransferGroupRepo } from './services/transferGroupRepo';
import { AuditLogRepo } from './services/auditLogRepo';
import { StorageService } from './services/storageService';
import { Mailer } from './services/mailer';
import { scanUploadedObject } from './services/scanRunner';

// clamscanはシグネチャDBをプロセスごとにメモリへ読み込むため、同一インスタンスで複数のスキャンが
// 同時に走るとメモリ上限(2Gi)を超えてOOM Killされる実績があった(複数ファイル一括送信時に発生)。
// インスタンス内では常に1件ずつ順番に処理するようキューで直列化する。
let scanQueue: Promise<unknown> = Promise.resolve();
function enqueueScan<T>(task: () => Promise<T>): Promise<T> {
  const result = scanQueue.then(task, task);
  scanQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

interface GcsEventBody {
  bucket?: string;
  name?: string;
  // upload-serviceからの同期呼び出し時のみ渡される。groupId/groupTokenは、同じフォーム送信内の
  // 全ファイルのスキャンが出揃った際に統合通知メールを送るための情報(生のダウンロードトークンは
  // DBに保存していないため、この経路でのみ利用可能)。
  groupId?: string;
  groupToken?: string;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const logger = pino({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });

  const pool = createPool(config);
  const transferRepo = new TransferRepo(pool);
  const transferGroupRepo = new TransferGroupRepo(pool);
  const auditLogRepo = new AuditLogRepo(pool);
  const storageService = new StorageService(config.storageBucket);
  const mailer = new Mailer(config.smtp);

  const app = express();
  app.use(pinoHttp({ logger, ...(config.commercial ? {serializers:commercialHttpSerializers} : {}) }));
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  // このエンドポイントはupload-serviceからの同期呼び出し専用(認証はCloud Run標準のIAM/OIDC
  // 招待者検証に任せ、アプリ側では行わない)。
  app.post('/', async (req, res) => {
    const body = req.body as GcsEventBody;
    if (!body?.bucket || !body?.name) {
      logger.warn(config.commercial ? {} : { body }, 'Received request without bucket/name; ignoring');
      res.status(200).send('ignored');
      return;
    }
    try {
      const group = body.groupId && body.groupToken ? { groupId: body.groupId, token: body.groupToken } : undefined;
      await enqueueScan(() =>
        scanUploadedObject(
          { config, transferRepo, transferGroupRepo, auditLogRepo, storageService, mailer, logger },
          body.bucket as string,
          body.name as string,
          group,
        ),
      );
      res.status(200).send('ok');
    } catch (err) {
      logger.error({ err }, 'Scan failed');
      res.status(500).send('scan failed');
    }
  });

  app.listen(config.port, () => {
    logger.info(`ppap-file-transfer scan-server listening on :${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
