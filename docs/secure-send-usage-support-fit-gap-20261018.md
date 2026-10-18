# Secure Send：利用制限・通知・共通問い合わせ Fit/Gap

2026-10-18 JST。要件承認後の設計調査。判定は **CONDITIONAL FIT** を維持する。実装・migration・環境構築・Production変更は行っていない。

## 判断

既存のGCS直接転送、OTP、To/CC、ClamAV、期限・回数制限、監査を再利用できる。追加要件は既存方式で実現可能だが、企業単位の正確な容量管理と共通問い合わせの認証連携は新規開発である。

容量は「企業・期間・プラン版」に属する利用枠として扱い、送信前に予約し、GCSが確認した実サイズで確定する。上限到達は送信機能の制限状態とし、企業・利用者の停止状態に置き換えない。これにより既存ファイルの受信と問い合わせを継続する。

共通問い合わせは一つのフォームと簡素な社内受付台帳を候補とする。Sales Toolsの受付・一覧UI、FACTACTの監査・排他・再実行、InfraVisionのセッションから企業を解決するパターンを移植する。診断Case、既存顧客テーブル、DB、セッションCookieを共用しない。設置先・認証接続方式は実装前の承認事項であり、今回の推奨を構成採用とは扱わない。

今回要件の開発・検証は **18〜28人日**。既存テナント／SSO統合等の未完了を含む再編成案は **30〜46人日**（環境構築が未済なら別途3〜5人日程度、非同期scan方式への転換は含まない）。1名・約1か月で全項目の商用受入まで完了すると約束できない。これは統括へ戻す重大な日程リスクである。

## 1. 基準・完了済み・未完了

| 正本／状態 | SHA・参照 | 確認結果 |
| --- | --- | --- |
| Send remote main | `9c1b00230f5efe6ddbae2b8c3ef5e7d0f87787b7` | 今回fresh read。既存送受信の基準 |
| Send商用化Fit/Gap PR #1 | `d2fdd5b7015be4a3967e900f66c0e46a884d019d` | 未merge。CONDITIONAL FIT、P0/P1を継承 |
| Send原価・構成 PR #3 | `74facb2fd202b697f288701bca670f7bc70c86b5` | 未merge。2026-10-18取得済み構成・請求・監視証跡を再利用 |
| ローカルtenant基礎 | `d6b51e1c1bc2f7979edd636d6603599180b63b0f` | `feat/secure-send-tenant-foundation-20261017`、clean。認可関数・5件テスト・strict型検査の既存記録あり。API/DB/SSO/GCSには未接続 |
| Sales Tools main | `d35581cec3dbc7d4ca2938f2a9c664906ccc5316` | 今回fresh read。受付、管理UI、staff認証、監査／leaseの実装を確認 |
| InfraVision portal main | `54124300f2b246aab5e8d0c355a7c899b11aa19e` | 今回fresh read。顧客セッション→customerRepoという信頼境界を確認 |
| Corporate Issue #16／#17 | 共通台帳／料金原則 | サービスDB・認証は独立。共通企業IDで外部参照。台帳の実装先は未決定 |
| Corporate Issue #15 | Guardポータル | 後工程チェックポイント。顧客ポータル・権限連携の完成実装ではない |
| Corporate PR #18 | `60243f3d2bd174ab61b6c4bf43c1d736cfc262ab` | C-40/C-50原価試算を履歴として参照。今回容量条件で再計算した結果ではない |

Send remoteの公開branch／PRにtenant基礎の実装は存在せず、ローカル作業をProduction実装済みとは扱わない。今回はその作業ツリーを変更していない。

Productionの直接再照会・DB ledger取得は今回行っていない。構成の正本はPR #3に固定された2026-10-18 05:59 JSTのユーザーread-only採取証跡等。GCSはDelete age21日＋soft delete7日、SQL backup設定は有効という既存確認を再利用し、現在状態や復元成功を新たに確認したとはしない。Sales Toolsの036はコード上存在するが、適用済みledgerを今回検証したとは扱わない。037以降など他レーンと競合し得る番号は採番しない。

## 2. 承認済み条件と残る定義

