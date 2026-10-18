# Secure Send 開発再開：契約人数・共有容量の第1実装

2026-10-18 JST。独立branch `feat/secure-send-commercial-usage-20261018`。

## 今回の到達点

既存tenant認可基礎を再実装せず継承し、Send単独の容量・通知・増枠・DL監視・削除・利用状況のバックエンド部品を追加した。**既存upload/download/scanサーバーへのmount・SSO統合・DB適用はしていない。** 商用機能が稼働したという完了報告ではない。

新規サービスはプランと正式発注に由来する権利スナップショットを必須とし、未設定時は拒否する。テナント認証未完成の既存IAP経路へ接続して、外部顧客の認可を成立したことにはしない。下記の本体接続ゲートが次工程となる。

## 1. 再開時の正本

| 対象 | fresh確認・状態 |
| --- | --- |
| remote main | `9c1b00230f5efe6ddbae2b8c3ef5e7d0f87787b7`。変更していない |
| PR #3 | `74facb2fd202b697f288701bca670f7bc70c86b5`。構成/費用/段階的スケールの調査。未merge |
| PR #4 | `d70bbe409c618dc20fcdcb3f46e0fba2af37ab38`。容量/通知/共通問い合わせのFit/Gap。未merge |
| PR #1 | `d2fdd5b7015be4a3967e900f66c0e46a884d019d`。今回の開発系統の既存正本 |
| 既存ローカル開発 | `d6b51e1c1bc2f7979edd636d6603599180b63b0f`、`feat/secure-send-tenant-foundation-20261017`。再開前clean。認可関数・5テスト・draft schemaをそのまま継承 |
| 新規worktree | `secure-send-commercial-dev`。既存開発/原価/構成調査のworktreeは変更しない |
| Corporate関連決定 | Issue #16〜#36のissue本文をfresh read。索引と内容hashは別JSON |

PR #3本文の古い「請求未取得」説明より、同SHAのdocsにある請求/構成取得済み追補を優先する。過去の原価・Fit/Gapの再調査は行わず、今回指示との差分を復元した。

## 2. 最新Decisionの反映と責任境界

- #21/#23：1か月後はPIRA提案予定であって商用完成期限ではない。今回のユーザー指示によりSend単独の非Production開発を再開する。PIRA採択、共通基盤の本格開発Go、公開やインフラ構築の承認とはみなさない。
- #27〜#31：企業→組合へ申込、組合→atLIBへ正式発注。相談/技術提案はatLIB。組合上乗せ利益と、基本料金40%の橋渡し関係者向け配分は別管理。
- #32〜#35＋今回指示：月額契約、数量は契約人数、追加/減少は正式変更発注。減少/解約はJST20日締切・月末反映・翌月初請求。日割りの1円未満切り捨ては共通請求側の責任。Sendには請求額・締切計算・組合注文workflowを作らない。
- `applyAllowance`は、共通基盤/権限あるatLIB担当者が検証済みの正式発注参照・版・有効時刻・契約人数・容量を渡す境界。入力をそのまま信頼する公開APIではない。未来の変更は実効日まで適用できず、減少は新しい期間へ反映する。同一人数の送信者交代で契約容量は変えない。
- 月途中の容量付与量は推測しない。`fullMonthCapacity`で設定bytes×契約人数を算定できるが、実適用する`baseQuotaBytes`は外部の承認済みsnapshotで必須指定する（満月枠を超える値は拒否）。請求日割りと容量日割りを混同しない。
- #16/#20：共通入口・組合ポータル・契約請求・共通問い合わせは接続待ち。Send側で重複実装しない。
- #19/#24：通知表示名は設定注入。PIRA名・組合構造・40%・単価・ロゴをSendドメインへ固定しない。今回ブラウザ画面のブランド改修は未実施。
- #22/#25/#29：調査回答・相談記録をSend利用企業や契約へ自動登録しない。入力snapshotは契約・サービス提供の目的のみに限定する。
- #36：GuardのDNSFilter使用量・請求数量の調査は再実行しない。Sendの送信者数量にGuard端末数を流用しない。

## 3. 実装状況と残課題

「部品実装」はローカル単体/サービス試験で確認した状態で、本体接続/商用受入ではない。

