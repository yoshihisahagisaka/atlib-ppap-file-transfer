# Secure Send 第3工程：検証DB適用前の判断記録・Runbook
確認日: 2026-10-18 JST。結論: **No-Go（検証DB未特定・実ledger/ACL/復旧未確認）**。
本書は適用承認そのものではない。実DB適用・新規DB/Cloud作成・main merge・Production接続/変更は未実施。完了条件は未達であり、権限不足で確認可能範囲を記録して停止する。

## 1. Canonical・作業状態
GitHub APIでfresh確認:
| 資産 | SHA | 状態・依存 |
|---|---|---|
| main | 9c1b00230f5efe6ddbae2b8c3ef5e7d0f87787b7 | 変更なし |
| PR5 | e87727a48dcf3ec99cb524a2dc356965e373d4de | Draft、baseはdocs/secure-send-commercialization-fit-gap-20261017 |
| PR6 | 287c4a94c1b74b7a22a077927a4544a685cd3dd1 | Draft、PR5 branchがbase |
| PR8 | 465802eb44bca1bbf7f7494bd05742a5f248ab66 | Draft、PR6 branchがbase |

PR5/6/8はstackの差分。mainへ三つのfull diffを重ねて適用しない。本記録はPR8上の文書専用差分とする。前工程Runbook、canonical JSON、migration runner/004、export Fit/Gap、Issue7の記録を再利用。PR8 treeにADR名の独立ファイルは見当たらず、上記を判断根拠とした。
既存ローカルworktreeはPermission deniedでstatus/未commit変更を確認できなかった。cleanとは報告しない。scratchへのgit cloneはDNS解決失敗。GitHub connectorで必要ファイルを取得した。アプリコード・既存作業ツリーは変更していない。

## 2. 専用検証DBの特定結果
| 項目 | 結果 |
|---|---|
| DB名・接続先・実ロール・所有者 | 未特定 / SKIP |
| Productionとの分離 | 未確認。localhostやDB名だけでは分離の証拠にならない。Cloud SQL proxyで本番へ転送していないことも確認必須 |
| 専用validation環境変数 | この実行環境で未設定。validateTargetはSKIP: VALIDATION_DB_NOT_CONFIGURED |
| Windowsサービス情報 | Service Control Managerアクセス拒否 |
| Docker | context名desktop-linuxは取得。docker psはnamed pipeアクセス拒否。存在/不在の判断不可 |
| Cloud SQL inventory | gcloud sql instances list --project=msp-zabbixはcredentials.dbアクセス拒否。DBへは接続していない |
| CLI | node/git/gh/dockerあり。psql/pg_dump/pg_restoreはPATH上に無し |

.env.exampleのppap_transfer、ppap_app、既存Cloud SQL、バケットは既存環境の例であり検証先として採用しない。秘密値やProduction .env/資格情報をコピーしない。

既存専用環境が無ければ、提案はローカルPostgreSQLの隔離container、loopback別port、専用volume、空の専用DBと別restore DB。DB名候補send_commercial_usage_test / send_restore_commercial_usage_testは**未作成・未確定**。Cloud従量費用は発生しない構成案だがPCのCPU/メモリ/diskを使用する。既存本番データ/資格情報は投入しない。migrator ownerと非owner runtimeを分離、専用読取roleを用意し、public/他role経由の継承権限も確認する。
作成には別承認が必要。停止は対象containerのみdocker stop、再開はdocker start。volumeは残し、削除は別判断。Cloud案は価格・運用が未調査のため費用を捏造せず、今回は選択しない。

## 3. DDL対象・hash・依存
SHA-256はUTF-8文字列のCRLFをLFへ正規化した値（既存preflight方式）。適用前に承認対象を同じ方式で再照合。raw byte hashと混同しない。

| 順序 | docs/内ファイル | SHA-256 |
|---|---|---|
| 1 | tenant-foundation-schema.draft.sql | cfa13e8729cf73b60d467e18f92f66011aee26ff263585141807da343f5e9862 |
| 2 | commercial-transfer-connection-schema.draft.sql | 6755405931816fcbaad877f93e8a5b44622fbefce7f2e93b2599d2b95ddf902e |
| 3 | commercial-usage-schema.draft.sql | 03031120fbecdb6dcdd4aad3779e027f673fc8f4dfe1b6a3748ca9069d16b1ea |

1は6新表、2は既存group/transferのnullable列・CHECK・UNIQUE・複合FK・index、3は5新表・3 index・関数・append-only trigger。CSV専用DDLはない。
既存root SQLは001/002/003/004/006。005欠番は維持、archiveの005は依存に含めない。007/008/009は候補のままで採番未確定。実ledger・remote main・対象object名衝突確認後に別工程で固定する。
runnerのledgerはschema_migrations(filename,applied_at)のみでhash列なし。DDL hashは本承認manifestへ保持し、ledger schemaを勝手に拡張しない。採番後のSQLとhashも再固定する。
既存004は列DROPとOTP DELETEを含む。既存DBのledgerを推測して再実行しない。新規空fixtureのbaseline再現と既存DB移行を区別する。

