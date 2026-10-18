import { asyncRoute } from '../lib/asyncRoute';
import type { CommercialSendConnection } from '../services/commercialSendConnection';
import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config';
import type { TransferGroupRepo } from '../services/transferGroupRepo';
import type { AuditLogRepo } from '../services/auditLogRepo';
import { generateDownloadToken, hashDownloadToken } from '../services/tokenService';
import { parseEmailList } from '../lib/emailList';

const MAX_RECIPIENTS_PER_FIELD = 10;

/** カンマ区切りのTo/CC文字列を受け取り、検証済みのメールアドレス配列に変換する。 */
function emailListField(opts: { required: boolean }) {
  return z
    .string()
    .max(2000)
    .optional()
    .superRefine((raw, ctx) => {
      const hasValue = typeof raw === 'string' && raw.trim().length > 0;
      if (!hasValue && opts.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '宛先を1件以上入力してください' });
      }
    })
    .transform((raw, ctx): string[] => {
      if (!raw || raw.trim().length === 0) return [];
      const { emails, invalid } = parseEmailList(raw);
      if (invalid.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `メールアドレスの形式が不正です: ${invalid.join(', ')}` });
        return z.NEVER;
      }
      if (emails.length > MAX_RECIPIENTS_PER_FIELD) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `宛先は${MAX_RECIPIENTS_PER_FIELD}件までです` });
        return z.NEVER;
      }
      return emails;
    });
}

const createSchema = z.object({
  senderName: z.string().min(1).max(100),
  to: emailListField({ required: true }),
  cc: emailListField({ required: false }),
  recipientNote: z.string().max(2000).optional(),
  expiresInDays: z.number().int().positive().optional(),
});

/**
 * 1回のフォーム送信(1〜複数ファイル)の入れ物を作る。アップロード開始前に必ず先に呼ぶ。
 * ダウンロードURL・OTP認証・期限・DL回数はこのグループに一本化されており、
 * 受信者は1つのリンク・1回のOTP認証でグループ内の全clean判定ファイルにアクセスできる。
 */
export function createTransferGroupRouter(transferGroupRepo: TransferGroupRepo, auditLogRepo: AuditLogRepo, config: Config, commercial?: CommercialSendConnection) {
  const router = Router();

  router.post('/', asyncRoute(async (req, res) => {
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

    // 同じアドレスがTo/CC両方に入力された場合はTo(より強い権限)を優先し、CC側からは除く。
    const toSet = new Set(input.to);
    const cc = input.cc.filter((email) => !toSet.has(email));

    const expiresInDays = Math.min(
      input.expiresInDays ?? config.transfer.defaultExpiresDays,
      config.transfer.maxExpiresDays,
    );
    const expiresAt = commercial ? await commercial.groupDeadline(input.expiresInDays) : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const downloadToken = generateDownloadToken();
    const tokenHash = hashDownloadToken(downloadToken);

    const group = await transferGroupRepo.create({
      senderEmail,
      senderName: input.senderName,
      to: input.to,
      cc,
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
      detail: { to: input.to, cc },
    });

    res.status(201).json({
      groupId: group.id,
      downloadToken, // クライアントは全ファイルの/completeを呼び終えるまでこの値をメモリ上に保持する
    });
  }));

  router.post('/:id/revoke', asyncRoute(async (req, res) => {
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
  }));

  return router;
}
