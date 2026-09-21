#!/usr/bin/env bash
# 宿主机一键上传文件到本地 OSS 模拟服务（tests/oss-mock）。
# 用法: ./tests/oss-mock/upload.sh <本地文件> [对象key]
# 前提: docker compose 里的 oss_mock 服务已启动。
set -euo pipefail

FILE="${1:?用法: $0 <本地文件> [对象key]}"
KEY="${2:-$(basename "$FILE")}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ABS_FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
case "$ABS_FILE" in
  "$REPO_ROOT"/*) REL="${ABS_FILE#"$REPO_ROOT"/}" ;;
  *) echo "错误: 文件必须在仓库目录内（容器只挂载了仓库根目录）。请先复制进仓库，例如: cp \"$FILE\" \"$REPO_ROOT/\""; exit 1 ;;
esac

exec docker run --rm --network zhuiyi_default \
  -v "$REPO_ROOT:/repo" \
  -e OSS_MOCK_ENDPOINT=http://oss-mock:9000 \
  -w /repo/backend-v2 \
  node:22-alpine node ../tests/oss-mock/upload.mjs "/repo/$REL" "$KEY"
