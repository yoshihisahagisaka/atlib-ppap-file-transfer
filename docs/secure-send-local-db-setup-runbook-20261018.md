# Secure Send ローカルPostgreSQL 17専用環境 作成承認用Runbook
2026-10-18 JST / PR9 0a8f23f0644e888c4de1d850bcda948c97499726 継承。
本書は手順のみ。コンテナ・Volume・DB・role作成、image pull、migration適用は未実施。

## 1. 確定構成
ユーザー確認: desktop-linux / Engine29.7.2 / FACTACT Supabase PostgreSQL17.6 / 公開port54322 / C空き約10.3GB / Send DB未作成。
エージェントのdocker image lsはnamed pipeアクセス拒否。既存image一覧・正確なdigest/サイズは未確認であり再利用可否は条件付き。FACTACTのコンテナ・mount・DB・ネットワーク・資格情報を流用しない。

| 用途 | container | named volume | host bind | DB |
|---|---|---|---|---|
| 検証 | secure-send-pg17-validation | secure-send-pg17-validation-data | 127.0.0.1:55432 | send_commercial_usage_test |
| 復元確認 | secure-send-pg17-restore | secure-send-pg17-restore-data | 127.0.0.1:55433 | send_restore_commercial_usage_test |

2つの独立cluster/Volumeとする。Docker Desktop/WSL/物理diskは共有するため障害・容量・CPUの完全分離ではない。FACTACTの54322とは非重複。port空きは作成直前に再確認。
各container memory512MiB、CPU1、shared_buffers64MiB、max_connections30、shm64MiB、restart=no。復元用は必要時のみ起動。同時実行は最大約1GiBのcontainer memory上限、Docker/OS/cache overheadは別。負荷/小memoryによる性能結果を本番性能保証にしない。
独自bridge networkは作らず既定bridgeを使用。FACTACTのnetworkへ参加させない。loopbackはLAN公開を避けるがホスト管理者/他containerからの完全遮断ではない。専用SCRAM認証とDB ACLで制限する。

## 2. イメージ選択・容量確認（読み取りのみ）
PowerShell7。以下の関数Dは全以降コマンドで使用し、Docker失敗時に停止する。
~~~powershell
$ErrorActionPreference='Stop'
function D { & docker --context desktop-linux @args; if($LASTEXITCODE -ne 0){throw 'Docker command failed'} }
D context show
D image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}'
D system df
Get-PSDrive C | Select-Object Name,Free,Used
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 54322,55432,55433 | Select-Object LocalAddress,LocalPort
~~~
Docker image一覧だけを共有。docker inspect全文/Envは秘密漏洩のため出さない。
再利用優先は既存の公式docker.io/library/postgres:17.x。tagだけでなくimage IDで固定する。同一imageの2コンテナはlayerを共有する。Supabase用imageはPostgreSQL17.6でも公式postgresとentrypoint/init/PGDATA/追加extensionが同じとは限らず、本手順の選択対象から除外する。FACTACT imageを変更/削除しない。
候補が公式17系と確認できたら:
~~~powershell
$ImageRef=Read-Host '確認済み公式Postgres17のローカルtag'
$ImageId=(D image inspect --format '{{.Id}}' $ImageRef).Trim()
D image inspect --format '{{json .RepoDigests}} {{.Os}}/{{.Architecture}} {{.Size}} {{json .Config.Entrypoint}}' $ImageId
D run --rm --pull=never --network none --entrypoint postgres $ImageId --version
~~~
最後のversion確認は一時container作成になるので**作成承認後のみ**。17.xでなければ停止。旧17.xキャッシュ利用は互換検証用、外部公開や商用承認を意味しない。候補がSupabaseのみなら公式17系を別取得する提案へ戻す。image pullは今回実行しない。承認後の取得例はdocker --context desktop-linux pull postgres:17。その後ID/digest/sizeを記録し、変動tagを直接runしない。DB17.6とのpatch差を記録する。
既存image再利用の実測可否・追加download量は現在SKIP。容量不足時にpruneしない。