| 条件 | 今回の扱い |
| --- | --- |
| 送信者1名あたり月5GB相当、企業で共有 | 承認済み。プラン設定のbytes/送信者×期間の対象送信者数＋有効な追加容量で算定 |
| 保存標準7日 | **候補**として登録。確定済み最大保存期間や完全消去期限へ読み替えない |
| 80%で顧客管理者へ通知 | 承認済み。閾値・宛先ポリシー・重複抑止を設定可能にする |
| 100%で新規送信制限、既存受信継続 | 承認済み。新しい容量予約を止め、受信のOTP・clean・宛先・期限・回数制限は維持 |
| 追加容量 | 当初手動受付可。設定増枠は担当者・理由・有効期間・受付番号を監査。追加価格は未決定 |
| DL通信量異常 | 検知対象。警告と人の確認を候補とし、自動受信停止・自動課金は追加承認なしに行わない |
| 共通問い合わせ | 企業・契約はログイン由来。対象サービス／種別／内容／返信先、atLIBの受付番号／担当／状態／履歴 |

実装契約で確認する定義は次のとおり。承認済み5GB・80/100%方針を再審議するものではない。

- GBのbyte定義：UIは通常のdecimal GB（1GB=1,000,000,000bytes）を提案するが、GiBと混在させず契約表示と一致させる。
- 月の境界：JST暦月か契約更新月か。期間開始／終了をUTC時刻で保存し、どのタイムゾーン規則から生成したか保持する。
- 枠の元となる人数：契約上の送信者枠か、有効送信者の実人数か。既存`countActiveSenders`は技術上の定義であり、容量付与の商用定義として未決定。期間スナップショット＋変更履歴で、停止／再有効化による枠の繰り返し獲得を防ぐ。
- 計上点：GCS受入完了の実bytesを推奨。感染・送信取消・再送・失敗の扱いは明文化する。感染削除してもインフラ費用は発生する。削除で月間累計を自動返還しない案を提案するが正式決定は別途。
- 保存7日の起点と最大値：group作成／upload完了／通知のどれか、リンク有効期間との関係、削除後保持・backupの説明。
- 追加容量の価格・失効・翌月繰越、80%通知の再通知規則、DL異常の数値・期間、問い合わせ本文の保持期間・返信運用。

例えば対象送信者が5／20／50名なら企業枠は25／100／250GB。人数の定義確定前の説明例であり、料金パックや契約を確定するものではない。

## 3. Fit/Gapと再利用範囲

| 要件 | 実装証跡 | 判定／差分 |
| --- | --- | --- |
| 大容量の直接送受信 | Send `storageService.ts`、`uploadRoutes.ts` | FIT。ただし現在は申告size上限のみで、署名PUTが同じbyte数を強制していない |
| 正確な月間容量 | `transfers.size_bytes`は入力値。complete時metadataは監査detailへ記録 | GAP。実size・generationを台帳へ確定し、二重completeを冪等化する |
| 同時送信の上限 | 企業／期間の原子集計なし | GAP。DB容量予約。インメモリrate limitは容量上限に転用しない |
| プラン設定 | ローカルdraft `plan_versions`はsender_limitのみ | PARTIAL。容量・保持・通知と共通料金プランへの参照をversion化し、送信時スナップショットへ解決する。料金算定の正本は共通台帳に残す |
| 7日の標準期限 | `config.ts`はdefault7、max14（コード既定値） | PARTIAL。企業別プラン参照と、実オブジェクト削除との整合が必要。Production実値と混同しない |
| 80%通知 | SMTP Mailer、groupの`notified_at`あり | PARTIAL。顧客admin解決・閾値越え・durable outbox・retryは新規。既存の単一日時だけでは再送保証にならない |
| 既存ファイル受信継続 | `downloadRoutes.ts`のOTP／clean／期限／回数 | FIT。送信quotaをdownload認可へ追加しない。回数判定と増分が分離しており競合試験は別途必要 |
| DL通信異常 | auditのdownloadedは署名URL一覧発行イベント | PARTIAL。DL完了・実転送byteとは異なる。URL再利用を考慮した計測が必要 |
| 問い合わせ受付UI | Sales Tools `businessWebConsultationLead.ts`、管理一覧・詳細 | PARTIAL。入力検証／冪等受付／UIは再利用。現状は見込客の公開申込で、契約顧客の認可ではない |
| 受付担当・履歴 | 既存lead repoにstatus、FACTACTにaudit | PARTIAL。担当・状態遷移・内部メモ・受付番号・append-only履歴は新ドメイン |
| 顧客企業・契約の特定 | Portal `middleware/auth.ts`／`customerRepo.ts` | パターンFIT。既存customerIdやCookieを共有せず、Secure Servicesの対応付けへ移植 |
| 監査・並行処理 | FACTACT `diagnosisPreparationRepo.ts`のtx／FOR UPDATE／SKIP LOCKED／lease | パターンFIT。AI Case状態やテーブルは転用しない |
| 保持削除worker | 旧PR #1は`retentionDeletionWorker.ts`に言及 | 今回Sales Tools main treeに同名ファイルなし。旧ローカル資産のSHA未固定なので、再利用済みとは数えない。削除証跡・再実行の思想のみ継承 |

