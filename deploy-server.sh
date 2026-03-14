#!/bin/bash

# CLIProxyAPI Dashboard 服务器部署脚本
# 用法：./deploy-server.sh <server-ip> [选项]
# 选项:
#   --update      更新部署（重建镜像 + 重启）
#   --api-only    仅更新 API 服务
#   --web-only    仅更新 Web 端
#   --config      仅同步配置
#   --status      查看服务状态

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查参数
if [ -z "$1" ]; then
    log_error "请提供服务器 IP 地址"
    echo "用法：./deploy-server.sh <server-ip> [选项]"
    echo "选项:"
    echo "  --update      更新部署（重建镜像 + 重启）"
    echo "  --api-only    仅更新 API 服务"
    echo "  --web-only    仅更新 Web 端"
    echo "  --config      仅同步配置"
    echo "  --status      查看服务状态"
    exit 1
fi

SERVER_IP="$1"
DEPLOY_MODE="${2:---full}"
PROJECT_NAME="cliproxyapi"
REMOTE_DIR="/opt/${PROJECT_NAME}"

# 检查配置文件是否存在
check_config() {
    log_info "检查配置文件..."
    
    if [ ! -f ".env" ]; then
        log_error ".env 文件不存在"
        exit 1
    fi
    
    if [ ! -f "config.local.yaml" ]; then
        log_error "config.local.yaml 文件不存在"
        exit 1
    fi
    
    if [ ! -f "docker-compose.yml" ]; then
        log_error "docker-compose.yml 文件不存在"
        exit 1
    fi
    
    log_success "配置文件检查通过"
}

# 检查 SSH 连接
check_ssh() {
    log_info "检查 SSH 连接到 ${SERVER_IP}..."
    
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes root@"${SERVER_IP}" "echo '连接成功'" > /dev/null 2>&1; then
        log_error "无法连接到服务器 ${SERVER_IP}"
        log_info "请确保:"
        log_info "  1. 服务器已安装 Docker"
        log_info "  2. 已配置 SSH 免密登录 (ssh-copy-id root@${SERVER_IP})"
        exit 1
    fi
    
    log_success "SSH 连接正常"
}

# 检查服务器 Docker 环境
check_remote_docker() {
    log_info "检查服务器 Docker 环境..."
    
    if ! ssh root@"${SERVER_IP}" "docker --version" > /dev/null 2>&1; then
        log_error "服务器未安装 Docker"
        exit 1
    fi
    
    if ! ssh root@"${SERVER_IP}" "docker compose version" > /dev/null 2>&1; then
        log_warning "服务器未安装 Docker Compose v2，尝试 docker-compose..."
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    log_success "Docker 环境检查通过"
}

# 本地构建镜像
build_images() {
    log_info "本地构建 Docker 镜像..."
    
    # 切换到项目根目录
    cd "$(dirname "$0")"
    
    # 构建 CLIProxyAPI 镜像
    log_info "构建 CLIProxyAPI 镜像..."
    docker build -t cliproxyapi:latest ../CLIProxyAPIPlus/
    
    # 构建 Dashboard 镜像
    log_info "构建 Dashboard 镜像..."
    docker build -t cliproxyapi-dashboard:latest ./dashboard/
    
    log_success "镜像构建完成"
}

