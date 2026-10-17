# Secure Send Production構成のfresh確認

2026-10-18 05:59 JST、ユーザーの通常PowerShellからread-only取得。Codexから認証DBへのアクセスは引き続き拒否されるため、ユーザー側の取得ファイルを読み取った。

証跡は `docs/evidence/20261018-config/` の5 JSON。顧客ファイル・宛先・OTP・secret値・DB行・ログ本文は含まない。請求/使用実績の取得ではない。

## 確認できた構成

| 対象 | 確認値 |
| --- | --- |
| upload traffic | ppap-upload-service-00022-5jq 100% |
| download traffic | ppap-download-service-00008-f96 100% |
| scan traffic | ppap-virus-scan-00014-7z2 100% |
| 3サービス共通 | maxScale20、containerConcurrency80、timeout300秒、startup CPU boost=true |
| scan | minScale1 |
| upload/downloadのminScale | 取得したrevision annotationsに明示値なし。service-level設定は未取得で、必ず0とは断定しない |
| SQL | PostgreSQL16、db-f1-micro、ASIA-NORTHEAST1、ZONAL、PD_SSD10GB |
| SQL backup | enabled=true、30世代保持、PITR=true、transaction log保持7日、log storage=CLOUD_STORAGE |
| GCS | ASIA-NORTHEAST1、STANDARD、lifecycle Delete age21日、soft delete604800秒=7日 |
| GCS IAM方式 | uniform bucket level access=true、public access prevention=inherited |

## 評価の更新

1. **共有DBの規模が判明**。db-f1-microの既存共有instanceを商用100〜1,000社の基盤として無検証で継続する案は採用できない。Cloud SQLのshared-coreはSLA対象外と公式に記載されている。専用DB化または共有instanceの能力増強を実測・費用・既存業務影響で判断する。増強は既存業務に影響するProduction変更として別途承認が必要。
2. **バックアップ設定は有効**。以前の「backup設定未確認」はこの範囲で解消。ただしbackupの実行成功、復元時間、PITR演習、バックアップのアクセス/保存場所、削除要求時の残存日数は未確認。ZONALをHA構成とは扱わない。
3. **21日＋7日の保存課金仮定に設定根拠**。PR2/インフラ比較で使用した28日相当の定常課金日数は概ね設定と整合する。ただしlifecycle処理遅延や早期感染削除、実物理保存期間の平均は未測定。bucket versioningの状態は今回の出力にないため未確認。
4. **scanのHTTP同時処理数と実処理能力は別**。HTTP80に対してコードはinstance内scan直列。最大20instanceの設定から同時1600scanと解釈しない。timeout300秒に対するqueue待ち/p95/RSS/同期待ち課金を確認する。
5. **公開禁止の有効性は未確定**。public_access_prevention=inheritedは親policyを確認しないとenforcedと断定できない。UBLA=trueだけでもprivateを証明しない。既存調査の非公開記録と今回の設定確認を区別し、IAM/親policyの有効状態は未確認として残す。

## 取得漏れと追加手順

初回取得スクリプトの配列projection指定が不十分で、Run CPU/memory/resourcesがJSONに出ていない。CPU/memory、cpu-throttling/billing mode、service-level min/max、billable instance timeは未確認。値がないことを既定値や0と解釈しない。

修正版 `collect-secure-send-resources-readonly.ps1` はcontainers配列をflattenしたうえでresourcesだけを出力する。環境変数は出力しない。resource項目が空ならファイル保存前に停止する。

スクリプトのあるフォルダで、通常PowerShellから以下を実行する。実行ポリシーで止まる場合のみプロセス限定の指定を使う。恒久ポリシーは変更しない。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\collect-secure-send-resources-readonly.ps1 -OutputDirectory C:\atlib\secure-send-resources-20261018
```

請求実績は別途Cloud Billing Reports/Cost table/既存BQ exportから、7〜9月＋10月部分月を区別して取得する。今回SQLの小さいtierが判明しても、前回のDB配賦予算6,000円を実測値に書き換えない。

## 追加確認：2026-10-18 06:03 JST

修正版による3 JSONを `docs/evidence/20261018-config/` に追加した。

| サービス | CPU上限 | メモリ上限 |
| --- | --- | --- |
| upload | 1000m = 1 vCPU | 512Mi |
| download | 1000m = 1 vCPU | 512Mi |
| scan | 1000m = 1 vCPU | 2Gi |

前回の原価モデルのCPU・memory仮定は現在構成と一致。構成の仮定が確認済みに変わっただけで、請求額・CPU利用率・稼働時間・scan秒が実測されたわけではない。cpu-throttlingの明示値は取得annotationsにないため、課金SKU/billing modeの照合は残す。初回配列projection漏れは解消。

次の `collect-secure-send-metrics-readonly.ps1` はMonitoring APIへGETのみを行い、対象3サービス・専用bucket・共有SQL instanceの時間単位の数値集計を保存する。対象は2026年7〜9月＋10月部分月。既存gcloudログインのaccess tokenをプロセス内だけで使用し、ファイル保存・出力・共有はしない。secret、object、Logging本文、DB行を取得しない。SQLは共有instance全体でありSecure Sendへの無条件配賦は不可。GCS送信bytesはscan/internal readを含み得るため、そのままInternet課金量とは扱わない。空データを0としない。

76件の有限クエリをオフラインmockで検証し、tokenが出力ファイルへ残らないことを確認。実APIでは未実行。401/403時は途中集計を保存して停止し、API有効化やIAM変更をしない。Monitoringの既存閲覧権限が必要。SQL集計と請求CSVは別途取得する。

## 参照URL

## Monitoring初回取得の結果と修正（06:08 JST）

初回のMonitoring取得では19 scope/metricのすべてがDescriptorUnavailableOrUnsupported、HTTP400。timeSeries取得には到達しておらず、利用実績は取得できていない。最終「completed」表示を成功と解釈してはならない。

指標名のslashをget resource pathにencodeする方式を廃し、metricDescriptors.listのexact-match filterへ変更。HTTP400時はAPI error messageのみを記録して最初の失敗で停止する。完了表示はCollected/NoData件数へ変更し、実データ0件なら明示する。修正版はURI/filter形式を確認するmockで76クエリを検証したが、実APIの成功は再取得待ち。

再取得は既存の失敗結果を保全するため別ディレクトリへ保存する。クラウド設定変更はしていない。

## 追加参照URL

- 実設定：同ディレクトリの5 JSON。
- Shared-coreのSLA： https://docs.cloud.google.com/sql/docs/postgres/instance-settings
- gcloud projection： https://docs.cloud.google.com/sdk/gcloud/reference/topic/projections
- metricDescriptors.list： https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.metricDescriptors/list

Production/DB/インフラ/料金は変更していない。新しい構成情報で評価根拠を更新した段階で、原価確定・商用Goではない。
