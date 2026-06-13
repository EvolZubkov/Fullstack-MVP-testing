#!/bin/bash
# =============================================================================
# deploy-test.sh - Deploy a test instance of test-builder alongside production.
#
# Clones the production PostgreSQL database and starts a separate container
# on a different port, reusing the production Docker image (no rebuild).
#
# Usage:
#   sudo bash deploy-test.sh <prod_project> <test_project> <test_port> [--reset-db]
#
# Arguments:
#   prod_project   production project name    e.g. test_builder
#   test_project   test instance name         e.g. test_builder_test
#   test_port      external port              e.g. 8082
#   --reset-db     drop and re-clone test DB from prod (default: skip if exists)
# =============================================================================

set -eo pipefail

PROD_PROJECT="${1:?Usage: sudo bash deploy-test.sh <prod_project> <test_project> <test_port> [--reset-db]}"
TEST_PROJECT="${2:?Missing test_project argument}"
TEST_PORT="${3:?Missing test_port argument}"
INTERNAL_PORT=8081
RESET_DB=false

# The container drops privileges to this unprivileged UID (see Dockerfile); the
# uploads volume must be owned by it so the app can write media/scorm/templates.
APP_UID=1500

shift 3
for arg in "$@"; do
    case "$arg" in
        --reset-db) RESET_DB=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

# Derived paths
PROD_APP_DIR="/srv/app/${PROD_PROJECT}"
PROD_ENV_FILE="${PROD_APP_DIR}/env/.env"
TEST_APP_DIR="/srv/app/${TEST_PROJECT}"
TEST_DATA_DIR="/srv/data/${TEST_PROJECT}"
TEST_ENV_FILE="${TEST_APP_DIR}/env/.env"
TEST_COMPOSE="${TEST_APP_DIR}/docker-compose.yml"
IMAGE_NAME="${TEST_PROJECT}"

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${BLUE}[test-deploy]${NC} $*"; }
ok()    { echo -e "${GREEN}[test-deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[test-deploy]${NC} $*"; }
error() { echo -e "${RED}[test-deploy] ERROR:${NC} $*" >&2; exit 1; }

trap 'error "Unexpected failure at line ${LINENO}. Run with bash -x for details."' ERR

[ "$EUID" -ne 0 ] && error "Run with root privileges: sudo $0 $*"

info "========================================"
info "Prod:   ${PROD_PROJECT}  (source)"
info "Test:   ${TEST_PROJECT}  ->  port ${TEST_PORT}"
info "Image:  ${IMAGE_NAME}:latest"
info "Reset:  ${RESET_DB}"
info "========================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Validate prerequisites
# ---------------------------------------------------------------------------
info "[1/5] Checking prerequisites..."

[ -f "${PROD_ENV_FILE}" ] || \
    error "Production .env not found: ${PROD_ENV_FILE}"

docker image inspect "${IMAGE_NAME}:latest" > /dev/null 2>&1 || \
    error "Image ${IMAGE_NAME}:latest not found. Run build-test.bat first to build the test image."
ok "Image ${IMAGE_NAME}:latest found"

# Read DATABASE_URL from prod .env.
# Normalize: strip UTF-8 BOM (EF BB BF) that Windows editors add, then strip CRLF.
DATABASE_URL=$(sed 's/\r//' "${PROD_ENV_FILE}" \
    | sed '1s/^\xef\xbb\xbf//' \
    | grep -m1 '^DATABASE_URL=' \
    | cut -d'=' -f2-) || true
[ -z "${DATABASE_URL}" ] && \
    error "DATABASE_URL not found in ${PROD_ENV_FILE}"

# Extract database name: last path segment before optional ?query
PROD_DB_NAME="${DATABASE_URL##*/}"
PROD_DB_NAME="${PROD_DB_NAME%%\?*}"
TEST_DB_NAME="${TEST_PROJECT}"

[ -z "${PROD_DB_NAME}" ] && \
    error "Cannot parse database name from DATABASE_URL"

# Build test DATABASE_URL: replace only the last path segment (db name),
# not the first occurrence in the whole URL (which could be inside username/password).
DB_URL_PREFIX="${DATABASE_URL%/*}"
DB_URL_QUERY=""
if [[ "${DATABASE_URL}" == *\?* ]]; then
    DB_URL_QUERY="?${DATABASE_URL#*\?}"