## 3. 作成前Go条件と承認範囲
本書の承認依頼は「専用2container/2Volume/2空DBとrole/ACLのbootstrap、接続・read-only確認」まで。アプリmigration/fixture DDL/外部サービス/FACTACT変更は含まない。
- 公式17系image ID・disk使用量を確認。image取得が必要なら追加容量を確認してから承認範囲内で取得。
- container/Volume名が未使用、port55432/55433が空いている。既存なら上書きせず停止。
- C空き5GiB以上を維持、計画作業の追加予算3GiB以下を目安にする（運用上の暫定gateで実測保証でない）。
- bootstrap秘密ファイルはGit/同期フォルダ外の新規専用dirに保存し、Windows ACLを本人/SYSTEMへ限定。
- FACTACT確認用に作成前後のdocker psとdocker stats --no-streamで稼働状況だけ記録。FACTACTへのDB接続は不要。
- restore rehearsal/バックアップ復元はmigration前の別承認対象。空DB作成と復元を混同しない。

## 4. 作成コマンド（明示承認後のみ）
以下は新規リソース専用。再実行・途中失敗時は自動clean/recreateせず、専用resourceの状態を確認して再開計画を立てる。
~~~powershell
$specs=@(
 @{Name='secure-send-pg17-validation';Volume='secure-send-pg17-validation-data';Port=55432;Db='send_commercial_usage_test'},
 @{Name='secure-send-pg17-restore';Volume='secure-send-pg17-restore-data';Port=55433;Db='send_restore_commercial_usage_test'}
)
$names=@(D ps -a --format '{{.Names}}')
$volumes=@(D volume ls --format '{{.Name}}')
foreach($s in $specs){
 if($names -contains $s.Name -or $volumes -contains $s.Volume){throw 'Dedicated name exists'}
 if(Get-NetTCPConnection -State Listen -LocalPort $s.Port -ErrorAction SilentlyContinue){throw 'Port occupied'}
}
if((Get-PSDrive C).Free -lt 5GB){throw 'Insufficient disk headroom'}
$PrivateRoot=Join-Path $env:LOCALAPPDATA 'atLIB-SecureSend-Validation-20261018'
if(Test-Path -LiteralPath $PrivateRoot){throw 'Private directory exists; review before continuing'}
New-Item -ItemType Directory -Path $PrivateRoot | Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $PrivateRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
if($LASTEXITCODE -ne 0){throw 'ACL failed'}
foreach($s in $specs){
 $secretPath=Join-Path $PrivateRoot ($s.Name+'.password')
 $secret=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
 [IO.File]::WriteAllText($secretPath,$secret,[Text.UTF8Encoding]::new($false))
 $secret=$null
 D volume create --label 'atlib.purpose=secure-send-validation' $s.Volume | Out-Null
 $dockerArgs=@('create','--pull=never','--name',$s.Name,'--label','atlib.purpose=secure-send-validation',
 '--restart=no','--memory=512m','--memory-swap=512m','--cpus=1','--shm-size=64m',
 '--log-driver=local','--log-opt','max-size=10m','--log-opt','max-file=2',
 '--publish',"127.0.0.1:$($s.Port):5432",
 '--mount',"type=volume,source=$($s.Volume),target=/var/lib/postgresql/data",
 '--mount',"type=bind,source=$secretPath,target=/run/secrets/bootstrap-password,readonly",
 '--env','POSTGRES_USER=send_bootstrap','--env','POSTGRES_DB=postgres',
 '--env','POSTGRES_PASSWORD_FILE=/run/secrets/bootstrap-password',
 '--env','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256',
 $ImageId,'-c','shared_buffers=64MB','-c','max_connections=30',
 '-c','max_wal_size=256MB','-c','min_wal_size=80MB',
 '-c','log_statement=none','-c','log_min_error_statement=panic')
 D @dockerArgs | Out-Null
}
D start secure-send-pg17-validation
~~~
公式17のPGDATA/volume targetは/var/lib/postgresql/data。/_FILEでbootstrap passwordを渡すためdocker Env/引数へ秘密そのものを入れない。専用ファイルは平文であるためACL保護、ログ/Gitへ保存しない。認証をtrustへ緩和しない。socketによるcontainer内管理はDocker管理者権限に依存する。
readyまでpg_isreadyを手動再確認。失敗時は接続を進めない:
~~~powershell
D exec secure-send-pg17-validation pg_isready -U send_bootstrap -d postgres
~~~
restoreも初期bootstrap時だけ起動して同手順を行い、完了後停止する。