Sales Toolsの公開受付は通知を`Promise.allSettled`で送っており、永続的な通知再送キューは確認できない。問い合わせや80%通知へそのままコピーすると「受付だけ成功して通知が落ちる」状態が残る。FACTACTの排他・lease設計を参照した新しいoutboxを作り、workerは期限付きclaim、再試行、最終失敗、手動再送を持つ。Cloud Runのプロセス内timerだけに頼らず起動保証のある実行契機を設ける。SMTP受領後のプロセス停止まで含む完全な一度きり配送は保証せず、at-least-onceと重複抑止・記録で運用する。

## 4. 容量制御の設計案

1. サーバーがsessionから企業・所属・送信権限を解決し、対象group所有権とプラン版・期間を確認する。bodyの企業IDを信用しない。
2. 同一transactionで企業／利用期間行をlockし、`消費確定＋予約中＋今回予約 <= 有効枠`を検証。成立時に予約とtransferを作る。groupの作成・ファイル数にも別の設定上限を適用し、空group乱造を防ぐ。
3. commit後に、予約bytesに拘束された署名付きupload権限を発行する。現行のcontentTypeのみのPUTでは不足。正確なlengthとcreate-only条件を拘束できるPUT方式を検証し、不適合なら署名POST policyのcontent-length-range等を比較する。単なる事後metadata確認だけで「クラウドへの超過uploadを予防済み」とは扱わない。
4. completeは保存オブジェクトの企業／group／予約／generationを照合。実sizeを確認し、同一予約・generationの確定は一度だけ。予約を実消費へ振り替え、状態・利用イベント・閾値outboxを同一DB transactionで確定する。scanは固定したgenerationに対して行い、clean確認後の上書きで差替できないようにする。
5. 中断・期限切れ予約は署名URL／upload権限の失効とGCS実体の照合後に解放。DBの予約時刻だけで早期解放しない。署名URL発行失敗・complete欠落・イベント重複・DB復旧でもreconcileできるようにする。DB/GCSは一つのtransactionにはならないため、状態機械と照合ジョブが必要。

予約が枠を使い切ると後続の新規予約は拒否する。既に容量を確保したuploadは完了可能とする案を推奨する。80%通知は消費確定の閾値越えを基準とし、予約中は画面上で別表示する。大きなuploadで80%から100%を一度に跨いだ場合は、通知レコードを冪等作成し、顧客には到達状態が分かる一通へまとめる方針を候補とする。

100%制限中でも、既存groupの受信・OTP・To/CCルール・期限・回数制限・scan条件を維持する。再送・新ファイル追加・期限延長を使った迂回は許可しない。容量追加後の解除は履歴付きの枠再計算で行い、自動課金や無断プラン変更にはしない。プラン縮小で消費が枠を超えた場合も既存ファイルを消さず、新規予約だけを止める。

## 5. 保存・削除とDL異常

リンクの失効とGCSの削除、soft deleteの保持、DB監査・問い合わせの保存は別の期限である。今回確認した設定証跡はlive21日＋soft delete7日。7日を採用しても、既存bucket全体のlifecycleを短縮して既存利用者のファイルを削除しない。

