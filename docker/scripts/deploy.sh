#!/bin/bash
# =============================================================================
# Server-side deploy for test-builder — ONE script for every instance.
#
# Uploaded and executed by docker/scripts/deploy.bat (via run-deploy.sh).
#
# Usage:
#   sudo deploy.sh <project> <port> <image_tar> <node_env> \
#        [--clone-from <source_project>] [--reset-db]
#
#   --clone-from  initialize a MISSING database by cloning another instance's one
#                 (this is what makes an instance a "test" instance: same image,
#                 same compose, same config mechanics — only DB init differs)
#   --reset-db    drop the database and re-clone it (requires --clone-from)
#
# Host layout created:
#   /srv/app/<project>/docker-compose.yml     - copied verbatim from the template
#   /srv/app/<project>/.env                   - COMPOSE variables (TB_*), generated
#   /srv/app/<project>/env/.env               - app secrets (:ro mount), host-owned
#   /srv/app/<project>/config/*.config.jsonc  - non-secret config (:ro mount)
#   /srv/app/<project>/config-backup/         - replaced config files
#   /srv/logs/<project>/                      - application logs
#   /srv/data/<project>/uploads/{media,scorm,templates}
# =============================================================================

set -euo pipefail

PROJECT_NAME="${1:?Usage: sudo deploy.sh <project> <port> <image_tar> <node_env> [--clone-from <src>] [--reset-db]}"
SERVICE_PORT="${2:?Missing port argument}"
IMAGE_TAR="${3:?Missing image tar path}"
NODE_ENV_NAME="${4:?Missing node_env argument (production|test|...)}"
shift 4

CLONE_FROM=""
RESET_DB=false
while [ $# -gt 0 ]; do
    case "$1" in
        --clone-from) CLONE_FROM="${2:?--clone-from needs a source project}"; shift 2 ;;
        --reset-db)   RESET_DB=true; shift ;;
        "")           shift ;;
        *)            echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

IMAGE_NAME="${PROJECT_NAME}"
APP_DIR="/srv/app/${PROJECT_NAME}"
LOG_DIR="/srv/logs/${PROJECT_NAME}"
DATA_DIR="/srv/data/${PROJECT_NAME}"
ENV_FILE="${APP_DIR}/env/.env"
CONFIG_DIR="${APP_DIR}/config"
CONFIG_BACKUP_DIR="${APP_DIR}/config-backup"
CONFIG_BACKUPS_KEPT=5
# Same rule for every instance: the file is named after the environment.
CONFIG_FILE_REL="config/${NODE_ENV_NAME}.config.jsonc"

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
normalize_env() { sed -i '1s/^\xef\xbb\xbf//' "$1"; sed -i 's/\r$//' "$1"; }

[ "$EUID" -ne 0 ] && error "Run with root privileges: sudo $0 $*"
[ "${RESET_DB}" = true ] && [ -z "${CLONE_FROM}" ] && \
    error "--reset-db requires --clone-from: this script never drops a database it cannot re-create."

info "========================================"
info "Project:   ${PROJECT_NAME}"
info "Port:      ${SERVICE_PORT}"
info "NODE_ENV:  ${NODE_ENV_NAME}"
info "Image:     ${IMAGE_NAME}:latest"
[ -n "${CLONE_FROM}" ] && info "DB source: ${CLONE_FROM} (clone if missing, reset=${RESET_DB})"
info "========================================"

# ---------------------------------------------------------------------------
# 1. Load the pre-built image (no build on the server)
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
    || error "Image has missing/non-executable/CRLF entrypoint. Rebuild with docker\\scripts\\deploy.bat."
ok "Docker image entrypoint is valid"

# ---------------------------------------------------------------------------
# 2. Application group
# ---------------------------------------------------------------------------
if ! getent group "${APP_GROUP}" > /dev/null 2>&1; then
    info "Creating group '${APP_GROUP}'..."
    groupadd "${APP_GROUP}"
    ok "Group '${APP_GROUP}' created. Add users: sudo usermod -aG ${APP_GROUP} <username>"
