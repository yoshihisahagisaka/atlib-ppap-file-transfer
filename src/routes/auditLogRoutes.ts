import { Router } from 'express';
import type { AuditLogRepo } from '../services/auditLogRepo';

const eventLabel: Record<string, string> = {
  history_exported: '履歴CSV出力',
  created: '送信作成',
  uploaded: 'アップロード完了',
  scan_clean: 'スキャン完了(安全)',
  scan_infected: 'スキャン検出(ウイルス)',
  otp_requested: 'OTP要求',
  otp_failed: 'OTP失敗',
  otp_verified: 'OTP成功',
  downloaded: 'ダウンロード',
  expired: '期限切れ',
  revoked: '取消',
};

export function createAuditLogRouter(auditLogRepo: AuditLogRepo) {
  const router = Router();

  router.get('/', async (req, res) => {
    if (!req.userEmail) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const entries = await auditLogRepo.listRecent(200);
    res.json({
      entries: entries.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        event: e.event,
        eventLabel: eventLabel[e.event] ?? e.event,
        actor: e.actor,
        ipAddress: e.ipAddress,
        transferId: e.transferId,
        filename: e.originalFilename,
        senderEmail: e.senderEmail,
        recipientEmail: e.recipientEmail,
      })),
    });
  });

  return router;
}