fi
TEST_DB_URL="${DB_URL_PREFIX}/${TEST_DB_NAME}${DB_URL_QUERY}"

# Extract DB user from URL: postgresql://USER:pass@host/db
DB_URL_NOSCHEME="${DATABASE_URL#*://}"
DB_USER="${DB_URL_NOSCHEME%%:*}"

ok "Prod DB:  ${PROD_DB_NAME}"
ok "Test DB:  ${TEST_DB_NAME}"
ok "DB user:  ${DB_USER}"
ok "Test URL: ${TEST_DB_URL}"

# ---------------------------------------------------------------------------
# 2. Clone database
# ---------------------------------------------------------------------------
info "[2/5] Setting up test database..."

DB_EXISTS=$(sudo -u postgres psql -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${TEST_DB_NAME}'" 2>/dev/null) || true
DB_EXISTS="${DB_EXISTS// /}"

if [ "${DB_EXISTS}" = "1" ] && [ "${RESET_DB}" = false ]; then
    warn "Database '${TEST_DB_NAME}' already exists — skipping clone"
    warn "Use --reset-db to drop and re-clone from production"
else
    if [ "${DB_EXISTS}" = "1" ]; then
        info "Terminating connections to '${TEST_DB_NAME}'..."
        sudo -u postgres psql -c \
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
             WHERE datname='${TEST_DB_NAME}' AND pid <> pg_backend_pid();" \
            > /dev/null 2>&1 || true
        info "Dropping '${TEST_DB_NAME}'..."
        sudo -u postgres dropdb "${TEST_DB_NAME}"
    fi

    info "Creating '${TEST_DB_NAME}'..."
    sudo -u postgres createdb "${TEST_DB_NAME}"

    info "Cloning '${PROD_DB_NAME}' -> '${TEST_DB_NAME}' (may take a while)..."
    sudo -u postgres pg_dump --no-owner --no-privileges "${PROD_DB_NAME}" \
        > /tmp/pg_dump_${PROD_DB_NAME}.sql
    sudo -u postgres psql "${TEST_DB_NAME}" < /tmp/pg_dump_${PROD_DB_NAME}.sql > /dev/null
    rm -f /tmp/pg_dump_${PROD_DB_NAME}.sql
    ok "Database cloned: ${PROD_DB_NAME} -> ${TEST_DB_NAME}"

    # After --no-owner restore, all objects belong to postgres. The app user needs
    # OWNERSHIP (not just GRANTs) so that drizzle-kit push can ALTER tables/add
    # constraints during migrations. Reassign ownership of every object in public.
    info "Reassigning ownership of '${TEST_DB_NAME}' objects to '${DB_USER}'..."
    sudo -u postgres psql "${TEST_DB_NAME}" << SQL
GRANT USAGE, CREATE ON SCHEMA public TO "${DB_USER}";
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO "${DB_USER}"', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO "${DB_USER}"', r.sequencename);
  END LOOP;
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname='public' LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO "${DB_USER}"', r.viewname);
  END LOOP;
END \$\$;
SQL
    ok "Ownership reassigned to '${DB_USER}'"
fi

# ---------------------------------------------------------------------------
# 3. Create host directory structure
# ---------------------------------------------------------------------------
info "[3/5] Creating directories..."
mkdir -p "${TEST_APP_DIR}/env"
mkdir -p "${TEST_DATA_DIR}/uploads/media"
mkdir -p "${TEST_DATA_DIR}/uploads/scorm"
mkdir -p "${TEST_DATA_DIR}/uploads/templates"
# These dirs are created here by root; the container runs as the app UID, so hand
# ownership over — otherwise every upload fails with EACCES (mkdir
# uploads/templates/<id>, media, scorm). setgid (2770) keeps new files group-readable.
chown -R "${APP_UID}":"${APP_UID}" "${TEST_DATA_DIR}/uploads"
chmod -R 2770 "${TEST_DATA_DIR}/uploads"
ok "  app:  ${TEST_APP_DIR}"
ok "  data: ${TEST_DATA_DIR}  (uploads owned by UID ${APP_UID})"