else
    ok "Group '${APP_GROUP}' exists"
fi

# ---------------------------------------------------------------------------
# 3. Host directories
# ---------------------------------------------------------------------------
info "Creating host directories..."
mkdir -p \
    "${APP_DIR}/env" \
    "${CONFIG_DIR}" \
    "${LOG_DIR}" \
    "${DATA_DIR}/uploads/media" \
    "${DATA_DIR}/uploads/scorm" \
    "${DATA_DIR}/uploads/templates"

chown -R root:"${APP_GROUP}" "${APP_DIR}"
chmod 2750 "${APP_DIR}"
chmod -R g+rX "${APP_DIR}"

# The container drops privileges to APP_UID, so the writable volumes must belong
# to it; setgid keeps new files group-manageable from the host.
chown "${APP_UID}":"${APP_GROUP}" "${LOG_DIR}"
chmod 2770 "${LOG_DIR}"
chown -R "${APP_UID}":"${APP_GROUP}" "${DATA_DIR}"
chmod -R 2770 "${DATA_DIR}"

ok "Directories ready:"
ok "  app:   ${APP_DIR}  (root:${APP_GROUP} 2750)"
ok "  logs:  ${LOG_DIR}  (${APP_UID}:${APP_GROUP} 2770)"
ok "  data:  ${DATA_DIR}  (${APP_UID}:${APP_GROUP} 2770)"

# ---------------------------------------------------------------------------
# 4. Secrets (env/.env) — HOST-OWNED, never overwritten by a deploy
#
# First deploy takes them from the package; an instance with --clone-from that
# got no secrets of its own inherits the source instance's file (its DATABASE_URL
# and encryption keys are aligned below — the clone is encrypted with the source
# keys, so reusing them is what makes the cloned emails decryptable).
# ---------------------------------------------------------------------------
info "Deploying secrets (env/.env)..."

ENV_SRC="${PACKAGE_DIR}/env/.env"

if [ ! -f "${ENV_FILE}" ]; then
    if [ -f "${ENV_SRC}" ]; then
        cp "${ENV_SRC}" "${ENV_FILE}"
        ok "env/.env deployed from the package (new)"
    elif [ -n "${CLONE_FROM}" ] && [ -f "/srv/app/${CLONE_FROM}/env/.env" ]; then
        cp "/srv/app/${CLONE_FROM}/env/.env" "${ENV_FILE}"
        ok "env/.env derived from ${CLONE_FROM} (new)"
    else
        error "No secrets available: the package carries no env/.env and there is nothing to derive from.
       Create ${ENV_FILE} manually (see docker/templates/.env.example) and re-run."
    fi
    normalize_env "${ENV_FILE}"
else
    if [ -f "${ENV_SRC}" ] && ! cmp -s "${ENV_SRC}" "${ENV_FILE}"; then
        # Secrets are host-owned: never silently replaced. Keep the incoming copy
        # next to it so an operator can diff and merge deliberately.
        cp "${ENV_SRC}" "${ENV_FILE}.incoming"
        chown root:"${APP_GROUP}" "${ENV_FILE}.incoming"
        chmod 640 "${ENV_FILE}.incoming"
        warn "env/.env kept (host-owned). Shipped version saved as ${ENV_FILE}.incoming"
    else
        ok "env/.env kept (host-owned)"
    fi
fi

# PORT / NODE_ENV are infra-controlled (compose + image); a stray value in the
# secrets file must not move the listener or the environment.
sed -i -E '/^(PORT|NODE_ENV)=/d' "${ENV_FILE}"

