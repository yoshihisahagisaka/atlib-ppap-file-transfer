-- 複数ファイル一括送信対応。
-- 「1ファイル=1トークン=1DLページ」というダウンロード側の仕組みはそのまま維持しつつ、
-- 同じフォーム送信でアップロードされた複数ファイルの完了(clean/infected確定)を束ねて
-- 検知するための最小限の相関テーブル。生のダウンロードトークンはこのテーブルにもDBの
-- どこにも保存しない(既存方針を踏襲)。

CREATE TABLE transfer_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notified_at TIMESTAMPTZ,  -- 統合通知メール送信済みかどうかの排他制御に使う(UPDATE...WHERE notified_at IS NULLで1回だけ勝たせる)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transfers ADD COLUMN group_id UUID REFERENCES transfer_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_transfers_group_id ON transfers(group_id);
