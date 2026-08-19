import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type pino from 'pino';
import type { Config } from '../config';
import type { TransferRepo } from './transferRepo';
import type { TransferGroupRepo } from './transferGroupRepo';
import type { AuditLogRepo } from './auditLogRepo';
import type { StorageService } from './storageService';
import type { Mailer } from './mailer';

async function runClamscan(filePath: string): Promise<{ infected: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('clamscan', ['--no-summary', filePath]);
    let output = '';
    proc.stdout.on('data', (chunk) => (output += chunk.toString()));
    proc.stderr.on('data', (chunk) => (output += chunk.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      // clamscanの終了コード: 0=検出なし, 1=検出あり, 2=エラー
      if (code === 0) resolve({ infected: false, output });
      else if (code === 1) resolve({ infected: true, output });
      else reject(new Error(`clamscan exited with code ${code}: ${output}`));
    });
  });
}

export interface ScanDeps {
  config: Config;
  transferRepo: TransferRepo;
  transferGroupRepo: TransferGroupRepo;
  auditLogRepo: AuditLogRepo;
  storageService: StorageService;
  mailer: Mailer;
  logger: pino.Logger;
}

export interface ScanGroupContext {
  groupId: string;
  /** グループ用の生のダウンロードトークン。DBにはハッシュしか保存していないため、統合通知メールの
   *  URLを組み立てられるのはこの引数を持つ呼び出し(同期呼び出し)だけであり、この呼び出しが
   *  グループの最後の1件になった場合にのみ使われる。 */
  token: string;
}

/**
 * GCSにアップロードされたオブジェクト1件をClamAVでスキャンし、結果に応じてDB更新・通知を行う。
 * groupが渡された場合、この呼び出しでグループ内の全ファイルのスキャンが出揃ったかを判定し、
 * 出揃っていれば(かつまだ誰も送っていなければ)clean判定のファイル一覧をまとめた通知メールを
 * 1通・1リンクだけ送る(受信者はそのリンク1つでOTP認証後、全ファイルにアクセスできる)。
 */
export async function scanUploadedObject(
  deps: ScanDeps,
  bucket: string,
  objectName: string,
  group?: ScanGroupContext,
): Promise<void> {
  const { config, transferRepo, transferGroupRepo, auditLogRepo, storageService, mailer, logger } = deps;

  if (bucket !== config.storageBucket) {
    logger.warn({ bucket, expected: config.storageBucket }, 'Event for unexpected bucket; skipping');
    return;
  }

  const transfer = await transferRepo.findByStorageObject(objectName);
  if (!transfer) {
    logger.warn({ objectName }, 'No matching transfer for uploaded object; skipping');
    return;
  }
  if (transfer.status !== 'scanning') {
    logger.info({ transferId: transfer.id, status: transfer.status }, 'Transfer not awaiting scan; skipping');
    return;
  }

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ppap-scan-'));
  const localPath = path.join(tmpDir, 'payload');
  try {
    const buffer = await storageService.download(objectName);
    await writeFile(localPath, buffer);

    logger.info({ transferId: transfer.id }, 'Running clamscan');
    const { infected, output } = await runClamscan(localPath);

    await transferRepo.markScanResult(transfer.id, infected);
    await auditLogRepo.log({
      transferId: transfer.id,
      groupId: transfer.groupId,
      event: infected ? 'scan_infected' : 'scan_clean',
      actor: 'system',
      ipAddress: null,
      detail: { output: output.slice(0, 2000) },
    });

    if (infected) {
      logger.warn({ transferId: transfer.id }, 'Infected file detected; deleting from storage');
      await storageService.delete(objectName);
      const group2 = transfer.groupId ? await transferGroupRepo.findById(transfer.groupId) : null;
      if (group2) {
        await mailer.sendInfectedNotice(group2.senderEmail, transfer.originalFilename);
        if (config.staffNotifyEmail) {
          await mailer.sendStaffAlert(
            config.staffNotifyEmail,
            'ウイルス検出によりファイルを削除しました',
            `送信者: ${group2.senderEmail}\n宛先: ${group2.recipientEmail}\nファイル名: ${transfer.originalFilename}\ntransferId: ${transfer.id}`,
          );
        }
      }
    } else {
      logger.info({ transferId: transfer.id }, 'File is clean; transfer is now downloadable');
    }

    if (group) {
      await maybeSendGroupNotification(deps, group, logger);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function maybeSendGroupNotification(deps: ScanDeps, group: ScanGroupContext, logger: pino.Logger): Promise<void> {
  const { config, transferRepo, transferGroupRepo, mailer } = deps;

  const stillScanning = await transferRepo.countScanningInGroup(group.groupId);
  if (stillScanning > 0) {
    logger.info({ groupId: group.groupId, stillScanning }, 'Group not fully scanned yet; not notifying');
    return;
  }

  const claimed = await transferGroupRepo.claimForNotification(group.groupId);
  if (!claimed) {
    logger.info({ groupId: group.groupId }, 'Group notification already claimed by another request; skipping');
    return;
  }

  const cleanTransfers = await transferRepo.findCleanInGroup(group.groupId);
  if (cleanTransfers.length === 0) {
    logger.info({ groupId: group.groupId }, 'All files in group were infected; no recipient notification to send');
    return;
  }
  if (!config.downloadBaseUrl) {
    logger.warn({ groupId: group.groupId }, 'Skipping group notification: DOWNLOAD_BASE_URL is not configured');
    return;
  }

  const groupInfo = await transferGroupRepo.findById(group.groupId);
  if (!groupInfo) {
    logger.error({ groupId: group.groupId }, 'Transfer group vanished before notification could be sent');
    return;
  }

  const downloadUrl = `${config.downloadBaseUrl}/d/${group.token}`;
  await mailer.sendGroupDownloadLinkNotice({
    to: groupInfo.recipientEmail,
    senderEmail: groupInfo.senderEmail,
    senderName: groupInfo.senderName ?? groupInfo.senderEmail,
    note: groupInfo.recipientNote,
    expiresAt: groupInfo.expiresAt,
    downloadUrl,
    files: cleanTransfers.map((t) => ({ filename: t.originalFilename })),
  });
  logger.info({ groupId: group.groupId, fileCount: cleanTransfers.length }, 'Group notification sent');
}