# OWNED BY THE APP UID, not root. This file is bind-mounted at /app/.env and read
# by the application, which runs as UID 1500 (gosu, see entrypoint.sh) — a member
# of neither root nor ${APP_GROUP} inside the container. With root ownership and
# 0640 the read fails with EACCES, and dotenv reports that failure only in a
# return value nobody checks: the app then boots with an EMPTY environment and
# dies on "DATABASE_URL must be set" while the file sits there, perfectly valid.
# Group ${APP_GROUP} keeps host-side operators able to edit it; 0640 keeps the
# secrets off world-read.
chown "${APP_UID}":"${APP_GROUP}" "${ENV_FILE}"
chmod 640 "${ENV_FILE}"

# ---------------------------------------------------------------------------
# 5. Non-secret config — the REPO is the source of truth, refreshed every deploy
#
# Unlike env/.env, these files are versioned: each deploy writes the shipped
# version so an upstream change actually reaches the server. A differing host
# copy is backed up (outside the mounted directory) and the diff is printed, so
# an ad-hoc server edit is never lost silently — carry it back into the repo.
# ---------------------------------------------------------------------------
info "Deploying config..."

CONFIG_SRC_DIR="${PACKAGE_DIR}/config"
mkdir -p "${CONFIG_DIR}"

if [ -d "${CONFIG_SRC_DIR}" ]; then
    STAMP="$(date +%Y%m%d-%H%M%S)"
    for src in "${CONFIG_SRC_DIR}"/*.jsonc; do
        [ -f "${src}" ] || continue
        name="$(basename "${src}")"
        dest="${CONFIG_DIR}/${name}"

        if [ ! -f "${dest}" ]; then
            cp "${src}" "${dest}"
            ok "config/${name} deployed (new)"
            continue
        fi
        if cmp -s "${src}" "${dest}"; then
            ok "config/${name} up to date"
            continue
        fi

        mkdir -p "${CONFIG_BACKUP_DIR}"
        cp "${dest}" "${CONFIG_BACKUP_DIR}/${name}.${STAMP}"
        cp "${src}" "${dest}"
        warn "config/${name} UPDATED from the deploy package"
        warn "  previous host copy: ${CONFIG_BACKUP_DIR}/${name}.${STAMP}"
        # diff exits 1 on differences (always, here) — neutralize it so `set -e`
        # and pipefail do not abort the deploy.
        { diff -u "${CONFIG_BACKUP_DIR}/${name}.${STAMP}" "${dest}" | sed -n '3,20p'; } || true
    done

    # Keep only the newest ${CONFIG_BACKUPS_KEPT} backups per file.
    if [ -d "${CONFIG_BACKUP_DIR}" ]; then
        for name in $(ls -1 "${CONFIG_BACKUP_DIR}" 2>/dev/null \
                      | sed 's/\.[0-9]\{8\}-[0-9]\{6\}$//' | sort -u); do
            { ls -1t "${CONFIG_BACKUP_DIR}/${name}."* 2>/dev/null \
              | tail -n +$((CONFIG_BACKUPS_KEPT + 1)) | xargs -r rm -f; } || true
        done
        chown -R root:"${APP_GROUP}" "${CONFIG_BACKUP_DIR}"
        chmod 750 "${CONFIG_BACKUP_DIR}"
    fi
else
    warn "config/ not found in deploy package — relying on what is already on the host"
fi

# The container reads these as the unprivileged app user (UID 1500), which is in
# neither root nor ${APP_GROUP} inside the container — so the mount must be
# world-readable (dir o+rx, files o+r). Non-secret content only.
chown -R root:"${APP_GROUP}" "${CONFIG_DIR}"
chmod 755 "${CONFIG_DIR}"
find "${CONFIG_DIR}" -type f -exec chmod 644 {} +

[ -f "${CONFIG_DIR}/$(basename "${CONFIG_FILE_REL}")" ] || \
    error "${CONFIG_FILE_REL} is missing in ${CONFIG_DIR}.
       The image carries no config — the deploy package must ship it (rebuild with docker\\scripts\\deploy.bat)."
ok "Config ready: ${CONFIG_DIR}  (repo is the source of truth; each deploy refreshes it)"

# ---------------------------------------------------------------------------
# 6. Compose file + its variables
#
# The compose file is copied verbatim (same file for every instance); everything
# instance-specific lives in the generated .env that compose reads from the
# project directory. Note this is COMPOSE's env file, not the application's.
# ---------------------------------------------------------------------------
info "Writing compose files..."

COMPOSE_TEMPLATE="${PACKAGE_DIR}/docker-compose.yml"
[ -f "${COMPOSE_TEMPLATE}" ] || error "docker-compose.yml not found in the deploy package"
cp "${COMPOSE_TEMPLATE}" "${APP_DIR}/docker-compose.yml"

cat > "${APP_DIR}/.env" << EOF
# Generated by deploy.sh — COMPOSE variables for docker-compose.yml.
# This file configures compose only; the application's secrets are env/.env.
# Edit + 'docker compose up -d' to change the port or bind address.
TB_PROJECT=${PROJECT_NAME}
TB_IMAGE=${IMAGE_NAME}:latest
TB_PORT=${SERVICE_PORT}
TB_NODE_ENV=${NODE_ENV_NAME}
TB_CONFIG_FILE=${CONFIG_FILE_REL}
TB_LOG_DIR=${LOG_DIR}
TB_DATA_DIR=${DATA_DIR}
EOF
chown root:"${APP_GROUP}" "${APP_DIR}/docker-compose.yml" "${APP_DIR}/.env"
chmod 640 "${APP_DIR}/.env"
chmod 644 "${APP_DIR}/docker-compose.yml"
ok "docker-compose.yml + .env written to ${APP_DIR}"

cd "${APP_DIR}"
docker compose down --remove-orphans 2>/dev/null || true

# ---------------------------------------------------------------------------
# 7. Database — THE ONLY PART THAT DIFFERS BETWEEN INSTANCES
#
# Without --clone-from the database must already exist (production is never
# created implicitly). With --clone-from a MISSING database is created and cloned
# from the source instance, which is how a test instance is born; an existing one
# is left alone unless --reset-db is given. Both paths then run the same
# migrations, so schema handling is identical everywhere.
# ---------------------------------------------------------------------------
DATABASE_URL="$(read_env DATABASE_URL "${ENV_FILE}")"
[ -n "${DATABASE_URL}" ] || error "DATABASE_URL not found in ${ENV_FILE}"

DB_NAME="${DATABASE_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"
DB_URL_NOSCHEME="${DATABASE_URL#*://}"
DB_USER="${DB_URL_NOSCHEME%%:*}"
[ -n "${DB_NAME}" ] || error "Cannot parse the database name from DATABASE_URL"

if [ -n "${CLONE_FROM}" ]; then
    # A cloned instance must not point at the source database: force its own name
    # (the project name) and inherit the source's encryption keys, otherwise the
    # cloned, source-encrypted emails cannot be decrypted.
    SRC_ENV="/srv/app/${CLONE_FROM}/env/.env"
    [ -f "${SRC_ENV}" ] || error "Source instance secrets not found: ${SRC_ENV}"
    SRC_URL="$(read_env DATABASE_URL "${SRC_ENV}")"
    [ -n "${SRC_URL}" ] || error "DATABASE_URL not found in ${SRC_ENV}"

    SRC_DB_NAME="${SRC_URL##*/}"; SRC_DB_NAME="${SRC_DB_NAME%%\?*}"
    DB_NAME="${PROJECT_NAME}"
    DB_URL_PREFIX="${SRC_URL%/*}"
    DB_URL_QUERY=""
    [[ "${SRC_URL}" == *\?* ]] && DB_URL_QUERY="?${SRC_URL#*\?}"
    DATABASE_URL="${DB_URL_PREFIX}/${DB_NAME}${DB_URL_QUERY}"
    DB_URL_NOSCHEME="${DATABASE_URL#*://}"
    DB_USER="${DB_URL_NOSCHEME%%:*}"

    upsert_env DATABASE_URL "${DATABASE_URL}" "${ENV_FILE}"
    for key in ENCRYPTION_PASSWORD ENCRYPTION_SALT; do
        value="$(read_env "${key}" "${SRC_ENV}")"
        [ -n "${value}" ] && upsert_env "${key}" "${value}" "${ENV_FILE}"
    done
    chmod 640 "${ENV_FILE}"
    ok "Secrets aligned to the clone: DATABASE_URL -> .../${DB_NAME}, ENCRYPTION_* from ${CLONE_FROM}"
