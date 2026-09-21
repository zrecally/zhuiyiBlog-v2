#!/usr/bin/env bash
# 本地一条命令发卡：给 OSS 模拟桶中已有对象生成卡密。
# 用法: backend-v2/card-issue.sh --key "<对象key>" --name "<产品名>" [--code <卡密>]
#       不带 --code 时自动按规则生成。
# 安全设计：无论 .env 写了什么，本脚本强制使用本地 Docker MySQL 与本地 OSS，
# 绝不触碰 .env 中指向生产 PolarDB-X 的 DATABASE_URL。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOCAL_DB="mysql://zhuiyi:local-mysql-only@127.0.0.1:3337/zhuiyi_blog"
LOCAL_OSS="http://127.0.0.1:9123"

# 前置检查：本地依赖没起就快速失败，避免半途写库。
# MinIO 就绪即视为 OSS 可用（S3 协议，与生产雨云 ROS 相同链路）。
curl -fsS --max-time 3 "$LOCAL_OSS/minio/health/live" >/dev/null || {
  echo "错误: 本地 MinIO($LOCAL_OSS)未启动，请先 docker compose up -d oss_mock" >&2
  exit 1
}
docker exec zhuiyi_mysql mysqladmin ping -h 127.0.0.1 -uzhuiyi -plocal-mysql-only --silent >/dev/null 2>&1 || {
  echo "错误: 本地 MySQL 未启动，请先 docker compose up -d db" >&2
  exit 1
}

# CARD_REDEEM_SECRET 必须与后端容器一致（容器从 backend-v2/.env 读取），否则 digest 对不上。
SECRET="$(grep -E '^CARD_REDEEM_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '\"')"
if [ -z "$SECRET" ]; then
  echo "错误: backend-v2/.env 缺少 CARD_REDEEM_SECRET" >&2
  exit 1
fi

exec env \
  NODE_ENV=development \
  FEISHU_DATA_ENV=Test \
  FEISHU_ALLOW_LEGACY_BLANK_ENV=false \
  DATABASE_URL="$LOCAL_DB" \
  CARD_REDEEM_ENABLED=true \
  CARD_REDEEM_SECRET="$SECRET" \
  CARD_REDEEM_MAX_FILE_BYTES=1073741824 \
  CARD_REDEEM_FILE_DIR=cache_data/card-files \
  CARD_REDEEM_OSS_ENABLED=true \
  CARD_REDEEM_OSS_ENDPOINT="$LOCAL_OSS" \
  CARD_REDEEM_OSS_ACCESS_KEY_ID=local-mock-key \
  CARD_REDEEM_OSS_ACCESS_KEY_SECRET=local-mock-secret \
  CARD_REDEEM_OSS_BUCKET=zhuiyi-card-local \
  CARD_REDEEM_OSS_KEY_PREFIX=card-files/ \
  CARD_REDEEM_OSS_REGION=us-east-1 \
  CARD_REDEEM_OSS_PATH_STYLE=true \
  npx tsx scripts/seed-card-redeem-oss.ts "$@"
