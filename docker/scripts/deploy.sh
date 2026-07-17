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
#   /srv/data/<project>/uploads/templates/    - uploaded design-template packages (PRD-3)
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
    "${DATA_DIR}/uploads/scorm" \
    "${DATA_DIR}/uploads/templates"

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
# Non-secret configuration is committed and baked into the image
# (config/production.config.jsonc, selected by NODE_ENV=production). It is not
# generated or mounted here — edit it in the repo and rebuild. Only secrets are
# host-side (env/.env, deployed above).
# ---------------------------------------------------------------------------

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
cd "${APP_DIR}"
docker compose down --remove-orphans 2>/dev/null || true

# Data migrations that `drizzle-kit push` cannot perform must run FIRST, while
# legacy columns/tables still exist. push syncs SCHEMA only — it never runs these
# backfills, and would DROP source tables/columns before the data is migrated:
#   - PRD-13 (016): users.role -> user_roles, before push drops users.role;
#   - PRD-15 TD-02 (023 -> 024): topic_courses/topic_events -> topics.feedback_json,
#     before the tables are dropped;
#   - PRD-15 D (026): create test_question_scoring BEFORE push, so push does not
#     prompt "create vs rename" / mis-map it onto a dropped table;
#   - PRD-15 D (027 -> 028): questions.points/scoring_json -> test_question_scoring
#     overrides, before the columns are dropped.
# All are guarded/idempotent (IF [NOT] EXISTS, ON CONFLICT DO NOTHING, backfill
# only by NULL/absence), so they are safe no-ops on a DB already migrated. Run in
# ORDER (backfill strictly before its drop) in one invocation; any failure aborts
# the deploy before push, so a drop never runs after a failed backfill.
info "Applying pre-push data migrations (push cannot run these)..."
docker compose run --rm --no-deps --entrypoint sh "${PROJECT_NAME}" -c "node script/run-sql.cjs \
  migrations/016_prd13_rbac_roles.sql \
  migrations/023_td02_topic_feedback_json.sql \
  migrations/024_td02_drop_topic_courses_events.sql \
  migrations/026_prd15_test_question_scoring.sql \
  migrations/027_prd15_scoring_backfill.sql \
  migrations/028_prd15_drop_question_scoring_columns.sql"
ok "Data migrations applied"

# Safety gate: assert the destructive/ambiguous PRD-15 migrations took effect
# BEFORE push runs. If the chain silently did not apply, push would prompt
# "create vs rename test_question_scoring" and --force would DROP source
# tables/columns without backfill. This turns that into a loud failure.
info "Verifying schema is migrated before push (PRD-15 gate)..."
docker compose run --rm --no-deps --entrypoint sh "${PROJECT_NAME}" -c "node script/run-sql.cjs script/verify-prd15-pre-push.sql" \
    || error "Pre-push gate failed: PRD-15 data migrations did not take effect. NOT running push (would risk data loss). See message above."
ok "Schema gate passed"

info "Applying DB schema (drizzle-kit push)..."
docker compose run --rm --no-deps --entrypoint sh "${PROJECT_NAME}" -c "npx drizzle-kit push --force"
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
