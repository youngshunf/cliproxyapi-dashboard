#!/bin/bash
# CLIProxyAPI Dashboard — Deploy from source (feature/i18n-all-pages branch)
# Usage:
#   ./deploy.sh local          — Build & deploy locally (docker compose)
#   ./deploy.sh <server-ip>    — Build locally, push image, deploy to remote server

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[DEPLOY]${NC} $1"; }
ok()  { echo -e "${GREEN}[  OK  ]${NC} $1"; }
warn(){ echo -e "${YELLOW}[ WARN ]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"
IMAGE_NAME="cliproxyapi-dashboard"
IMAGE_TAG="i18n"
FULL_IMAGE="$IMAGE_NAME:$IMAGE_TAG"
COMPOSE_FILE="docker-compose.local.yml"
REMOTE_USER="root"
REMOTE_DEPLOY_DIR="/opt/cliproxyapi"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    echo "Usage: $0 <local|server-ip>"
    echo ""
    echo "  local         Build & deploy locally via docker compose"
    echo "  <server-ip>   Build, export, scp, deploy on remote server"
    exit 1
fi

# ============================================================
# Step 1: Build Docker image from source
# ============================================================
build_image() {
    log "Building dashboard image from source..."
    cd "$DASHBOARD_DIR"

    BRANCH=$(git branch --show-current)
    log "Current branch: $BRANCH"

    docker build \
        --build-arg DASHBOARD_VERSION="i18n-$(git rev-parse --short HEAD)" \
        -t "$FULL_IMAGE" \
        -f Dockerfile \
        .

    ok "Image built: $FULL_IMAGE"
}

# ============================================================
# Step 2a: Local deploy
# ============================================================
deploy_local() {
    log "Deploying locally..."
    cd "$SCRIPT_DIR"

    # Stop existing dashboard
    docker compose -f "$COMPOSE_FILE" stop dashboard 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" rm -f dashboard 2>/dev/null || true

    # Temporarily patch compose to use our image
    local TMP_COMPOSE="/tmp/cliproxyapi-compose-i18n.yml"
    sed "s|image: ghcr.io/itsmylife44/cliproxyapi-dashboard/dashboard:latest|image: $FULL_IMAGE|g" \
        "$COMPOSE_FILE" > "$TMP_COMPOSE"

    docker compose -f "$TMP_COMPOSE" up -d

    ok "Dashboard deployed locally!"
    log "Access: http://localhost:3000"
}

# ============================================================
# Step 2b: Remote deploy
# ============================================================
deploy_remote() {
    local SERVER="$1"
    log "Deploying to $SERVER..."

    # Export image
    local TAR_FILE="/tmp/${IMAGE_NAME}-${IMAGE_TAG}.tar"
    log "Exporting image..."
    docker save "$FULL_IMAGE" -o "$TAR_FILE"
    ok "Image exported ($(du -h "$TAR_FILE" | cut -f1))"

    log "Compressing..."
    gzip -f "$TAR_FILE"
    TAR_FILE="$TAR_FILE.gz"
    ok "Compressed ($(du -h "$TAR_FILE" | cut -f1))"

    # Upload
    log "Uploading to $SERVER..."
    ssh "$REMOTE_USER@$SERVER" "mkdir -p $REMOTE_DEPLOY_DIR"
    scp "$TAR_FILE" "$REMOTE_USER@$SERVER:$REMOTE_DEPLOY_DIR/"
    ok "Image uploaded"

    # Copy config files
    log "Syncing config files..."
    local REMOTE_COMPOSE="$COMPOSE_FILE"
    # Patch image reference before uploading
    local TMP_COMPOSE="/tmp/cliproxyapi-compose-remote.yml"
    sed "s|image: ghcr.io/itsmylife44/cliproxyapi-dashboard/dashboard:latest|image: $FULL_IMAGE|g" \
        "$SCRIPT_DIR/$COMPOSE_FILE" > "$TMP_COMPOSE"
    scp "$TMP_COMPOSE" "$REMOTE_USER@$SERVER:$REMOTE_DEPLOY_DIR/$COMPOSE_FILE"
    [ -f "$SCRIPT_DIR/.env" ] && scp "$SCRIPT_DIR/.env" "$REMOTE_USER@$SERVER:$REMOTE_DEPLOY_DIR/"
    [ -f "$SCRIPT_DIR/config.local.yaml" ] && scp "$SCRIPT_DIR/config.local.yaml" "$REMOTE_USER@$SERVER:$REMOTE_DEPLOY_DIR/"

    # Deploy on remote
    log "Deploying on $SERVER..."
    ssh "$REMOTE_USER@$SERVER" bash -s "$IMAGE_NAME" "$IMAGE_TAG" "$REMOTE_DEPLOY_DIR" "$COMPOSE_FILE" << 'REMOTE_EOF'
set -euo pipefail
IMAGE_NAME="$1"; IMAGE_TAG="$2"; DEPLOY_DIR="$3"; COMPOSE_FILE="$4"
cd "$DEPLOY_DIR"

echo "[REMOTE] Loading Docker image..."
gunzip -c "${IMAGE_NAME}-${IMAGE_TAG}.tar.gz" | docker load
echo "[REMOTE] Image loaded"

echo "[REMOTE] Starting services..."
docker compose -f "$COMPOSE_FILE" up -d
echo "[REMOTE] Services started"

echo "[REMOTE] Waiting for dashboard health..."
for i in $(seq 1 30); do
    if docker exec cliproxyapi-dashboard node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null; then
        echo "[REMOTE] Dashboard is healthy! ✅"
        break
    fi
    sleep 2
done

rm -f "${IMAGE_NAME}-${IMAGE_TAG}.tar.gz"
echo "[REMOTE] Cleanup done"
REMOTE_EOF

    ok "Deployed to $SERVER!"
    log "Access: http://$SERVER:3000"
    rm -f "$TAR_FILE" "$TMP_COMPOSE"
}

# ============================================================
# Main
# ============================================================
build_image

if [ "$TARGET" = "local" ]; then
    deploy_local
else
    deploy_remote "$TARGET"
fi

echo ""
ok "All done! 🚀"