新規商用ファイルにプラン版と`access_expires_at`／`delete_after`を保存し、認可時は期限を厳守、短期DL署名の有効期間も残存期限以内にする。削除workerはorg＋object＋generationを一致確認して削除し、失敗・再実行・削除確認日時を保存する。GCS lifecycleは漏れ防止の補助とする。soft deleteを維持する場合は7日削除後も保持・課金が残るため「7日で完全消去」と表示しない。restoreやDB復旧で期限切れファイルを公開状態へ戻さない。

Google公式：署名URLは保有者が有効期間中に利用できる。アプリでquotaや回数を止めても発行済みURL自体を一度きりに変えるものではない。現行`downloaded`イベントをbytes完了実績として積算してはいけない。

- 最小案：署名URL発行時の対象ファイル合計bytesと発行頻度を「推定」として記録し、企業別に異常を検出する。絶対bytes／期間、upload比率、直近基準からの増加、クールダウンを設定値とする。実転送ではないことを画面にも表示。
- 併用：bucket／サービスの実測転送メトリクスで全体急増を監視し、scanの内部読み出しと外向け通信を分離できる範囲を確認する。全体メトリクスだけでは企業帰属できない。
- 必須の検証：同じ署名URLの繰り返し取得を全体監視が検出できるか。企業別実bytesが必要ならGCSアクセス観測とorg/object/generation対応の安全な集計を追加する。raw URL、OTP、ファイル名・内容・宛先をメトリクスlabelへ入れない。
- 最初は警告・人の確認。自動で既存受信を止める構成は今回承認の対象外。実通信の企業別厳密計量・即時課金・download proxy全面移行は最小パイロットの追加前提にしない。ただし異常検知自体を省かない。

Google公式参照（2026-10-18確認）：

- https://docs.cloud.google.com/storage/docs/access-control/signed-urls
- https://docs.cloud.google.com/storage/docs/authentication/signatures （policyのcontent-length-range）
- https://docs.cloud.google.com/storage/docs/lifecycle （設定変更の反映遅延、Delete条件）
- https://docs.cloud.google.com/storage/docs/soft-delete （削除後の不可読・保持・課金）

## 6. 共通問い合わせの最小構成

共通フォームは一つとし、利用者が自由に企業名や契約IDを申告して認可する方式にはしない。ログイン主体のissuer/subjectと有効な所属から共通企業IDを解決し、Guard／Sendの契約一覧から対象サービスを選択する。複数企業所属の場合は、サーバーで認可済みの企業だけを切り替えられる。

入力は対象サービス、問い合わせ種別、本文、返信先。返信先はログインの確認済み連絡先を既定とし、任意変更を許可するなら検証・承認・機微情報の返信制限を設ける。受付は返信先変更に失敗しても別企業へ付け替わらない。添付ファイル、顧客向けチケット一覧・コメント画面、SLA自動判定は最小案に含めない。

atLIB画面は受付番号、企業、対象サービス、種別、担当、状態（未対応／対応中／顧客確認待ち／完了等の候補）、作成・更新日時、内部履歴を表示する。受付番号は一意だが認可秘密にはしない。status・担当更新と履歴を同一transactionで保存し、本文・内部メモを一般アクセスログや通知へ複製しない。通知メールには受付番号・対象サービス・管理画面リンクを中心にし、本文・OTP・顧客ファイルを入れない。返信は当初既存業務メールで手動可とする提案で、送受信メールの自動取り込みは範囲外。対応内容・日時・担当を台帳に記録する。

### 認証・設置先のFit/Gap

| 候補 | 影響・判断案 |
| --- | --- |
| Secure Services用の小さな共通受付・台帳モジュールを分離配置 | 第一候補として見積り。既存Productionを守り、Guard/Sendは外部IDで対応付ける。新しい設置先・認証接続は統括承認が必要 |
| Sales Tools本体へ公開受付／共通顧客認証まで直接追加 | UI再利用は可能だが、社内staff認証と外部顧客認証、公開ルート、共通DB・migration・deployの影響が広い。今回無条件採用しない |
| Guard／Sendにそれぞれ独立した問い合わせ・管理画面 | 初期実装は容易でも、二重顧客台帳・履歴分散・二つのフォームになるため最終案にしない |