# ---------------------------------------------------------------------------
# 4. Write .env for test instance
# ---------------------------------------------------------------------------
info "[4/5] Writing .env..."

if [ ! -f "${TEST_ENV_FILE}" ] || [ "${RESET_DB}" = true ]; then
    cp "${PROD_ENV_FILE}" "${TEST_ENV_FILE}"

    # Normalize: remove BOM and CRLF so Docker/Node can read values cleanly
    sed -i '1s/^\xef\xbb\xbf//' "${TEST_ENV_FILE}"
    sed -i 's/\r$//' "${TEST_ENV_FILE}"

    # Replace DATABASE_URL with test instance URL
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${TEST_DB_URL}|" "${TEST_ENV_FILE}"

    # Point API_BASE_URL at the test instance
    TEST_HOST_IP=$(hostname -I | awk '{print $1}')
    sed -i "s|^API_BASE_URL=.*|API_BASE_URL=http://${TEST_HOST_IP}:${TEST_PORT}/|" "${TEST_ENV_FILE}"

    ok ".env written: ${TEST_ENV_FILE}"
else
    warn ".env already exists — skipping (use --reset-db to overwrite)"
fi

# Sanity-check DATABASE_URL (file is already normalized at this point)
ACTUAL_URL=$(grep -m1 '^DATABASE_URL=' "${TEST_ENV_FILE}" | cut -d'=' -f2-) || true
if echo "${ACTUAL_URL}" | grep -qF "/${TEST_DB_NAME}"; then
    ok "DATABASE_URL -> .../${TEST_DB_NAME}"
else
    error "DATABASE_URL in ${TEST_ENV_FILE} still points to wrong DB.\nEdit manually: nano ${TEST_ENV_FILE}"
fi

# ---------------------------------------------------------------------------
# 5. Write docker-compose.yml and start container
# ---------------------------------------------------------------------------
info "[5/5] Writing docker-compose.yml and starting container..."

cat > "${TEST_COMPOSE}" << EOF
# Test instance — cloned from production '${PROD_PROJECT}'.
# Managed by docker/scripts/deploy-test.sh

services:
  ${TEST_PROJECT}:
    image: ${IMAGE_NAME}:latest
    container_name: ${TEST_PROJECT}
    restart: unless-stopped
    ports:
      - "${TEST_PORT}:${INTERNAL_PORT}"
    volumes:
      - ${TEST_DATA_DIR}/uploads:/app/uploads
    env_file:
      - ${TEST_ENV_FILE}
    healthcheck:
      test: ["CMD", "sh", "-c", "wget -q --spider http://127.0.0.1:${INTERNAL_PORT}/api/me"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

cd "${TEST_APP_DIR}"
docker compose down --remove-orphans 2>/dev/null || true

# PRD-13 role backfill, BEFORE push drops users.role. The test DB was just cloned
# from prod, which still has users.role but not yet the user_roles table (prod is
# not migrated) — so create user_roles here and copy each role into it (former
# authors -> administrator, everyone else -> learner), then push drops the legacy
# column. Done server-side with the same postgres superuser used for the clone
# above, so it needs no app image and no extra shipped files (deploy-test.bat
# ships only this script). The column-existence guard makes it a safe no-op once
# the column is already gone (a non-reset re-run). Mirrors migrations/016 — keep
# the role mapping in sync. Without this, push would drop users.role and every
# cloned account would lose all roles (blank "no access" screen for everyone).
info "Backfilling roles (users.role -> user_roles) before push..."
sudo -u postgres psql -v ON_ERROR_STOP=1 "${TEST_DB_NAME}" << SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS "user_roles" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" varchar(36) NOT NULL,
  "role" text NOT NULL,
  "granted_by" varchar(36),
  "granted_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_user_role_idx"
  ON "user_roles" ("user_id", "role");
ALTER TABLE "user_roles" OWNER TO "${DB_USER}";
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='users' AND column_name='role') THEN
    INSERT INTO "user_roles" ("id","user_id","role","granted_at")
    SELECT gen_random_uuid()::text, u."id",
           CASE WHEN u."role"='author' THEN 'administrator' ELSE 'learner' END, now()
    FROM "users" u
    WHERE NOT EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."user_id"=u."id");
  END IF;
END
\$\$;
SQL
ok "Roles backfilled"

