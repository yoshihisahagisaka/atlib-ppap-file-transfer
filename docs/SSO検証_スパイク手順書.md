# SSO検証スパイク 手順書(Google + Microsoft Entra ID)

対象: `sso-verify-service`。atLIB SecureSendの対外SaaS化検討における、送信者側SSO(Google Workspace / Microsoft Entra ID)+ JITプロビジョニングの技術検証用スパイク。

**本番の`upload-service`(IAP配下、`https://ppap-upload.atlib.jp`)には一切影響しない。** 完全に独立したCloud Runサービスとして、既存の共有LB(`msp-iap-urlmap`)を経由せず、既定の`*.run.app` URLで直接検証する。

## 0. 前提

- GCPプロジェクト: `msp-zabbix`(既存、変更なし)
- Cloud SQLインスタンス: `msp-customer-portal-db`(既存)内に、**本番の`ppap_transfer`/`ppap_app`とは別**のデータベース`ppap_sso_verify`・ユーザー`ppap_sso_verify_app`を新規作成する(§3)
- atLIBのDNSドメイン(`atlib.jp`)がGoogleで取得されていることと、Microsoft Entra IDでログイン検証できるかは無関係。Microsoft 365 Business Standard契約があれば、そのMicrosoft 365テナントには自動的にEntra IDテナント(無料枠)が付随しており、基本的なOIDCサインイン(`openid`/`profile`/`email`スコープ)にP1/P2等の追加ライセンスは不要。

## 1. OAuthクライアント登録(手動・MFA付きログインが必要なため自動化しない)

### Google Cloud Console

1. [APIs & Services > OAuth consent screen] で作成:
   - User Type: **External**(JITのドメイン一致検証のため、`atlib.jp`以外のドメインのアカウントでもログインできる必要がある)
   - 公開ステータス: **Testing**(Google側の審査は不要。ただしテストユーザーとして明示的に追加したGoogleアカウント、最大100件までしかログインできない。複数ドメインでJITを試すには、各ドメインの実アカウントをテストユーザーに追加すること)
   - スコープ: `openid`、`.../auth/userinfo.email`、`.../auth/userinfo.profile`(非機微スコープ、審査不要)
2. [APIs & Services > Credentials > 認証情報を作成 > OAuthクライアントID] で作成:
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクトURI: まず `http://localhost:8080/auth/google/callback` を追加(ローカル検証用)。Cloud Runへの初回デプロイ後、発行された`*.run.app` URLを2つ目のリダイレクトURIとして追加登録する(複数URI登録可)
3. 発行された クライアントID / クライアントシークレット を控える

### Microsoft Entra管理センター

1. [ID > アプリの登録 > 新規登録] で作成:
   - サポートされているアカウントの種類: **この組織ディレクトリのみのアカウント(シングル テナント)**(検証用。将来の本番マルチテナント対応時はここを見直す)
   - リダイレクトURI: プラットフォーム=**Web**、`http://localhost:8080/auth/microsoft/callback`(localhostは開発用として明示的に許可されている)。Cloud Runデプロイ後に`*.run.app`のURIを追加登録
2. [APIのアクセス許可] で Microsoft Graph の委任アクセス許可 `openid` / `email` / `profile` を追加(既定では管理者の同意不要。テナント全体でエンドユーザー同意が無効化されている場合のみ、管理者による同意が必要。ログイン時に`AADSTS65001`系のエラーが出た場合はこれを疑う)
3. [証明書とシークレット > 新しいクライアント シークレット] でシークレットを発行
4. アプリケーション(クライアント)ID・ディレクトリ(テナント)ID・クライアントシークレットの値 を控える

## 2. Secret Manager登録

```bash
# 改行混入防止のため、必ずファイル経由で登録する(既存手順書と同じ注意点)
gcloud secrets create ppap-sso-verify-google-client-secret --data-file=<改行なしのファイル>
gcloud secrets create ppap-sso-verify-entra-client-secret --data-file=<改行なしのファイル>
gcloud secrets create ppap-sso-verify-session-secret --data-file=<openssl rand -base64 32 等で生成したファイル>
gcloud secrets create ppap-sso-verify-db-password --data-file=<改行なしのファイル>

SA=135863453696-compute@developer.gserviceaccount.com
for s in ppap-sso-verify-google-client-secret ppap-sso-verify-entra-client-secret ppap-sso-verify-session-secret ppap-sso-verify-db-password; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

## 3. DB分離(本番`ppap_transfer`とは別データベース)

```bash
gcloud sql databases create ppap_sso_verify --instance=msp-customer-portal-db
gcloud sql users create ppap_sso_verify_app --instance=msp-customer-portal-db --password='<上記で生成したパスワード>'
```

**注意**: `migrations/runner.ts`は`migrations/`直下の`*.sql`を**ファイル名順に全て**適用する仕組みで、対象データベースごとの部分適用機能は無い(既存の`msp-customer-portal`と同じ方式)。そのため`ppap_sso_verify`に対して`npm run migrate:sso-verify`を実行すると、`001_init.sql`〜`004_group_download.sql`(本来`ppap_transfer`用のtransfers/transfer_groups/audit_logs等)も一緒に作成される。これ自体はデータが混入するわけではなく実害はないが、**`005_sso_verify_spike.sql`は逆に本番`ppap_transfer`側に誤って適用されるのを防ぐため`migrations/sso-verify-archive/`に退避してある**(共有ランナーの走査対象外)。`ppap_sso_verify`には既に適用済みなので影響はないが、このDBを再構築する場合はそのアーカイブ先のファイルを直接`psql`等で適用すること。

## 4. ローカル検証(Phase A)

```bash
cp sso-verify.env.example sso-verify.env
# sso-verify.env に §1 で控えたクライアントID/シークレット、DB接続情報を記入
# (このファイルは .gitignore の *.env パターンで無視される。sso-verify.env.example はテンプレートとして追跡対象)