Issue #16の全請求管理や大型CRMを先に完成させる必要はない。最小の共通企業ID・サービス契約対応・有効所属を用意し、契約登録・同期は当初atLIBが手動で確認可能とする。料金計算・請求の複製はしない。

サービスから共通受付へ移る場合は、短寿命・audience限定・一回使用の認証引継ぎ等を比較し、送り元サービスをバックエンドで認証して企業・所属を再照合する。queryのcustomerIdや未検証ヘッダ、メールドメイン一致だけを信用しない。Cookieや署名鍵の共有を必須にしない。Guardには完成した顧客SSOがまだないため、この接続を「既存ログインにリンクを付けるだけ」とは見積もらない。

Sales Toolsの共通KPI画面をトップとする既存Decisionは変更しない。ここで提案するのは契約者の問い合わせ入口と運用台帳であり、別のKPIポータルを作る決定ではない。将来Sales Toolsから管理導線を付ける場合も別承認の最小差分とする。

## 7. 必要なDB変更案（DDL・migration未作成）

### Secure Send専用DB

| 論理テーブル／既存変更 | 主な項目・制約 |
| --- | --- |
| `plan_versions`／assignmentの拡張 | sender_limit、bytes_per_sender_period、単位、period_policy、retention_default/max、80%等の閾値、DL警告ポリシー、effective_from/to。版は不変、未設定を無制限と扱わない |
| `organization_usage_periods` | org、期間開始/終了、プラン版、対象送信者数と根拠、base/extra/effective_limit、consumed/reserved bytes。org＋期間の一意性、非負CHECK、競合ロック |
| `upload_reservations` | org、期間、group/transfer、予約bytes、実bytes、object/generation、状態、期限、idempotency key。orgを含む複合FKと一意キー |
| `usage_events` | 予約・確定・解放・訂正のappend-only原簿、event key、原因予約、実測/推計区分。集計表と照合・再構築可能にする |
| `quota_adjustments` | org、契約/期間、追加bytes、有効期間、理由、承認者/操作者、受付参照。二重適用防止。請求額ではない |
| `notification_outbox` | org、期間、通知種別/threshold、dedupe key、state、attempt、retry_at、lease、宛先解決参照、配送結果。本文・連絡先の保持を最小化 |
| `download_usage_observations` | org、観測区間、対象object参照、推定発行bytes/観測bytesの種類、ソースevent key。請求確定や実DL完了と混同しない |
| `deletion_jobs`と既存transfer/groupの拡張 | org、policy_version、期限、delete_after、generation、試行・確認日時・失敗理由。削除と利用量累計を分離 |
| 既存group/transfer/recipient/OTP/audit | tenant基礎案のorg参照・複合FK・sender_user_idを先行。全repoはtrusted org必須。今回quotaだけ付けても越境対策完了にはならない |

物理テーブルの分割・共通outbox化は詳細設計で整理可能。既存監査との統合はイベント意味と権限を確認して行う。実サイズ・容量の累計はBIGINT等で保持し、JSONやJavaScript numberとの安全な変換範囲も検証する。

### 共通受付・台帳の独立したデータ境界

| 論理テーブル候補 | 内容 |
| --- | --- |
| `service_customers`／`service_contract_bindings` | 共通企業ID、Guard/Send、外部org/contract ID、有効期間、状態、登録根拠。Issue #16実装時に二重正本を作らずadapter／移管する |
| `customer_identity_memberships` | issuer/subjectから共通企業への認可済み対応。既存Send usersそのものを移動しない |
| `support_requests` | UUID、受付番号、共通企業/契約、対象サービス、種別、本文、requester、検証済み返信先、担当、状態、version、作成日時。tenantを含むidempotency一意キー＋payload hash |
| `support_events` | 担当・状態・返信記録・内部メモの履歴。support_id＋企業の複合FK、actor、旧/新状態、時刻、追記のみ |
| `support_notification_outbox` | 受付確認／社内通知の再送状態。共通DB境界内で受付と原子的に生成し、Send DBを直接更新しない |

