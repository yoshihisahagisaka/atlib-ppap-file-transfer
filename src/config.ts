import { getSecret } from './lib/secrets';

export interface Config {
  nodeEnv: string;
  port: number;
  gcpProjectId: string;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    socketPath?: string;
  };
  storageBucket: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
  };
  // Cloud IAP (upload-serviceのみ使用)。既存の msp-iap-urlmap に相乗りしている複数のbackend service
  // (一般アクセス用ppap-upload-bes、監査ログ専用ppap-audit-bes)それぞれのaudience文字列
  // (/projects/{project_number}/global/backendServices/{id})をカンマ区切りで並べたもの。
  // 空配列の場合、upload-server.ts は本番(NODE_ENV=production)では起動時エラーで落ちる。
  // ローカル開発時はIAPヘッダを付与できないため未設定のまま起動し、ダミーユーザーで動作確認する。
  iapAudiences: string[];
  // 例: https://files.atlib.jp (社外向け、公開)。upload-serviceが通知メール内のリンク生成に使う。
  // download-service/scan jobでは未使用のため任意項目とし、upload-server.ts側で起動時に必須チェックする。
  downloadBaseUrl?: string;
  // ウイルススキャンサービス(ppap-virus-scan)のURL。upload-serviceが/completeでの同期スキャン
  // 呼び出しに使う。download-service/scan-server自身では未使用のため任意項目。
  scanServiceUrl?: string;
  transfer: {
    defaultExpiresDays: number;
    maxExpiresDays: number;
    maxDownloads: number;
    otpExpiresMinutes: number;
    maxOtpAttempts: number;
    signedUrlExpiresMinutes: number; // ダウンロード実行用の署名付きURL自体の有効期限(短め)
    maxUploadSizeMb: number;
  };
  staffNotifyEmail?: string; // 感染検知時などの社内通知先(任意)
  // sso-verify-server専用(SSO検証スパイク)。GOOGLE_OAUTH_CLIENT_ID等が環境変数に無ければ
  // 各プロパティはundefinedのままになり、Secret Manager呼び出しも一切発生しない
  // (upload/download/scanの3本番サービスの起動挙動には影響しない)。
  sso: {
    google?: { clientId: string; clientSecret: string; redirectUri: string };
    microsoft?: { clientId: string; clientSecret: string; tenantId: string; redirectUri: string };
    sessionSecret?: string;
    seatCapDefault: number;
  };
}

async function resolveSecret(
  projectId: string,
  envValue: string | undefined,
  secretId: string,
): Promise<string> {
  if (envValue) return envValue;
  return getSecret(projectId, secretId);
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required config value: ${name}`);
  return value;
}

export async function loadConfig(): Promise<Config> {
  const gcpProjectId = process.env.GCP_PROJECT_ID ?? 'msp-zabbix';

  const dbPassword = await resolveSecret(gcpProjectId, process.env.DB_PASSWORD, 'ppap-db-password');
  const smtpPassword = await resolveSecret(gcpProjectId, process.env.SMTP_PASSWORD, 'ppap-smtp-password');

  // sso-verify-server専用。対応する環境変数が設定されている場合のみ解決する(ガード)。
  // upload/download/scanのデプロイにはこれらの環境変数が存在しないため、それらのサービスでは
  // google/microsoft/sessionSecretは常にundefinedのままとなり、新規のSecret Manager呼び出しは発生しない。
  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const google = googleClientId
    ? {
        clientId: googleClientId,
        clientSecret: await resolveSecret(
          gcpProjectId,
          process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          'ppap-sso-verify-google-client-secret',
        ),
        redirectUri: required('GOOGLE_OAUTH_REDIRECT_URI', process.env.GOOGLE_OAUTH_REDIRECT_URI),
      }
    : undefined;

  const microsoftClientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const microsoft = microsoftClientId
    ? {
        clientId: microsoftClientId,
        clientSecret: await resolveSecret(
          gcpProjectId,
          process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
          'ppap-sso-verify-entra-client-secret',
        ),
        tenantId: required('MICROSOFT_OAUTH_TENANT_ID', process.env.MICROSOFT_OAUTH_TENANT_ID),
        redirectUri: required('MICROSOFT_OAUTH_REDIRECT_URI', process.env.MICROSOFT_OAUTH_REDIRECT_URI),
      }
    : undefined;

  const ssoConfigured = Boolean(googleClientId || microsoftClientId);
  const sessionSecret = ssoConfigured
    ? await resolveSecret(gcpProjectId, process.env.SSO_SESSION_SECRET, 'ppap-sso-verify-session-secret')
    : process.env.SSO_SESSION_SECRET;

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 8080),
    gcpProjectId,
    db: {
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      name: required('DB_NAME', process.env.DB_NAME),
      user: required('DB_USER', process.env.DB_USER),
      password: dbPassword,
      socketPath: process.env.DB_SOCKET_PATH || undefined,
    },
    storageBucket: required('STORAGE_BUCKET', process.env.STORAGE_BUCKET),
    smtp: {
      host: required('SMTP_HOST', process.env.SMTP_HOST),
      port: Number(process.env.SMTP_PORT ?? 587),
      user: required('SMTP_USER', process.env.SMTP_USER),
      password: smtpPassword,
      from: required('SMTP_FROM', process.env.SMTP_FROM),
    },
    iapAudiences: (process.env.IAP_AUDIENCE ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    downloadBaseUrl: process.env.DOWNLOAD_BASE_URL || undefined,
    scanServiceUrl: process.env.SCAN_SERVICE_URL || undefined,
    transfer: {
      defaultExpiresDays: Number(process.env.TRANSFER_DEFAULT_EXPIRES_DAYS ?? 7),
      maxExpiresDays: Number(process.env.TRANSFER_MAX_EXPIRES_DAYS ?? 14),
      maxDownloads: Number(process.env.TRANSFER_MAX_DOWNLOADS ?? 3),
      otpExpiresMinutes: Number(process.env.OTP_EXPIRES_MINUTES ?? 10),
      maxOtpAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
      signedUrlExpiresMinutes: Number(process.env.SIGNED_URL_EXPIRES_MINUTES ?? 5),
      maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 200),
    },
    staffNotifyEmail: process.env.STAFF_NOTIFY_EMAIL || undefined,
    sso: {
      google,
      microsoft,
      sessionSecret,
      seatCapDefault: Number(process.env.SSO_SEAT_CAP_DEFAULT ?? 3),
    },
  };
}
