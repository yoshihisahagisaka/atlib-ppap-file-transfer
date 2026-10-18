# Secure Send 第2工程：接続・検証・migration承認前Runbook

## 状態と根拠

作業branch `feat/secure-send-stage2-20261018`。mainは作業開始時に再確認した`9c1b00230f5efe6ddbae2b8c3ef5e7d0f87787b7`。PR5 remote `e87727a48dcf3ec99cb524a2dc356965e373d4de`とsource-equivalentなlocal `ffd39ef`を継承。PR3 `74facb2`、PR4 `d70bbe4`、第1工程Runbookと既存tenant/usage部品を再利用した。Corporate Issue16〜38を取得し、37の共同購買対象・38のサービス別配分境界も確認した。契約・請求・40%配分・共通問い合わせをSendへ重複実装していない。

今回の承認範囲は開発コード・ローカル試験・検証準備まで。**実DB適用、Cloud設定、Production、main、商用公開は未実施。** DBの実ledger・データ・顧客ファイル・OTP・Cloud秘密値も取得していない。

## 実装済み・残作業

| 項目 | 今回の差分 | 残る検証/制限 |
| --- | --- | --- |
| Google/Microsoft SSO | 既存OIDC/PKCE/state/nonce/HMACを再利用。検証済みissuer/subject→登録identity→active membership。ドメイン自動参加なし | 外部IdP実試験SKIP。Microsoftは具体的tenant UUIDのみ。複数active企業所属の初回ログイン選択UIは未実装（曖昧なら拒否） |
| tenant/role | リクエストごと所属再読込。顧客admin viewと送信権限を分離。送信履歴/complete/revokeをorg+userで絞込み | 招待/メンバー変更CRUD、正式発注との契約反映adapterは共通接続待ち。cookieにorg/roleを権限として保存しない |
| 送信容量 | 既存create/completeへ接続。事前検査→transfer作成→排他的予約→size固定/create-only署名。実size/generationとscanning化をusageと同一transactionで確定 | GCS PUT/CORS/SDK実試験SKIP。署名失敗/同時予約敗者はpending行・予約が残り得る。期限だけで解放しない |
| 再試行 | 予約元periodをDBで解決し月跨ぎcomplete可能。確定済みcompleteは二重計上せずscanningのscanを再試行 | process停止時のscanの自動発見/永続queueは未実装。利用者complete再送または認証済み運用再試行が必要 |
| 世代整合 | 同一generationをscan read、感染delete、受信signedURLに使用。DL URL期限をgroup期限内へ短縮 | GCS世代置換/412/実ClamAVはSKIP。バケット/IAM/CORSは変更していない |
| 受信 | OTP/To/CC/clean判定を再利用。新規送信quotaを受信へ持ち込まない。DL回数を条件付きUPDATEで原子的にclaim | 実OTP/メール回帰SKIP。回数は従来どおりURL発行回数で、実DL完了数ではない |
| 通知・削除 | 第1工程outbox/lease/retryを再利用し、current admins SQL→既存Mailerへ接続する`runCommercialUsageBatch`を用意 | 自動worker起動/SMTP送信/物理削除は未実行。認証済みjob配置と実証が必要。既存受信者通知のclaim後停止/SMTP失敗時の復旧は別途検証が必要 |
| DL異常 | download側商用モード時、URL発行推計を企業・現在periodへ記録。scanは含めない。観測失敗は受信を遮断しない | 実egress観測adapterは未接続。推計を実通信量/請求に用いない |
| 監査 | 既存sender/scan/OTP監査維持、容量イベントappend-only。商用customerから既存全体監査viewerは404 | tenant専用監査viewerは未実装。opsは承認済みtenant絞込み手順が必要 |

価格・5GB・80%・7日は提供権利snapshotの設定で、商用コードに値を固定していない。既存global最大ファイル容量も安全上の上限として適用する。実有効送信者数を契約人数として扱わない。active人数と契約人数の管理viewを維持し、共通発注経路以外で契約枠を増やさない。

## ローカル再現コマンド（DB不要）

Node24.18、lock固定の依存を使用する。今回、新しいworktreeへの`npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000`が成功。bcryptは`npm rebuild bcrypt --foreground-scripts --no-audit --no-fund`で既存lock版のnative bindingを導入した。依存版変更なし。第1工程のEPERMは今回の別worktreeでは再現しなかった。

