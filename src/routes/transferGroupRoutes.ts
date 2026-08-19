import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config';
import type { TransferGroupRepo } from '../services/transferGroupRepo';
import type { AuditLogRepo } from '../services/auditLogRepo';
import { generateDownloadToken, hashDownloadToken } from '../services/tokenService';

const createSchema = z.object({
  senderName: z.string().min(1).max(100),
  recipientEmail: z.string().email(),
  recipientNote: z.string().max(2000).optional(),
  expiresInDays: z.number().int().positive().optional(),
});

/**
 * 1回のフォーム送信(1〜複数ファイル)の入れ物を作る。アップロード開始前に必ず先に呼ぶ。
 * ダウンロードURL・OTP認証・期限・DL回数はこのグループに一本化されており、
 * 受信者は1つのリンク・1回のOTP認証でグループ内の全clean判定ファイルにアクセスできる。
 */
export function createTransferGroupRouter(transferGroupRepo: TransferGroupRepo, auditLogRepo: AuditLogRepo, config: Config) {
  const router = Router();

  router.post('/', async (req, res) => {
    const senderEmail = req.userEmail;
    if (!senderEmail) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;

    const expiresInDays = Math.min(
      input.expiresInDays ?? config.transfer.defaultExpiresDays,
      config.transfer.maxExpiresDays,
    );
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const downloadToken = generateDownloadToken();
    const tokenHash = hashDownloadToken(downloadToken);

    const group = await transferGroupRepo.create({
      senderEmail,
      senderName: input.senderName,
      recipientEmail: input.recipientEmail,
      recipientNote: input.recipientNote ?? null,
      tokenHash,
      expiresAt,
      maxDownloads: config.transfer.maxDownloads,
    });

    await auditLogRepo.log({
      transferId: null,
      groupId: group.id,
      event: 'created',
      actor: senderEmail,
      ipAddress: req.ip ?? null,
      detail: { recipientEmail: input.recipientEmail },
    });

    res.status(201).json({
      groupId: group.id,
      downloadToken, // クライアントは全ファイルの/completeを呼び終えるまでこの値をメモリ上に保持する
    });
  });

  router.post('/:id/revoke', async (req, res) => {
    const senderEmail = req.userEmail;
    if (!senderEmail) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const group = await transferGroupRepo.findById(req.params.id as string);
    if (!group || group.senderEmail !== senderEmail) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    await transferGroupRepo.revoke(group.id);
    await auditLogRepo.log({
      transferId: null,
      groupId: group.id,
      event: 'revoked',
      actor: senderEmail,
      ipAddress: req.ip ?? null,
    });
    res.json({ ok: true });
  });

  return router;
}
