# Secure Send 商用インフラ構成の比較評価

評価日：2026-10-18（日本時間）。調査・試算のみ。Production、DB、インフラ、料金設定の変更・構築はしていない。

## 経営判断サマリー

**推奨は、専用GCPプロジェクトを分離の基本単位とし、パイロットでは既存送受信を再利用するCloud Run構成を優先、将来は非同期スキャンを共通化してRun/VMを実測で選ぶ段階方式。通常VMへの移設を先に決めない。**

10社での初期採算はインフラ方式だけでは解決しない。PR #2の仮定を引き継ぐと、非同期Run・共有SQL案Cで標準10社・売上50%配分の場合、5名パックは月約11,248円の赤字、20名パックは約5,936円の赤字、50名パックのみ約47円の黒字。開発・営業費を含む前で、最後のケースにも実質的な採算余力はない。最小料金3,000円×10社から配分後に残るのは15,000円で、決済・サポートだけでも月約14,747円、固定費に回るのは約253円しかない。専用DBやVMを足して最小パックを黒字化する余地はない。

したがって「10社でも成立」は、初期赤字を明示したパイロット予算、配分対象基本料の限定、サポート分担、価格/最低契約規模、利用上限の統括判断とセットで検討する。料金・配分率は今回決めない。VM化でGCS外向き通信費は消えない。

**約1か月の候補**：B（専用project・同期clamd）を機能変更が少ない基準案とし、C（非同期Run）を比較検証する。両方を同時実装しない。共有SQLに余力と分離条件がある場合のみ暫定共有、条件を満たさない場合は専用SQL案Dを採り、初期固定費を予算化する。フル独立が提供条件なら共有SQL案を採用しない。

**本格展開**：D（専用project・非同期Run・専用Cloud SQL）を基準。scanの実測スロット時間・p95待ち時間・定義更新時メモリ・保守原価がE（Run＋VM）に有利となった場合のみworkerを交換。最終的な構成採用は大きなアーキテクチャ判断として統括へ戻す。

## 1. 基準・調査証跡・未取得事項

- Production構成の根拠はd2fdd5bのFit/Gapと既存デプロイ記録。mainの基準は9c1b002。upload/download/scan、専用GCS、共有Cloud SQL内ppap_transfer、同期scan、clean後通知を継承。
- Draft PR #2は今回fresh確認でOpen、未マージ、head caea47b7dad8efc7902ba165d74ebea7a244b2fa。前回モデルを変更せず再利用した。
- 料金モデルSHA256：5EC3E5FB05F2133D6A4E699C46AE8848BE39B27F0FC39627E3C6A8C50E4FCC90。
- 2026-10-18再試行：gcloudはローカルAppDataのlogs/credentials.dbへのアクセス拒否。ブラウザ参照は起動失敗。クラウドIAM不足を確認できたわけではない。認証情報のコピーや権限迂回はしていない。
- 直近3完了月（7〜9月）と10月部分月の請求・利用実績は引き続き未取得。取得できない項目を0や推計実績で埋めない。今回実測した性能値もない。

## 2. 現行構成から分かった原価・性能上の論点

1. ファイル本体は署名PUT/GETでGCSへ直接転送する。API基盤がRunかVMかによらず、GCS保存・操作・インターネット転送費は残る。APIとGCSへ同じ通信費を二重計上しない。
2. scanRunnerはGCSオブジェクト全体をBufferへ読み、さらにtmpへ書いてclamscanをファイルごとに起動する。ファイル容量だけでなくBuffer・tmp・エンジン・展開領域・reload時のメモリが必要。Cloud Runの書込み可能ファイルシステムはメモリへ影響するため、1GBファイルを2GiB設定へ単純に拡大できない。[S3,S8]
3. 既存scan-serverはOOM対策としてインスタンス内で直列化。20インスタンスでも同時20scanが上限の目安で、HTTP concurrencyを上げてもscan処理能力はそのまま。待機リクエスト・uploadの同期課金が増え得る。
4. scan-entrypointのfreshclamは起動時1回。min1でウォームでも定義が定期更新される根拠はない。request-basedで背景daemonが常時CPUを得るとも限らない。[S2]
5. clamscanは毎回定義ロード、clamdは常駐daemon。常駐化の速度・メモリ効果は合理的な検証候補だが、70%短縮は今回の感度仮定であって実測ではない。clamdのTCPを外部公開しない。[S3]
6. DB poolは各プロセスmax5。既存記録の各サービスmax20がすべて同時に立つと理論300接続、rolling更新や他システム分は別枠。非同期化だけで接続枯渇は解決しない。
7. groupTokenは現在の同期呼出でのみ渡され、DBにはhashだけ保存。キューにIDを積むだけでは通知リンクを後で再構成できない。暗号化通知envelope＋outboxなどの設計・権限・保持が追加で必要。
8. notified_atはSMTP成功前のclaim。再配送時の通知欠落/二重通知を防ぐoutbox、scanのlease/冪等性が必要。同期/非同期の二重発火は既存で障害実績があり、Eventarcを保険として併用しない。

