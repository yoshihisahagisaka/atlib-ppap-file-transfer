import { requireValue, identifier, integer } from '../domain/commercialUsage';
import type { Notice } from '../domain/commercialUsage';

export interface UsageAdminContact {
  organizationId: string; organizationStatus: 'active' | 'suspended';
  role: 'admin' | 'member'; membershipStatus: 'active' | 'suspended' | 'invited';
  userStatus: 'active' | 'suspended'; email: string;
}
export interface UsageMailPort { send(to: string[], subject: string, text: string): Promise<void>; }

/** SMTP transport can delegate to the existing Mailer. No file/OTP/token/request-body recipient. */
export function createUsageAdminNotifier(
  resolve: (organizationId: string) => Promise<UsageAdminContact[]>,
  mailer: UsageMailPort,
  display: { serviceName: string },
): (organizationId: string, notice: Notice) => Promise<void> {
  requireValue(display.serviceName.trim().length > 0 && display.serviceName.length <= 100 && !/[\r\n]/.test(display.serviceName), 'INVALID_DISPLAY_NAME');
  return async (org, notice) => {
    identifier(org); const contacts = await resolve(org);
    requireValue(contacts.every(c => c.organizationId === org), 'CONTACT_TENANT_MISMATCH');
    const admins = contacts.filter(c => c.organizationStatus === 'active' && c.role === 'admin' && c.membershipStatus === 'active' && c.userStatus === 'active');
    const to = [...new Set(admins.map(c => c.email))];
    requireValue(to.length > 0 && to.every(email => /^[^\s@]+@[^\s@]+$/.test(email) && email.length <= 320), 'NO_VALID_ADMIN_CONTACT');
    const state = notice.kind === 'quota_full' ? '送信容量の上限に達しました' : notice.kind === 'quota_warning' ? '送信容量の上限が近づいています' : 'ダウンロード通信量の増加を検知しました';
    const bytes = (notice.observedBytes / 1_000_000_000).toFixed(2);
    const limit = (notice.thresholdBytes / 1_000_000_000).toFixed(2);
    integer(notice.periodStartsAt, 'NOTICE_PERIOD'); integer(notice.periodEndsAt, 'NOTICE_PERIOD');
    const period = `${new Date(notice.periodStartsAt).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'})} 〜 ${new Date(notice.periodEndsAt).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'})}（終了時刻は含みません）`;
    const measurement = notice.kind !== 'download_anomaly' ? '送信済み容量' : notice.id.startsWith('download:issued_estimate:') ? 'URL発行に基づく推計容量' : '観測された外向き通信量';
    const note = notice.kind === 'download_anomaly'
      ? '発行URLからの推計と実測値は別々に検知します。異常の原因を確認してください。受信の自動停止や追加請求は行っていません。'
      : '既存ファイルの受信は、有効期限・宛先・確認コード・回数制限の範囲で引き続き利用できます。容量追加は窓口へご相談ください。';
    await mailer.send(to, `【${display.serviceName}】${state}`, `${state}\n対象期間: ${period}\n${measurement}: ${bytes} GB\n判定基準: ${limit} GB\n\n${note}`);
  };
}
