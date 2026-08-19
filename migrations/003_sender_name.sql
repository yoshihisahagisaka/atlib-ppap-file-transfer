-- 送信者氏名(通知メールの件名・本文に使う)。既存行はNULL許容(過去データはメールアドレスのみ表示)。
ALTER TABLE transfers ADD COLUMN sender_name VARCHAR(255);