## 3. 分離の意味

| 分離方式 | 分離されるもの | 残る共有・注意点 |
| --- | --- | --- |
| 専用project | IAM、service account、秘密情報、bucket、quota、請求帰属 | 物理専有ではない。課金accountや組織権限は共有し得る |
| 専用論理DB・共有SQL instance | DB権限・schema・業務データ | CPU、IO、接続上限、障害、メンテナンス、instance backupを共有 |
| 専用Cloud SQL instance | DB処理能力・接続・復旧/変更責任 | 基盤の物理サーバー専有を意味しない |
| 通常の専用VM | Secure Send専用guest OS・プロセス・disk | hypervisor/物理hostは他VMと共有し得る |
| Sole-tenant node | 指定プロジェクト群のVM用物理host | アプリ内の顧客越境は別問題。Cloud SQL/GCSまで物理専有にはならない |

Sole-tenantは専有hardware必須の契約/BYOL/監査要件が確認された場合だけ再評価する。現時点では合理的な要件がなく、ノード全体予約費と運用が増えるため数値比較・採用候補から外す。[S7]

## 4. 比較構成と評価

| 案 | 構成 | 独立性・可用性 | 性能・拡張性 | 固定/変動費・運用 |
| --- | --- | --- | --- | --- |
| A | 既存Run同期・clamscan・共有SQL | 現行依存。商用tenant境界は別途未完成 | 毎回ロード・直列scan・同期待ち | 既存予算比較用。商用Go案ではない |
| B | 専用project・Run同期・clamd・共有SQL | アプリ/保存分離、DBの障害を共有 | 常駐化で短縮候補。cold/reload検証が必要 | min1/4GiB仮定で待機費増。変更範囲小 |
| C | 専用project・Run＋Cloud Tasks・clamd・共有SQL | DB共有の例外管理が必要 | 待機をAPIから分離。再試行/速度制御 | min0仮定で固定費低減、初回遅延とoutbox追加 |
| D | C＋専用Cloud SQL、段階HA | 既存Productionから独立。region障害は残る | 接続/queue/DB能力を段階制御 | DB専用固定費増。運用はmanaged中心 |
| E | Run API＋Pub/Sub pull VM worker＋専用SQL | workerを複数zoneへ。10社1台はworker停止時待機 | CPU/定義cache制御良、実測に合わせworker増 | VM/patch/NAT/保守を追加。低負荷で不利 |
| F | VM API群＋VM scan＋自営Postgres | HAもrestoreも自社責任 | 自由度大。DB切替とOS管理が難しい | 機器料金だけで比較せず保守工数増 |

セキュリティはDが独立性とmanaged運用を両立しやすいという設計判断。VMが自動的に安全になるわけではなく、scannerへ悪性入力を処理させるguestのpatch・権限分離が必要。F単一VMへAPI/DB/scanを同居させる廉価案は、blast radius・OOM・復旧の競合から商用基準案として採用しない。

## 5. 原価の前提と計算

PR #2の価格、利用シナリオ、150円/USD、GCS通信0.12USD/GiB、保存0.025USD/GiB月の仮置き、物理21日＋仮soft delete7日、決済3.6%、サポート、共通予備費を維持した。実請求・東京見積りではない。region係数はRun1.2、VM1.25の仮定。

