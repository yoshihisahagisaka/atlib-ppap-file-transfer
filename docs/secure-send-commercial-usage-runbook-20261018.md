# Secure Send usage 第1実装 Runbook

対象branch：`feat/secure-send-commercial-usage-20261018`。本書だけでProduction migration・deploy・公開を実行しない。

## ローカル検証（DB不要）

Node24.18以降の対応環境で実行する。アプリ自体の既存engines/commonjs設定は変更しない。Node24固有のtest hookとtransformは試験用。

```powershell
node --version
npm ci
npm run typecheck:commercial
npm run test:commercial
git diff --check
```

今回の環境では`npm ci`がEPERMで完了しなかったため、lockと一致するtypescript5.9.3を作業用ディレクトリへ取得し、次のコマンドで追加コードだけをstrict検査した。依存ディレクトリの削除/権限変更や他repoのnode_modules共用はしていない。

```powershell
# このworkspaceのsecure-send-commercial-devから実行した記録
node ../work/ts-5.9.3/package/lib/tsc.js -p test/tsconfig.commercial.json
node --experimental-transform-types --test test/tenantAuthorization.test.cjs test/commercialUsage.test.cjs test/commercialUsage.postgres.test.cjs
```

DB未指定ならPostgreSQL試験はSKIP。SKIPをDB試験PASSとして数えない。テストで使うMemoryUsageStoreとfakeNodemailerは`test/support`だけにあり、Productionで利用しない。全体`npm run build`、実SDK・SMTP・SSO・scan・受信のE2Eは依存復元後に必要。

## 隔離PostgreSQL試験（別途承認後・任意実行）

`test/commercialUsage.postgres.test.cjs`は専用LOCALテストDBを要求する。通常の`DATABASE_URL`や`.env`、Cloud SQLの既存認証は読まない。hostnameをlocalhost/127.0.0.1、DB名末尾を`commercial_usage_test`に制限し、別のDDL許可変数が必要。

```powershell
# 事前にレビュー済みの空のLOCALテストDBと専用roleを準備する。
# 本番/共有Cloud SQL接続文字列を設定しない。実際のパスワードをチャットへ貼らない。
$env:SECURE_SEND_USAGE_TEST_DATABASE_URL = Read-Host '専用LOCALテストDB URL（秘密値を出力しない）' -MaskInput
$env:SECURE_SEND_USAGE_TEST_ALLOW_DDL = 'yes'
node --experimental-transform-types --test test/commercialUsage.postgres.test.cjs
Remove-Item Env:SECURE_SEND_USAGE_TEST_DATABASE_URL
Remove-Item Env:SECURE_SEND_USAGE_TEST_ALLOW_DDL
```

`-MaskInput`はPowerShell7向け。対応しない環境では秘密を適切な環境変数として別途設定する。検証用URLをGitやログへ保存しない。

試験はランダムな`send_usage_test_<hex>`schemaに組織・transferのfixtureとdraft DDLを作り、最後に**そのschemaだけ**を削除する。既存テーブル・migration ledgerは操作しない。DB/role/schema作成権限とこの試験の適用範囲を承認してから実行する。今回Dockerはpermission deniedで、試験は未実施。

## 本体接続に必要なadapter（未接続）

| port | 供給元／条件 |
| --- | --- |
| `TenantContext` | Google issuer/subject・有効所属・企業状態からサーバーが解決。body/headerの任意orgやメールドメインだけで作らない |
| `StaffContext` | 社内認証と権限allowlistから解決。customer adminに`allowance:apply`/`capacity:grant`を与えない |
| 正式snapshot | `organizationId/periodId/startsAt/endsAt/contractedSenders/baseQuotaBytes/sourceOrderId/sourceRevision/effectiveAt/sendingEnabled/plan`。署名/認証されたcommon adapterまたは確認済み手動操作のみ |
| `transfer` | tenant-scoped DB検索。groupとtransfer所属、所有者、取消/期限、object pathを確認し、取消済みならnull。clientのobjectNameは受け取らない |
| `metadata/deleteGeneration` | 指定されたprivate bucketのCommercialGcs。GCS SDK形状・ifGenerationMatchの型と実挙動を確認。generationの412は再試行で削除対象を置き換えない |
| `uploadClosed` | URL失効だけではtrueにしない。PUTの遅延完了を排除できる照合/運用の確証。未実装時はfalseとして予約を保持する |
| admin連絡先 | 対象orgの有効なadminを都度取得。招待/停止/他orgは通知しない。0件は配送失敗→outbox/監視で扱う |
| SMTP | `createUsageAdminNotifier(resolveAdmins, {send:(to,s,t)=>mailer.sendUsageNotice(to,s,t)}, {serviceName:configDisplayName})` |
| DL観測 | 署名URL発行推計は`issued_estimate`、検証済みrecipient egressは`observed_egress`。scan/内部読み出しをrecipient観測へ混入させない |