## 4. preflightと未確認の競合
PR8のscripts/validation/secure-send-preflight.cjsを正とする。専用LOCAL host/DB名・query override拒否、BEGIN READ ONLY、ledger/columns/constraint/index/ACL/countを再利用。
今回は対象未設定でvalidateTargetのみ実行。接続collect未実行。元scriptの構文確認PASS。既存49 PASS/8 SKIPは過去証跡であり今回再実行していない。
既存preflightの対象表リストはplan/assignment、usage events/outbox/download observations等を網羅しない。所有者/関数/trigger/extension/実効DDL権限も不足するため、本PRのdocs/secure-send-stage3-inventory-readonly.sqlを**補足**で使用する。新しいmigration runnerではない。
全ての新表/制約/index/関数名と実inventoryを比較し、既存objectがあればIF NOT EXISTSで隠さず停止。schema_migrationsが無ければ新規DB判定を行い、旧SQLを無条件実行しない。
DDL権限: migratorのschema CREATE、既存2表のowner相当、REFERENCES、関数/trigger作成、gen_random_uuid availabilityを確認。runtimeは非owner・非superuser・非BYPASSRLSとし、必要なCRUD/sequence/schema権限だけ付与。usage historyへのUPDATE/DELETEをPUBLIC/継承role含め拒否し実効ACLを確認。GRANT/REVOKEは未作成のロール名で実行しない。

## 5. 影響・バックアップ・復旧条件
ALTER/UNIQUE/FK/index作成は既存表の強いlock/scanを伴い、既存件数・サイズ次第で時間が変わる。旧行NULL維持、email/domain backfillなし。実測所要時間はSKIP。
承認後の上限候補lock_timeout=5s、statement_timeout=60s。timeout時ROLLBACK、無断延長不可。org advisory lock→org/子row lock順を維持。
DDLはfile単位transactionとledger insertを同一transactionにする。既存runner全実行はしない。三つ全体は一括原子性がないため、途中失敗時は後続停止・成功file/ledgerを記録、部分適用からの再開は承認manifestと照合する。
backupは専用DBのcustom dump、保護されたGit外保存先・アクセス権・SHA-256・pg_restore --listを確認。別途承認された空restore専用DBで復元しledger/schema/constraints/index/件数を照合。作成や復元も今回未実施。初回空DBなら空baselineの証拠と破棄再作成の承認を代替条件として統括が明示決定し、復元PASSを偽らない。
切戻し: 新規送信/worker停止→進行PUT/予約/outbox/generation照合→検証DBだけ復元またはtenant対応コードで前進修正。DB restoreではGCS objectは戻らない。商用行があるDBをcommercial disabledのlegacy IAP書込先へ戻さない。旧社内IAPは別DB/既存サービス維持、DBや設定変更なし。

## 6. 実行コマンド（現時点は読み取りのみ）
ユーザー端末でまず以下を実行する。DB新規作成やmigration不要。結果に秘密を含めず共有する。
~~~powershell
docker context show
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
Get-Command psql,pg_dump,pg_restore -ErrorAction SilentlyContinue | Select-Object Name,Source
~~~
本番と分離した既存containerが特定できた時だけ、公開設定やmount先を秘密を含めず確認し、管理者が接続先/DB/role/分離根拠を指定する。docker inspect全文やEnv一覧は共有しない。Cloud inventoryは必要時のみユーザーがgcloud sql instances list --project=msp-zabbix --format="table(name,databaseVersion,region,state)"を実施（DB接続ではない）。
その後、PR8コードを持つローカルcheckoutで専用変数を安全な方法で設定し、通常DATABASE_URL/.envを流用しない。URLをコマンド引数に直書きしない。
~~~powershell
node scripts/validation/secure-send-preflight.cjs
if ($LASTEXITCODE -ne 0) { throw 'preflight未完了: migration禁止' }
~~~
補足SQLにはpsql用の専用libpq service設定を使用する（秘密はPGPASSFILE等の保護ファイル、接続先がvalidationと一致することを管理者が確認）。URLをログに出さない。
~~~powershell
psql -X --dbname=service=secure_send_validation -v ON_ERROR_STOP=1 -f docs/secure-send-stage3-inventory-readonly.sql
~~~
以下は**承認後専用テンプレート。今回実行禁止**。backup/restore先とserviceを固定し、復元先を独立確認する。PG service設定は今回未作成。
~~~powershell
pg_dump --dbname=service=secure_send_validation --format=custom --file="$env:SECURE_SEND_VALIDATION_BACKUP_FILE"
if ($LASTEXITCODE -ne 0) { throw 'backup failed' }
Get-FileHash -Algorithm SHA256 -LiteralPath $env:SECURE_SEND_VALIDATION_BACKUP_FILE
pg_restore --list "$env:SECURE_SEND_VALIDATION_BACKUP_FILE"
if ($LASTEXITCODE -ne 0) { throw 'backup listing failed' }
# 別の空restore DBへの復元も明示承認された後のみ
pg_restore --dbname=service=secure_send_validation_restore --exit-on-error --single-transaction --no-owner --no-privileges "$env:SECURE_SEND_VALIDATION_BACKUP_FILE"
if ($LASTEXITCODE -ne 0) { throw 'restore failed' }
~~~
no-owner/no-privileges復元はACL/ownerの復旧実証を代替しない。復元環境のrole mapping/ACLを別途照合する。未確定の採番/role/targetで実行できる汎用DDLコマンドは提示せず、条件確定後に承認対象のfile限定実行コマンドを固定する。

