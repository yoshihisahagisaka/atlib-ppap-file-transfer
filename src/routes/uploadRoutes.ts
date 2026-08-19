import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Config } from '../config';
import type { TransferRepo } from '../services/transferRepo';
import type { AuditLogRepo } from '../services/auditLogRepo';
import type { StorageService } from '../services/storageService';
import { requestScan } from '../services/scanClient';

const createSchema = z.object({
  groupId: z.string().uuid(),
  filename: z.string().min(1).max(500),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

const completeSchema = z.object({
  groupId: z.string().uuid(),
  groupToken: z.string().min(1),
});

export function createUploadRouter(
  transferRepo: TransferRepo,
  auditLogRepo: AuditLogRepo,
  storageService: StorageService,
  config: Config,
) {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    const senderEmail = req.userEmail;
    if (!senderEmail) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const maxBytes = config.transfer.maxUploadSizeMb * 1024 * 1024;
    if (input.sizeBytes > maxBytes) {
      res.status(413).json({ error: `File too large (max ${config.transfer.maxUploadSizeMb}MB)` });
      return;
    }

    // オブジェクトパスはgroupId配下にランダムなプレフィックスを付けて格納する。バケット自体が
    // 非公開でダウンロードは常に署名付きURL経由のため、パスそのものを秘匿する必要はない。
    const objectPath = storageService.objectPath(input.groupId, `${randomUUID()}-${input.filename}`);

    const transfer = await transferRepo.create({
      groupId: input.groupId,
      senderEmail,
      originalFilename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      storageObject: objectPath,
    });

    await auditLogRepo.log({
      transferId: transfer.id,
      groupId: input.groupId,
      event: 'created',
      actor: senderEmail,
      ipAddress: req.ip ?? null,
      detail: { filename: input.filename },
    });

    const uploadUrl = await storageService.createUploadUrl(objectPath, input.contentType);

    res.status(201).json({
      transferId: transfer.id,
      uploadUrl,
    });
  });

  router.post('/:id/complete', async (req, res) => {
    const senderEmail = req.userEmail;
    if (!senderEmail) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    const transfer = await transferRepo.findById(req.params.id as string);
    if (!transfer || transfer.senderEmail !== senderEmail || transfer.groupId !== parsed.data.groupId) {
      res.status(404).json({ error: 'Transfer not found' });
      return;
    }
    if (transfer.status !== 'pending_upload') {
      res.status(409).json({ error: `Transfer is already in status: ${transfer.status}` });
      return;
    }

    const metadata = await storageService.getMetadata(transfer.storageObject);
    if (!metadata) {
      res.status(409).json({ error: 'Upload not found in storage yet' });
      return;
    }

    await transferRepo.markUploaded(transfer.id);
    await auditLogRepo.log({
      transferId: transfer.id,
      groupId: parsed.data.groupId,
      event: 'uploaded',
      actor: senderEmail,
      ipAddress: req.ip ?? null,
      detail: { sizeBytes: metadata.sizeBytes },
    });

    if (!config.scanServiceUrl) {
      req.log.error('SCAN_SERVICE_URL is not configured');
      res.status(500).json({ error: 'scan_not_configured' });
      return;
    }

    // ここでスキャンサービスを同期呼び出しし、完了(clean/infected判定・DB更新まで)を待ってから
    // レスポンスする。受信者への統合通知メールは、同じフォーム送信内の全ファイルのスキャンが
    // 出揃った時点で(このリクエストがその最後の1件だった場合に)scan-server側から送られる。
    try {
      await requestScan(
        config.scanServiceUrl,
        {
          bucket: config.storageBucket,
          objectName: transfer.storageObject,
          groupId: parsed.data.groupId,
          groupToken: parsed.data.groupToken,
        },
        req.log,
      );
    } catch (err) {
      req.log.error({ err }, 'Synchronous scan request failed');
      res.status(502).json({ error: 'scan_failed' });
      return;
    }

    res.json({ ok: true });
  });

  router.get('/', async (req, res) => {
    const senderEmail = req.userEmail;
    if (!senderEmail) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const rows = await transferRepo.listHistoryBySender(senderEmail);
    res.json({
      transfers: rows.map((t) => ({
        id: t.id,
        groupId: t.groupId,
        recipientEmail: t.recipientEmail,
        filename: t.filename,
        sizeBytes: t.sizeBytes,
        status: t.groupRevoked ? 'revoked' : t.status,
        downloadCount: t.downloadCount,
        maxDownloads: t.maxDownloads,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
      })),
    });
  });

  return router;
}