```powershell
Set-Location <checked-out-stage2-repository>
node --version
npm ci --ignore-scripts --no-audit --no-fund
npm rebuild bcrypt --foreground-scripts --no-audit --no-fund
npm run build
npm run typecheck:commercial
# この工程ではDB test URL/ALLOW_DDLを設定しない。
node --experimental-transform-types --test test/tenantAuthorization.test.cjs test/commercialUsage.test.cjs test/commercialUsage.postgres.test.cjs
node --test test/commercialConnection.test.cjs
git diff --check
```

後者はbuild済みの実装をExpress/loopback HTTP、実jose署名/JWKS、明示的なDB/GCS/scan/OTP試験doubleと接続する。実SMTP/GCS/Cloud SQL/外部IdPへ接続する試験ではない。証跡は`docs/evidence/stage2-20261018/`。失敗を修正後に再実行して記録し、実環境試験SKIPをPASSに含めない。

## 商用モードの接続条件（この設定操作は未実行）

- `SECURE_SEND_COMMERCIAL_MODE=enabled`を明示。未設定/disabledは既存IAP構成。無効値は起動拒否。
- `SECURE_SEND_PUBLIC_ORIGIN`は末尾slashなしのorigin。ProductionではHTTPS。Google/Microsoft callbackは同一originの`/auth/<provider>/callback`。
- 既存SSO設定・32文字以上のsession secretを使用する。商用modeでは独立したcookie名/audience/サーバー側期限を付ける。既存spike sessionとIAP/dev headerは商用認証として認めない。
- `POST`は正しいOrigin必須。顧客APIは登録membership必須。組織selectorは`x-send-organization-id`（UUID）だが認可ではなく、DBで所属を再確認する。
- 検証DBに承認済み企業/user/issuer/subject/membershipと提供権利snapshotが必要。メールdomainや既存IAPメールから自動backfillしない。招待・正式注文・請求システムは追加しない。
- **商用データが入る検証DBへlegacy IAP-only uploadを接続しない。** Legacy sender reposは従来のemail認可を保持するため、商用機能をdisabledへ切り替えるだけのrollbackは不可。商用は独立DB/接続先/サービス群で試験する。
- HTTPログは商用modeでcallback query/cookie/Authorization/受信tokenを除外。Cloud/LB側のURLログ設定も公開前に別途確認する。

## Migration ledgerとDDL依存（未適用）

既存runnerは`schema_migrations(filename,applied_at)`を作成し、直下SQLを辞書順に各file transactionで適用する。既存ファイルは`001_init.sql`、`002_transfer_groups.sql`、`003_sender_name.sql`、`004_group_download.sql`、`006_recipient_cc.sql`。005欠番は詰めない。`migrations/sso-verify-archive`は商用tenant schemaの依存ではない。既存004は破壊的処理を含むため、既存DBへledgerを推測して再実行してはいけない。

今回の三つのdraftは全てrunner外。**採番は未確定**。採番候補007/008/009は、適用直前のremote/mainと実ledger照合後のみ確定する。

1. `docs/tenant-foundation-schema.draft.sql`：organizations/users/identities/memberships/technical plan 6表。
2. `docs/commercial-transfer-connection-schema.draft.sql`：既存group/transferへnullable org・user、transferへgeneration、tenant/ownerの複合FK、index。旧行はNULLのまま。メール推測backfillなし。
3. `docs/commercial-usage-schema.draft.sql`：usage5表、append-only trigger、transfer複合FK。

`docs/commercial-migration-preflight.sql`はread-only確認用。DB名/role/version、実ledger、対象table定義、件数/孤立参照のみで個人情報・ファイル内容を出力しない。ledger自体が無い場合はそのqueryを停止し、新規DBとして別途判断する。**今回実ledger確認はSKIPであり、適用可能判定は未確定。**

同時実行のlock順は全Send writerでorgID順の`pg_advisory_xact_lock(hashtextextended('send-usage:'||org,0))`→組織/子row lockに統一する。既存tenant draftの組織row lockのみのコメントを接続時に置き換える。現時点でmembership CRUDは公開しない。usage reserve/completeは同一client内でtransferを再認可し、追加pool connectionを取得しない。GCS metadataはtransaction内で呼ぶため、timeout/lock待ち/レイテンシ負荷を実DBで確認する。

## 承認前に提示する影響と復旧

