# 企業管理者向け履歴閲覧・CSV出力：Fit/Gap・実装・第3工程への引継ぎ

## Canonicalと権限の継承

Issue7、main `9c1b002`、Draft PR5 `e87727a`、PR6 `287c4a9`をfresh確認。ローカルbase `b58db05`はPR6と同一tree。既存のaudit.html/audit.js、auditLogRoutes/AuditLogRepo、TransferRepo、tenantAuthorization、IAP middleware、運用デプロイ手順を確認した。第3工程に関して確認できたGit資産はPR6のDDL依存・preflight・Runbookであり、別の第3工程branch/PRや実DB適用記録は今回の確認範囲にはなかった。既存記録を継承し、実適用済みとは推測しない。

社内版は監査用IAP backendへのpath振分と管理者限定policyでaudit.html/audit.js/api/audit-logsを制限する。アプリの既存auditLogRoutes自体はuserEmailを確認して全体直近200件を読むため、そのまま商用にmountしてはいけない。社内管理者のメールアドレスを商用admin allowlistとして移植しない。

商用版はPR6の既存`Membership.role='admin'`と`assertCustomerAdmin`を再利用。新Roleを設けず、SSOのserver-side principalを使用する。一般sender/member、inactive/invited/suspended、組合ユーザーに企業全体の閲覧/出力を付与しない。送信権限canSend=falseのadminも監査可能。新規送信quotaとは独立する。

## Fit/Gapと今回の最小差分

| 項目 | 既存Fit | Gap / 今回の差分 |
| --- | --- | --- |
| 履歴 | transfers / transfer_groups / recipients、sender履歴API | sender履歴は本人限定のまま。adminの自社全員分だけ別queryで既存tableを読む |
| 監査 | audit_logs、既存監査画面/API・event code | 全体listRecentは商用に使わず、tenant-scoped readerを追加 |
| Role | 社内版は監査用IAP、商用版はPR6 admin | 商用admin認可を再利用し、query直前に同一DB transactionでactive組織/user/admin所属を再確認・shared lock |
| 期間 | timestampは既存保存あり | UTCのfrom以上to未満。UIは日本時間の開始日〜終了日当日を含む指定から変換 |
| CSV | 未実装 | 正規化HistoryRow→CSV writer、UTF-8 BOM/CRLF/quote/formula neutralize、件数/byte/期間上限 |
| Excel | 未実装 | 同じHistoryRowを使うwriter拡張点まで。xlsx生成は未実装、format=xlsxは拒否 |
| 出力監査 | audit_logsにevent TEXT、detail JSONB、親IDはnullable | 既存tableへhistory_exportedイベント追加。tenant/user/range/kind/rowCount/state=generatedを記録。出力内容の二重保存なし |
| 大量出力 | queue未実装 | 初期は同期・上限超過を413で拒否し、期間分割へ案内。黙って切り詰めない。非同期job/GCS成果物は後続設計のみ |

今回追加した部品は`historyExport.ts`、`historyExportRoutes.ts`、既存商用compositionへの接続、既存audit画面に追加する`history-admin.js`。legacy IAP API/認可構成は維持し、商用時は既存global queryを利用しない。一般送信者向け履歴の権限を拡張していない。既存audit.jsの値差し込みはtextContentへ変更し、記録値をHTMLとして解釈しない。

## フィールドの意味と欠損

| 出力候補 | 正とする既存データ | 意味・補完しない事項 |
| --- | --- | --- |
| 記録日時 | transfers.created_at / audit_logs.created_at | 送信一覧の期間は作成日時、監査の期間はイベント日時。アップロード確定日時も別列 |
| 送信者・To/CC | t.sender_email、g.sender_email、transfer_group_recipients.kind/email | 取得時点の保存値。歴史的な宛先snapshotや送信者氏名を捏造しない |
| ファイル名・容量 | original_filename / size_bytes | pendingは申告値。旧社内版のsize_bytesも実測確定値とは限らないため「記録容量」と表示 |
| 状態・期限・取消 | transfers.status、g.expires_at/revoked_at | 現在保存されている状態。監査発生当時の状態を復元したとは表現しない |
| DL回数・最終日時 | g.download_count、event=downloadedのgroup監査日時 | **受信用URL発行のグループ単位記録**。ファイル実取得・完了・個別ファイルDL回数・実egressとは異なる |
| 送信/グループ/監査ID | t.id、g.id、a.id | 送信行は最初のuploaded監査IDがある場合のみ。全監査IDは監査CSVを参照。group監査のfilenameはNULLのまま |
| actor | audit_logs.actor | recipient/system/user ID/email等の保存値。顧客の実名に変換しない |

NULLは空欄で出力し、0や成功を代入しない。監査detailのraw JSON、OTP/hash/token、signed URL、object path、scan出力、IPアドレス等はCSVに含めない。送信履歴と監査ログを別種別の出力にして、group監査をファイル数分に増幅しない。

## APIと画面

- `GET /api/audit-logs?kind=transfers|audit&from=<UTC ISO>&to=<UTC ISO>&offset=0&limit=100`：企業admin専用。上限200件/page、同じ正規化行とhasMore。既存商用session middlewareでtenantを確定。
- `POST /api/audit-logs/export`：bodyはkind/from/to/format=csvのみ。未知key（organizationId等）を拒否。既存同一Originチェックとrate limitを使用する。添付CSV、no-store、nosniff、X-Audit-Id。CSRF対策のあるPOSTを使用し、URLに顧客ID/メール/秘密値を含めない。
- UIは既存/audit.htmlを再利用。商用/api/sessionの既存role判定後、期間・種別・表示・次の100件・CSV出力を追加。実際の認可は必ずAPI/DB側。legacyの/api/session=404時だけ従来表示へ戻る。403/401をlegacy表示へfallbackさせない。
- エラー：認可403、入力400、上限413、監査書込み失敗/SQL等500。csv以外は未対応として400。xlsxボタンは未提供。

