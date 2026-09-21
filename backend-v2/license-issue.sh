#!/usr/bin/env bash
# 本地一条命令签发编排卡密（AgentDeck Pro）
# 用法:
#   在线激活码: backend-v2/license-issue.sh [--count 2] [--name "编排模式 Pro"] [--days 30]
#   离线凭据:   backend-v2/license-issue.sh --offline --device <DEVICE_ID> [--days 365] [--to "张三"] [--out /path/to/license.lic]
# 安全设计：强制使用本地 Docker MySQL，绝不触碰生产配置。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOCAL_DB="mysql://zhuiyi:local-mysql-only@127.0.0.1:3337/zhuiyi_blog"

docker exec zhuiyi_mysql mysqladmin ping -h 127.0.0.1 -uzhuiyi -plocal-mysql-only --silent >/dev/null 2>&1 || {
  echo "错误: 本地 MySQL 未启动，请先 docker compose up -d db" >&2
  exit 1
}

SECRET="$(grep -E '^CARD_REDEEM_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '\"' || echo "local-card-secret-not-for-production-2026")"

exec env \
  NODE_ENV=development \
  DATABASE_URL="$LOCAL_DB" \
  LICENSE_KEY_SECRET="$SECRET" \
  npx tsx scripts/seed-license-keys.ts "$@"
