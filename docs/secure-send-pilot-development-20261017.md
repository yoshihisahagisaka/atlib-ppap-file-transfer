# Secure Send 商用パイロット開発記録

2026-10-18再開追補：最新の契約人数・共同購買境界と今回の実装/未接続状況は
`secure-send-development-restart-20261018.md` / `secure-send-commercial-usage-runbook-20261018.md`を参照。
以下は2026-10-17のcheckpointとして保持し、最新Business Decisionは再開追補を優先する。

## 基準と権限

- upstream: yoshihisahagisaka/atlib-ppap-file-transfer
- 基準: d2fdd5b7015be4a3967e900f66c0e46a884d019d（PR #1、未マージ）
- main: 9c1b002。既存Fit/Gapを継承しCONDITIONAL FITを維持。
- 開発: feat/secure-send-tenant-foundation-20261017。既存作業ツリー外の独立チェックアウト。
- migration適用、Production変更、商用公開はそれぞれ影響・復旧方法を提示して承認を得る。
- Productionのfresh照会はgcloud credentials.dbアクセス拒否で未完了。既存調査のReadyを今回の確認結果として扱わない。

## Business Decision 料金設計v1

企業単位の人数別月額パック。対象は送信者のみ。受信者は原則アカウント不要で課金対象外。
価格、人数境界、レベニューシェアは未確定。超過時は上位プラン変更が基本候補で、具体的な拒否・猶予・通知動作は未決定。
価格・人数上限はコードに固定しない。契約・決済・自動変更は実装しない。

## 今回の実装と限界

tenantAuthorization.tsに組織・利用者・所属の整合、停止、送信権限、顧客管理者、送信所有者の判定を追加。
有効送信者数は対象企業のactive所属、canSend=true、active利用者の一意件数とする**技術上の暫定定義**。
招待中・停止済み・非送信者・受信者は含めない。組織停止によって人数記録をゼロにはしない。
この定義を請求・日割り・月次ピークなどの課金算定に転用する際は統括判断が必要。
管理者ロールと送信権限を分け、管理者という理由だけで他利用者のファイル所有権は与えない。
未設定の人数上限は無制限と解釈しない。allowance判定は将来の有効化処理用で既存送受信には未接続。

schema.draft.sqlはレビュー専用でmigration runner対象外。DB適用はしていない。
既存API・SSO・GCS・scanへの接続は未実施であり、現時点でマルチテナント安全性が成立したとは扱わない。

## 次の実装順序

1. 検証DB・バケット・サービスをProductionから分離した構成と費用影響を提示。
2. 実DBテスト用にtenant表、group/transfer/recipient/OTP/auditの組織参照と複合外部キーを設計。
3. セッションから信頼できる組織・所属を解決。body/headerのorganization ID単独では認可しない。
4. repo全体をtenant必須にし、作成・完了・取消・履歴・監査・scan・削除へ適用。
5. Google issuer/subjectで利用者を識別し招待照合。メールドメイン一致だけで所属を発行しない。
6. 人数の有効化は組織ロック＋集計＋更新を同一transactionで行い、並行有効化試験を実施。
7. 利用量の事実記録、監査閲覧、保持削除、監視・復旧検証、限定顧客E2E。

## 必須の統合テスト

- 企業A/B、同一利用者の複数所属、admin/member/停止/招待をfixture化。
- 他社groupIdを指定したupload作成・完了・取消は拒否し、URL発行・scan・通知を起こさない。
- 他社ファイル・履歴・監査・利用量を取得できない。DBで不整合な企業間参照を拒否。
- GCS prefixは配置規約であり単独の認可手段ではない。保存objectと組織・groupの一致を確認。
- 正規Toは社外でも受信成功、CCのみと他group OTPは拒否。
- 期限・回数・取消・scan状態を並行処理も含め検証。署名URL発行済みの有効期間も受入条件に記載。
- 正常送受信、複数ファイル、To/CC、感染、scan失敗、SMTP失敗、監査を回帰確認。
- 送信者枠有効化の競合、停止・再有効化、プラン変更との競合を実DBで確認。

## 次の承認資料

## 今回の検証記録

- Node v24.18.0: `node --experimental-strip-types --test test/tenantAuthorization.test.cjs` — 5件PASS。
- `git diff --check` — PASS。
- 既存ローカルTypeScriptコンパイラで `tsc -p test/tsconfig.tenant.json` — 新規共通処理のstrict型検査PASS（外部型定義を必要としない専用設定）。
- `npm ci --ignore-scripts --no-audit --no-fund`は応答が得られず中断。全体TypeScriptビルドは未確認。
- 実DB・API・GCS・SSOの統合試験は未実施。並行有効化の正しさも未検証。

## 承認時に提示する内容

検証DBへのmigration適用前にDDL、対象環境、削除可能なfixture、再作成手順を提示。
Production移行前に既存atLIBデータの件数・孤立参照・ledgerをread-only確認し、段階的backfillと互換性を設計。
データ投入後の切戻しは旧revisionへのtraffic変更だけで完了とはせず、新規顧客データ保全と旧版アクセス遮断を含める。

## 日程リスク

既存見積りP0 13〜20人日、P1 6〜10人日。約1か月は余裕が少ない。
保持削除・監視・顧客管理者を未実施のまま商用受入済みとはしない。
Google外部公開状態、SMTP制約、backup/復旧、監視設定は未確認。重大な日程影響は統括へ戻す。
