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
# Optional operator-provided secrets, shipped by deploy-test.bat from the project's
# .env.test. When present it becomes the test instance's .env (DATABASE_URL and the
# encryption keys are still forced below to match the prod-cloned DB).
PROVIDED_ENV="/tmp/deploy-test-${PROD_PROJECT}.env.test"
# Host-side non-secret config, mounted over the image's baked copy so it can be
# edited on the server and applied with a restart (no rebuild). Seeded from the
# image on first deploy (see step 4b).
TEST_CONFIG_DIR="${TEST_APP_DIR}/config"
TEST_CONFIG_FILE="${TEST_CONFIG_DIR}/test.config.jsonc"
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

# Read the first value of KEY ($1) from an env file ($2), tolerating BOM/CRLF.
read_env() {
    sed 's/\r//' "$2" | sed '1s/^\xef\xbb\xbf//' | grep -m1 "^$1=" | cut -d'=' -f2- || true
}
# Set KEY ($1)=VALUE ($2) in an env file ($3): drop any existing line, append anew.
# Line-based (not sed) so values with / & | (URLs, random keys) need no escaping.
upsert_env() {
    grep -v "^$1=" "$3" > "$3.tmp" 2>/dev/null || true
    mv "$3.tmp" "$3"
    printf '%s=%s\n' "$1" "$2" >> "$3"
}

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

normalize_env() { sed -i '1s/^\xef\xbb\xbf//' "$1"; sed -i 's/\r$//' "$1"; }

if [ -f "${PROVIDED_ENV}" ]; then
    # Operator-provided secrets (project's .env.test, shipped by deploy-test.bat).
    # Wins over the prod copy AND over an existing host file — shipping it is explicit
    # intent, so it is the source of truth for the test instance's secrets.
    cp "${PROVIDED_ENV}" "${TEST_ENV_FILE}"
    normalize_env "${TEST_ENV_FILE}"
    # The test DB is a CLONE of prod. Force the test DB URL (so the app hits the test
    # DB) and the PROD encryption keys (so the cloned, prod-encrypted emails decrypt),
    # regardless of what the provided file carried (e.g. a developer's local values).
    upsert_env DATABASE_URL "${TEST_DB_URL}" "${TEST_ENV_FILE}"
    PROD_ENC_PW=$(read_env ENCRYPTION_PASSWORD "${PROD_ENV_FILE}")
    PROD_ENC_SALT=$(read_env ENCRYPTION_SALT "${PROD_ENV_FILE}")
    [ -n "${PROD_ENC_PW}" ]   && upsert_env ENCRYPTION_PASSWORD "${PROD_ENC_PW}"   "${TEST_ENV_FILE}"
    [ -n "${PROD_ENC_SALT}" ] && upsert_env ENCRYPTION_SALT     "${PROD_ENC_SALT}" "${TEST_ENV_FILE}"
    # PORT / NODE_ENV are infra-controlled (compose + image) — strip them from the
    # secrets file so a stray value can't make the app listen on the wrong port.
    grep -vE '^(PORT|NODE_ENV)=' "${TEST_ENV_FILE}" > "${TEST_ENV_FILE}.tmp" || true
    mv "${TEST_ENV_FILE}.tmp" "${TEST_ENV_FILE}"
    rm -f "${PROVIDED_ENV}"   # don't leave secrets in /tmp
    ok ".env written from provided .env.test (DATABASE_URL + ENCRYPTION_* aligned to the prod clone): ${TEST_ENV_FILE}"
elif [ ! -f "${TEST_ENV_FILE}" ] || [ "${RESET_DB}" = true ]; then
    # No provided file — derive from the prod .env (copy + swap DATABASE_URL).
    cp "${PROD_ENV_FILE}" "${TEST_ENV_FILE}"
    normalize_env "${TEST_ENV_FILE}"
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${TEST_DB_URL}|" "${TEST_ENV_FILE}"
    ok ".env written from prod copy: ${TEST_ENV_FILE}"
else
    warn ".env already exists — skipping (ship .env.test or use --reset-db to overwrite)"
fi