| 入力 | 値 | 区分 |
| --- | --- | --- |
| VM e2-standard-2参考 | 0.06701142 USD/h | 公式取得参考表。東京SKU未照合、1.25倍を仮定 |
| VM月額計算 | 9,047円/月＋disk450円 | 30日、2vCPU/8GiB相当。常駐 |
| worker通信・更新予備費 | 3,000円/fleet月 | NAT/OS更新等の仮予算。private Google access＋mirrorで削れる可能性 |
| Run clamd memory | 4GiB、1vCPU | 仮定。reloadと並列時のRSS未測定 |
| clamd scan時間 | 既存仮定の30% | 70%短縮の感度仮定。warm/定義共通 |
| async Run起動 | 20秒×max(100回, files/1000切上) | 仮定。cold p95/頻度未測定 |
| Cloud Tasks | 3 operations/file×0.40USD/百万 | 公式参考。32KB以下の小さなIDのみ、free枠除外 [S5] |
| Pub/Sub | 1KiB/件×publish/delivery×40USD/TiB | 公式参考。再配送/ack等は予備費で要較正 [S6] |
| 専用SQL固定予算 | 10/100社18,000、500社40,000、1,000社70,000円/月 | 仮定。SKU/HA/backupを含む十分性未検証 |
| 専用LB | 10社0、100社以上4,500円/月 | 仮予算。10社はrun.app＋Google SSO想定。独自domain/LBが必須なら追加 |
| VM worker能力 | 2slot、176h/月×40%稼働を容量設計 | 仮定。reload時8GiBで2slot成立をbench。HAは10社1台、以降最低2台 |
| 固定運用工数 | A〜D 2h/月、E 4h＋0.5h/追加worker、F 8/12/20/32h | 仮定。緊急対応・24h当番・開発を含めない |

専用SQL予算は専用分離の差額を評価する仮置きで、性能やHAを保証する見積りではない。PR #2の企業50円/社＋送信者2円/人の共通予備費を全案へ同額で残し、削除による見かけの改善を避けた。この予備費は従量請求ではなく、専用DB段階予算と保守的に重なる可能性があるため、実績入手後に費目を再分類する。

Bは同期・4GiB/min1の待機約5,832円/月、C/Dはmin0で待機費を外した感度比較。min0が初回待ち・可用性条件を満たさなければ、C/Dへ約5,832円/月を追加する。worker常時CPUが必要ならRun instance-basedで再見積りし、request-based背景更新を前提にしない。[S2]

### 標準20名パックを全社が利用する場合

月額税別、全社同一パックの独立比較。サポート等は固定運用＋顧客対応。初期工事費・営業費・税・事故対応を含まない。

| 案 | 社数 | 固定インフラ | インフラ総額 | サポート等 | 売上50%配分後差引 | scan VM台数 |
| --- | --- | --- | --- | --- | --- | --- |
| A | 10 | 13,999 | 18,561 | 14,667 | -10,027 | — |
| A | 100 | 13,999 | 59,613 | 74,667 | 97,720 | — |
| A | 500 | 13,999 | 242,069 | 341,333 | 576,598 | — |
| A | 1000 | 13,999 | 470,139 | 674,667 | 1,175,195 | — |
| B | 10 | 15,832 | 20,299 | 14,667 | -11,766 | — |
| B | 100 | 15,832 | 60,503 | 74,667 | 96,830 | — |
| B | 500 | 15,832 | 239,189 | 341,333 | 579,477 | — |
| B | 1000 | 15,832 | 462,547 | 674,667 | 1,182,787 | — |
| C | 10 | 10,000 | 14,470 | 14,667 | -5,936 | — |
| C | 100 | 10,000 | 54,588 | 74,667 | 102,745 | — |
| C | 500 | 10,000 | 232,927 | 341,333 | 585,739 | — |
| C | 1000 | 10,000 | 455,855 | 674,667 | 1,189,478 | — |
| D | 10 | 22,000 | 26,470 | 14,667 | -17,936 | — |
| D | 100 | 26,500 | 71,088 | 74,667 | 86,245 | — |
| D | 500 | 48,500 | 271,427 | 341,333 | 547,239 | — |
| D | 1000 | 78,500 | 524,355 | 674,667 | 1,120,978 | — |
| E | 10 | 34,497 | 38,923 | 22,667 | -38,390 | 1 |
| E | 100 | 48,493 | 92,762 | 84,667 | 54,572 | 2 |
| E | 500 | 70,493 | 291,835 | 351,333 | 516,831 | 2 |
| E | 1000 | 100,493 | 543,177 | 684,667 | 1,092,156 | 2 |
| F | 10 | 46,986 | 51,402 | 38,667 | -66,869 | 1 |
| F | 100 | 89,472 | 133,632 | 114,667 | -16,298 | 2 |
| F | 500 | 89,472 | 310,269 | 413,333 | 436,398 | 2 |
| F | 1000 | 108,465 | 550,059 | 794,667 | 975,274 | 2 |