設定：SEND_EXPORT_MAX_DAYS（既定90）、SEND_EXPORT_MAX_ROWS（10000）、SEND_EXPORT_MAX_BYTES（10485760）。技術的な安全上限であり、料金・契約容量・保持期間ではない。送信枠の5GB等を変更しない。CSV日時はUTC。UIの日付は日本時間で変換する。

## tenant境界と監査

送信queryはt.organization_idとg.organization_idの一致を必須にし、同一企業の他sender分だけをadminに返す。監査queryはtransfer/groupの両方をserver側tenantで検証し、片方が他企業・親ID不一致の場合は除外する。顧客への表示をメール一致で広げない。

親IDが両方NULLの操作ログは、serverが書くhistory_exportedかつdetail.organizationIdが自社と一致するものだけを許可する。他イベントに任意JSONのorganizationIdがあっても認可の根拠にしない。旧データや親削除で企業帰属を確定できない監査は除外し、その限界をUI/Runbookに明記する。削除後も全監査のtenant帰属を永続保証する要件を追加する場合は、audit_logsのorganization_id等のDDL設計・backfillを別途審議し、実適用前に個別承認が必要。

read・CSV生成・出力監査をREPEATABLE READ transaction内で処理し、最新admin所属のshared lockを保持してcommitする。権限変更との競合でDBが失敗した場合は出力しない。監査のstateはgeneratedであり、ユーザーが保存/開封したことを保証しない。監査のcommit前にCSV本体を返さない。client切断後に生成済み監査が残ることはある。

初期版は一時ファイル/GCSへの保存をせず、上限付きメモリ生成→添付応答。サーバー成果物の保持・削除jobを新設しない。非同期版は必要性・実測を確認後、期限/暗号化/tenant再認可/成果物削除・job監査まで設計する。

## 検証と第3工程の継続

追加試験はCSV数式/制御文字/quote/日本語BOM、期間/欠損、admin/member/no-seat/停止、DB上の権限変更、tenant付きquery、矛盾参照の除外条件、出力監査失敗、件数/byte上限、ページング、HTTP/unknown key、csvのみ許可を対象にする。DB query-port試験は実PostgreSQLでの越境否認をPASSに置換しない。

第3工程の既存preflightを継承して、`scripts/validation/secure-send-preflight.cjs`を追加した。専用環境変数だけを読み、localhost/127.0.0.1、DB名末尾commercial_usage_testを強制し、接続query overrideを拒否する。BEGIN READ ONLYでledger/columns/constraints/indexes/集計件数/帰属不明監査件数とdraft DDL hashを収集する。顧客値・秘密・.envは読まず、CREATE/ALTER/UPDATE/DELETE/DROPやrunner実行を含めない。

`test/commercialUsage.postgres.test.cjs`の承認後に実行する既存fixtureに、A/B企業・矛盾するtransfer/group監査・親のない監査・出力監査・DB上のadmin降格を追加した。実DB試験のコードは準備済みだが、今回実行していない。preflightは現在roleのSELECT/INSERT/UPDATE/DELETE権限のメタデータも読むが、権限変更はしない。

今回の実DB接続先は指定されていないためpreflightはSKIP。既存gcloud認証領域のアクセス拒否を回避したり、Production資格情報をコピーしたりしない。実ledger、適用済みDDL、role/ACL、backfill可否、EXPLAIN、lock性能は未確認。前工程のbackup/restoreとtenant→connection→usageの承認gateを維持する。

**Export固有の新規migrationは今回追加していない。** 既存audit_logs.eventはTEXTで新イベントを格納できる。ただし商用tenant列等はPR6の未適用draftに依存し、商用APIを実環境で使える状態にはしていない。実DBでの追加indexやtenant監査列が必要になれば、影響・復旧・ledger採番を提示して個別承認を得る。SQL queryの実行・ロール競合とプランは未検証であり、公開ゲートにする。

実DB承認後の追加必須試験：A社admin/A社sender/B社admin/停止/権限降格、両親IDの矛盾・片親削除・NULL tenant・同一メール異企業、0件/上限境界、同時exportと所属変更、期間JST月境界、出力監査とCSV件数一致、index/メモリ/statement timeout、旧社内IAP画面と送受信回帰。ブラウザでのCSV保存・Excelによる日本語/セル解釈確認も未実施（SKIP）。

```powershell
npm run build
npm run typecheck:commercial
npm run test:commercial
npm run test:commercial:connection
npm run test:commercial:export
node --check public/upload/audit.js
node --check public/upload/history-admin.js
# 専用LOCAL検証DBの接続先を明示した場合だけ、読み取り専用preflight。
# 通常DATABASE_URL/Production .envは使わない。秘密値を履歴・Gitへ残さない。
node scripts/validation/secure-send-preflight.cjs
# 未設定時はSKIP・exit 3。DB適用成功と扱わない。
```

実migration、DB作成、Cloud/IAP/GCS変更、Production、main merge、商用公開は今回行わない。初回接続後も実DDL適用前のユーザー承認で必ず停止する。