# Sanity-check DATABASE_URL (file is already normalized at this point)
ACTUAL_URL=$(grep -m1 '^DATABASE_URL=' "${TEST_ENV_FILE}" | cut -d'=' -f2-) || true
if echo "${ACTUAL_URL}" | grep -qF "/${TEST_DB_NAME}"; then
    ok "DATABASE_URL -> .../${TEST_DB_NAME}"
else
    error "DATABASE_URL in ${TEST_ENV_FILE} still points to wrong DB.\nEdit manually: nano ${TEST_ENV_FILE}"
fi

# ---------------------------------------------------------------------------
# 4b. Seed a HOST-side config/test.config.jsonc and mount it (see the compose
# below), so non-secret settings (superadmin emails, appUrl, log levels) can be
# edited ON THE SERVER and applied with `docker compose restart` — no image
# rebuild. The instance runs with NODE_ENV=test, so the loader reads
# config/test.config.jsonc; the read-only mount makes this host file win over the
# image's baked copy. Seeded once from the image's baked default (the operator
# then edits the host copy); --reset-db re-seeds from the current image.
# ---------------------------------------------------------------------------
info "[4b/5] Seeding host config (editable without rebuild)..."
mkdir -p "${TEST_CONFIG_DIR}"

if [ ! -f "${TEST_CONFIG_FILE}" ] || [ "${RESET_DB}" = true ]; then
    # Extract the baked config from the image (cat via an overridden entrypoint;
    # the container is not started).
    docker run --rm --entrypoint cat "${IMAGE_NAME}:latest" /app/config/test.config.jsonc \
        > "${TEST_CONFIG_FILE}" \
        || error "Failed to extract config/test.config.jsonc from ${IMAGE_NAME}:latest (rebuild the image with build-test.bat first)."
    ok "Config seeded from image: ${TEST_CONFIG_FILE}"
else
    warn "Host config already exists — keeping edits (use --reset-db to re-seed from image)"
fi
# World-readable so the container's unprivileged app user (UID 1500) can read the
# mounted file regardless of the server's umask.
chmod 644 "${TEST_CONFIG_FILE}"
ok "Edit non-secret config here, then 'docker compose restart': ${TEST_CONFIG_FILE}"

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
      # Non-secret config, editable on the host (restart to apply — no rebuild).
      # NODE_ENV=test makes the loader read config/test.config.jsonc; this mount
      # overrides the image's baked copy.
      - ${TEST_CONFIG_FILE}:/app/config/test.config.jsonc:ro
    env_file:
      - ${TEST_ENV_FILE}
    environment:
      # Infra-controlled: the app must listen on INTERNAL_PORT to match the port
      # mapping and healthcheck. `environment` wins over env_file, so a stray PORT in
      # the secrets file can't move the listener off ${INTERNAL_PORT}.
      PORT: ${INTERNAL_PORT}
      NODE_ENV: test
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
# Bring the cloned DB up to date with the image via `drizzle-kit migrate` (same
# mechanism as prod deploy.sh; no more `push --force`, which silently dropped/
# recreated on drift). The clone carries prod's drizzle.__drizzle_migrations, so
# migrate applies only the migrations newer than what prod already has. The
# role-backfill heredoc above stays as a clone bootstrap (guarded/idempotent).
info "Applying DB migrations to test DB (drizzle-kit migrate)..."
docker compose run --rm --no-deps --entrypoint sh "${TEST_PROJECT}" -c "npx drizzle-kit migrate"
ok "DB migrations applied"

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
info "Edit non-secret config (superadmins, appUrl, log levels) WITHOUT rebuild:"
info "  nano ${TEST_CONFIG_FILE}"
info "  docker compose restart"
info ""
info "Re-clone DB from prod:"
info "  sudo bash $0 ${PROD_PROJECT} ${TEST_PROJECT} ${TEST_PORT} --reset-db"
info ""
info "Teardown:"
info "  cd ${TEST_APP_DIR} && docker compose down"
info "  sudo -u postgres dropdb ${TEST_DB_NAME}"
info "  rm -rf ${TEST_APP_DIR} ${TEST_DATA_DIR}"
info "========================================"
