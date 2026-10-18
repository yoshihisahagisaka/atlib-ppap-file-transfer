# 第2工程：実装と引継ぎ

基準：main `9c1b002`、Draft PR5 `e87727a`（source-equivalent local `ffd39ef`）。独立branch `feat/secure-send-stage2-20261018`からPR5へstackする。main/PR5開発branchは更新しない。Corporate Issue16〜38はmanifest参照。

## 完了

- 商用opt-in compositionを既存upload-serverへ追加。Google/Microsoftの既存OIDC実装を再利用し、issuer/subjectで事前承認済み所属を解決。adminと送信権限、企業境界を分離。
- 既存送信create/completeへ予約・実size/generation確定を接続。PGは企業advisory lock、同一connectionで所有権再確認とtransfer/usage/outbox確定。commit後のscan失敗を再送でき、二重計上しない。
- 既存scan/受信にsame generationを引き継ぎ、signedURLの期限をgroup期限内へclamp。100%でも既存受信はquotaと独立。
- DL回数を原子的にclaim。回帰検証で発見した既存OTPの`verified_at`によるコード比較/期限確認迂回を修正し、実bcryptを使うfixture回帰試験を追加。
- current admins→既存Mailerの明示batch接続、DL URL発行推計observerを追加。自動worker/新infra/共通問い合わせは作成しない。
- DDL依存・ledger確認SQL・事前backup/restore・lock影響・切戻し・実行手順をRunbook化。SQLはrunner外、未採番・未適用。

## 検証結果

| 検証 | 結果 | 限界 |
| --- | --- | --- |
| 全アプリTypeScript build | PASS | 実サービス起動/Cloud SDK実接続を意味しない |
| 第1工程strict subset | PASS | 新規接続コードも全アプリstrict buildに含む |
| 既存tenant/usageテスト | 23 PASS、0 FAIL、1 SKIP | PostgreSQL実試験はSKIP |
| 追加HTTP/接続/認証回帰 | 16 PASS、0 FAIL、6 SKIP | Express/loopback、実署名/JWKS/bcrypt。DB/GCS/scan/SMTP/OTP DBはfixture/port double |
| diff check | PASS | 証跡は`docs/evidence/stage2-20261018/` |

**合計39 PASS、0 FAIL、7 SKIP。** 実環境SSO/SMTP/GCS/ClamAV、実PostgreSQL排他/DDL/Production相当E2EはPASS扱いしない。DB fixtureを完全な既存SQL→tenant→connection→usage依存に更新したが、実適用は今回行っていない。

## 未完了と次の承認

最初の承認対象は、**対象・role・DDL hash・backup/復元確認を添えた専用検証DBへのmigration適用**。現時点では接続先未指定・実ledger未確認なので、適用Goを出せる状態ではない。Runbookのread-only preflightで根拠を揃え、実DDL前に停止する。Cloud Run/GCS/IAM/CORS/Production/main/公開は個別承認のまま。

次に実DB排他/複合FK→SSO越境→GCS size/create-only/世代→ClamAV/OTP/To/CC/SMTP再送→worker削除/容量上限/受信継続の順で実証する。既存global audit viewerはcustomerへ公開しない。

残課題：複数active所属の初回選択、招待/停止管理と契約人数変更の正式発注接続、workerの実行場所/監視/失敗通知、署名失敗/pending PUT予約の照合、scan自動再試行、受信者通知claim後停止の復旧、実egress観測、契約終了時の既存受信・消去条件。legacy IAP-only modeを商用DBへ戻すrollbackは認めず、tenant-aware schema/dataと受信を維持する。

料金・共同購買・請求・共通問い合わせは既存Canonicalに委ねる。提供権利snapshotを請求情報と混同せず、未確定条件を事業判断としてコードに埋めていない。

手順：[第2工程Runbook](secure-send-stage2-runbook-20261018.md)。前工程：[第1工程Runbook](secure-send-commercial-usage-runbook-20261018.md)。