# Bring the cloned DB schema up to date with the image BEFORE the app boots.
# The startup template sync (syncBuiltinTemplates) is awaited before the HTTP
# server listens, so a stale cloned schema aborts the whole boot. Run push in a
# one-off container with the entrypoint overridden so the app itself does not
# start (the ownership reassignment above exists precisely so push can ALTER the
# cloned tables). Mirrors the prod deploy.sh schema step.
# PRD-15 data/destructive migrations that push cannot perform, BEFORE push (same
# rule as the role backfill above and prod deploy.sh). The clone carries prod's
# topic_courses/topic_events and questions.points/scoring_json; these must be
# backfilled into feedback_json / test_question_scoring and the replacement table
# created BEFORE push drops the sources or mis-maps test_question_scoring onto a
# dropped table. All idempotent; run in order in one invocation.
info "Applying pre-push data migrations (TD-02 feedback, PRD-15 scoring)..."
docker compose run --rm --no-deps --entrypoint sh "${TEST_PROJECT}" -c "node script/run-sql.cjs \
  migrations/023_td02_topic_feedback_json.sql \
  migrations/024_td02_drop_topic_courses_events.sql \
  migrations/026_prd15_test_question_scoring.sql \
  migrations/027_prd15_scoring_backfill.sql \
  migrations/028_prd15_drop_question_scoring_columns.sql"
ok "Data migrations applied"

info "Applying DB schema to test DB (drizzle-kit push)..."
docker compose run --rm --no-deps --entrypoint sh "${TEST_PROJECT}" -c "npx drizzle-kit push --force"
ok "DB schema up to date"

docker compose up -d
ok "Container started"

# ---------------------------------------------------------------------------
# 6. Allow Docker subnet in pg_hba.conf (if not already present)
# ---------------------------------------------------------------------------
info "Checking pg_hba.conf for Docker subnet..."

CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${TEST_PROJECT}" 2>/dev/null) || true

if [ -n "${CONTAINER_IP}" ]; then
    # Derive /16 subnet from container IP (e.g. 172.27.0.2 -> 172.27.0.0/16)
    DOCKER_SUBNET=$(echo "${CONTAINER_IP}" | awk -F. '{print $1"."$2".0.0/16"}')

    PG_HBA=$(sudo -u postgres psql -tAc "SHOW hba_file" 2>/dev/null | tr -d '[:space:]') || true

    if [ -z "${PG_HBA}" ] || [ ! -f "${PG_HBA}" ]; then
        warn "Cannot locate pg_hba.conf — add manually: host all all ${DOCKER_SUBNET} md5"
    elif grep -qE "^host[[:space:]].*${DOCKER_SUBNET}" "${PG_HBA}" 2>/dev/null; then
        ok "pg_hba.conf already allows ${DOCKER_SUBNET}"
    else
        echo "host  all  all  ${DOCKER_SUBNET}  md5" >> "${PG_HBA}"
        ok "pg_hba.conf: added ${DOCKER_SUBNET}"

        # Reload PostgreSQL to apply the new rule
        if sudo -u postgres psql -c "SELECT pg_reload_conf();" > /dev/null 2>&1; then
            ok "PostgreSQL reloaded"
        else
            warn "Could not reload PostgreSQL automatically."
            warn "Run manually: sudo systemctl reload postgresql"
        fi
    fi
else
    warn "Could not detect container IP — ensure pg_hba.conf allows Docker subnets"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
docker compose ps

HOST_IP=$(hostname -I | awk '{print $1}')
echo ""
info "========================================"
info "Test instance ready"
info "URL:   http://${HOST_IP}:${TEST_PORT}"
info ""
info "Management:"
info "  cd ${TEST_APP_DIR}"
info "  docker compose logs -f"
info "  docker compose stop / start / restart"
info ""
info "Re-clone DB from prod:"
info "  sudo bash $0 ${PROD_PROJECT} ${TEST_PROJECT} ${TEST_PORT} --reset-db"
info ""
info "Teardown:"
info "  cd ${TEST_APP_DIR} && docker compose down"
info "  sudo -u postgres dropdb ${TEST_DB_NAME}"
info "  rm -rf ${TEST_APP_DIR} ${TEST_DATA_DIR}"
info "========================================"
