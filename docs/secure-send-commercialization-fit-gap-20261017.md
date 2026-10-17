# atLIB Secure Send — 既存資産調査・商用化 Fit/Gap 評価

調査日: 2026-10-17
対象: `atlib-ppap-file-transfer` main `9c1b002`、`atlib-sales-tools`、`atlib-msp-customer-portal`（InfraVision顧客ポータル）
調査方法: ソース、migration、テスト、運用手順書、Cloud Runの読み取り専用照会。Production・DB・設定の変更はしていない。

## 判断

### 結論: **CONDITIONAL FIT**

Secure Sendは、社内利用に必要な送受信、受信者OTP、ClamAVスキャン、期限・上限付きダウンロード、To/CC通知、監査ログという重要な土台をすでに稼働させている。対外商用サービス化の最小版は、既存の3サービスとデータモデルを活かせるため、ゼロから作る必要はない。

ただし本番`ppap_transfer`には顧客組織・利用者・ロール・契約プラン・利用量・テナント境界がなく、現行の送信者認証はatLIB社内IAPグループである。Google/Microsoft SSOと顧客ユーザーのJIT作成は、独立プロジェクト・別DBで動く**検証スパイク**までであり、送信本体へ未統合である。よって、外部顧客への提供開始は「テナント境界と顧客認証を実装・テストし、商用運用条件を確認する」ことが前提となる。

約1か月で可能なのは、対象顧客を限定した最小商用版（小規模パイロット）までである。一般公開の商用Goは、下表のP0を完了し、SSO・分離・運用・契約条件を受入確認してからとする。

## 1. As-Is: Secure Send本体

### 稼働構成 — **確認済み**

| 項目 | 実装・稼働証跡 | 評価 |
| --- | --- | --- |
| upload-service | `ppap-upload-service`、社内IAP配下。送信フォーム、アップロード、スキャン同期呼出、送信履歴、監査ログ画面 | PASS |
| download-service | `ppap-download-service`、社外公開。OTP認証後のダウンロード | PASS |
| virus-scan | `ppap-virus-scan`、ClamAV。Cloud Runサービス間OIDCで呼出 | PASS |
| DB | Cloud SQL同一インスタンス内の専用DB `ppap_transfer` | PASS（論理DB分離） |
| object storage | 非公開GCSバケット `atlib-ppap-file-transfer`、ライフサイクル21日 | PASS |
| Production状態 | 3サービスは2026-10-17の読み取り専用Cloud Run照会でReady | PASS |

`docs/運用手順書_デプロイ.md`では、スキャンサービスは2GiB・最小1インスタンスで常時ウォームとする。読み取り専用の現在設定でも、scanは2GiB/minScale=1、upload/downloadは512MiB、全てmaxScale=20、timeout=300秒を確認した。

### 実装済み機能 — **確認済み**

| 機能 | 根拠 | 状態 |
| --- | --- | --- |
| アップロード用署名付きURL | `services/storageService.ts` | 実装済み |
| ダウンロード用短期署名URL | 同上、設定値は`SIGNED_URL_EXPIRES_MINUTES` | 実装済み |
| ダウンロードリンクの期限・回数上限 | `transfer_groups.expires_at/max_downloads/download_count`、`downloadRoutes.ts` | 実装済み |
| 受信者メールOTP | `download_otps`、bcryptハッシュ、10分の使い捨て設計 | 実装済み |
| 複数ファイルを1グループで認可 | `004_group_download.sql`、`transfer_groups` | 実装済み |
| To/CC通知 | `006_recipient_cc.sql`、CCは通知のみでDL権限なし | 実装済み |
| ウイルススキャン | `scanRunner.ts`、ClamAV、感染時GCS削除 | 実装済み |
| clean後だけ通知 | `scanRunner.ts`、全ファイルのscan確定後に送信 | 実装済み |
| 監査ログ | `audit_logs`、created/uploaded/scan/OTP/download等 | 実装済み |
| 送信者名・送信履歴 | `transfer_groups.sender_email/sender_name`、upload側repo | 実装済み |
| ファイルの自動削除 | GCS lifecycle 21日 | 稼働手順で確認。DBレコード整合は要検証 |

### 現行のアクセス境界 — **確認済み**