共通台帳と各サービスDBの間にDB外部キーや広いread権限を張らず、明示的な外部参照＋API/adapterで連携する。メール一致だけで企業統合しない。新規履歴表ではruntimeのUPDATE/DELETEを明示REVOKEし、実効権限を検証する。Sales Tools 036の教訓どおり、狭いGRANTだけで過去のdefault ACLを打ち消したと思い込まない。

## 8. 必須受入・回帰試験（今回未実行）

| 区分 | 必須ケース |
| --- | --- |
| 越境否認 | A/Bのgroup・予約・利用量・問い合わせID差替、admin/member/停止、同一ユーザー複数所属。署名URL・通知・scan・DB更新の副作用も起きない |
| 容量・並行 | 79.9→80%、99→100%、残量不足、N並行upload、同時増枠/seat変更、二重complete、異なるpayloadで同じ冪等キー、月跨ぎ・期間帰属・JST境界 |
| upload実体 | 申告小/実体大、署名再利用・上書き、generation差替、clean後差替、中断/complete欠落、予約失効直前upload、GCS成功/DB失敗と再実行 |
| 制限範囲 | 100%で新規送信だけ拒否、予約済み完了の扱い、既存正規ToはOTP受信成功、CC・他group OTP拒否、期限・回数・感染・取消維持、問い合わせ入口が使える |
| 通知 | 80/100を一度に跨ぐ、再実行/worker二重起動、宛先変更/admin不在、SMTP失敗/受領直後停止、retry上限とatLIB通知。メール停止でも容量判定は正確 |
| 保持削除 | 新規7日期限・既存期限維持、署名URLを期限以内に制限、削除失敗/再実行/404/generation不一致、soft-delete・backup残存、復元後の非公開維持 |
| DL異常 | 発行推計と実bytesを区別、署名URL再利用・Range/再試行、scan読み出し混入、全体転送急増と企業帰属の限界、警告の重複抑止 |
| 共通問い合わせ | 未ログイン、別企業/未契約サービス指定、引継token再利用/期限/audience、CSRF・Origin・XSS・本文長・spam制限、重複受付/返信先改竄、担当競合、内部履歴の顧客非公開 |
| 障害・権限 | DB unavailable時に新規送信をfail closed、既存受信への不要なquota依存なし、outbox/削除lease回収、最低権限、履歴変更拒否、復旧後のquota/outbox照合 |

停止企業／ログイン不能者の問い合わせ経路は別途運用定義が必要で、外部未認証の経路から企業情報を開示する抜け道を作らない。送信quota100%は所属停止ではないので通常問い合わせを利用可能とする。

## 9. 工数と約1か月のパイロットへの影響

1人日を実働1日としての概算。実装前の調査に基づく範囲で、確定見積ではない。

| 今回の要件パッケージ | 人日 | 範囲 |
| --- | --- | --- |
| 設定契約・期間/枠・DB設計 | 2〜3 | byte単位・枠人数・snapshot・migration案 |
| 容量予約/確定・GCS制約 | 2〜4 | 二重処理・失敗回収・署名方式の検証 |
| 通知outbox・利用状況表示 | 2〜3 | 80/100%、顧客admin宛、retry/運用 |
| 期限・削除整合 | 2〜3 | プラン別期限、削除worker、証跡 |
| DL異常の最小監視 | 2〜3 | 発行推計＋全体実測、警告、再利用URL検証 |
| 共通問い合わせ最小版 | 5〜8 | 最小企業/契約対応、認証引継、フォーム、atLIB台帳、担当/状態/履歴 |
| 結合・越境・復旧の受入 | 3〜4 | 上記を横断したE2E・障害回復 |
| **今回要件合計** | **18〜28** | 各行固有の実装試験は各行に含み、横断受入を別計上 |

既存Fit/GapのP0 13〜20＋P1 6〜10には利用量・警告・保持等が含まれるため、今回18〜28を丸ごと足さない。再編成の目安は次のとおり。