fi

info "Database: ${DB_NAME} (user ${DB_USER})"

command -v psql > /dev/null 2>&1 || \
    error "psql not found on this host — the database tooling below (existence check, clone) needs it."

DB_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || true)"
DB_EXISTS="${DB_EXISTS// /}"

if [ "${DB_EXISTS}" = "1" ] && [ "${RESET_DB}" = true ]; then
    info "Terminating connections to '${DB_NAME}'..."
    sudo -u postgres psql -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" > /dev/null 2>&1 || true
    info "Dropping '${DB_NAME}' (--reset-db)..."
    sudo -u postgres dropdb "${DB_NAME}"
    DB_EXISTS=""
fi

if [ "${DB_EXISTS}" = "1" ]; then
    ok "Database '${DB_NAME}' exists — keeping data"
elif [ -n "${CLONE_FROM}" ]; then
    info "Creating '${DB_NAME}' and cloning from '${SRC_DB_NAME}' (may take a while)..."
    sudo -u postgres createdb "${DB_NAME}"
    DUMP_FILE="$(mktemp /tmp/pg_dump_${SRC_DB_NAME}.XXXXXX.sql)"
    sudo -u postgres pg_dump --no-owner --no-privileges "${SRC_DB_NAME}" > "${DUMP_FILE}"
    sudo -u postgres psql "${DB_NAME}" < "${DUMP_FILE}" > /dev/null
    rm -f "${DUMP_FILE}"
    ok "Database cloned: ${SRC_DB_NAME} -> ${DB_NAME}"

    # After a --no-owner restore every object belongs to postgres. The app user
    # needs OWNERSHIP (not just grants) so migrations can ALTER these tables, and
    # CREATE on the DATABASE because drizzle-kit migrate keeps its ledger in a
    # separate `drizzle` schema.
    info "Reassigning ownership of '${DB_NAME}' to '${DB_USER}'..."
    sudo -u postgres psql -v ON_ERROR_STOP=1 "${DB_NAME}" << SQL