### 10社・標準利用の人数別比較

| 案 | パック | 売上合計 | インフラ総額 | 売上50%後 | 基本料1,000円の50%後 |
| --- | --- | --- | --- | --- | --- |
| A | Starter | 30,000 | 15,515 | -15,261 | -5,261 |
| C | Starter | 30,000 | 11,502 | -11,248 | -1,248 |
| D | Starter | 30,000 | 23,502 | -23,248 | -13,248 |
| E | Starter | 30,000 | 35,978 | -43,725 | -33,725 |
| A | Business | 50,000 | 18,561 | -10,027 | 9,973 |
| C | Business | 50,000 | 14,470 | -5,936 | 14,064 |
| D | Business | 50,000 | 26,470 | -17,936 | 2,064 |
| E | Business | 50,000 | 38,923 | -38,390 | -18,390 |
| A | Business Plus | 80,000 | 24,653 | -4,199 | 30,801 |
| C | Business Plus | 80,000 | 20,406 | 47 | 35,047 |
| D | Business Plus | 80,000 | 32,406 | -11,953 | 23,047 |
| E | Business Plus | 80,000 | 44,814 | -32,360 | 2,640 |

216ケース（6構成×4規模×3パック×3利用量）の全値はCSVに保存。GCS外向き通信は前モデルと同じ単一単価の保守近似で、大量利用時のtier割引・他宛先・Range/再試行を未較正。FはHA組立費と運用を含む計画予算で、特に大規模のapp/DB台数はベンチ未検証。

### 追加固定費の読み方

専用project分離の費用を一括の「project料金」とは置かず、複製するSQL・LB・worker・秘密情報・監視・保守へ分解する。B/Cのrun.app利用はGoogle SSOが商用実装される前提で、既存社内IAPを単に外す案ではない。独自domain/WAF/既存LB同等の入口が必要なら別途LB等の予算を追加する。

共有SQLから専用SQLへの仮固定差額は、10社12,000円/月、100社はLB込み16,500円/月、500社38,500円/月、1,000社68,500円/月。これは共有費をゼロにせず6,000円/月配賦した比較。共有SQLの現金増分が小さい場合でも、共有故障・性能競合の負担を消した扱いにはしない。

## 6. 構成変更の損益分岐と改善幅

同一の4GiB/1vCPU worker、1リクエスト1slotのRun稼働費仮定は約22.03円/slot時。2vCPU/8GiB VM1台＋disk＋fleet通信の仮費用約12,497円/月との単純分岐は567slot時/月。さらに保守差分2h/月を加えると約930slot時/月。これはHAなし1VM、定義reload・Run同時処理共有効果を含めない局所比較。

2slot VMを1台で使えるか、scanのCPU比率がどの程度かで変わる。RunもconcurrencyでCPU/memoryを共有できれば単位費用が下がるため、この分岐をVM採用の確定条件にはしない。2zone最低2VMなら固定費がさらに増える。176h/月・40%余力設計では1VM合計140.8slot時しか需要を受けない想定であり、この条件のVMはコスト最適になりにくい。

| 規模・20名標準 | Bのインフラ削減 vs PR2 | Cの削減 | Dの削減 | Eの運用込み改善 |
| --- | --- | --- | --- | --- |
| 10 | -1,739 | 4,091 | -7,909 | -28,363 |
| 100 | -890 | 5,025 | -11,475 | -43,148 |
| 500 | 2,880 | 9,141 | -29,359 | -59,766 |
| 1000 | 7,592 | 14,284 | -54,216 | -83,039 |

負の改善額は費用増。大規模でもメモリ4GiB化、HA、専用DBで単純に安くならない。前モデルはscan秒が仮定であり、短縮の効果自体がまだ仮説。高位の赤字は主にGCS通信とメール/運用等も含む利用量増で、scan置換だけで解消しない。

