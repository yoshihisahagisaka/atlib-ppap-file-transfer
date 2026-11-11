# Secure Send 検証DB migration 最終承認Runbook
日付2026-10-18 JST。準備のみ、実migration/ACL適用/fixture/backup/restoreは未実施。
対象は専用container secure-send-pg17-validation / Volume secure-send-pg17-validation-data / Windows127.0.0.1:55432 / DB send_commercial_usage_test / schema public / send_migratorのみ。FACTACT/PIRA/Cloud SQL/既存社内Sendを含まない。

## Canonical
fresh GitHub確認: main9c1b002、PR5 e87727a、PR6 287c4a9、PR8 465802e、PR9 0a8f23f、PR10 67262a28ff7c446237bd16babd2012f43b32750a、すべて既存SHA維持。PR5→6→8→9→10のstackを継承する。本PRはPR10上の準備差分。
ユーザー端末のclean 4ad8470e worktree、Windows Node24.18.0、公式PG17.11、3Role認証/ACL、host経由READ_ONLY_COLLECTED、ledger null、対象表空、残9.49GiBを既存証跡とする。再構築・再試験はしない。実行直前のfresh identity/空状態確認は承認後の事故防止gate。
エージェントはローカルGit/Dockerへアクセス不可のためDBへ接続していない。GitHubのbase64原本を復号してbyte/hash/Git blobを照合。原本をhashに合わせて編集しない。

## 原本・採番manifest
manifest sourceCommitは67262a28。SHA-256/byte数は**Git blobのraw UTF-8 byte列**（現原本LF）から算出。worktreeのCRLFは検証時のみLF正規化比較し、末尾LFは足さず引かず、原本は書換えない。apply用bundleはgit showでraw byteを取り出す。
| 順 | 検証ledger filename | 元ファイル | Git bytes | SHA-256 |
|---|---|---|---:|---|
| 1 | 001_init.sql | migrations/001_init.sql | 3181 | 12fea4560b18745ec147dc1b90acd15eed09e559f3468013a723ac98672d1186 |
| 2 | 002_transfer_groups.sql | migrations/002_transfer_groups.sql | 933 | e03abb15649cb8254b0f5976d15bfbaa67166014c59d020ced1435cf61d07cef |
| 3 | 003_sender_name.sql | migrations/003_sender_name.sql | 203 | 672a116a74de2457c58c87e806e9d40658ef83ee35fd0b7093eb11dbd7d428a6 |
| 4 | 004_group_download.sql | migrations/004_group_download.sql | 2583 | 7404c8c5e30410212c4603d07f4e076fc95032d7b6db051d3a6bd1e07de62779 |
| 5 | 006_recipient_cc.sql | migrations/006_recipient_cc.sql | 1637 | 7a8761ecef3299efcc4d0461fa23f78af00c6d0c059c40c76ee044867fc9b7a5 |
| 6 | 007_tenant_foundation.sql | docs/tenant-foundation-schema.draft.sql | 2084 | c0388738364cc03c36912aa7dea4007a3e27bd22e996e9f565e409d8b3cb71dd |
| 7 | 008_commercial_transfer_connection.sql | docs/commercial-transfer-connection-schema.draft.sql | 1946 | 1de3411f9baad19ff2fae323e480aa8f7c24bac6b78d345d9ec0a273952e9a91 |
| 8 | 009_commercial_usage.sql | docs/commercial-usage-schema.draft.sql | 3860 | f572ed562cbaeeb489134c34628b495f1ed5f26747e3700c154bd9133509a90d |
ACL追加手順010_validation_runtime_acl.sql: docs/secure-send-validation-runtime-acl-20261018.sql、1840 bytes、SHA256 4f7819ab2ac94856bea7b1fb9c0b85a2eefa3ecad764b9545c3812889ad6f088。

007/008/009はこの**検証環境のledger名**として確定。010は検証ACLの適用記録名。docsのdraft原本を変更/移動せず、bundle生成時にledger名へ対応付ける。本番のmigrationsディレクトリへ無断追加しない。Production採番は将来別review。
root baselineの最新番号006、005欠番維持。archive005を詰めない。実検証ledger不存在の証跡あり。今後remoteに同番号追加・採番変更があれば停止してmanifest再承認。
適用対象外: migrations/sso-verify-archive/005_sso_verify_spike.sql、bootstrap SQL再実行、test fixture、任意の*.sql、過去の調査SQL。本体migration runnerは通常configを読むため使用しない。