- upload-serviceはIAPで社内グループを保護し、監査画面は別backend/IAPポリシーでdirectorグループに限定する。
- download-serviceは受信者が公開URLへアクセスし、宛先ToアドレスにOTPを送る方式である。
- 現行`transfers`、`transfer_groups`、`audit_logs`には`tenant_id`/`organization_id`/`customer_id`がない。従って、外部企業を収容した場合のSQLレベル・APIレベルの企業境界は存在しない。

## 2. 既存商用化・SSO資産

### Secure Send SSO検証スパイク — **部分対応**

`docs/SSO検証_スパイク手順書.md`と`sso-verify-server.ts`から、Google OIDC・Microsoft Entra OIDC・PKCE・署名付きセッションCookie・ドメイン照合・JIT作成・seat capを確認した。Cloud Runの`ppap-sso-verify-service`もReadyである。

ただし以下の理由から商用SSOとしては未完了である。

1. 本番upload-serviceとは別Cloud Run、別GCP project、別DB `ppap_sso_verify`。
2. `sso_verify_customers/users` はスパイク専用migrationにあり、`ppap_transfer`の送信グループに接続していない。
3. Microsoftは検証用にsingle-tenant登録と明記され、顧客ごとのEntraテナントを受け入れる設計・実機検証は未確認。
4. customer admin/general userという権限モデル、退会・停止、監査証跡、招待運用は未実装。

### Sales Tools — **設計思想・一部部品は再利用可能**

| 確認項目 | 実装証跡 | Secure Sendへの再利用評価 |
| --- | --- | --- |
| 組織 | `migrations/007_it_management_diagnosis.sql` の`organizations` | 組織概念・ID参照の設計思想を再利用可能 |
| 利用者と役割 | `participants`/`participant_roles` | 診断参加者の役割でありSaaS認可ではない。設計思想のみ |
| 監査 | `diagnosis_audit_logs`とテスト | 監査イベント設計・失敗時の扱いを再利用可能 |
| 保持・削除 | `retentionDeletionWorker.ts`とgolden test | データ分類・削除証跡の設計思想を再利用可能 |
| 認証 | 社内Google Workspace/staff主体。管理APIはstaff auth配下 | 外部顧客SSOの基盤としては不適合 |
| DB | 独立DB `sales_tools` | Secure Sendと共有DBに統合しない |

Sales Toolsの`organizations`は診断案件に紐づく業務ドメインで、外部ユーザーの認可境界ではない。現行作業ツリーには未コミット変更があるため、本評価では読み取りのみとし、変更していない。

### InfraVision顧客ポータル — **顧客単位の分離実績はあるが、直接統合は非推奨**

| 確認項目 | 実装証跡 | 評価 |
| --- | --- | --- |
| 顧客レコード | `customers`、`customer_code`、`status(active/suspended)` | 実装済み |
| 顧客と監視対象の分離 | `customer_hostgroups.customer_id`→Zabbix group | 実装済み |
| 顧客ログイン | `AuthService`/`CustomerRepo`、メール・パスワード | 実装済み（Google/Microsoft顧客SSOではない） |
| 社内管理者ロール | Google Workspace+PKCE、`admin_principals`、admin/general | 実装済み |
| API境界 | 顧客セッションからcustomer codeを取り、Zabbix host groupを限定する設計 | 実装証跡あり。Secure Send用のクロステナント否認テストは別途必要 |
| ファイル保護 | 月次レポートのGCS保存 | 実装済み。ただしSecure Sendの配布認可要件とは異なる |
| 顧客追加・停止 | onboarding、customers.status、Zabbix作成手順 | 実装済み |
| 監査ログ | 構造化アクセスログ、ops history | Secure Sendの完全な顧客操作監査とは別 |

InfraVisionは「顧客IDをDBに持ち、顧客ごとの外部システム資源を限定する」有効な実績である。一方、監視/Zabbixを中心としたアプリであり、Secure Sendのファイル・リンク・受信者モデルとは異なる。両アプリのDBや認証を強制共有せず、Secure Send自身に`organizations`/`users`/`memberships`/`roles`を持たせ、必要な設計パターンとテストだけを移植する。

## 3. 商用化 Fit/Gap