## 5. role/空DB bootstrap（承認後のみ、migrationではない）
以下をdocs/secure-send-local-db-bootstrap.sqlとして本PRに保存する。検証/復元で別々に実行。ロールはcluster単位で独立。ログインpasswordは初期NULLでリモート接続不可、後から各clusterで新規専用値を対話設定する。
~~~powershell
D cp docs/secure-send-local-db-bootstrap.sql secure-send-pg17-validation:/tmp/send-bootstrap.sql
D exec secure-send-pg17-validation psql -X -U send_bootstrap -d postgres -v ON_ERROR_STOP=1 -v send_db=send_commercial_usage_test -f /tmp/send-bootstrap.sql
# 対話端末で順に実行。passwordは画面/履歴へ書かない
D exec -it secure-send-pg17-validation psql -X -U send_bootstrap -d postgres
~~~
psql内:
~~~text
\password send_migrator
\password send_runtime
\password send_readonly
\q
~~~
restore側:
~~~powershell
D start secure-send-pg17-restore
D exec secure-send-pg17-restore pg_isready -U send_bootstrap -d postgres
D cp docs/secure-send-local-db-bootstrap.sql secure-send-pg17-restore:/tmp/send-bootstrap.sql
D exec secure-send-pg17-restore psql -X -U send_bootstrap -d postgres -v ON_ERROR_STOP=1 -v send_db=send_restore_commercial_usage_test -f /tmp/send-bootstrap.sql
D exec -it secure-send-pg17-restore psql -X -U send_bootstrap -d postgres
~~~
同じ3つのpasswordコマンドで**別の新規値**を設定。FACTACT/Productionの値を流用しない。

| role | 所有/権限 | 制限 |
|---|---|---|
| send_bootstrap | 専用clusterの初期superuser | docker内bootstrap/管理のみ。アプリやpreflightに渡さない |
| send_migrator | 専用DB owner、schema CREATE、将来DDL owner | NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS、runtimeへ所属を与えない |
| send_runtime | CONNECT/USAGEのみ（空DB時） | migration後に必要なtable/sequence/functionだけ明示grant。schema CREATE・ledger更新・履歴UPDATE/DELETE/TRUNCATE不可 |
| send_readonly | CONNECT/USAGE、migrator作成の将来tableにSELECT | DML/DDL不可、default_transaction_read_only=on、timeout10秒 |

read-only設定自体は強制的な権限境界ではない。ACL/所有権/role membershipも確認する。default privilegesは**実際にobjectを作るrole**に適用され、既存tableには遡及しない。migrator以外でtableを作らない。
runtimeへの一括CRUD default grantは行わない。usage historyのappend-onlyを壊すため、後続migration承認時にobject別allowlistと実効ACLを確定する。既存fixtureはschema作成が必要なのでruntimeでは実行しない。fixture実行は別承認。
初回空DBではschema_migrationsもアプリtableも存在しないのが正。bootstrapでledgerを捏造しない。

## 6. 接続・権限・read-only preflight
container内TCP -Wで専用新規passwordを対話入力:
~~~powershell
D exec -it secure-send-pg17-validation psql -X -h 127.0.0.1 -U send_readonly -d send_commercial_usage_test -W -v ON_ERROR_STOP=1
~~~
psql内:
~~~sql
BEGIN READ ONLY;
SELECT current_database(),current_user,current_setting('transaction_read_only'),version();
SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles
 WHERE rolname IN('send_migrator','send_runtime','send_readonly');
SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database();
SELECT has_schema_privilege(current_user,'public','CREATE') AS must_be_false;
SELECT to_regclass('public.schema_migrations') AS expected_null;
SELECT count(*) AS expected_zero FROM information_schema.tables WHERE table_schema='public';
ROLLBACK;
~~~
host mappingも別確認。host側にnode/pg依存導入済みのPR9 checkoutを用意し、専用URLだけをsession内で設定。下記は秘密を対話入力し、引数/履歴へ出さない（PowerShell7）:
~~~powershell
$pw=Read-Host 'send_readonly専用password' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try{
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 $env:SECURE_SEND_VALIDATION_DB_URL='postgresql://send_readonly:'+ [Uri]::EscapeDataString($plain) +'@127.0.0.1:55432/send_commercial_usage_test'
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 $plain=$null; $pw=$null
}
try{
 node scripts/validation/secure-send-preflight.cjs
 if($LASTEXITCODE -ne 0){throw 'preflight incomplete'}
}finally{Remove-Item Env:SECURE_SEND_VALIDATION_DB_URL -ErrorAction SilentlyContinue}
~~~
環境変数を一覧表示しない。通常DATABASE_URL/.envは読み込まない。READ_ONLY_COLLECTED/metaのDB/role/read_only=on、ledger=null、columns空を証跡化。これは「空DB接続確認」のPASSでありmigration・アプリ・ACL全試験のPASSでない。
PR9補足inventory SQLはcontainerへcpして同じTCP readonly接続で-f実行（専用password入力）し全object/roleを確認。runtime/migratorも-h/-Wで接続確認し、CREATE実行せずhas_schema_privilegeでruntime=false/migrator=trueを確認。readonly/runtimeに他role所属がないことをpg_auth_membersで照合。
restore DBもport55433/DB名変更の同preflightで空状態を確認後、D stop secure-send-pg17-restore。

## 7. disk/FACTACT影響評価
10.3GBはユーザー観測値で今回実測していない。OS空きGBとPowerShellのGiB表示差に注意。
見積り: 既存公式image再利用なら追加image layerほぼ不要、2つの初期cluster/volume/WAL＋小量fixture＋custom dumpで計0.5〜2GiB程度を計画値とする。新規image取得は展開layer/一時download/WSL VHDX拡張で更に消費するため、実image sizeだけで必要空きを断定しない。上記は保証/上限ではない。
max_wal_sizeはhard disk quotaではなく一時超過する。Docker logは各20MB目安上限、DB table/temp/backupにはhard capがない。大きなCSV/ファイルblobをDBへ投入しない。GCSファイル本体は今回対象外。
作業前後/fixture/backup前後に:
~~~powershell
Get-PSDrive C | Select-Object Free,Used
D system df
D stats --no-stream
D exec secure-send-pg17-validation du -sh /var/lib/postgresql/data
~~~
空き5GiB未満またはSend作成前から3GiB超増加で新規試験/restoreを止め、Send containerを安全停止して調査。FACTACTを停止/縮小/pruneしない。CPU/memory/I/O/diskは共通なのでFACTACT無影響を保証しない。既存作業に遅延が出たらSendの試験を止める。
WSL VHDXはVolume削除後もWindows空きが即回復しない場合がある。本手順ではVHDX圧縮/移動/一括削除を実施しない。Cloud課金なし、端末資源消費のみ（Docker契約費用は既存契約による）。

