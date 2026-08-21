-- SSO検証スパイク専用スキーマ。既存のtransfers/transfer_groups/audit_logs等には一切触れない。
-- 本番のppap_transferデータベースには絶対に適用しないこと。専用データベース(ppap_sso_verify)に
-- のみ適用する想定(migrations/runner.tsはDB_NAME環境変数で対象データベースを切り替える)。

-- pgcryptoは拡張機能なのでデータベースごとに個別に有効化が必要
-- (001_init.sqlでppap_transferには有効化済みだが、これは別データベースのため改めて有効化する)。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 検証用の「登録済み顧客企業」ドメイン一覧。本番の正式なマルチテナントスキーマではない、
-- JITプロビジョニングの座席上限ロジックを検証するためだけの簡易テーブル。
CREATE TABLE sso_verify_customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain       VARCHAR(255) NOT NULL UNIQUE,   -- 例: 'atlib.jp'
  company_name VARCHAR(255) NOT NULL,
  seat_cap     INT NOT NULL DEFAULT 3,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- JITプロビジョニングで自動作成される「送信者アカウント」。
CREATE TABLE sso_verify_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL REFERENCES sso_verify_customers(id) ON DELETE CASCADE,
  email          VARCHAR(255) NOT NULL UNIQUE,
  provider       VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'microsoft')),
  first_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sso_verify_users_customer_id ON sso_verify_users(customer_id);