| 再編成した全体WBS | 人日 |
| --- | --- |
| tenant/複合FK・全API境界・顧客SSO/管理者（未接続部分） | 10〜14 |
| 今回要件パッケージ | 18〜28 |
| 上記に含まないbackup復元/既存障害手順・残存運用確認 | 2〜4 |
| **再計画の全体目安** | **30〜46** |

ローカルの認可関数だけを根拠にtenant/SSO統合工数を完了控除しない。専用検証環境の構築が未済なら従前構成調査の3〜5人日程度を別途確認する。専用環境、非同期scan化、共通受付の配置・既存管理画面配線には重複の可能性があるため実装計画確定時に照合する。

### パイロットの最低範囲

tenant/SSOの安全性、企業共有枠の原子的な制限、80%通知・失敗通報、100%時の受信継続、期限/削除確認、DL急増検知、一つの問い合わせフォームとatLIB担当/状態/履歴を受入対象とする。追加容量は手動、契約対応の登録は手動、返信は既存業務メール＋記録でよい。高度な顧客チケットUI、自動課金、追加容量購入UI、共通請求システム全体、DL通信の厳密リアルタイム課金は後工程とする。

1名なら30〜46営業日の目安で約1か月を超える。統括判断の候補は、境界を固定してtenant/quotaと共通受付を別担当で進めること、またはPIRA提案と商用利用開始の時期を分けることである。2名なら単純に半分ではなく、認証/DB契約・結合受入・環境承認がクリティカルパスとなる。安全試験を削って日程を合わせる提案はしない。既存開発レーンの停止・担当変更は今回実行していない。

## 10. migration・配置・切戻しの影響

今回はDDLを実行可能なmigrationとして作らず、番号も予約しない。次の承認資料で環境ID、DDL、影響表、所要時間、lock、backfill、権限、照合SQL、適用ledger、復旧手順を提示する。

- 専用検証環境：additive表＋fixtureで競合/E2E、追加設定版の有効化をリハーサル。既存社内Productionは触らない。
- 既存データ接続が必要になった場合：孤立参照と件数確認→org参照の段階追加→backfill照合→複合制約→旧API閉鎖の順。既存migrationを書き換えたり、推測で再実行しない。
- 新規データが入る前の検証切戻し：旧revision/設定へ戻し、不要fixtureのみ削除可能。新規本番データ投入後は新表をDROPしない。
- quota有効化後の切戻し：新規受付を止め、予約・GCS・使用原簿・outboxを照合。tenant/quotaを理解しない旧版へtrafficを戻して新規送信を再開しない。互換版で既存受信を維持し、必要なら新規送信は保留する。
- retention短縮後：削除はrevisionを戻して復元できない。既存objectを対象外とし、新規契約から適用すること、soft delete復元権限/費用・復元しても期限を再有効化しないことを承認時に示す。
- 共通受付：署名鍵・Cookieを共有せず、受付UI/APIとDB境界を分ける。配置案がSales Tools同居へ変更されるなら同サービスのmigration/deploy直列化・no-traffic確認・回帰を別途見積もる。

## 11. 統括への判断・次の承認

1. 今回18〜28／全体30〜46人日の再計画に対する人員・開始範囲・商用開始日の扱い。
2. 共通受付・最小契約対応の設置先と認証引継方式。全サービスDB・認証の統合は前提としない。
3. 容量のbyte単位、対象人数・期間・計上点・増減ルール、7日の起点/最大値/削除後保持。追加料金の必要な判断は統括へ戻す。
4. 新条件の原価再評価。PR #18の高利用上限はUL1GiB/DL2GiB/送信者月、保存費は21＋7日仮定だった。5GB共有枠・7日候補・DL異常監視は新条件であり、旧損益分岐55/62社などを新条件の採算保証に転用しない。今回料金や配分率を変更しない。
5. 実装の承認→検証DB migration/検証環境構築の承認→Production変更の承認→商用公開の承認をそれぞれ影響・復旧方法付きで行う。今回の要件承認だけでこれらを実施しない。

次に承認を受ける単位は「最小実装範囲・配置/認証接続案・設定契約」であり、Production作業ではない。未確定の料金・契約処理や大きな構成変更は統括の判断に残す。