npm run migrate:sso-verify   # migrations/ 直下の001〜004を適用(005_sso_verify_spike.sqlは
                              # migrations/sso-verify-archive/ に退避済みのため、別途 psql 等で直接適用する)
npm run dev:sso-verify
```

テストデータ投入:
```sql
INSERT INTO sso_verify_customers (domain, company_name, seat_cap) VALUES
  ('atlib.jp', 'atLIB (internal test)', 3),
  ('<検証用に確保した2つ目のドメイン>', 'Test Customer B', 2);
```

`http://localhost:8080/sso-verify/` を開き、Google/Microsoft双方でログインし、以下を確認する:
1. `provisioned` / `over_cap` / `domain_not_registered` の3状態が正しく表示される
2. `seat_cap`を超えるログインでは`sso_verify_users`に新規行が増えない(`SELECT count(*) FROM sso_verify_users WHERE customer_id = ...`)
3. 未登録ドメインのアカウントでは`domain_not_registered`になる

## 5. Cloud Runへのデプロイ(Phase B)

```bash
gcloud builds submit --config=cloudbuild.sso-verify.yaml .
gcloud run deploy ppap-sso-verify-service \
  --image=asia-northeast1-docker.pkg.dev/msp-zabbix/cloud-run-source-deploy/ppap-sso-verify-service \
  --region=asia-northeast1 --allow-unauthenticated \
  --add-cloudsql-instances=msp-zabbix:asia-northeast1:msp-customer-portal-db \
  --set-env-vars=GCP_PROJECT_ID=msp-zabbix,DB_NAME=ppap_sso_verify,DB_USER=ppap_sso_verify_app,DB_SOCKET_PATH=/cloudsql/msp-zabbix:asia-northeast1:msp-customer-portal-db,STORAGE_BUCKET=unused-sso-verify-spike,SMTP_HOST=unused,SMTP_USER=unused,SMTP_FROM=unused@atlib.jp,SMTP_PASSWORD=unused,GOOGLE_OAUTH_CLIENT_ID=<...>,GOOGLE_OAUTH_REDIRECT_URI=PENDING,MICROSOFT_OAUTH_CLIENT_ID=<...>,MICROSOFT_OAUTH_TENANT_ID=<...>,MICROSOFT_OAUTH_REDIRECT_URI=PENDING \
  --set-secrets=DB_PASSWORD=ppap-sso-verify-db-password:latest,SSO_SESSION_SECRET=ppap-sso-verify-session-secret:latest,GOOGLE_OAUTH_CLIENT_SECRET=ppap-sso-verify-google-client-secret:latest,MICROSOFT_OAUTH_CLIENT_SECRET=ppap-sso-verify-entra-client-secret:latest
```

デプロイ後に表示される`*.run.app` URLを、Google Cloud ConsoleとMicrosoft Entra管理センター双方のリダイレクトURI設定に追加登録してから(localhostの登録は残したままでよい)、環境変数を実URLに更新する:

```bash
gcloud run services update ppap-sso-verify-service --region=asia-northeast1 \
  --update-env-vars=GOOGLE_OAUTH_REDIRECT_URI=https://<run-url>/auth/google/callback,MICROSOFT_OAUTH_REDIRECT_URI=https://<run-url>/auth/microsoft/callback
```

マイグレーション適用とテストデータ投入は、Cloud SQL Auth Proxy経由(または`gcloud sql connect`)で§4と同様に行う。

Phase Aと同じログイン確認をCloud Run上のURLで再実施したうえ、以下も確認する:
```bash
# LBに一切手を加えていないことの確認
gcloud compute url-maps describe msp-iap-urlmap  # 新規パスマッチャーが追加されていないこと

# 本番DBと別データベースであることの確認
gcloud sql databases list --instance=msp-customer-portal-db  # ppap_sso_verify が ppap_transfer と別に存在すること

# LB非経由で直接200が返ることの確認
curl -I https://<run-url>/sso-verify/
```

## 6. 将来、別インスタンスへ切り出す場合

`ppap_sso_verify`は最初から本番データと混ざっていないため、`pg_dump --dbname=ppap_sso_verify` / `pg_restore`で新しいCloud SQLインスタンスに移し、Cloud Runサービスの`DB_HOST`/`DB_SOCKET_PATH`を差し替えるだけで完了する。データの選り分け作業は発生しない。