| # | 要件 | 現状 | 判定 | 商用最小版に必要なこと |
| ---: | --- | --- | --- | --- |
| 1 | 企業別データ・ファイル分離 | 社内単一テナント。顧客IDなし | GAP | 全業務表にorganization_id、GCS object prefix、全repo queryの境界、越境否認テスト |
| 2 | 顧客管理者・利用者権限 | 社内IAPのみ。SSO spikeはユーザー作成のみ | GAP | membership、admin/member、招待・停止、認可middleware |
| 3 | Google/Microsoft SSO | 独立スパイクでGoogle/Entra OIDC | 部分対応 | 本体統合、マルチテナントEntra方針、外部Google公開・同意設定、E2E |
| 4 | アップロード・保存・削除 | GCS/署名URL/scan/21日lifecycle | 実装済み | テナントprefix、契約別保持期間、削除ジョブ/DB整合の確認 |
| 5 | ウイルススキャン | ClamAV、感染時削除、clean後通知 | 実装済み | 容量・同時実行・定義更新・検知時顧客通知の負荷試験 |
| 6 | URL発行・期限 | グループtoken、OTP、max downloads、短期署名URL | 実装済み | 顧客別の既定値と管理UI |
| 7 | CC通知 | To/CCモデル | 実装済み | 顧客側の許可範囲と監査表示 |
| 8 | DL履歴・監査 | audit_logs、監査画面 | 部分対応 | organization絞込、顧客閲覧範囲、改ざん耐性・保存年限 |
| 9 | 企業別利用量 | 送信サイズは保存、集計なし | GAP | 月次の容量・送信・DL・スキャン集計 |
| 10 | 上限・契約プラン | SSO spikeのseat capのみ | GAP | plan、quota、超過時の拒否/通知、管理画面 |
| 11 | 申込・契約・決済 | 実装なし | GAP | 初期は手動契約・手動オンボーディング。自動決済は後工程 |
| 12 | 個人情報・保持・削除 | GCS 21日、自動削除方針。顧客単位の削除未実装 | 部分対応 | 利用規約/保持表、顧客削除手順、バックアップからの削除方針 |
| 13 | 障害・backup・監視 | 稼働手順と健康確認あり。backup/復旧RTO/RPOの証跡未確認 | 部分対応 | Cloud SQL backup、GCS versioning/retention、監視・通報、復旧演習 |
| 14 | 商用セキュリティ検証 | IAP/OTP/ハッシュ/スキャンあり。外部マルチテナント試験未確認 | 部分対応 | 脅威モデル、認可・越境・SSO・rate limit・脆弱性試験、受入基準 |

## 4. 最小商用版（限定パイロット）の実装順序

### P0: 商用開始のブロッカー（推定 13〜20人日）

1. **テナントデータモデル（3〜4人日）**: `organizations`、`users`、`memberships`、`plans`をSecure Send専用DBへ追加。既存`transfer_groups`と`transfers`に`organization_id`を追加し、既存社内データはatLIB組織に移行するmigrationを設計・検証する。
2. **認可境界（3〜4人日）**: セッションのorganization/member roleから全ての送信・履歴・監査・管理APIを絞る。IDだけの差替えで他社データを読めないことをAPI/DB統合テストで証明する。
3. **顧客SSOと利用者管理（4〜6人日）**: SSO spikeを本体へ統合。Googleを先行し、Microsoft Entraは顧客テナント方式を確定後に入れる。顧客管理者の招待、停止、JIT作成、seat上限を実装する。
4. **運用・安全確認（3〜6人日）**: tenantごとの監査/利用量、レート制限の再評価、バックアップ/削除、障害監視、E2Eおよび越境否認試験を実施する。

### P1: 契約運用に必要（推定 6〜10人日）

- プラン・容量・送信数・利用者数の月次集計、上限警告、社内管理画面。
- 顧客自身による監査閲覧、顧客管理者による利用者停止。
- 保持期間と顧客削除の運用手順・実機検証。

### P2: 自動化・拡張（提案時点では不要）

- 申込、契約、決済、請求の自動連携。
- Microsoft Entraの顧客テナント横断SSO、SCIM等。
- プラン変更のセルフサービス、自動超過課金。

### 1か月の到達目安

| 週 | 完了条件 |
| --- | --- |
| 1 | データ境界・認証方針の設計確定、migrationレビュー、脅威モデル |
| 2 | テナントmodel・認可middleware・越境否認テスト |
| 3 | Google SSO本体統合、招待/停止、既存機能回帰試験 |
| 4 | 限定顧客のE2E、監査/利用量最小集計、障害・バックアップ確認、Go/No-Go |

