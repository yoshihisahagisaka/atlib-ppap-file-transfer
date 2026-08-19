#!/bin/sh
set -e

# 定義ファイルをコンテナ起動時に更新する(失敗してもビルド時に取り込んだ定義でスキャンを続行する)。
# サービスは常駐するため、リクエストの都度ではなく起動時1回のみ実行する。
freshclam || echo "freshclam update failed; continuing with bundled definitions"

exec node dist/scan-server.js