GRANT CREATE ON DATABASE "${DB_NAME}" TO "${DB_USER}";
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
else
    error "Database '${DB_NAME}' does not exist.
       A production database is never created implicitly. Create it once:
         sudo -u postgres createdb -O ${DB_USER} ${DB_NAME}
       ...or deploy this instance with --clone-from <source_project> to clone one."
fi

# ---------------------------------------------------------------------------
# 8. Schema migrations (identical for every instance)
# ---------------------------------------------------------------------------
# Applied BEFORE the app boots: startup (syncBuiltinTemplates) is awaited before
# the HTTP server listens and aborts the whole boot on a stale schema.
#
# `drizzle-kit migrate` applies the reviewed SQL under drizzle/ in order, each in
# its own transaction — unlike the former `push --force` it never diffs the live
# DB and never silently drops/recreates on drift.
#
# -T is essential, not cosmetic: without it `docker compose run` attaches to the
# terminal that `ssh -tt` provides and tears the stream down the moment the
# container exits, losing the final stderr. The inner redirect-then-cat is what
# makes a failure legible: drizzle-kit ends a failed run with process.exit(1),
# truncating pending writes to a PIPE; writes to a FILE are synchronous.
info "Applying DB migrations (drizzle-kit migrate)..."
if ! docker compose run --rm -T --no-deps --entrypoint sh app \
    -c 'npx drizzle-kit migrate > /tmp/migrate.log 2>&1; ec=$?; cat /tmp/migrate.log; exit $ec'; then
    echo ""
    warn "drizzle-kit migrate FAILED — see the error above. Known causes:"
    warn "  'permission denied for database': the app role lacks CREATE on the DB"
    warn "     (migrate needs it for the drizzle schema). As the postgres superuser:"
    warn "     GRANT CREATE ON DATABASE \"${DB_NAME}\" TO \"${DB_USER}\";"
    warn "  'relation/table already exists': this database predates the migrate era"
    warn "     and was never baselined. Run ONCE, then redeploy:"
    warn "     cd ${APP_DIR} && docker compose run --rm -T --no-deps --entrypoint sh \\"
    warn "       app -c 'node script/run-sql.cjs drizzle/baseline-existing-db.sql'"
    warn "  See drizzle/README.md."
    error "Aborting before start — the schema is not in a known state."
