-- 宛先(To)の複数化 + CC対応。
-- 1グループ(1回のフォーム送信)に複数のTo・CCを許可する。
-- To宛先はダウンロード時OTP認証の対象(ダウンロードページで自分のメールアドレスを指定し、
-- 登録済みTo宛先と一致した場合のみそのアドレスにOTPを送る)。
-- CC宛先は通知メール(To/Ccヘッダで同送)を受け取るのみで、OTP発行・ダウンロード権限は持たない。

CREATE TABLE transfer_group_recipients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES transfer_groups(id) ON DELETE CASCADE,
  email      VARCHAR(255) NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('to', 'cc')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfer_group_recipients_group_id ON transfer_group_recipients(group_id);
CREATE UNIQUE INDEX idx_transfer_group_recipients_group_email ON transfer_group_recipients(group_id, email);

-- 既存データの移行: 単一だったrecipient_emailをTo1件として複製する
INSERT INTO transfer_group_recipients (group_id, email, kind)
SELECT id, recipient_email, 'to' FROM transfer_groups WHERE recipient_email IS NOT NULL;

ALTER TABLE transfer_groups DROP COLUMN recipient_email;

-- どのTo宛先に対して発行されたOTPかを記録する(複数To対応後、監査ログで「誰がダウンロードしたか」
-- を正しく特定するために必要)。既存行(移行以前に発行された期限切れOTP)はNULLのままでよい。
ALTER TABLE download_otps ADD COLUMN recipient_email VARCHAR(255);