| 項目 | 今回のコード | 残る接続・検証 |
| --- | --- | --- |
| tenant認可 | 既存`tenantAuthorization.ts`を継承 | 全業務テーブルのorg参照、複合FK、repoのorg必須化、信頼できるSSO context |
| 企業共有容量 | `CommercialUsageService`、契約人数×設定bytes、期間/counter | 正式発注snapshotの供給、検証DB migration、既存APIへの接続 |
| 同時送信制限 | 予約→GCS実bytes確定、PGの企業単位advisory transaction lock | PostgreSQL16実接続での並行/復旧試験 |
| 80/100%通知 | outbox・lease・retry・増枠時の古い通知無効化・current admin解決 | 顧客admin repo、SMTP実送信、job実行契機とfailed監視 |
| 100%時の受信継続 | quota判定は新規予約だけ。予約済み完了可。download routerは変更なし | OTP/To/CC/期限/回数/感染/取消を含むE2E。今回「受信E2E PASS」とはしていない |
| 容量追加 | staff権限、理由/正式参照・冪等性・期間限定増枠・監査 | 実DB/管理API・画面、共通問い合わせとの参照連携 |
| DL異常 | 発行推計と観測egressを別windowに集計。内部scanを除外 | 実メトリクス取得・企業帰属、URL再利用/Range等の検知、監視通知 |
| 保持7日候補 | 設定型deadline、期限後generation条件付き削除、繰返し安全 | 新規group作成/短期DL署名への期限反映、実GCS削除/soft delete/復旧 |
| 企業/送信者/利用状況 | admin管理用view、契約人数/実有効人数の乖離表示、既存sender count再利用 | 企業CRUD・利用者招待/停止・認証・管理画面はtenant/SSO統合工程 |
| 既存SMTP再利用 | Mailerに`sendUsageNotice`を追加。既存OTP経路をtransport stubで回帰 | 実nodemailer/SMTP到達・上限。baseline全体build |
| 共通問い合わせ・組合管理・請求 | 今回実装しない | 共通基盤待ち。Sendを待機させずportだけ明確化 |

保存7日、5GB、80%等は実行コードの既定値にしていない。試験fixtureでは承認済みの例として5,000,000,000bytes/契約送信者・80%・7日を設定する。未設定/不正値はfail closed。単位・期間・retention・DL閾値・retry設定は本体接続前に正式なplan版へ固定する。

## 4. ファイルと処理の要点

- `src/domain/commercialUsage.ts`：型、整数上限、設定検証、契約人数の満月枠計算、deadline、容量判定。料金・発注・請求処理なし。
- `commercialUsageService.ts`：権利適用、予約/確定/増枠、利用状況、DL異常、通知claim/再送、期限削除。actor/tenant/所有者の検証を先行。
- `commercialUsageStore.ts`：transaction port。missing period作成も排他対象。Memory実装はtestだけ。
- `pgCommercialUsageStore.ts`：既存pg Poolと接続可能なnarrow port。org/periodを全クエリへbindし、企業単位のadvisory lockで期間作成・重複期間・予約競合を直列化。実PostgreSQL検証は未実施。
- `commercialGcs.ts`：既存の非公開bucketを受け取り、署名PUTの`x-goog-content-length-range`で予約サイズを固定、`x-goog-if-generation-match:0`で上書きを拒否。generationは数値に丸めず文字列で扱う。CORSと実SDKの適合確認は残る。
- `commercialUsageNotifications.ts`：送信時点の有効な顧客adminだけへ通知。他社contactが混じるresolver結果は全体拒否。ファイル名/OTP/署名URLを通知へ入れない。`{send:(to,subject,text)=>mailer.sendUsageNotice(to,subject,text)}`で既存Mailerを接続可能。
- `commercialUsageJobs.ts`：明示的なwork発見/処理。起動時に自動実行しない。送信失敗・削除失敗を他社の処理へ波及させない。Cloud Run Job/Scheduler等の構築は未実施。
- `docs/commercial-usage-schema.draft.sql`：番号なし・runner外・未適用のレビュー案。usage periods/reservations/events/outbox/observationsの5表、企業/transfer複合FK、履歴変更拒否trigger。runtime ACLは環境role確定後に明示REVOKEと実効検証が必要。

## 5. 安全性・未確定仕様

同じ正式snapshotの再送はcanonical比較で冪等。JSONBのkey順序差を誤った変更とみなさない。異なる内容で同じ識別子/版を再利用した場合は拒否。期間名を変えた同一期間の二重枠や、同じtransferの再予約も拒否する。

予約済みデータのcompleteは、月が変わっても元の期間へ計上する。新しい月に期間未設定なら新規送信は拒否する。増枠はその期間だけで繰越しない。感染/取消/保持削除による消費返還は実装していない。今回は`received_bytes`方式のみを明示設定で受け入れ、業務上の正式な計上点の決定を済ませたとはしない。

署名URL期限が過ぎても、開始済みPUTが終わっていない可能性がある。単に「metadataが今ない」だけで予約を解放しない。`uploadClosed`の確証portがfalseなら保持する。確証取得adapterはまだ未実装で、初期は照合・人の確認が必要。自動work discoveryは未確証reservationを常時再試行して期限削除を詰まらせない。

通知はend-to-end exactly onceではない。SMTP受領直後にworkerが停止すれば重複の可能性がある。lease tokenによる遅延workerの更新拒否と、状態/試行履歴による運用とする。pendingの80%通知が100%に追い越された場合はfull通知にまとめ、増枠後に旧上限の通知を再送しない。