fi
ok "DB migrations applied"

# ---------------------------------------------------------------------------
# 9. Start and wait for health
# ---------------------------------------------------------------------------
info "Starting service..."
docker compose up -d

info "Waiting for the container to become healthy..."
HEALTH=""
for _ in $(seq 1 60); do
    HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
              "${PROJECT_NAME}" 2>/dev/null || echo "")"
    case "${HEALTH}" in
        healthy) break ;;
        none)    warn "Image has no healthcheck — skipping the wait"; break ;;
        *)       sleep 5 ;;
    esac
done

if [ "${HEALTH}" = "healthy" ] || [ "${HEALTH}" = "none" ]; then
    ok "Service is up"
else
    warn "Container is not healthy after ~5 min (status: ${HEALTH:-unknown}). Recent logs:"
    docker compose logs --tail 30 || true
    error "Deployment finished but the service is not healthy — investigate before announcing it."
fi

# ---------------------------------------------------------------------------
# 10. Let the container reach a host-local PostgreSQL (idempotent)
# ---------------------------------------------------------------------------
CONTAINER_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
                "${PROJECT_NAME}" 2>/dev/null || true)"
if [ -n "${CONTAINER_IP}" ]; then
    DOCKER_SUBNET="$(echo "${CONTAINER_IP}" | awk -F. '{print $1"."$2".0.0/16"}')"
    PG_HBA="$(sudo -u postgres psql -tAc "SHOW hba_file" 2>/dev/null | tr -d '[:space:]' || true)"

    if [ -z "${PG_HBA}" ] || [ ! -f "${PG_HBA}" ]; then
        warn "Cannot locate pg_hba.conf — if the DB is host-local, add: host all all ${DOCKER_SUBNET} md5"
    elif grep -qE "^host[[:space:]].*${DOCKER_SUBNET}" "${PG_HBA}" 2>/dev/null; then
        ok "pg_hba.conf already allows ${DOCKER_SUBNET}"
    else
        echo "host  all  all  ${DOCKER_SUBNET}  md5" >> "${PG_HBA}"
        sudo -u postgres psql -c "SELECT pg_reload_conf();" > /dev/null 2>&1 \
            && ok "pg_hba.conf: added ${DOCKER_SUBNET} (PostgreSQL reloaded)" \
            || warn "pg_hba.conf: added ${DOCKER_SUBNET} — reload manually: sudo systemctl reload postgresql"
    fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
docker compose ps

echo ""
info "========================================"
info "Deployment complete: ${PROJECT_NAME}"
info "URL:     http://$(hostname -I | awk '{print $1}'):${SERVICE_PORT}"
info "Logs:    cd ${APP_DIR} && docker compose logs -f"
info "Config:  nano ${CONFIG_DIR}/$(basename "${CONFIG_FILE_REL}") && docker compose restart"
info "         (repo is the source of truth — every deploy refreshes it)"
info "Secrets: nano ${ENV_FILE} && docker compose up -d   (host-owned, never overwritten)"
info "========================================"
