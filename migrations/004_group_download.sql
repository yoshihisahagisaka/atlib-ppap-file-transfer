-- ダウンロード認可をファイル単位からグループ単位に一本化する。
-- 受信者は1つのURL(グループトークン)にアクセスし、1回のOTP認証で
-- グループ内の全ファイル(clean判定のもの)を個別/一括ダウンロードできるようにする。
-- (これまでは1ファイル=1トークン=1OTPで、受信メールにファイル数分のリンクが並び分かりづらかった)

ALTER TABLE transfer_groups
  ADD COLUMN sender_email VARCHAR(255),
  ADD COLUMN sender_name VARCHAR(255),
  ADD COLUMN recipient_email VARCHAR(255),
  ADD COLUMN recipient_note TEXT,
  ADD COLUMN token_hash VARCHAR(255) UNIQUE,
  ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN max_downloads INT NOT NULL DEFAULT 3,
  ADD COLUMN download_count INT NOT NULL DEFAULT 0,
  ADD COLUMN revoked_at TIMESTAMPTZ;

CREATE INDEX idx_transfer_groups_token_hash ON transfer_groups(token_hash);
CREATE INDEX idx_transfer_groups_sender_email ON transfer_groups(sender_email);

-- ファイル単位のトークン/期限/DL回数/宛先情報はもう使わない(グループ側に一本化したため)。
-- sender_emailだけは「自分の送信履歴」絞り込みクエリの簡素化のためtransfers側にも残す。
-- 開発中の試験データのみが対象のため、破壊的だが列ごと削除する。
ALTER TABLE transfers
  DROP COLUMN token_hash,
  DROP COLUMN expires_at,
  DROP COLUMN max_downloads,
  DROP COLUMN download_count,
  DROP COLUMN sender_name,
  DROP COLUMN recipient_email,
  DROP COLUMN recipient_note;

-- OTPもグループ単位に変更。旧スキーマのdownload_otps.transfer_idは(リネーム後の)
-- transfer_groups.idとは異なる値(ファイル単位のtransfers.id)を指しているため、
-- リネーム後に外部キーを張るとFK違反になる。OTPは有効期限10分の使い捨てデータなので、
-- 移行時点で残っている行は全て破棄してよい。
DELETE FROM download_otps;
ALTER TABLE download_otps RENAME COLUMN transfer_id TO group_id;
ALTER TABLE download_otps DROP CONSTRAINT download_otps_transfer_id_fkey;
ALTER TABLE download_otps
  ADD CONSTRAINT download_otps_group_id_fkey FOREIGN KEY (group_id) REFERENCES transfer_groups(id) ON DELETE CASCADE;

-- 監査ログもグループ単位のイベント(OTP要求/検証/ダウンロード/取消)を記録できるようにする
ALTER TABLE audit_logs ADD COLUMN group_id UUID REFERENCES transfer_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_audit_logs_group_id ON audit_logs(group_id);
