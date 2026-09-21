#!/bin/bash

# 流量链路服务器与节点监控脚本 (Traffic Nodes Monitor)
# 用于监控 4台服务器 + 1台数据库 的仿真集群链路
# 输出日志到 /logs 目录

LOG_DIR="$(dirname "$0")/../logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/traffic_monitor_$(date '+%Y%m%d').log"

echo "=================================================================" | tee -a "$LOG_FILE"
echo "               流量链路服务器监控 (Traffic Nodes Monitor)               " | tee -a "$LOG_FILE"
echo "=================================================================" | tee -a "$LOG_FILE"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
echo "-----------------------------------------------------------------" | tee -a "$LOG_FILE"

# 获取容器状态
function get_container_status() {
    local container=$1
    local status=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null)
    if [ -z "$status" ]; then
        echo -e "\033[31m不存在 (Not Found)\033[0m"
    elif [ "$status" == "running" ]; then
        echo -e "\033[32m运行中 (Running)\033[0m"
    else
        echo -e "\033[31m$status\033[0m"
    fi
}

# 检查 HTTP 健康状态
function check_http_health() {
    local endpoint=$1
    local status_code=$(curl -o /dev/null -s -w "%{http_code}" --max-time 3 "$endpoint")
    if [ "$status_code" == "200" ] || [ "$status_code" == "404" ] || [ "$status_code" == "403" ] || [ "$status_code" == "429" ] || [ "$status_code" == "304" ]; then
        echo -e "\033[32m正常 (HTTP $status_code)\033[0m"
    elif [ "$status_code" == "000" ]; then
        echo -e "\033[31m无法连接 (Connection Refused)\033[0m"
    else
        echo -e "\033[33m异常 (HTTP $status_code)\033[0m"
    fi
}

# 检查 TCP 端口连通性 (用于代理)
function check_tcp_health() {
    local endpoint=$1
    local host=$(echo "$endpoint" | awk '{print $1}')
    local port=$(echo "$endpoint" | awk '{print $2}')

    # 使用 nc (netcat) 测试 TCP 端口是否开启
    if nc -z -w 3 "$host" "$port" 2>/dev/null; then
        echo -e "\033[32m正常 (TCP Port Open)\033[0m"
    else
        echo -e "\033[31m无法连接 (Port Closed)\033[0m"
    fi
}

# 检查 MySQL 健康状态
function check_mysql_health() {
    local container=$1
    if docker exec "$container" mysqladmin ping -h 127.0.0.1 -uuser -ppassword --silent > /dev/null 2>&1; then
        echo -e "\033[32m正常 (Ready)\033[0m"
    else
        echo -e "\033[31m无法连接 (Not Ready)\033[0m"
    fi
}

# 获取资源使用率
function get_stats() {
    local container=$1
    local stats=$(docker stats --no-stream --format "{{.CPUPerc}} CPU | {{.MemUsage}}" "$container" 2>/dev/null)
    if [ -z "$stats" ]; then
        echo "N/A"
    else
        echo "$stats"
    fi
}

# 节点配置与检查逻辑 - 适配最新的 docker-compose.mock-cluster.yml 拓扑
NODES=(
    "1. 香港动态前端节点|zhuiyi_mock_hk_frontend|http|http://127.0.0.1:8080/"
    "2. 北京只读静态站节点|zhuiyi_mock_bj_static|http|http://127.0.0.1:8081/healthz"
    "3. 北京后端业务服务|zhuiyi_mock_backend|http|http://127.0.0.1:3001/api/v1/health"
    "4. 海外受控出站代理|zhuiyi_mock_proxy|tcp|127.0.0.1 8443"
    "5. MySQL数据库|zhuiyi_mock_db|mysql|zhuiyi_mock_db"
)

for node in "${NODES[@]}"; do
    IFS='|' read -r name container type endpoint <<< "$node"

    echo -e "\033[36m➤ $name\033[0m" | tee -a "$LOG_FILE"

    # 状态
    c_status=$(get_container_status "$container")

    # 去除颜色代码以写入纯文本日志
    c_status_plain=$(echo "$c_status" | sed -E "s/\\033\[[0-9]+m//g")
    echo "  容器状态: $c_status"
    echo "  容器状态: $c_status_plain" >> "$LOG_FILE"

    if [[ "$c_status" == *"运行中"* ]]; then
        if [ "$type" == "http" ]; then
            h_status=$(check_http_health "$endpoint")
        elif [ "$type" == "tcp" ]; then
            h_status=$(check_tcp_health "$endpoint")
        elif [ "$type" == "mysql" ]; then
            h_status=$(check_mysql_health "$container")
        fi

        r_stats=$(get_stats "$container")
    else
        h_status="\033[31m未知 (Unknown)\033[0m"
        r_stats="N/A"
    fi

    h_status_plain=$(echo "$h_status" | sed -E "s/\\033\[[0-9]+m//g")

    echo -e "  服务连通性: $h_status"
    echo "  服务连通性: $h_status_plain" >> "$LOG_FILE"

    echo -e "  资源消耗: $r_stats\n"
    echo -e "  资源消耗: $r_stats\n" >> "$LOG_FILE"
done

echo "=================================================================" | tee -a "$LOG_FILE"
echo "提示: 如需持续实时监控，可执行: watch -n 2 ./tests/monitor_traffic_nodes.sh"
echo "日志已保存至: $LOG_FILE"