100社・20名標準でC案はPR2から月約5,025円のインフラ予算削減、1,000社で約14,284円の削減に留まる。1,000社・20名高位ではGCS通信だけで約844万円/月（大容量tier割引前の保守近似）。インフラ全体約1,016万円/月からC案でも約998万円/月であり、利用上限なしの赤字を解消しない。

clamdが全く短縮しない感度（warmScanFactor=1）なら、C案の標準100社費用は本表より約685円/月、1,000社では約6,854円/月増える。速度仮定だけで巨額のコスト削減を作っていない。一方、前モデルのscan秒そのものが10倍なら全案を再計算しworker台数も増やす必要がある。

開発20人日×8h×4,000円＝640,000円と仮定すれば、月1,000円削減では回収640か月、月10,000円でも64か月。性能・障害対策を目的にする変更と純粋な節約施策を区別する。追加工数は後述し、試算費用へ開発償却を自動加算していない。

## 7. 大容量・利用上限

| 1送信 | 保存費（28日） | GCS DL1回 | DL3回 | 注意 |
| --- | --- | --- | --- | --- |
| 200MiB | 1円 | 4円 | 11円 | scan/通知/圧縮展開/再試行は別 |
| 1GiB | 4円 | 18円 | 54円 | scan/通知/圧縮展開/再試行は別 |

1GiBを1,000回送信し毎回3回取得すると、通信費だけで約54,000円、保存約3,500円。APIのVM移設でこれらは減らない。署名GETの発行回数3回は実GET回数3回の保証ではなく、再利用・Range・中断/再開のbytesを別計測する。

パイロットの候補は既存200MiB/file、送信合計500MiB・10file以内、月UL3/10/25GiB、月DL6/20/50GiB、月件数150/600/1,500を警告・相談閾値とし、正式な硬い停止・追加料金は統括判断。保存はリンク7日/最大14日と物理21日を区別し、soft delete/versioningとbackupの実日数を確認する。28日はモデル仮定で、実際の設定ではない。

1GiB以上へ拡大するならresumable upload、generation固定、stream→disk、展開容量/再帰/時間制限、スキャン不可状態の扱いを追加評価する。GCS resumable session URIも秘密情報として扱う。[S9]

## 8. 安全性・性能の必須受入条件

- **tenant境界**：server側Organization/Membershipから認可。全query・group/file/recipient/OTP/audit/queue/job/objectへ整合制約。prefixは配置規約であって認可そのものではない。別tenant・別owner・停止・同一利用者複数所属をAPI/実DBで否認する。
- **正規受信**：他社のTo受信者はaccount不要でOTP認可。企業間送付をtenant越境と誤って禁止しない。CCのみは取得不可。既存OTPのverified_at先行成功分岐はPR2で未解決、商用前に認証回帰が必要。
- **ファイルの同一性**：object generation、実size、content-typeを確認し、検査済みgenerationだけGETを発行。署名PUTによる検査後上書き、同名再upload、未完了残骸、取消後scan通知を拒否。
- **scan判定**：MaxFileSize/MaxScanSize/StreamMaxLength/展開limitを整合させる。上限を超えて未検査のファイルをclean扱いしない。clamd導入時は設定がserver側に移る。暗号化zip/圧縮爆弾/timeoutは「未検査・配布不可」を候補とし提供範囲を統括確認。[S3]
- **定義更新**：署名mirrorを単一updaterで更新し、version/ageを観測。request-scoped reloadかinstance-based CPUを選択。freshclam失敗時・古い定義時の配布可否、例として24h超の停止閾値を要承認。Google参照構成はmirror運用を含むが、既存Eventarcの再採用を意味しない。[S1,S2]
- **最小権限**：API、scan、notify、updaterのSAを分離。scanへ署名URL発行権や広域DB更新権を与えない。clamdはUnix socket/閉じたloopback、VMへ公開3310なし。untrusted inputをrootlessで処理、temp隔離・掃除、logへpayload/tokenを書かない。
- **DB**：5×(upload instances＋download instances＋worker processes)＋migration/ops/rolling予備をmax_connections以下へ。実上限の70%などを運用予算候補にし、queue速度とRun maxを連動。3サービスmax20で300接続の潜在値。共有SQLの場合は既存他業務分を先に控除。[S10]
- **同時利用**：scanのp50/p95/p99、peak RSS/reload RSS、CPU秒、cold start、queue待ち、署名PUT完了率、DB待ち、メール制限を測る。平均月量からピーク同時数を断定しない。