## 8. 停止・再開・backup/restore・削除
~~~powershell
# Send限定、通常停止。データはVolumeに残る
D stop --time 60 secure-send-pg17-validation secure-send-pg17-restore
# 再開は必要な方のみ。secret bind元を保持する
D start secure-send-pg17-validation
D exec secure-send-pg17-validation pg_isready -U send_bootstrap -d postgres
~~~
restartだけではinit/bootstrapは再適用されない。秘密を変更した時もファイル書換えだけではDB passwordは変更されない。
バックアップ/復元はPR9条件と別承認を維持。container内でbinary dumpを作成してdocker cpすることでWindows PowerShellのbinary redirectを避ける:
~~~powershell
# バックアップ/復元が別承認された後のみ。新しい出力名を使用する
D exec secure-send-pg17-validation pg_dump -U send_bootstrap -d send_commercial_usage_test -Fc -f /tmp/send-before.dump
$DumpPath=Join-Path $PrivateRoot 'send-before.dump'
if(Test-Path -LiteralPath $DumpPath){throw 'Backup file exists'}
D cp secure-send-pg17-validation:/tmp/send-before.dump $DumpPath
Get-FileHash -Algorithm SHA256 -LiteralPath $DumpPath
D exec secure-send-pg17-validation pg_restore --list /tmp/send-before.dump
D start secure-send-pg17-restore
D cp $DumpPath secure-send-pg17-restore:/tmp/send-before.dump
# 空restore DBをpreflightで再確認してから、migrator所有で復元
D exec secure-send-pg17-restore pg_restore -U send_bootstrap --role=send_migrator -d send_restore_commercial_usage_test --no-owner --no-privileges --exit-on-error --single-transaction /tmp/send-before.dump
~~~
no-owner/no-privilegesなのでACL復元実証は別。検証後schema/constraint/index/件数/owner/ACLを比較し必要なallowlistを再適用する。bootstrap role/default ACLはclusterごとに別bootstrap済みとする。DB dumpだけでrole/password/GCSは復旧できない。restore失敗時に--cleanや本番接続へ切り替えない。
削除は**別途明示承認後**。停止/証跡/backup確認後、container名/label/mountを以下の限定出力で照合:
~~~powershell
D inspect --format '{{.Name}} {{index .Config.Labels "atlib.purpose"}} {{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}} {{end}}' secure-send-pg17-validation secure-send-pg17-restore
D volume inspect --format '{{.Name}} {{index .Labels "atlib.purpose"}}' secure-send-pg17-validation-data secure-send-pg17-restore-data
# 名前/label/mountが本書と一致した時だけ。下記は不可逆、通常停止では実行しない
D stop --time 60 secure-send-pg17-validation secure-send-pg17-restore
D rm secure-send-pg17-validation secure-send-pg17-restore
D volume rm secure-send-pg17-validation-data secure-send-pg17-restore-data
~~~
force/prune/volume一括列挙削除は使わない。imageは共有され得るため削除しない。PrivateRootの秘密/backupは保存要否を別判断、再帰削除コマンドは含めない。

## 9. migration承認の別gate・統括報告
今回の準備完了は設計/コマンドのreview可能状態。実作成/接続/SQL実行はSKIP。
作成承認後に空DB/role/preflightを証跡化してもmigrationは停止する。GoにはPR9の以下が別途必要:
- 実ledger（新規空なら不存在の証拠）、全object競合、owner/runtime ACL
- baseline001/002/003/004/006とdraft tenant→connection→usageの採番/最終hash/対象file。既存004の破壊操作は空fixtureだけ
- file別transaction/ledger同時commit、lock5s/statement60s等の上限と失敗時停止
- backup/restore実証、または統括が明示承認した空baseline再作成による復旧条件
- fixture用DDL/drop schema、外部GCS/SMTP/SSO/ClamAVは個別scope、Productionと接続しない
本書の作成承認はmigration/商用公開/外部サービス変更の承認を含めない。

参考（公式）:
- https://hub.docker.com/_/postgres : 17系volume・初期化・PASSWORD_FILE
- https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html : 作成role別/既存object非遡及
- PR9 docs/secure-send-stage3-db-approval-runbook-20261018.md

## 今回の静的検証
PowerShell全12ブロックのParser検査PASS。Docker/APIアクセス拒否によりimage/起動/SQL/ACL/接続/復元は全て未実行SKIP。SQL構文・実効ACLは実PostgreSQLで未検証。構文PASSを実環境PASSとしない。