## 7. 承認後テスト計画（全て現在実環境SKIP）
| 対象 | 既存再利用・追加観点 | 合格条件 |
|---|---|---|
| DB fixture | commercialUsage.postgres.test.cjs | A/B複合FK越境拒否、20並行予約で10成功、世代/容量/状態同時確定、二重complete不計上、append-only拒否 |
| 権限 | 既存admin/member + can_send | senderは独立roleでない。can_send=false adminは出力可、member送信者/組合利用者/停止/降格は企業全体出力不可 |
| 通知/容量追加 | 既存usageサービス/worker試験 | 80/100到達、重複抑止、lease/再送、増枠後旧notice無効、理由/操作履歴と契約snapshot整合 |
| export実SQL | PR8 fixtureとHTTP試験 | A/B・矛盾/NULL親・同メール別企業・出力監査commit失敗・権限変更並行、CSV件数/監査一致、EXPLAIN/上限/timeout |
| 受信回帰 | 既存OTP/DL接続試験 | quota100%でも既存受信可、誤OTP/期限/再発行/同時DL上限/CC拒否、cleanのみ受信 |
| 表示 | audit画面、ブラウザ/Excel | JST日付→UTC半開区間、BOM日本語、quote/改行、先頭空白/制御文字/数式、欠損空欄、他社混入なし |
既存fixtureはランダムschemaへDDLを作り最後にDROPする破壊的試験。migration承認とは別にそのfixture実行も承認対象に明示し、承認後のみSECURE_SEND_USAGE_TEST_DATABASE_URL / SECURE_SEND_USAGE_TEST_ALLOW_DDL=yesを設定する。現時点では設定しない。
~~~powershell
# 以下はDB試験の明示承認後のみ
node --experimental-transform-types --test test/commercialUsage.postgres.test.cjs
~~~
fixture一件が全表のruntime ACL/SMTP/HTTP認証/E2Eを証明するわけではない。未カバー観点は個別証跡が必要。

## 8. 外部サービスの検証準備
| 接続 | 必要な専用設定 | 検証・影響範囲 |
|---|---|---|
| GCS | 専用private bucket/SA、限定prefix、CORS/origin、generation、保持/soft delete/lifecycle | create-only署名、サイズ不一致/412、同世代scan/DL/delete、期限。新規bucket/IAM変更は別承認。既存Production bucketは使わない |
| SMTP | 検証送信先allowlist・専用credentialまたはローカルmail sink | 80/100/outbox失敗再送・lease。sink成功は実SMTP成功でない。外部送信は指定テスト宛先のみ |
| Google/Microsoft | 専用client/callback/origin、Microsoft具体tenant、登録済issuer/subject/所属 | 実署名/nonce/state/PKCE・停止/越境。mock JWKS成功を外部SSO PASSにしない。既存本番client変更禁止 |
| ClamAV | 隔離scan service/endpoint・同一GCS generation | clean/安全な試験用EICAR・失敗再試行・感染削除。検証bucket限定、実マルウェア不要 |
| Web/worker | 隔離origin/DB接続、commercial enabled、専用session secret | 既存受信とquota分離、worker明示起動/停止・監査。ProductionのCloud Run/env/スケジュール変更なし |
7日アクセス期限と物理削除/soft-deleteは別条件。完全消去と称さない。実egress adapter未接続、URL発行推計を実通信量/請求へ使わない。秘密設定の値は証跡に出さない。.xlsx新規実装は対象外。

## 9. 統括への判断依頼
現在の判断は**No-Go**。migration実適用承認を今求める段階ではない。
必要な最小操作は、ユーザー端末で既存Docker一覧を取得し、既存の専用検証DBの有無と接続先/role/Production分離根拠を確認すること。存在しなければローカル専用構成の作成を別承認する。
Goに必要な未完了条件:
- 接続先・DB・schema・実ロール・proxy/共有接続なしの証拠
- read-only実ledger/全object競合/owner/runtime ACL/既存件数
- 最終採番・適用SQL/hash・lock上限・初期fixture範囲
- 保護backup保存先、復元実証または明示承認された空baseline代替
- fixture DDL/外部送信/外部resource変更の承認範囲分離
上記を埋めて本書の判定を更新し、統括の明示承認まで実適用を停止する。