## 9. 非同期キューの選択と通知

Run workerにはCloud Tasksを第一比較候補とする。dispatch速度と同時数を制御し、OIDC・最小invoker権限を使う。HTTP handlerは最大30分なのでRunの最大60分だけを見て設計しない。timeout後も処理が動き得るためDB lease・idempotency key・generation/scan-version単位の結果を使う。[S4,S5]

VM workerは公開HTTPを作らずPub/Sub pullを候補とし、lease更新・ack前のDB確定・dead letter・再実行を設計。Cloud TasksからprivateIPのVMへそのまま届くとは扱わない。大きなファイルをqueue payloadへ入れずIDとgenerationだけにする。

既存のraw groupTokenはqueue/logへ入れない。KMS等で暗号化した通知envelopeを短期保持するoutbox、あるいは別のリンク再構成方式を統括レビューする。notify権限のみ復号、scan成功後に通知outboxを確定。SMTPはend-to-end exactly onceを保証しないためdedupeと再送記録を設ける。作成→upload→scan待ち→clean/感染/失敗→通知待ち→通知済みを明示する。キュー自体も完了状態の原簿にはしない。

## 10. 限定商用パイロットの最低構成と拡張

最低構成は、(1)専用project/SA/secret/bucket、(2)既存upload/downloadとGoogle SSO＋企業別認可、(3)閉じたscanサービスと定義更新/age監視、(4)共有例外条件を満たす専用論理DBまたは専用SQL、(5)監査/利用量/期限・削除、(6)通知失敗の再処理、(7)backup/restoreと監視通報、(8)ファイルサイズ・容量・件数の運用上限。監視やbackupを削って10社採算を成立させない。

共有SQL例外の条件は、専用DB roleで他DBアクセス不可、既存業務を控除した接続/CPU/IO予算、停止・障害責任の明示、backup復元時の他業務影響、期限を決めた分離計画をすべて確認すること。条件未確認のまま共有を推奨確定しない。B案で同期を維持するならclaim/SMTP失敗時の通知再処理とraw token保護はなお必要で、asyncだけの問題ではない。

| 段階 | 推奨する判断 | 拡張条件・復旧 |
| --- | --- | --- |
| 10社・pilot | B基準。Cは限定比較、共有SQL例外かDを統括判断 | tenant/SSO/OTP是正が先。上限を設け、営業時間対応と初期損失予算を明示 |
| 100社 | C→DへのDB分離完了を目標、async採用可否を実測で確定 | queue backlog/scan p95/SQL接続/SMTPを監視。SQL HA・PITRの要否を決定 |
| 500社 | Dでqueue/SQLの能力拡張、workerのみEも比較 | DB接続枠、監査growth、削除worker、複数zone workerを負荷試験 |
| 1,000社 | D/EのTCO・実性能で選択。必要なら顧客群のshard | 災害復旧、送信制限、地域障害/大量利用の試験。台数を社数だけで固定しない |

目標候補はpilot RTO4h/RPO24h、展開時RTO1h/RPO15分。ただし保証ではなく契約判断前の演習目標。SQL HAはregional耐障害でありbackup・誤削除・region災害の代替ではない。taskを失ってもDB/outboxから再構成、未検査配布をfail closed、削除はobject実体・metadata・queue/outbox・backup残存期限を分けて記録する。

region障害の別region復旧/backupコピーを正式採用する場合、追加保存・転送・復旧演習費が必要で今回予算には確定計上していない。VM snapshotだけではPostgresの整合復旧を保証しない。FはWAL/PITR・replication・failover・restoreを自社で検証する責任が増える。

## 11. 工数と1か月への影響

既存商用化P0（13〜20人日）は未完了の前提。以下は概算追加工数で、共通項目を案ごとに重複加算しない。

| 作業 | 追加目安 | 条件 |
| --- | --- | --- |
| 専用project/IAM/secret/bucket/CI設計・検証 | 3〜5人日 | 既存資産再利用。構築は今回未実施 |
| clamd・streaming・定義mirror/age gate・bench | 4〜7人日 | 1GiB化は含めない。既存scan判定回帰を含む |
| async/outbox/通知token保護/再試行/画面待ち | 6〜10人日 | Bでは後工程、C/D/Eで必要 |
| 専用Cloud SQL移行・backup/restore | 3〜5人日 | migration/backfill/rollback検証を含む |
| VM worker/MIG/patch/network/運用 | 追加4〜7人日 | EはDからworker交換の差分 |
| 自営Postgres/HA/restore | 追加8〜15人日以上 | F。DB運用の既存資産があっても別検証 |