提案資料に載せる範囲は、既存実績（安全なファイル送信・OTP・スキャン・監査）と「限定パイロットへ向けた実装計画」までに留める。1か月で自動決済、Microsoft全テナントSSO、完全セルフサービスまでを約束しない。

## 5. 料金設計の材料（未確定）

| 原価・課金候補 | 現時点の確認 | 判断 |
| --- | --- | --- |
| Cloud Run upload/download | 稼働中。利用量別の請求実測は未取得 | 利用量を計測してから価格へ反映 |
| ClamAV scan | scanは2GiB/minScale=1。ウォーム維持の固定費がある | 基本料金に含める候補。ファイル数/サイズ増で再測定 |
| Cloud SQL | 既存インスタンスに論理DBで相乗り | 商用の追加負担、backup・HA原価は未確認 |
| GCS保存 | 21日lifecycle。保存量・取得量の実測未取得 | 容量/送信量帯の従量またはfair-use候補 |
| SMTP/通知 | Gmail SMTPを使用 | 商用送信量上限、到達性、送信ドメイン対策を確認 |
| 企業単位基本料 | 運用、scanの固定費、監査を回収しやすい | 小規模企業に説明しやすい候補 |
| 利用者単位 | SSO/JIT・管理者機能と整合 | seat cap実装を商用化する必要あり |
| 利用量単位 | 保存GB、送信件数、容量、DL回数 | 実測を取ってから上限・超過条件を決める |

Secure Guardとのセット価格、レベニューシェア原資、正式価格は未決定とする。先にP0で利用量を記録できる状態にし、固定費と変動費を1〜2か月観測してから料金案を作る。

## 6. 商用Go条件と未確認事項

### Go条件

- tenant境界とロールがE2E/自動テストで確認済みであること。
- 一社のユーザー、ファイル、監査ログ、署名URLが他社から取得不能であること。
- Google SSOを外部顧客で実機確認済みであること。Microsoftを提供対象にする場合は顧客Entraテナントで確認済みであること。
- 保持・削除・backup/復旧・障害通知の責任分界を文書化し、担当者が実行できること。
- scan失敗、感染検知、SMTP失敗、Cloud Run/Cloud SQL障害の運用手順がテスト済みであること。
- 利用規約、個人情報取扱い、DPA等の契約・法務確認を完了していること。

### 未確認（推測しない）

- Cloud SQLのbackup設定、復旧目標、GCS versioning/retention、監視・アラートの現在状態。
- 現在の月額原価、ファイル量・容量・通信量、SMTPの商用送信上限。
- 本番の監査ログ保存年限と顧客が閲覧できる範囲。
- 顧客Entraテナントを対象にしたMicrosoft SSOの実機結果。
- 現行SSOスパイクのGoogle外部公開状態・審査/テストユーザー制約の商用移行可否。
- 外部脆弱性診断、負荷試験、個人情報・契約の商用適合性。

## 7. 推奨アーキテクチャ

Secure Sendは独立アプリ・独立論理DBを維持する。`atlib-msp-customer-portal`の顧客ID・停止・RBACのパターン、Sales Toolsの監査/保持削除のパターンを参照するが、DB・セッション・アプリケーションを共有しない。

```
Customer SSO (Google first / Entra after verification)
  -> Secure Send app session {user, organization, role}
  -> Secure Send API authorization
  -> ppap_transfer DB (organization_id on every tenant record)
  -> GCS object prefix organization_id/...
  -> existing scan service / OTP download / audit event flow
```

この構成なら、既存のアップロード、スキャン、OTP、通知、監査という資産を残しつつ、顧客境界をSecure Send自身が責任を持って検証できる。

## 8. 根拠ファイル

- `docs/運用手順書_デプロイ.md`
- `docs/SSO検証_スパイク手順書.md`
- `migrations/001_init.sql`, `002_transfer_groups.sql`, `004_group_download.sql`, `006_recipient_cc.sql`
- `src/routes/*`, `src/services/storageService.ts`, `scanRunner.ts`, `ssoVerifyRepo.ts`
- Sales Tools: `migrations/007_it_management_diagnosis.sql`, `services/retentionDeletionWorker.ts`, `test/*golden*`
- InfraVision: `migrations/001_init.sql`, `010_admin_principals.sql`, `src/server.ts`, `services/customerRepo.ts`, `routes/staffAuth.ts`