# 传输镜像到服务器
transfer_images() {
    log_info "传输镜像到服务器..."
    
    # 保存并压缩镜像
    log_info "保存 CLIProxyAPI 镜像..."
    docker save cliproxyapi:latest | gzip > /tmp/cliproxyapi.tar.gz
    
    log_info "保存 Dashboard 镜像..."
    docker save cliproxyapi-dashboard:latest | gzip > /tmp/cliproxyapi-dashboard.tar.gz
    
    # 创建远程目录
    ssh root@"${SERVER_IP}" "mkdir -p ${REMOTE_DIR}"
    
    # 传输镜像
    log_info "上传 CLIProxyAPI 镜像..."
    scp /tmp/cliproxyapi.tar.gz root@"${SERVER_IP}":/tmp/
    
    log_info "上传 Dashboard 镜像..."
    scp /tmp/cliproxyapi-dashboard.tar.gz root@"${SERVER_IP}":/tmp/
    
    # 加载镜像
    log_info "在服务器上加载镜像..."
    ssh root@"${SERVER_IP}" "gunzip -c /tmp/cliproxyapi.tar.gz | docker load"
    ssh root@"${SERVER_IP}" "gunzip -c /tmp/cliproxyapi-dashboard.tar.gz | docker load"
    
    # 清理临时文件
    ssh root@"${SERVER_IP}" "rm -f /tmp/*.tar.gz"
    rm -f /tmp/*.tar.gz
    
    log_success "镜像传输完成"
}

# 同步配置文件
sync_config() {
    log_info "同步配置文件到服务器..."
    
    # 上传配置文件
    scp .env root@"${SERVER_IP}":${REMOTE_DIR}/
    scp config.local.yaml root@"${SERVER_IP}":${REMOTE_DIR}/
    scp docker-compose.yml root@"${SERVER_IP}":${REMOTE_DIR}/
    
    # 重命名配置文件
    ssh root@"${SERVER_IP}" "mv ${REMOTE_DIR}/config.local.yaml ${REMOTE_DIR}/config.yaml"
    
    log_success "配置文件同步完成"
}

# 生成 docker-compose.yml
generate_compose_file() {
    log_info "生成 docker-compose.yml..."
    
    cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: cliproxyapi-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: cliproxyapi
      POSTGRES_USER: cliproxyapi
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cliproxyapi"]
      interval: 10s
      timeout: 5s
      retries: 5

  cliproxyapi:
    image: cliproxyapi:latest
    container_name: cliproxyapi
    restart: unless-stopped
    ports:
      - "8317:8317"
      - "8085:8085"
      - "1455:1455"
    environment:
      - MANAGEMENT_API_KEY=${MANAGEMENT_API_KEY}
      - JWT_SECRET=${JWT_SECRET}
    volumes:
      - cliproxyapi_auths:/root/.cli-proxy-api
      - ./config.yaml:/app/config.yaml
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - frontend
      - backend
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8317/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  dashboard:
    image: cliproxyapi-dashboard:latest
    container_name: cliproxyapi-dashboard
    restart: unless-stopped
    ports:
      - "3789:3000"
    environment:
      - DATABASE_URL=postgresql://cliproxyapi:${POSTGRES_PASSWORD}@postgres:5432/cliproxyapi
      - MANAGEMENT_API_KEY=${MANAGEMENT_API_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - NEXTAUTH_SECRET=${JWT_SECRET}
      - NEXTAUTH_URL=http://localhost:3000
    networks:
      - frontend
      - backend
    depends_on:
      - cliproxyapi
      - postgres
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  docker-proxy:
    image: tecnativa/docker-socket-proxy
    container_name: cliproxyapi-docker-proxy
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - INFO=1
      - SYSTEM=1
      - TASKS=1
      - VOLUMES=1
    networks:
      - backend

  perplexity-sidecar:
    image: python:3.11-slim
    container_name: cliproxyapi-perplexity
    restart: unless-stopped
    working_dir: /app
    volumes:
      - ./perplexity-sidecar:/app
    command: >
      sh -c "pip install fastapi uvicorn perplexity-webui-scraper &&
             python app.py"
    environment:
      - PERPLEXITY_COOKIES=${PERPLEXITY_COOKIES}
    networks:
      - backend
    ports:
      - "8766:8766"

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge

volumes:
  postgres_data:
  cliproxyapi_auths:
EOF

    log_success "docker-compose.yml 生成完成"
}

# 启动服务
start_services() {
    log_info "启动服务..."
    
    ssh root@"${SERVER_IP}" "cd ${REMOTE_DIR} && ${COMPOSE_CMD} up -d"
    
    log_info "等待服务启动..."
    sleep 10
    
    # 检查服务状态
    ssh root@"${SERVER_IP}" "cd ${REMOTE_DIR} && ${COMPOSE_CMD} ps"
    
    log_success "服务启动完成"
}

# 查看服务状态
check_status() {
    log_info "查看服务状态..."
    
    ssh root@"${SERVER_IP}" "cd ${REMOTE_DIR} && ${COMPOSE_CMD} ps"
    
    log_info "查看日志（最近 20 行）..."
    ssh root@"${SERVER_IP}" "cd ${REMOTE_DIR} && ${COMPOSE_CMD} logs --tail=20"
}

# 完整部署
full_deploy() {
    check_config
    check_ssh
    check_remote_docker
    build_images
    transfer_images
    sync_config
    start_services
    
    log_success "========================================="
    log_success "部署完成！"
    log_success "========================================="
    log_info "API 地址：http://${SERVER_IP}:8317"
    log_info "Dashboard 地址：http://${SERVER_IP}:3789"
    log_info "首次访问请创建管理员账户"
}

# 更新部署
update_deploy() {
    check_config
    check_ssh
    check_remote_docker
    build_images
    transfer_images
    start_services
    
    log_success "========================================="
    log_success "更新完成！"
    log_success "========================================="
}

# 仅更新 API
update_api_only() {
    check_ssh
    
    log_info "仅更新 API 服务..."
    build_images
    
    # 只传输 API 镜像
    docker save cliproxyapi:latest | gzip > /tmp/cliproxyapi.tar.gz
    scp /tmp/cliproxyapi.tar.gz root@"${SERVER_IP}":/tmp/
    ssh root@"${SERVER_IP}" "gunzip -c /tmp/cliproxyapi.tar.gz | docker load"
    ssh root@"${SERVER_IP}" "rm -f /tmp/*.tar.gz"
    rm -f /tmp/*.tar.gz
    
    ssh root@"${SERVER_IP}" "cd ${REMOTE_DIR} && ${COMPOSE_CMD} up -d cliproxyapi"
    
    log_success "API 服务更新完成"
}

# 仅更新 Web
update_web_only() {
    check_ssh
    
    log_info "仅更新 Dashboard 服务..."
    build_images
    
    # 只传输 Dashboard 镜像
    docker save cliproxyapi-dashboard:latest | gzip > /tmp/cliproxyapi-dashboard.tar.gz
    scp /tmp/cliproxyapi-dashboard.tar.gz root@"${SERVER_IP}":/tmp/
    ssh root@"${SERVER_IP}" "gunzip -c /tmp/cliproxyapi-dashboard.tar.gz | docker load"
    ssh root@"${SERVER_IP}" "rm -f /tmp/*.tar.gz"
    rm -f /tmp/*.tar.gz
    
    ssh root@"${SERVER_IP}" "cd ${REMOTE_DIR} && ${COMPOSE_CMD} up -d dashboard"
    
    log_success "Dashboard 服务更新完成"
}

# 仅同步配置
sync_config_only() {
    check_config
    check_ssh
    
    sync_config
    
    log_info "重启服务以应用新配置..."
    ssh root@"${SERVER_IP}" "cd ${REMOTE_DIR} && ${COMPOSE_CMD} restart"
    
    log_success "配置同步完成"
}

# 主逻辑
case "${DEPLOY_MODE}" in
    --update)
        update_deploy
        ;;
    --api-only)
        update_api_only
        ;;
    --web-only)
        update_web_only
        ;;
    --config)
        sync_config_only
        ;;
    --status)
        check_status
        ;;
    --full|"")
        full_deploy
        ;;
    *)
        log_error "未知选项：${DEPLOY_MODE}"
        exit 1
        ;;
esac

log_success "操作完成！"