| 対象 | 影響 | 復旧条件 |
| --- | --- | --- |
| tenant新表 | identity/所属情報とFKが増える | 未使用の独立検証DBならバックアップ復元。既存共有customer DBへ統合しない |
| group/transfer ALTER | table lock、既存行/新規index検証の時間、nullable列追加 | 原本は残るが新規商用行作成後のDROPは不可。tenant対応コードを保った前進修正 |
| usage表/trigger | 排他待ち、quota/notice/削除履歴増加 | カウンタとobjectを照合。予約/送信済み使用量を捨てない。worker停止時も受信維持 |
| GCS | 本工程では変更なし | generation条件で別世代削除を防止。削除後の復元はsoft delete/保持/IAMを別途検証。DB restoreだけではファイルを戻せない |

実適用承認には、**対象の専用検証DB/role/schema、実ledger照合結果、DDL確定hashと採番、DDL所要時間/lock上限、バックアップ保存先とrestore実証、初期tenant/identity/snapshot投入内容、runtime ACL**を添える。初期対象は空の隔離LOCAL検証DBを推奨し、Production/共有Cloud SQLを対象に含めない。接続先や初期identityは今回推測しない。

以下は承認後にユーザーが指定した専用検証DBでのみ実行するテンプレート。今回は実行していない。接続情報は専用環境変数で渡しログ/Gitへ出さない。

```powershell
# read-onlyの事前確認（接続先と承認を確認してから）
psql "$env:SECURE_SEND_VALIDATION_DB_URL" -X -v ON_ERROR_STOP=1 -f docs/commercial-migration-preflight.sql
# 変更前dump。保護された専用保存先に置き、Gitへ保存しない。
pg_dump --dbname="$env:SECURE_SEND_VALIDATION_DB_URL" --format=custom --file="$env:SECURE_SEND_VALIDATION_BACKUP_FILE"
pg_restore --list "$env:SECURE_SEND_VALIDATION_BACKUP_FILE"
```

dumpが存在するだけでは復旧確認にならない。別の空の専用restore検証DBを明示し、復元→ledger/schema/件数照合→接続先確認を行った記録が必要。DDL適用は承認済みfileを1 transactionずつ、`ON_ERROR_STOP`、`lock_timeout=5s`/`statement_timeout=60s`等の環境に応じた上限付きで実施し、成功したhash/nameだけledgerへ記録する。タイムアウト時はROLLBACKし、上限を無断延長しない。新規DDLをrunnerへ入れて既存全migrationを無条件実行しない。

切戻しは新規送信受付/workerを停止→進行PUT/予約/outbox/GCS generationを照合→隔離環境と確認したDBだけバックアップから復元、またはtenant対応の前版で前進修正。既存受信を維持する必要がある環境ではschemaと確定済みデータを保ち、legacy認可へ戻さない。**Production rollbackコマンドはこのRunbookで承認されていない。**

## 実環境検証の次工程（全て現時点SKIP）

1. 承認された空の専用DBでordered DDL fixture試験。`test/commercialUsage.postgres.test.cjs`はlocalhost、DB名末尾`commercial_usage_test`、専用ALLOW_DDLの三重gate。ランダムschema以外を削除しない。既存本体runnerを使わず、fixtureに既存SQL→tenant→connection→usageを適用する。schema所有/extension権限を事前確認する。
2. PostgreSQL同時20予約→10成功、実size/generation+usage同時commit、SQL失敗時rollback、二重complete、複合FK越境、送信中停止/所属停止/revoke/期間境界、pool小数接続時の待ちを確認。
3. 専用private bucket/SAでsigned headersのブラウザPUT、200MiB以下の境界/サイズ違い/overwrite拒否/CORS、same generation scan/clean/infected/delete412、期限clamp。bucket lifecycleの7日以降物理保持/soft deleteは別条件として照合。
4. 実Google/Microsoftログイン→登録所属→異企業ID/一般sender/admin/no-seat/suspended/匿名/dev/spikecookie拒否。外部顧客間越境否認を最優先。
5. `runCommercialUsageBatch`を認証済み運用executorから明示呼出しし、current admins、SMTP失敗→再送、lease期限、重複許容/死活、削除を確認。自動worker/HTTP staff endpointはこの差分では追加していない。実送信先は承認済み検証宛先のみ。
6. 月枠100%でも既存ファイルTo/OTP/clean/期限/回数の範囲で受信、CCでは受信不可、同時DLclaim、URL発行推計と実egress分離を検証。quotaを解除して受信を通す設計にしない。

正式な容量計上点（現在は設定上received_bytesのみ）、月途中割当、契約減少/解約時の既存受信条件、完全消去表現、初回複数所属選択、pending予約照合、worker配置/監視は残課題。共通注文/請求/問い合わせとは独立に判断を返す。