## 依存と影響
001: pgcrypto extension、transfers/download_otps/audit_logs。
002: transfer_groups、transfer group_id。
003: 旧sender_name追加（004に必要）。
004: group downloadへ移行、旧列DROP、OTP DELETE、監査group_id。**専用空baseline構築に限る**。
006: To/CC recipients、旧group recipient_emailのINSERT移行/DROP、OTP recipient_email追加。
007: organizations/users/identities/memberships/plans/assignmentsの6表。
008: org/user/generation列、CHECK/複合FK/UNIQUE/index。
009: usage5表、append-only関数/trigger、partial index。
010: 以下のACL。baseline5表+tenant6+usage5=アプリ16表、schema_migrationsを加えpublicの業務・管理表17。extension/system objectは別集計。
空DBのみ、既存顧客データなし、email/domain推測backfillなし。004/006の削除を既存社内DBに適用しない。CREATE EXTENSION pgcryptoはPG17 trusted extensionのDB所有者権限とimage内availabilityを適用前補足inventoryで確認し、権限エラー時bootstrap/superuserにすり替えて実行しない。
通常index/ALTER/FKはlockを取る。file別transaction、lock5s/statement60s、timeout・失敗時そのfileをrollbackし後続停止。先行commitは残る。再実行は空DBgateで拒否し、IF NOT EXISTSで隠さない。

## ACL計画（010原本が正）
- send_migratorが全アプリDDL/ledger owner、非superuser/CREATEDB/CREATEROLE/BYPASSRLSを維持。
- runtime: transfer/group/recipients/OTP/audit SELECT/INSERT、必要列UPDATEのみ。DELETE/TRUNCATEなし。
- runtime: usage periods/reservations/outbox SELECT/INSERTと必要列UPDATE、events/observations SELECT/INSERTのみ。
- tenant/plan: SELECTのみを原則とし、既存FOR SHAREに必要なUPDATE(status)をorganizations/users/membershipsへ限定。identity/plan/契約変更APIは追加しない。
- runtime: UUID defaultの依存先generatorの実効EXECUTEも確認する。extensionが作る関数の所有/ACLはmigrator default privilegesと別に照合し、不足時は所有者と必要権限を確認して再承認、superuserでの無断権限拡大なし。
- runtime: schema/DB CREATE、role管理、trigger変更、ledger SELECT/INSERT/UPDATE/DELETEなし。UUIDなのでsequence権限不要。
- read-only:既存default ACL+明示SELECT、DML/DDLなし、role所属なし。read_only設定に加えてACLで制限。
- audit/events/observationsへのUPDATE/DELETE/TRUNCATEは明示REVOKE。append-only triggerを維持。runtimeへtenant role owner権限を付与しない。
DB runtime roleはアプリ接続用。商用admin/member+can_sendや社内IAP管理者とは別物。既存コードはアプリでtenantを制限しDBのRLSはないため、runtime資格情報の直接利用者を顧客にしない。UPDATE(status)には行の状態変更権限も伴う制限を明記し、今回API権限を拡張しない。

## PR9/10照合・hash訂正
PR9の対象DB未特定/credential拒否という過去状態は、PR10のユーザー実作成/host preflight証跡で解消。PR9の元hash表は撤回、PR10訂正3値と本manifestが正。
raw Git blob算出の3値/bytesは上表。余分なLFを追加した調査用fileのhashは使用しない。preflightや原本にtrim処理を追加しない。
PR9の「restore実証必須」とPR10の「空baseline代替を明示判断」を区別。今回はrestore未実施。次節の選択が統括の承認項目として残る。

## Backup/Restore・失敗時停止
対象は専用空DB。保存先は作成済みGit外PrivateRoot内の新しい固有名backup。C残9.49GiBは既存観測、実行前/backup後に5GiB以上、追加作業後も5GiB以上の見込みを確認。空backupサイズを推測でPASSにしない。
以下は**backup取得も含め次工程の明示承認後だけ**。binaryはPowerShell redirectせずcontainer内作成→docker cp。dumpはACL/metadataを含みrole passwordは含めない。cluster role定義は秘密なしinventoryを別保存し、pg_dumpall --roles-onlyのpassword hash取得は行わない。
~~~powershell
$ErrorActionPreference='Stop'
function Send-Docker { & docker --context desktop-linux @args; if($LASTEXITCODE -ne 0){throw 'Docker failed; stop'} }
$SendPrivateRoot=Join-Path $env:LOCALAPPDATA 'atLIB-SecureSend-Validation-20261018'
$SendStamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$SendDump=Join-Path $SendPrivateRoot ("send-before-"+$SendStamp+".dump")
if(Test-Path -LiteralPath $SendDump){throw 'Backup exists'}
if(((Get-PSDrive C).Free - 1GB) -lt 5GB){throw 'Insufficient backup headroom'}
Send-Docker exec secure-send-pg17-validation pg_dump -U send_bootstrap -d send_commercial_usage_test -Fc -f /tmp/send-before-approved.dump
Send-Docker exec secure-send-pg17-validation pg_restore --list /tmp/send-before-approved.dump
Send-Docker cp secure-send-pg17-validation:/tmp/send-before-approved.dump $SendDump
Get-Item -LiteralPath $SendDump | Select-Object Name,Length
Get-FileHash -LiteralPath $SendDump -Algorithm SHA256
~~~
初回のこのcontainer内backup名は未使用であることを確認し、再作業時は別名を指定。hash・bytes・保存先識別子と空schema/role/ACL snapshotを証跡へ記録、秘密値は記録しない。

