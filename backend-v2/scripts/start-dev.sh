#!/usr/bin/env bash
# 本地开发/测试专用：启动 backend-v2（3003/8454）
# 插件包 OSS 指向本地 MinIO 模拟桶（zhuiyi_oss_mock @ 9123），与线上 rains3 生产桶完全隔离。
# 用法: ./scripts/start-dev.sh   （前台运行；Ctrl+C 停止）
set -euo pipefail
cd "$(dirname "$0")/.."

export PORT=3003
export ADMIN_PORT=8454
# ── 本地测试 OSS（MinIO 模拟桶）：发卡文件与插件包全部进本地，与线上 rains3 生产桶零交集 ──
MINIO_USER="$(docker inspect zhuiyi_oss_mock --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '/^MINIO_ROOT_USER=/{print $2}')"
MINIO_PASS="$(docker inspect zhuiyi_oss_mock --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '/^MINIO_ROOT_PASSWORD=/{print $2}')"
export CARD_REDEEM_OSS_ENDPOINT="http://127.0.0.1:9123"
export CARD_REDEEM_OSS_BUCKET="zhuiyi-local"
export CARD_REDEEM_OSS_ACCESS_KEY_ID="$MINIO_USER"
export CARD_REDEEM_OSS_ACCESS_KEY_SECRET="$MINIO_PASS"
export CARD_REDEEM_OSS_KEY_PREFIX="card-files/"
export CARD_REDEEM_OSS_PATH_STYLE=true

# 插件包专用 OSS（本地 MinIO 独立桶）：缺省回退上面配置
export LICENSE_PLUGIN_OSS_ENDPOINT="${LICENSE_PLUGIN_OSS_ENDPOINT:-$CARD_REDEEM_OSS_ENDPOINT}"
export LICENSE_PLUGIN_OSS_BUCKET="${LICENSE_PLUGIN_OSS_BUCKET:-zhuiyi-plugins-local}"
export LICENSE_PLUGIN_OSS_ACCESS_KEY_ID="${LICENSE_PLUGIN_OSS_ACCESS_KEY_ID:-$MINIO_USER}"
export LICENSE_PLUGIN_OSS_ACCESS_KEY_SECRET="${LICENSE_PLUGIN_OSS_ACCESS_KEY_SECRET:-$MINIO_PASS}"

echo "==> 本地 backend-v2: 公网 $PORT / 管理面 $ADMIN_PORT / 插件OSS $(dirname "$LICENSE_PLUGIN_OSS_ENDPOINT"):$LICENSE_PLUGIN_OSS_BUCKET"
exec ~/.nvm/versions/node/v22.20.0/bin/node --import tsx src/server.ts
