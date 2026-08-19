-- ppap-file-transfer 初期スキーマ

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 送信案件(1ファイル送信 = 1レコード)
CREATE TABLE transfers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_email      VARCHAR(255) NOT NULL,        -- IAPで確認済みの社内送信者
  recipient_email   VARCHAR(255) NOT NULL,        -- ダウンロード通知・OTP送付先
  recipient_note    TEXT,                          -- 送信者が入力する宛先メモ(任意。会社名・案件名等)
  original_filename VARCHAR(500) NOT NULL,
  content_type      VARCHAR(255) NOT NULL,
  size_bytes        BIGINT NOT NULL,
  storage_object    TEXT NOT NULL,                 -- GCSオブジェクトパス(バケット名は含まない)
  status            TEXT NOT NULL DEFAULT 'pending_upload'
                       CHECK (status IN ('pending_upload', 'scanning', 'clean', 'infected', 'expired', 'revoked')),
  token_hash        VARCHAR(255) NOT NULL UNIQUE,  -- ダウンロードリンクトークンのSHA-256ハッシュ(生トークンは保存しない)
  expires_at        TIMESTAMPTZ NOT NULL,
  max_downloads     INT NOT NULL DEFAULT 3,
  download_count    INT NOT NULL DEFAULT 0,
  uploaded_at       TIMESTAMPTZ,                   -- アップロード完了(complete API呼び出し)時刻
  scanned_at        TIMESTAMPTZ,                   -- ウイルススキャン完了時刻
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfers_token_hash ON transfers(token_hash);
CREATE INDEX idx_transfers_sender_email ON transfers(sender_email);
CREATE INDEX idx_transfers_status ON transfers(status);

-- 受信者ダウンロード用OTP(1回のダウンロードリクエストにつき1件発行)
CREATE TABLE download_otps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id   UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  code_hash     VARCHAR(255) NOT NULL,             -- bcryptハッシュ(生コードは保存しない)
  expires_at    TIMESTAMPTZ NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_download_otps_transfer_id ON download_otps(transfer_id);

-- 監査ログ(誰が・いつ・何をしたか。ISMS対応で長期保管する)
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
  event       TEXT NOT NULL,                       -- created, uploaded, scan_clean, scan_infected,
                                                     -- otp_requested, otp_verified, otp_failed, downloaded,
                                                     -- expired, revoked
  actor       VARCHAR(255),                        -- 社内メールアドレス、'recipient'、または 'system'
  ip_address  VARCHAR(64),
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_transfer_id ON audit_logs(transfer_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