復旧方針は統括が次のいずれかを明示選択する:
A: restore専用container/空DBの作成起動・bootstrap・restore試験を先行する**別承認**。PR10手順の別Volume/55433、空DBを確認して、所有者・ACLを含む復元を検証する。
B: 今回は顧客データのない空DBの検証であることを根拠に、backup+空schema/owner/ACL証跡を保持してmigrationを条件付き承認する。失敗時は新規作業停止・接続停止、復旧操作は別承認。復元未実証のリスクを明示受容する。自動DROP/Volume削除・再作成を承認に含めない。
Aを選び未実施ならNo-Go。Bを選び明示承認すれば、backup成功確認後の検証migrationへ条件付きGo。データ入り環境にBを一般化しない。
restore起動/復旧SQLは今回実行しない。後続別承認時の手順:
1. PR10通りrestore clusterを独立bootstrapし、空DB/3Role/owner確認。
2. dumpをdocker cp、pg_restore --list/hash確認。--no-owner --no-privilegesを使わず、同名owner/runtime/readonlyが存在するclusterでsend_bootstrap管理者として--exit-on-error --single-transactionでrestoreする。CREATE DATABASE/role passwordはdumpと別bootstrap。
3. pg_restore -U send_bootstrap -d send_restore_commercial_usage_test --exit-on-error --single-transaction /tmp/send-before-approved.dump。
4. public schema/owner/ACL、role属性/所属/default ACL、table件数/ledgerを比較。database-level CONNECT/CREATE/TEMPとownerはDB作成時に別照合（通常pg_dump単独ではDB作成ACLを再現しない）。
5. restore専用を停止。実証結果を記録。DB復元でGCS objectは戻らない。
migration失敗は後続停止、成功ledger/失敗file/SQLSTATE（秘密除外）を記録。自動再実行/timeout延長/権限拡大なし。商用modeをdisabledにしてtenantデータをlegacy書込先へ戻さない。

## 再現コマンド：オフライン確認・準備（DB接続なし）
本PR checkoutを新規worktreeで使用。既存4ad8470e worktree/dirty作業を上書きしない。正しいcommitを取得後:
~~~powershell
node scripts/validation/verify-migration-manifest.cjs
if($LASTEXITCODE -ne 0){throw 'Manifest mismatch'}
$SendBundle=Join-Path $env:TEMP ('secure-send-approved-bundle-'+(Get-Date -Format 'yyyyMMddHHmmss'))
node scripts/validation/verify-migration-manifest.cjs --prepare $SendBundle
if($LASTEXITCODE -ne 0){throw 'Bundle preparation failed'}
~~~
scriptはGit原本8本のhash/bytes/blobとworktree LF比較を行い、新しいbundleへraw原本・ACL・manifest・apply-approved.sqlだけを生成する。DB接続やSQL実行はしない。bundleのSQL一覧は001/002/003/004/006/007/008/009/010とwrapperのみ。005や任意SQLを走査適用しない。
apply-approved.sqlは初期DB名/role/public空をチェック、ledgerを初期作成、file別BEGIN/SET LOCAL/SQL/ledger INSERT/COMMIT。010含むledger9行が期待値。hashは別manifestに記録し既存ledger schemaを拡張しない。

