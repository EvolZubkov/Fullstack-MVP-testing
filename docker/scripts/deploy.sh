#!/bin/bash
# =============================================================================
# Server-side deploy script for test-builder.
# Uploaded and executed on the target server by build-docker.bat / deploy-docker.bat.
#
# Usage: sudo deploy.sh <project_name> <port> <image_tar>
#
# Host directory structure created:
#   /srv/app/<project>/                       - working directory (docker compose runs here)
#   /srv/app/<project>/docker-compose.yml     - generated compose file
#   /srv/app/<project>/env/.env               - app env file (:ro mount)
#   /srv/logs/<project>/                      - application logs
#   /srv/data/<project>/uploads/media/        - media uploads
#   /srv/data/<project>/uploads/scorm/        - SCORM packages
# =============================================================================

set -euo pipefail

PROJECT_NAME="${1:?Usage: sudo deploy.sh <project_name> <port> <image_tar>}"
SERVICE_PORT="${2:?Missing port argument}"
IMAGE_TAR="${3:?Missing image tar path}"

IMAGE_NAME="${PROJECT_NAME}"

APP_DIR="/srv/app/${PROJECT_NAME}"
LOG_DIR="/srv/logs/${PROJECT_NAME}"
DATA_DIR="/srv/data/${PROJECT_NAME}"

APP_UID=1500
APP_GROUP="botadmins"

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${PACKAGE_DIR}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()    { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*"; }
error() { echo -e "${RED}[deploy]${NC} $*"; exit 1; }

if [ "$EUID" -ne 0 ]; then
    error "Run with root privileges: sudo $0 $*"
fi

info "========================================"
info "Project:  ${PROJECT_NAME}"
info "Port:     ${SERVICE_PORT}"
info "Image:    ${IMAGE_NAME}:latest"
info "========================================"

# ---------------------------------------------------------------------------
# 1. Load Docker image (pre-built locally — no build on server)
# ---------------------------------------------------------------------------
info "Loading Docker image..."
[ -f "${IMAGE_TAR}" ] || error "Image tar not found: ${IMAGE_TAR}"
docker load -i "${IMAGE_TAR}"
ok "Image loaded: ${IMAGE_NAME}:latest"

info "Validating Docker image entrypoint..."
docker run --rm --entrypoint /bin/sh "${IMAGE_NAME}:latest" -c \
    'test -f /app/docker/entrypoint.sh &&
     test -x /app/docker/entrypoint.sh &&
     ! head -n 1 /app/docker/entrypoint.sh | grep -q "$(printf "\r")"' \
    || error "Image has missing/non-executable/CRLF entrypoint. Rebuild with docker\\scripts\\build-docker.bat."
ok "Docker image entrypoint is valid"

# ---------------------------------------------------------------------------
# 2. Ensure application group exists
# ---------------------------------------------------------------------------
if ! getent group "${APP_GROUP}" > /dev/null 2>&1; then
    info "Creating group '${APP_GROUP}'..."
    groupadd "${APP_GROUP}"
    ok "Group '${APP_GROUP}' created. Add users: sudo usermod -aG ${APP_GROUP} <username>"
else
    ok "Group '${APP_GROUP}' exists"
fi

# ---------------------------------------------------------------------------
# 3. Create host directory structure with proper permissions
# ---------------------------------------------------------------------------
info "Creating host directories..."
mkdir -p \
    "${APP_DIR}/env" \
    "${LOG_DIR}" \
    "${DATA_DIR}/uploads/media" \
    "${DATA_DIR}/uploads/scorm"

chown -R root:"${APP_GROUP}" "${APP_DIR}"
chmod 2750 "${APP_DIR}"
chmod -R g+rX "${APP_DIR}"

chown "${APP_UID}":"${APP_GROUP}" "${LOG_DIR}"
chmod 2770 "${LOG_DIR}"

chown -R "${APP_UID}":"${APP_GROUP}" "${DATA_DIR}"
chmod -R 2770 "${DATA_DIR}"

ok "Directories ready:"
ok "  app:     ${APP_DIR}  (root:${APP_GROUP} 2750)"
ok "  logs:    ${LOG_DIR}  (${APP_UID}:${APP_GROUP} 2770)"
ok "  data:    ${DATA_DIR}  (${APP_UID}:${APP_GROUP} 2770)"

# ---------------------------------------------------------------------------
# 4. Deploy .env file (preserve existing edits)
# ---------------------------------------------------------------------------
info "Deploying .env..."

ENV_SRC="${PACKAGE_DIR}/env/.env"
ENV_DEST="${APP_DIR}/env/.env"

if [ -f "${ENV_SRC}" ]; then
    if [ ! -f "${ENV_DEST}" ]; then
        cp "${ENV_SRC}" "${ENV_DEST}"
        chown root:"${APP_GROUP}" "${ENV_DEST}"
        chmod 640 "${ENV_DEST}"
        ok ".env deployed (new)"
        echo ""
        warn "!!! Edit ${ENV_DEST} with real credentials before starting !!!"
        echo "    nano ${ENV_DEST}"
        echo ""
        read -r -p "Press Enter after editing .env..."
    else
        warn ".env already exists — skipping (preserving edits)"
    fi
else
    warn "env/.env not found in deploy package — skipping"
fi

# ---------------------------------------------------------------------------
# 5. Generate docker-compose.yml from template
# ---------------------------------------------------------------------------
info "Generating docker-compose.yml..."

COMPOSE_TEMPLATE="${PACKAGE_DIR}/docker-compose.yml"
[ -f "${COMPOSE_TEMPLATE}" ] || error "docker-compose.yml template not found in deploy package"

sed \
    -e "s/PROJECT_NAME_PLACEHOLDER/${PROJECT_NAME}/g" \
    -e "s/SERVICE_PORT_PLACEHOLDER/${SERVICE_PORT}/g" \
    "${COMPOSE_TEMPLATE}" > "${APP_DIR}/docker-compose.yml"

ok "docker-compose.yml generated at ${APP_DIR}/docker-compose.yml"

# ---------------------------------------------------------------------------
# 6. Apply DB schema BEFORE starting the app
# ---------------------------------------------------------------------------
# The app's startup (syncBuiltinTemplates) is awaited before the HTTP server
# listens, so it reads the current schema and aborts the entire boot if a column
# is missing (e.g. right after a schema change). Push the schema first, in a
# one-off container with the entrypoint overridden so the app does not boot yet.
info "Applying DB schema (drizzle-kit push)..."
cd "${APP_DIR}"
docker compose down --remove-orphans 2>/dev/null || true
docker compose run --rm --no-deps --entrypoint sh app -c "npx drizzle-kit push --force"
ok "DB schema up to date"

# ---------------------------------------------------------------------------
# 7. Start service via docker compose
# ---------------------------------------------------------------------------
info "Starting service with docker compose..."
docker compose up -d
ok "Service started"

echo ""
docker compose ps

echo ""
info "========================================"
info "Deployment complete: ${PROJECT_NAME}"
info "Logs:  docker compose -p ${PROJECT_NAME} logs -f"
info "URL:   http://$(hostname -I | awk '{print $1}'):${SERVICE_PORT}"
info "========================================"