接続時の注意：completeの`transfer`照合とGCS metadata確認、削除はusage transaction内で行う。transfer resolverが同じ飽和したpoolからさらに接続を待つ構成は避け、transactionに結び付いたlookup adapter、または別の上限付きread poolを使う。pool枯渇・timeout・組織内並行負荷を実DBで試験するまでAPIへmountしない。usageの企業advisory lockと、既存draftのmembership有効化で想定した組織行lockは同一ではないため、送信者招待/停止・契約数量変更を統合する際にlock順序を固定する。今回の管理viewは乖離検知であり、送信者有効化のDB処理を完成させたものではない。

snapshotは契約・数量・期間の提供権利であって請求書ではない。20日締切、月末変更予約、日割り端数、組合上乗せ価格、40%配分は共通基盤の責任。数量減少は新periodで適用し、Send内で組合の申込を受理しない。

## 正確なupload接続順（将来の変更レビュー用）

1. 所有権・tenantを検証した既存group/transferを用意する。group自体の乱造・ファイル数制限も契約設定に従わせる。
2. `reserve`で容量を確保する。SQLtransactionをcommitした後、`CommercialGcs.uploadGrant`で署名URLを発行。
3. ブラウザは返却されたContent-Type、`x-goog-content-length-range`、`x-goog-if-generation-match`を**そのまま**PUTする。署名URLをログへ出さない。bucket CORSの許可header変更は別途レビュー/承認。
4. completeで実sizeとgenerationを確定。既存transferへactual sizeとgenerationを保存し、scanを**同じgeneration**へ限定する。quota確定だけでcleanと扱わない。
5. 既存clean/To/CC/OTP/期限・回数・取消を保ち、既存download側へquotaゲートを追加しない。短期DL URLはgroup残存期限以内へclampする。

この順を既存APIへまだ組み込んでいない。現在の通常PUT URLには新しいsize/overwrite制約は付かない。新旧経路を誤って混在させて商用提供しない。

## worker・監視（新規infra未構築）

`discoverUsageWork`→`processUsageWork`を認証済みjobから呼ぶ想定。in-process timerで送信保証を主張しない。per queueの最大件数は設定、DB負荷とpoolを計測する。通知はDB内claim→SMTPはtransaction外→lease tokenで結果確定。削除はobject+generation条件を使用し、状態確定前の停止は安全に再試行できる。

失敗を通常ログへraw dumpせず、failed/deferred件数・遅延を監視する。少なくとも以下のread-only照合が必要（接続は別途承認された環境のみ）。

```sql
-- outboxの状態ごとの件数。宛先・本文・ファイル情報は出力しない。
SELECT payload->>'state' AS state, count(*)
FROM send_usage_outbox GROUP BY payload->>'state';
-- 未解放予約/削除待ちの数。詳細調査は権限ある個別操作で行う。
SELECT payload->>'state' AS state, count(*)
FROM send_usage_reservations GROUP BY payload->>'state';
```

failed通知は自動でsentにしない。admin宛先/SMTPを確認したうえで、監査付きの再送操作を別途設計する。今回lease/retry/maxAttemptsは実装したが、failedからの運用再送画面と監視基盤は未接続。容量追加は`grantCapacity`に理由と承認参照を渡す。顧客からの直接自己増枠は禁止。

## 実行していない操作と復旧

DB migration、番号採番、Cloud Run/SQL/GCS/Secret/CORS/Scheduler変更、メール送信、SSO設定、main merge、商用公開は未実施。draft SQLはmigrations runner外。次の承認時は対象環境、確定DDLとruntime ACL、backfill、ledger照合、load/lock影響、復旧手順を提示する。

本体へ接続した後の切戻しは、受付停止→予約/GCS/outbox/実使用を照合→tenant/quota互換版へ戻す。新規データを旧IAP-only版へ流さず、DROPで復旧しない。保持削除後の物理復元とURLの再有効化は別問題。旧社内bucketの21日lifecycleやsoft deleteを無断変更しない。

## 公式仕様の確認先（2026-10-18）

- https://docs.cloud.google.com/storage/docs/xml-api/reference-headers ：PUTのcontent-length-range、generation-match=0。
- https://docs.cloud.google.com/storage/docs/request-preconditions ：generation条件。
- https://docs.cloud.google.com/storage/docs/access-control/signed-urls ：有効期間中のURL再利用。
- https://docs.cloud.google.com/storage/docs/soft-delete ：削除後保持・課金と通常アクセス不可。
