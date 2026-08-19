import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Config } from '../config';
import type { TransferRepo } from '../services/transferRepo';
import type { TransferGroupRepo } from '../services/transferGroupRepo';
import type { AuditLogRepo } from '../services/auditLogRepo';
import type { StorageService } from '../services/storageService';
import type { Mailer } from '../services/mailer';
import type { OtpService } from '../services/otpService';
import { hashDownloadToken } from '../services/tokenService';
import type { TransferGroup } from '../domain/transfer';

const verifySchema = z.object({ code: z.string().min(1).max(20) });

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

/** クレーム時点で有効な(取消・期限切れ・上限到達していない)状態かどうかを判定する。 */
function isUsable(group: TransferGroup): boolean {
  if (group.revokedAt) return false;
  if (group.expiresAt.getTime() < Date.now()) return false;
  if (group.downloadCount >= group.maxDownloads) return false;
  return true;
}

export function createDownloadRouter(
  transferRepo: TransferRepo,
  transferGroupRepo: TransferGroupRepo,
  auditLogRepo: AuditLogRepo,
  storageService: StorageService,
  mailer: Mailer,
  otpService: OtpService,
  config: Config,
  // OTP要求/検証(総当たり対策が必要)だけに掛けるレート制限。状態確認(/status)は機微情報を
  // 含まないため、ページの再読み込み等で誤って弾かれないよう対象外にする。
  otpRateLimiter: RequestHandler,
) {
  const router = Router();

  router.get('/:token/status', async (req, res) => {
    const tokenHash = hashDownloadToken(req.params.token as string);
    const group = await transferGroupRepo.findByTokenHash(tokenHash);
    if (!group) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    if (!isUsable(group)) {
      res.json({
        status: group.revokedAt ? 'revoked' : 'expired',
        usable: false,
        recipientEmailMasked: maskEmail(group.recipientEmail),
        expiresAt: group.expiresAt,
        downloadsRemaining: Math.max(0, group.maxDownloads - group.downloadCount),
      });
      return;
    }

    const stillScanning = await transferRepo.countScanningInGroup(group.id);
    if (stillScanning > 0) {
      res.json({ status: 'scanning', usable: false, recipientEmailMasked: maskEmail(group.recipientEmail) });
      return;
    }

    const cleanTransfers = await transferRepo.findCleanInGroup(group.id);
    if (cleanTransfers.length === 0) {
      res.json({ status: 'infected', usable: false, recipientEmailMasked: maskEmail(group.recipientEmail) });
      return;
    }

    res.json({
      status: 'ready',
      usable: true,
      files: cleanTransfers.map((t) => ({ filename: t.originalFilename, sizeBytes: t.sizeBytes })),
      expiresAt: group.expiresAt,
      recipientEmailMasked: maskEmail(group.recipientEmail),
      downloadsRemaining: Math.max(0, group.maxDownloads - group.downloadCount),
    });
  });

  router.post('/:token/otp', otpRateLimiter, async (req, res) => {
    const tokenHash = hashDownloadToken(req.params.token as string);
    const group = await transferGroupRepo.findByTokenHash(tokenHash);
    if (!group || !isUsable(group)) {
      res.status(404).json({ error: 'not_found_or_unavailable' });
      return;
    }

    const code = await otpService.issue(group.id);
    await mailer.sendOtpCode(group.recipientEmail, code, `${await countFilesLabel(transferRepo, group.id)}`);
    await auditLogRepo.log({
      transferId: null,
      groupId: group.id,
      event: 'otp_requested',
      actor: 'recipient',
      ipAddress: req.ip ?? null,
    });

    res.json({ ok: true, sentTo: maskEmail(group.recipientEmail) });
  });

  router.post('/:token/verify', otpRateLimiter, async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const tokenHash = hashDownloadToken(req.params.token as string);
    const group = await transferGroupRepo.findByTokenHash(tokenHash);
    if (!group || !isUsable(group)) {
      res.status(404).json({ error: 'not_found_or_unavailable' });
      return;
    }

    const result = await otpService.verify(group.id, parsed.data.code);
    if (result !== 'ok') {
      await auditLogRepo.log({
        transferId: null,
        groupId: group.id,
        event: 'otp_failed',
        actor: 'recipient',
        ipAddress: req.ip ?? null,
        detail: { result },
      });
      res.status(400).json({ error: result });
      return;
    }

    const cleanTransfers = await transferRepo.findCleanInGroup(group.id);
    const files = await Promise.all(
      cleanTransfers.map(async (t) => ({
        filename: t.originalFilename,
        downloadUrl: await storageService.createDownloadUrl(
          t.storageObject,
          t.originalFilename,
          config.transfer.signedUrlExpiresMinutes,
        ),
      })),
    );

    await transferGroupRepo.incrementDownload(group.id);
    await auditLogRepo.log({
      transferId: null,
      groupId: group.id,
      event: 'downloaded',
      actor: 'recipient',
      ipAddress: req.ip ?? null,
      detail: { fileCount: files.length },
    });

    res.json({ files });
  });

  return router;
}

async function countFilesLabel(transferRepo: TransferRepo, groupId: string): Promise<string> {
  const files = await transferRepo.findCleanInGroup(groupId);
  if (files.length === 1) return files[0]?.originalFilename ?? 'ファイル';
  return `${files.length}件のファイル`;
}