## 承認後のみの適用コマンド（今回は実行禁止）
事前にfresh read-only preflight、container image/mount/port、role/owner/ACL、extension available、backup証跡とA/B復旧方針承認を確認。実行直前はアプリ/worker接続なし。
~~~powershell
# APPROVAL REQUIRED: prepare済bundleだけを転送。新規path、既存があれば停止
Send-Docker exec secure-send-pg17-validation sh -c 'test ! -e /tmp/send-approved-bundle'
Send-Docker cp $SendBundle secure-send-pg17-validation:/tmp/send-approved-bundle
# コンテナへ転送した実byteをmanifestと照合
$SendManifest=Get-Content -Raw -LiteralPath (Join-Path $SendBundle 'manifest.json') | ConvertFrom-Json
foreach($e in @($SendManifest.entries)+@($SendManifest.acl)){
 $SendHashLine=Send-Docker exec secure-send-pg17-validation sha256sum ("/tmp/send-approved-bundle/"+$e.ledgerName)
 if(($SendHashLine -split '\s+')[0] -ne $e.sha256){throw 'Transferred SQL hash mismatch'}
}
# send_migrator専用passwordを対話入力。bootstrapとして適用しない
Send-Docker exec -it secure-send-pg17-validation psql -X -h 127.0.0.1 -U send_migrator -d send_commercial_usage_test -W -P pager=off -v ON_ERROR_STOP=1 -f /tmp/send-approved-bundle/apply-approved.sql
~~~
host55432経由read-only preflightは既存の安全な対話URL手順を再利用。migrator実行はcontainer内TCP5432へ固定、送信先が同じ専用containerであることをmount/portで照合。Production URL/通常.env/アプリrunnerを使わない。
上記コマンドは今回準備のみ。migration成功後もアプリ/worker自動起動なし、テストデータ投入なし。

## 適用後検査と結合テスト計画
migration直後の検査はread-onlyでledger9行、アプリ16表、org/transfer複合FK・partial indexes・2append-only triggers・owner・column ACL・default ACLを照合。runtime表権限だけのhas_table_privilegeは列UPDATEを見落とすためhas_column_privilegeも使う。SELECT FOR SHAREの実行はfixture投入後の別検証。非権限RoleでCREATE/UPDATE実行して試す否定試験も今回未実施。
実DB未実施は**すべてSKIP**:
| テスト | 再利用 | 合格証跡 |
|---|---|---|
| tenant A/B | 既存Postgres fixture/HTTP | composite FK・query双方越境拒否、同メール別企業も拒否 |
| admin/member/can_send | tenantAuthorization/export | admin no-seat可、member/組合/suspended/降格は企業全体出力不可 |
| reservation/complete | usage実DB fixture | 並行20→10成功、上限拒否、実size/generation/transfer同時commit、二重計上0、期間跨ぎ |
| 通知・増枠 | usage/notification/outbox | 80/100/retry/lease/旧通知無効、追加容量の理由・履歴 |
| DL異常・期限削除 | usage/worker/GCS | URL推計と実egress区別、window/しきい値、同generation削除、失敗再試行 |
| 履歴CSV/監査 | PR8 fixture | 自社だけ、出力監査commit、失敗CSV不返却、矛盾親/NULL帰属除外、権限変更並行 |
| OTP/受信 | 既存connection | 誤OTP/期限/再発行/CC拒否/並行回数、quota100でも既存受信継続 |
| runtime ACL | 本ACL追加 | 実アプリSQLが通りledger/履歴更新/DDL拒否、append-only維持 |
| browser/Excel | CSV既存writer/UI | BOM/日本語/数式/空欄/日時/件数上限、xlsx新実装なし |
DB fixtureは独立ランダムschemaを作って消す。既存fixtureのowner接続はruntime ACL検証を代替しない。fixture実行/data投入は別承認。GCS/SMTP/SSO/ClamAV実サービスも別scopeでありmock成功をPASSにしない。

## Go/No-Go
| 条件 | 現状 | 判断 |
|---|---|---|
| 専用DB/3Role/host read-only/空ledger | 既存実証PASS | Go材料 |
| baseline/順序/検証採番/hash/bytes/除外 | Git raw原本で固定 | Go材料 |
| ACL原本・bundleオフライン確認 | 準備、hash/生成試験PASS | Go材料、実SQL未検証 |
| backup取得/hash/list・fresh空状態 | 次工程未実施 | 実行直前必須、失敗なら停止 |
| 復旧A/B | 統括選択待ち、restore未実施 | 現時点No-Go |
| migration適用 | 明示承認なし | 禁止 |
| fixture/restore/Cloud/Production/main | 承認範囲外 | 禁止維持 |

**統括への具体的承認依頼**:
専用空DBに対し、適用前backup取得と検査、本manifest baseline5+商用3+ACL1およびledger初期作成をsend_migratorでfile別適用し、read-only適用後検査まで承認するか。復旧B（空DB限定・backup保持・失敗時停止して復旧別承認）を採用するか、Aの復元試験先行を別承認するか明示する。
承認後もfixture/data投入/restore起動/外部サービス/main/Productionは含まない。現時点は**計画確定・承認待ちNo-Go**で停止。

## 今回の検証範囲
Git raw bytes8本のSHA256/bytes/blob照合PASS。オフラインbundle試験:8原本+ACL byte hash維持、wrapper9 ledger entries確認PASS。JavaScript構文/PowerShellブロックParser検査を実施する。DB/SQL実行は0。Dockerアクセス権限を回避していない。
