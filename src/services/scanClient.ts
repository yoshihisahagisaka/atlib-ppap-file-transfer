import { GoogleAuth } from 'google-auth-library';
import type pino from 'pino';

/**
 * upload-serviceからppap-virus-scanサービス(scan-server.ts)を同期的に呼び出す。
 * scan-server側のscanUploadedObject()がDB更新・(グループ全体が出揃った時点での)通知メール送信
 * まで完了してからレスポンスを返すため、このawaitが返った時点でスキャン結果は確定している。
 *
 * 認証はCloud Runサービス間のOIDC IDトークン(google-auth-libraryがメタデータサーバー経由で
 * ランタイムSAから自動取得)。msp-customer-portal/batch/generate-monthly-reports.tsのIAP呼び出し
 * パターンと同じ仕組みで、audienceには宛先サービスのURLそのものを使う。
 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RequestScanParams {
  bucket: string;
  objectName: string;
  groupId: string;
  groupToken: string;
}

/**
 * 呼び出し先が非2xxを返した場合に数秒おいて再試行する。scan-server側は
 * transfer.status !== 'scanning' なら即returnして何もしない設計(scanRunner.ts)のため、
 * 1回目が実は成功していた場合でも再試行は安全(二重スキャン・二重メール送信は起きない)。
 * コールドスタート直後にCloud Runが一時的に503を返すケースの吸収が主目的。
 */
export async function requestScan(scanServiceUrl: string, params: RequestScanParams, logger: pino.Logger): Promise<void> {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(scanServiceUrl);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const authHeaders = await client.getRequestHeaders();
      const res = await fetch(scanServiceUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket: params.bucket,
          name: params.objectName,
          groupId: params.groupId,
          groupToken: params.groupToken,
        }),
      });

      if (res.ok) return;

      const text = await res.text().catch(() => '');
      lastError = new Error(`Scan service returned HTTP ${res.status}`);
      logger.warn({ attempt, status: res.status, text }, 'Scan service call failed; will retry if attempts remain');
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ attempt, err: lastError }, 'Scan service call errored; will retry if attempts remain');
    }

    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }

  logger.error({ err: lastError }, 'Scan service call failed after all retries');
  throw lastError ?? new Error('Scan service call failed');
}