DL異常は、URL発行量の推計と実egress観測を合算しない。`recordDownload`は信頼できるworkerに限定し、ユーザーの申告bytesを実測として登録しない。既存`downloaded`イベントは署名URL発行であり、実ダウンロード完了件数・bytesではない。異常検知による自動受信停止・追加課金はない。

署名URLの発行権限はclient側へ渡すものなので、期限/ヘッダ/サイズの実GCS試験が必要。既存URL発行は今回無断変更せず、商用経路を安全に接続するまで新adapterは使用されない。

## 6. 検証結果

| 検証 | 今回結果 |
| --- | --- |
| Node v24.18.0、tenant＋commercial service/adapter試験 | **23 PASS、0 FAIL**。既存5件を含む |
| opt-in PostgreSQL試験 | **1 SKIP（未実行）**。Docker socketにpermission denied、外部DBへ接続していない |
| TypeScript5.9.3 strict/noUncheckedIndexedAccess、追加7モジュール＋既存tenant | **PASS**。`test/tsconfig.commercial.json`。既存lockと一致するcompiler archiveを使用 |
| Mailer usage通知・既存OTP | ローカルtransport stubでPASS。実SMTP検証ではない |
| GCS | SDK形状portのstubでヘッダ/期限/世代条件を検証。実bucket未接続 |
| 依存復元 | offline ciはENOTCACHED、通常ciはnode_modules内mkdir EPERM。権限回避やグローバル設定変更なし |
| baseline全体typecheck/build | 依存/Node型欠落でFAIL。新規coreのstrict PASSと区別。全体build成功とは報告しない |
| 既存送受信/SSO/scan/OTP実機E2E | 未実施。関連server/routerに変更なし |
| DB/Production/インフラ/商用公開 | 実行なし。DDL適用・migration採番なし |

初回のMailer stub回帰はNode strip-onlyでは既存constructor parameter propertyを処理できなかったため、テスト実行をNode24のtransform-typesへ統一した。Mailerの型専用importを`type Transporter`へ明示化。CommonJSのpackage設定・既存本番起動方式は変えていない。

試験内容：20件並行予約で枠超過防止、transaction失敗のrollback、A/B越境・所有者/ロール拒否、実size不一致、重複complete、正式snapshot再送/改竄、契約人数と実ユーザー数の分離、増枠・通知更新、月跨ぎ、期間重複、非admin宛通知拒否、retry/lease、URL再利用前提のDL集計、世代差替・期限削除・月次利用量非返還、旧OTP文面等。

## 7. 次工程の順序

1. **tenant/SSO/DB境界**：既存draftを元にorg参照・複合FK・全repo境界を確定し、sessionからのtrusted TenantContextを作る。IAP emailやbodyのorg IDだけでは接続しない。
2. **検証環境とmigration承認**：対象を分離し、tenant DDL＋今回5表の確定DDL/ACL/台帳/復旧方法を提示。既存Productionや他レーンの番号を流用しない。
3. **実DB試験**：opt-in試験とPostgreSQL16の並行・制約・append-only・rollback・接続枯渇/復旧を確認。Memory試験で実DBの排他成功を代替しない。
4. **upload経路の接続**：既存group/transferをorg＋所有者で解決→新規署名前にreserve→bounded URL/required headers→実体size/generation確定→既存scanへgeneration付きで渡す。現在のscan APIにはgeneration連携の差分が必要なので、clean後差替の防止を含め回帰する。
5. **管理・通知・監視・削除の接続**：既存認証に管理view/増枠API・画面を接続。current admin resolver、実SMTP、job発火/failed監視、DL実測の安全なadapter、access expiryと短期署名clampを検証。
6. **共通基盤連携**：正式発注snapshotの出所・冪等ID・有効日を接続。20日締め/請求/減少予約は共通側へ委ねる。共通問い合わせへの導線は共通portal完成後。
7. 全回帰・負荷/復旧・契約運用を受入後、別承認でmain merge/Production/公開を判断する。

旧PR #4の「約1か月完成を前提とした日程リスク」はIssue #21と今回再開指示により前提を更新する。今回の部品実装をもって旧見積りを全消化済みとは扱わず、次工程の実績から残工数を再評価する。

## 8. ロールバック・引継ぎ

今回の差分は未接続で、既存worktree/Productionには影響しない。試験は実Cloud・本番DB・SMTPを呼ばない。Draft PRはコードレビュー用で商用Goではない。

将来適用後は、新規受付停止→予約/GCS/利用原簿/outboxを照合→互換版へ戻す。新規顧客データを旧tenant未対応revisionへ戻さず、usage表をDROPして復旧したことにしない。期限削除はコードを戻しても復元されない。soft-delete復元後もアクセス期限を再有効化しない。

共通基盤待ちを理由にSend全体を停止しない一方、未完了の認証やmigrationを機能flagで迂回して提供開始もしない。次の承認対象は、分離検証環境・確定tenant/usage DDL・適用/復旧手順である。