1か月内にtenant分離・Google SSO・権限・監査と、専用化・async・VM・大容量化をすべて同時に完了する計画はリスクが大きい。B案でもP0との合計は20〜32人日程度になり得る（重複分は詳細化が必要）。実測1〜2日で優先度を絞り、PIRA提案日と外部商用Goを同一にしない。未達項目を縮めたふりをせず統括へ日程リスクを戻す。

## 12. 採用しない構成と理由

- **現行そのまま外部販売**：tenant境界・OTP・定義更新・運用条件が未解決。
- **単一VMへ全機能＋DB同居**：OOM/scan負荷で送受信とDBが共倒れ。backup・patch・restoreを追加すると節約効果が不明。
- **最初からVM fleet/自営DB全面移行**：月額の節約根拠がなく、追加工数と保守が1か月目標を圧迫。
- **Sole-tenant**：物理専有が必要な契約等の根拠がない。顧客間認可を置き換えない。
- **Eventarc＋同期scanの二重経路**：既存障害の再発を避け、移行時にtriggerの正を一つにする。
- **fileごとのRun Job/Spot VMのみ**：cold/定義ロード・中断・通知遅延の検証が必要。大容量専用queueや将来burst枠の後工程候補に留める。
- **GCSをVM diskへ全面置換**：通信費が無料になるわけではなく、容量/耐久/backup/認可/可用性を失いやすい。

## 13. 移行手順（未実行）

1. read-only evidenceと匿名集計で現revision、DB ledger、bucket設定、実原価を固定。機能・tenant・OTP・scanの受入テストを先に定義。
2. 採用案、共有SQL例外、提供範囲、初期損失、RTO/RPO、増分費用・復旧手順を統括承認。検証環境用の構築とDB migrationは各々の承認対象。
3. 専用projectの検証環境へ既存image/設定を再現。専用SA/DB資格/secret/bucketを使い、Productionの通知先やobjectへ接続しない。
4. 共有SQL利用なら専用role/論理DB、connection上限・負荷隔離を確認。専用SQLなら新DBへ必要データだけ移行し、原則pilot新規顧客から始める。
5. Bはscan常駐化/定義更新を試験。C以降はoutbox・raw token保護・通知/再試行・generation固定を試験。旧同期triggerを無効化してから新queueへ一本化する手順を検証。
6. 合成ファイルのbench、別tenant否認、感染/未検査/古い定義/SQL断/worker断/SMTP失敗/削除の試験。scan1slot→2slotはpeak RSSとreloadを見て判断。
7. 限定顧客でE2E後に承認を得て公開。既存社内Productionは維持し、pilot用domain/認証/client IDを明示。
8. rollbackは新規受付停止→queue drain/lease失効→DB/outbox/通知整合確認→互換revisionへ戻す。新データを旧版へ無条件接続せず、発行済みリンクの宛先・鍵・objectを保持して受信継続または失効を判断。

## 14. 実測取得を再開するための具体的手順

### まずユーザーが通常のPowerShell/Cloud Consoleで確認

今回のエラーはCodex実行領域がローカル認証DBへ書けないことによる。ユーザーの通常端末で既存ログインを使う。サービスアカウントkeyやaccess token、DB/SMTPパスワードをこちらへ渡さない。gcloud auth print-access-token、secret versions access、環境変数全出力は不要。

添付のcollect-secure-send-readonly.ps1は3サービスの非秘密メタデータ、SQLのtier/backup設定、bucket policy設定のみを取得しローカルファイルへ保存する。クラウド変更、IAM変更、object列挙、ログ本文やDB行の取得はしない。失敗時はそこで止め、API有効化や再認証を自動実行しない。

### 必要な閲覧権限

| 対象 | 必要なアクセス | 注意 |
| --- | --- | --- |
| 請求account全体 | Billing Account Viewer roles/billing.viewer | 付与は管理者判断。請求変更権限は不要 |
| 特定project費用 | billing.resourceCosts.getを含む既存閲覧権限 | Project Viewerは広い。scope限定custom roleを優先。projectCostsManagerは設定管理も含むため安易に追加しない [S11] |
| 既存BQ請求export | dataset dataViewer＋query project jobs.create | 既存exportだけ照会。query scan費用を抑制。新exportは別途変更承認 [S12] |
| Run/SQLメタデータ | run.services.get/list、cloudsql.instances.get | run.viewer/cloudsql.viewer等の範囲を管理者確認。DB SELECT権限とは別 |
| GCS設定 | storage.buckets.get | objectViewerやfile downloadは不要。bucket設定に限定 |
| 集計metrics | monitoring.timeSeries.list等 | monitoring.viewer相当。Logging本文やprivate logs閲覧を要求しない |
| DB匿名月次集計 | 対象テーブルの必要列SELECT/read-only transaction | PR2の集計SQLをユーザー側で実行。認証情報や生行は送らない |

Billing ConsoleのReportsで2026-07-01〜09-30と10月部分月を別に、project=msp-zabbix、service/SKU別にCSVを取得。gross usage/cost、credits、net cost、currencyを残す。resource帰属がなければCloud Run service別billable time/GCS bucket bytesと照合して推計配賦し、プロジェクト全額をSecure Sendへ配賦しない。SSO spike別projectは開発費として別掲。

請求Reports CSVにはservice別集計しかない場合があり、SKU/使用量/credit/資源帰属はCost tableまたは既存Detailed Billing Exportで補う。Cloud Billing APIのaccount listだけで過去使用明細は取得できない。exportが未設定でも今から全過去期間が遡及できるとは約束しない。

最低限ほしいmetricsはRunのbillable instance time/CPU-memory/request count/startup/concurrency、GCSのmonthly sent bytes/object bytes/operations、SQL CPU/IO/disk/connections、SMTP送信制限と運用工数。ログが未保存なら過去のp95/同時ピークを復元した扱いにしない。

## 15. 次の承認事項・残存リスク

今回の推奨は評価案であり、構築指示ではない。統括へ戻すのは、(1)B/Cのpilot候補と共有SQL例外、(2)専用DBによる初期固定費増、(3)async token/outboxのアーキテクチャ、(4)価格/配分/上限、(5)1か月目標と商用Goの条件。

費用未実測、東京SKU未照合、scan速度/RSS未測定、SMTP能力未検証、認証/tenant分離未完成、署名URLと実GETの量差、削除/backup/監視/復旧未検証が残る。10社での全売上50%配分黒字を前提にインフラを選ばない。

## 出典（2026-10-18確認）

- [S1] Google malware scanning reference architecture: https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage
- [S2] Run billing settings: https://docs.cloud.google.com/run/docs/configuring/billing-settings
- [S3] ClamAV scanning: https://docs.clamav.net/manual/Usage/Scanning.html
- [S4] Run request timeout: https://docs.cloud.google.com/run/docs/configuring/request-timeout
- [S5] Tasks pricing/HTTP limits: https://cloud.google.com/tasks/pricing / https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
- [S6] Pub/Sub pricing: https://cloud.google.com/pubsub/pricing
- [S7] VM tenancy: https://docs.cloud.google.com/compute/docs/instances/about-vm-tenancy
- [S8] Run memory: https://docs.cloud.google.com/run/docs/configuring/services/memory-limits
- [S9] Resumable uploads: https://docs.cloud.google.com/storage/docs/resumable-uploads
- [S10] Run→SQL: https://docs.cloud.google.com/sql/docs/postgres/connect-run
- [S11] Billing view permissions: https://docs.cloud.google.com/billing/docs/how-to/reports / https://docs.cloud.google.com/billing/docs/how-to/custom-roles
- [S12] Billing export: https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery
- VM reference pricing: https://cloud.google.com/products/compute/pricing/general-purpose
- Run/GCS reference pricing: https://cloud.google.com/run/pricing / https://cloud.google.com/storage/pricing
- Soft delete: https://docs.cloud.google.com/storage/docs/soft-delete

## 検証記録

216ケースの収支整合を自動検証。Aの36ケースがPR #2の結果と一致することを確認。原価モデルの数式・構成・料金設定は変更していない。B〜Fは性能/価格仮定の計算であり、実環境benchを実施した結果ではない。RTO/RPO・HA・DB予算・VM台数は未検証の計画値。
