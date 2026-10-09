#!/bin/bash
# =============================================================================
# Server-side deploy for test-builder — ONE script for every instance.
#
# Uploaded and executed by scripts/deploy/deploy.bat (via run-deploy.sh).
#
# Usage:
#   sudo deploy.sh <project> <port> <image_tar> <node_env> \
#        [--clone-from <source_project>] [--init-db-from <source_project>] \
#        [--reset-db] [--domain <fqdn> --certbot-email <email>] \
#        [--seed-admin <email> --seed-admin-password-b64 <base64>]
#
#   --clone-from    initialize a MISSING database by cloning another instance's one
#                   (this is what makes an instance a "test" instance: same image,
#                   same compose, same config mechanics — only DB init differs)
#   --init-db-from  initialize a MISSING database EMPTY, borrowing only the
#                   PostgreSQL coordinates (host/role/password) of another instance.
#                   This is what makes an instance a "mirror": production-shaped
#                   but raised from scratch — its own database, its own freshly
#                   generated secrets (there is nothing to decrypt, so the source
#                   encryption keys are NOT copied) and its own domain.
#   --reset-db      drop the database and re-create it (requires --clone-from or
#                   --init-db-from — the script never drops what it cannot rebuild)
#   --domain        publish the instance at this FQDN: writes the nginx vhost from
#                   docker/templates/nginx-site-*.conf and obtains a Let's Encrypt
#                   certificate for it BEFORE the first container start
#   --certbot-email registration/expiry-notice address for certbot (required with
#                   --domain)
#   --seed-admin[-password-b64]
#                   bootstrap login for a database this run created: creates the
#                   administrator with a usable password. Skipped when the database
#                   already existed, so a redeploy never resets a live password.
#
# Host layout created:
#   /srv/app/<project>/docker-compose.yml     - copied verbatim from the template
#   /srv/app/<project>/.env                   - COMPOSE variables (TB_*), generated
#   /srv/app/<project>/env/.env               - app secrets (:ro mount), host-owned
#   /srv/app/<project>/config/*.config.jsonc  - non-secret config (:ro mount)
#   /srv/app/<project>/config-backup/         - replaced config files
#   /srv/logs/<project>/                      - application logs
#   /srv/data/<project>/uploads/{media,scorm,templates}
#   /etc/nginx/{sites-available,conf.d}/<project>.conf   - with --domain
# =============================================================================

set -euo pipefail

PROJECT_NAME="${1:?Usage: sudo deploy.sh <project> <port> <image_tar> <node_env> [--clone-from <src>] [--reset-db]}"
SERVICE_PORT="${2:?Missing port argument}"
IMAGE_TAR="${3:?Missing image tar path}"
NODE_ENV_NAME="${4:?Missing node_env argument (production|test|...)}"
shift 4

CLONE_FROM=""
INIT_DB_FROM=""
RESET_DB=false
SITE_DOMAIN=""
CERTBOT_EMAIL=""
SEED_ADMIN=""
SEED_ADMIN_PW_B64=""
while [ $# -gt 0 ]; do
    case "$1" in
        --clone-from)   CLONE_FROM="${2:?--clone-from needs a source project}"; shift 2 ;;
        --init-db-from) INIT_DB_FROM="${2:?--init-db-from needs a source project}"; shift 2 ;;
        --reset-db)     RESET_DB=true; shift ;;
        --domain)       SITE_DOMAIN="${2:?--domain needs an FQDN}"; shift 2 ;;
        --certbot-email) CERTBOT_EMAIL="${2:?--certbot-email needs an address}"; shift 2 ;;
        --seed-admin)   SEED_ADMIN="${2:?--seed-admin needs an email}"; shift 2 ;;
        --seed-admin-password-b64)
                        SEED_ADMIN_PW_B64="${2:?--seed-admin-password-b64 needs a value}"; shift 2 ;;
        "")             shift ;;
        *)              echo "Unknown argument: $1" >&2; exit 1 ;;
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
# Shared by every instance published under a domain: one webroot for the ACME
# http-01 challenge, so renewals keep working whichever vhost answers.
ACME_WEBROOT="/var/www/certbot"

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
#
# The result is written THROUGH the original file (`cat >`), never moved onto it.
# `mv` renames the temp file, so the env file became a NEW inode owned by root —
# the app runs as UID 1500 and lost its read on a 0640 file. That is invisible on
# production (no secrets are rewritten there) and broke every test deploy, where
# the clone alignment below rewrites DATABASE_URL and the ENCRYPTION_* keys.
upsert_env() {
    grep -v "^$1=" "$3" > "$3.tmp" 2>/dev/null || true
    printf '%s=%s\n' "$1" "$2" >> "$3.tmp"
    cat "$3.tmp" > "$3"
    rm -f "$3.tmp"
}
# Ownership+mode the secrets file must ALWAYS end up with: owned by the app UID
# (it is bind-mounted at /app/.env and read by the app, a member of neither root
# nor ${APP_GROUP} inside the container), group-readable for host operators, never
# world-readable. Called after every step that writes the file.
seal_env_file() {
    chown "${APP_UID}":"${APP_GROUP}" "$1"
    chmod 640 "$1"
}
normalize_env() { sed -i '1s/^\xef\xbb\xbf//' "$1"; sed -i 's/\r$//' "$1"; }

# 32 random bytes as hex. openssl is not assumed: a Debian host without it still
# has /dev/urandom, and a deploy must not fail on a missing optional tool.
gen_secret() {
    if command -v openssl > /dev/null 2>&1; then
        openssl rand -hex 32
    else
        head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}
# Write KEY ($1) into env file ($2) with a fresh random value, but ONLY when it has
# no value yet — so a mirror generates its secrets once, on the deploy that creates
# it, and every later deploy leaves them (and therefore the data encrypted with
# them) alone.
ensure_secret() {
    local current
    current="$(read_env "$1" "$2")"
    [ -n "${current}" ] && return 0
    upsert_env "$1" "$(gen_secret)" "$2"
    info "  generated ${1}"
}

[ "$EUID" -ne 0 ] && error "Run with root privileges: sudo $0 $*"
[ -n "${CLONE_FROM}" ] && [ -n "${INIT_DB_FROM}" ] && \
    error "--clone-from and --init-db-from are mutually exclusive: a database is either copied or created empty."
[ "${RESET_DB}" = true ] && [ -z "${CLONE_FROM}" ] && [ -z "${INIT_DB_FROM}" ] && \
    error "--reset-db requires --clone-from or --init-db-from: this script never drops a database it cannot re-create."
[ -n "${SITE_DOMAIN}" ] && [ -z "${CERTBOT_EMAIL}" ] && \
    error "--domain requires --certbot-email: certbot registers the ACME account against it and sends expiry notices there."
[ -n "${SEED_ADMIN}" ] && [ -z "${SEED_ADMIN_PW_B64}" ] && \
    error "--seed-admin requires --seed-admin-password-b64: an account without a usable password can only be reached by email reset."

info "========================================"
info "Project:   ${PROJECT_NAME}"
info "Port:      ${SERVICE_PORT}"
info "NODE_ENV:  ${NODE_ENV_NAME}"
info "Image:     ${IMAGE_NAME}:latest"
[ -n "${CLONE_FROM}" ] && info "DB source: ${CLONE_FROM} (clone if missing, reset=${RESET_DB})"
[ -n "${INIT_DB_FROM}" ] && info "DB:        empty, created if missing (coordinates from ${INIT_DB_FROM}, reset=${RESET_DB})"
[ -n "${SITE_DOMAIN}" ] && info "Domain:    ${SITE_DOMAIN} (nginx vhost + Let's Encrypt certificate)"
[ -n "${SEED_ADMIN}" ] && info "Seed:      administrator ${SEED_ADMIN} (only if this run creates the database)"
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
    || error "Image has missing/non-executable/CRLF entrypoint. Rebuild with scripts\\deploy\\deploy.bat."
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
# Logs a root-run one-off container left behind (app.log of the first deploy with the
# file sink): the app cannot append to them, so they pass to the app UID. Only root-owned
# files are touched — a log the app already owns, or a rotated archive, stays as it is.
find "${LOG_DIR}" -maxdepth 1 -type f -name '*.log' -user 0 -exec chown "${APP_UID}":"${APP_GROUP}" {} + 2>/dev/null || true
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
    elif [ -n "${INIT_DB_FROM}" ]; then
        # A mirror starts with an EMPTY secrets file rather than a copy: the block
        # below fills in exactly what it needs — the PostgreSQL coordinates and the
        # SMTP account borrowed from the source instance, everything else generated.
        # Copying the source file would drag its DATABASE_URL and encryption keys
        # along, and an instance holding production's keys is a leak with no upside:
        # it has no production data to decrypt.
        [ -f "/srv/app/${INIT_DB_FROM}/env/.env" ] || \
            error "Source instance secrets not found: /srv/app/${INIT_DB_FROM}/env/.env
       --init-db-from borrows the PostgreSQL coordinates from that instance, so it must be deployed first."
        printf '%s\n' \
            "# Secrets for the '${PROJECT_NAME}' instance — generated by deploy.sh on $(date -Iseconds)." \
            "# Host-owned: no later deploy overwrites this file." > "${ENV_FILE}"
        ok "env/.env created empty (mirror of ${INIT_DB_FROM}, secrets generated below)"
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

# --- Mirror: the values that make this instance itself ------------------------
# Done here, before the database section, because that section reads DATABASE_URL
# from this file like it does for every other instance.
if [ -n "${INIT_DB_FROM}" ]; then
    SRC_ENV="/srv/app/${INIT_DB_FROM}/env/.env"
    [ -f "${SRC_ENV}" ] || error "Source instance secrets not found: ${SRC_ENV}"
    SRC_URL="$(read_env DATABASE_URL "${SRC_ENV}")"
    [ -n "${SRC_URL}" ] || error "DATABASE_URL not found in ${SRC_ENV}"

    # Same server, same PostgreSQL role — a database of our own. Re-derived on every
    # deploy (like the clone path) so the instance can never drift onto the source
    # database after a hand edit.
    MIRROR_DB_NAME="${PROJECT_NAME}"
    MIRROR_URL_PREFIX="${SRC_URL%/*}"
    MIRROR_URL_QUERY=""
    [[ "${SRC_URL}" == *\?* ]] && MIRROR_URL_QUERY="?${SRC_URL#*\?}"
    upsert_env DATABASE_URL "${MIRROR_URL_PREFIX}/${MIRROR_DB_NAME}${MIRROR_URL_QUERY}" "${ENV_FILE}"

    # Session and encryption keys are the mirror's OWN and are generated once: it
    # holds no data encrypted by the source, so inheriting those keys would spread
    # them for nothing. `ensure_secret` is a no-op from the second deploy on —
    # regenerating ENCRYPTION_* would make every email already stored here
    # undecryptable.
    ensure_secret SESSION_SECRET      "${ENV_FILE}"
    ensure_secret ENCRYPTION_PASSWORD "${ENV_FILE}"
    ensure_secret ENCRYPTION_SALT     "${ENV_FILE}"

    # The SMTP account IS inherited: it is the one thing a fresh instance cannot
    # invent, and without working mail nobody can be invited or reset a password.
    for key in SMTP_USER SMTP_PASS; do
        if [ -z "$(read_env "${key}" "${ENV_FILE}")" ]; then
            value="$(read_env "${key}" "${SRC_ENV}")"
            [ -n "${value}" ] && upsert_env "${key}" "${value}" "${ENV_FILE}"
        fi
    done
    ok "Mirror secrets aligned: DATABASE_URL -> .../${MIRROR_DB_NAME}, own session/encryption keys, SMTP from ${INIT_DB_FROM}"
fi

# The public URL is what config/mirror.config.jsonc reads as server.appUrl, so it
# follows the domain this deploy publishes — one source of truth for both nginx and
# the links the application puts in its emails.
if [ -n "${SITE_DOMAIN}" ]; then
    upsert_env APP_URL "https://${SITE_DOMAIN}" "${ENV_FILE}"
    ok "APP_URL set to https://${SITE_DOMAIN}"
fi

# The seeded administrator is also a configured superadmin, so the very first boot
# provisions the account even before the seeding step runs. Appended rather than
# overwritten: a list an operator has extended on the host must survive a redeploy.
if [ -n "${SEED_ADMIN}" ]; then
    CURRENT_SUPERADMINS="$(read_env SUPERADMIN_EMAILS "${ENV_FILE}")"
    if [ -z "${CURRENT_SUPERADMINS}" ]; then
        upsert_env SUPERADMIN_EMAILS "${SEED_ADMIN}" "${ENV_FILE}"
    elif [[ ",${CURRENT_SUPERADMINS}," != *",${SEED_ADMIN},"* ]]; then
        upsert_env SUPERADMIN_EMAILS "${CURRENT_SUPERADMINS},${SEED_ADMIN}" "${ENV_FILE}"
    fi
fi

# OWNED BY THE APP UID, not root. This file is bind-mounted at /app/.env and read
# by the application, which runs as UID 1500 (gosu, see entrypoint.sh) — a member
# of neither root nor ${APP_GROUP} inside the container. With root ownership and
# 0640 the read fails with EACCES, and dotenv reports that failure only in a
# return value nobody checks: the app then boots with an EMPTY environment and
# dies on "DATABASE_URL must be set" while the file sits there, perfectly valid.
# Group ${APP_GROUP} keeps host-side operators able to edit it; 0640 keeps the
# secrets off world-read.
seal_env_file "${ENV_FILE}"

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
       The image carries no config — the deploy package must ship it (rebuild with scripts\\deploy\\deploy.bat)."
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
    seal_env_file "${ENV_FILE}"
    ok "Secrets aligned to the clone: DATABASE_URL -> .../${DB_NAME}, ENCRYPTION_* from ${CLONE_FROM}"
fi

info "Database: ${DB_NAME} (user ${DB_USER})"

command -v psql > /dev/null 2>&1 || \
    error "psql not found on this host — the database tooling below (existence check, clone) needs it."

DB_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || true)"
DB_EXISTS="${DB_EXISTS// /}"

# Whether THIS run brought the database into existence. The seeding step keys off
# it: a bootstrap login belongs to an empty database, never to one that has been
# in use — otherwise every redeploy would silently reset a live password.
DB_CREATED=false

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
    # CREATE on the DATABASE because the migrator keeps its ledger in a
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
    DB_CREATED=true
elif [ -n "${INIT_DB_FROM}" ]; then
    # An EMPTY database, owned by the app role from the start — no restore happened,
    # so there is nothing to reassign. CREATE on the database is granted explicitly
    # anyway: the owner has it implicitly today, but the migrator keeps its ledger in
    # a separate `drizzle` schema and a future role change must not silently break
    # migrations. Everything else — tables, built-in templates, the superadmin
    # accounts — is produced by the migrations and the application's own startup.
    info "Creating empty database '${DB_NAME}' owned by '${DB_USER}'..."
    sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
        "GRANT CREATE ON DATABASE \"${DB_NAME}\" TO \"${DB_USER}\";" > /dev/null
    ok "Database created empty: ${DB_NAME}"
    DB_CREATED=true
else
    error "Database '${DB_NAME}' does not exist.
       A production database is never created implicitly. Create it once:
         sudo -u postgres createdb -O ${DB_USER} ${DB_NAME}
       ...or deploy this instance with --clone-from <source_project> to clone one,
       or with --init-db-from <source_project> to create it empty (mirror)."
fi

# ---------------------------------------------------------------------------
# 7b. Let the container reach a host-local PostgreSQL (idempotent)
#
# BEFORE the first database access — which is a correction, not a preference. This
# used to run after the application had started, and that worked only for an
# instance whose subnet some earlier deploy had already added: every compose
# project gets its OWN docker bridge network with its OWN /16, and pg_hba.conf is
# matched per subnet. A brand-new instance was therefore refused by PostgreSQL on
# the very first step that touches the database — the migrations — and the reason
# was invisible, because the former `drizzle-kit migrate` answered a connection
# failure by exiting 1 with NO message whatsoever. Open the door first, then knock.
# ---------------------------------------------------------------------------
# One-off containers below (`docker compose run ... --entrypoint sh`) bypass the image
# entrypoint, which is what drops root to the app user via gosu, and the service runs as
# `user: root`. Each of them therefore passes `--user nodejs` explicitly: they share the
# logs and uploads volumes with the app, and a file they create as root (app.log, first
# of all) is one the app — UID 1500 — can no longer write to. That is how the first
# deploy with the file sink left app.log root-owned and the running app logging nowhere.
DOCKER_NETWORK="${PROJECT_NAME}_default"
# Compose creates the network on its first `run`; none has happened yet (section 6
# ended with `down`), so materialise it with a no-op container to learn the subnet.
docker network inspect "${DOCKER_NETWORK}" > /dev/null 2>&1 || \
    docker compose run --rm -T --no-deps --user nodejs --entrypoint sh app -c 'true' > /dev/null 2>&1 || true
DOCKER_SUBNET="$(docker network inspect "${DOCKER_NETWORK}" \
                 -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || true)"

if [ -z "${DOCKER_SUBNET}" ]; then
    warn "Cannot determine the subnet of docker network '${DOCKER_NETWORK}'."
    warn "  If the database is host-local, the migration step below may be refused by pg_hba.conf."
else
    PG_HBA="$(sudo -u postgres psql -tAc "SHOW hba_file" 2>/dev/null | tr -d '[:space:]' || true)"

    if [ -z "${PG_HBA}" ] || [ ! -f "${PG_HBA}" ]; then
        warn "Cannot locate pg_hba.conf — if the DB is host-local, add: host all all ${DOCKER_SUBNET} md5"
    elif grep -qE "^host[[:space:]].*${DOCKER_SUBNET}" "${PG_HBA}" 2>/dev/null; then
        ok "pg_hba.conf already allows ${DOCKER_SUBNET} (${DOCKER_NETWORK})"
    else
        # `md5` rather than `scram-sha-256` deliberately: with a SCRAM-stored
        # password PostgreSQL performs SCRAM for an md5 line anyway, and this is
        # the form every instance already on this host was added with.
        echo "host  all  all  ${DOCKER_SUBNET}  md5" >> "${PG_HBA}"
        sudo -u postgres psql -c "SELECT pg_reload_conf();" > /dev/null 2>&1 \
            && ok "pg_hba.conf: added ${DOCKER_SUBNET} for ${PROJECT_NAME} (PostgreSQL reloaded)" \
            || warn "pg_hba.conf: added ${DOCKER_SUBNET} — reload manually: sudo systemctl reload postgresql"
    fi
fi

# ---------------------------------------------------------------------------
# 8. Schema migrations (identical for every instance)
# ---------------------------------------------------------------------------
# Applied BEFORE the app boots: startup (syncBuiltinTemplates) is awaited before
# the HTTP server listens and aborts the whole boot on a stale schema.
#
# `dist/migrate.cjs` (scripts/db/migrate.ts: the migrator built into drizzle-orm,
# the same one `drizzle-kit migrate` wraps) applies the reviewed SQL under drizzle/
# in order — unlike the former `push --force` it never diffs the live DB and never
# silently drops/recreates on drift. drizzle-kit itself is not in the image.
#
# -T is essential, not cosmetic: without it `docker compose run` attaches to the
# terminal that `ssh -tt` provides and tears the stream down the moment the
# container exits, losing the final stderr. The inner redirect-then-cat is what
# makes a failure legible: the script ends a failed run with process.exit(1),
# truncating pending writes to a PIPE; writes to a FILE are synchronous.
# Ledger repair FIRST. `migrate` decides what to apply by TIME (MAX(created_at) in
# drizzle.__drizzle_migrations against `when` in the journal), never by hash — so a
# migration that was REGENERATED after it had already been applied looks unapplied,
# is run a second time and dies on "already exists", aborting the release before the
# migrations that matter. The drift lives in each instance's DATABASE, so it cannot be
# fixed in the repository: this step realigns the timestamps of rows whose hash is
# already in the ledger, and never inserts one (see the script header).
#
# Non-fatal on purpose: if it cannot run, `migrate` below fails with its own legible
# error, and one failure story is better than two.
info "Reconciling the migration ledger with the journal..."
if ! docker compose run --rm -T --no-deps --user nodejs --entrypoint sh app \
    -c 'node dist/reconcile-migration-ledger.cjs > /tmp/reconcile.log 2>&1; ec=$?; cat /tmp/reconcile.log; exit $ec'; then
    warn "ledger reconcile FAILED — continuing; the migration step below will report the real error."
fi

info "Applying DB migrations (dist/migrate.cjs)..."
if ! docker compose run --rm -T --no-deps --user nodejs --entrypoint sh app \
    -c 'node dist/migrate.cjs > /tmp/migrate.log 2>&1; ec=$?; cat /tmp/migrate.log; exit $ec'; then
    echo ""
    warn "migrate FAILED — see the error above. Known causes:"
    warn "  'no pg_hba.conf entry for host', 'password authentication failed', ECONNREFUSED:"
    warn "     the container cannot CONNECT. Check that pg_hba.conf allows the docker subnet"
    warn "     ${DOCKER_SUBNET:-of this instance} (network ${DOCKER_NETWORK}) and that the"
    warn "     password in env/.env is right:"
    warn "       sudo -u postgres psql -tAc \"SHOW hba_file\"   # then grep '^host' in it"
    warn "  'permission denied for database': the app role lacks CREATE on the DB"
    warn "     (migrate needs it for the drizzle schema). As the postgres superuser:"
    warn "     GRANT CREATE ON DATABASE \"${DB_NAME}\" TO \"${DB_USER}\";"
    warn "  'relation/table already exists': this database predates the migrate era"
    warn "     and was never baselined. Run ONCE, then redeploy:"
    warn "     cd ${APP_DIR} && docker compose run --rm -T --no-deps --user nodejs --entrypoint sh \\"
    warn "       app -c 'node scripts/db/run-sql.cjs drizzle/baseline-existing-db.sql'"
    warn "  See drizzle/README.md."
    error "Aborting before start — the schema is not in a known state."
fi
ok "DB migrations applied"

# ---------------------------------------------------------------------------
# 8b. Data step that SQL cannot express: canonical page text
# ---------------------------------------------------------------------------
# Content-page fields get their typography on save, so pages written before the
# text pipeline existed keep straight quotes and hyphens until someone re-saves
# them. This bundled script applies the SAME pass the application does (it is
# built from `shared/text`, not reimplemented in SQL) and writes only the rows
# that actually change, so every later deploy re-runs it as a cheap no-op.
#
# Non-fatal on purpose: a cosmetic backfill must never block a release. A failure
# is reported and the deploy continues — the next one retries it.
info "Normalising content-page text (backfill)..."
if ! docker compose run --rm -T --no-deps --user nodejs --entrypoint sh app \
    -c 'node dist/backfill-page-text.cjs > /tmp/backfill.log 2>&1; ec=$?; cat /tmp/backfill.log; exit $ec'; then
    warn "content-page text backfill FAILED — see the error above."
    warn "  The release continues: the step is cosmetic and re-runs on the next deploy."
else
    ok "Content-page text normalised"
fi

# ---------------------------------------------------------------------------
# 8c. Does this instance still need its bootstrap login?
#
# Asked HERE, while the schema exists but the application has never run. That
# order matters: startup provisions the configured superadmin accounts itself
# (provisionSuperadmins, server/index.ts), so once the app has booted `users` is
# never empty and the question can no longer be answered.
#
# "This run created the database" alone was too narrow a test: a first deploy that
# failed AFTER creating the database — as one did — would leave the instance
# permanently unseeded on every retry, i.e. with no way in at all. The honest
# invariant is "nobody has used this instance yet".
# ---------------------------------------------------------------------------
SEED_NEEDED=false
if [ -n "${SEED_ADMIN}" ]; then
    if [ "${DB_CREATED}" = true ]; then
        SEED_NEEDED=true
    else
        EXISTING_USERS="$(sudo -u postgres psql -d "${DB_NAME}" -tAc \
                          "SELECT count(*) FROM public.users" 2>/dev/null | tr -d '[:space:]' || true)"
        if [ "${EXISTING_USERS}" = "0" ]; then
            SEED_NEEDED=true
            info "No users in '${DB_NAME}' yet — the bootstrap login will be created."
        else
            ok "Seed skipped: '${DB_NAME}' already has ${EXISTING_USERS:-some} user(s)"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# 9. Reverse proxy and TLS certificate (only with --domain)
#
# BEFORE the first container start, on purpose. A mirror runs with
# cookieSecure=true (config/mirror.config.jsonc), so until TLS actually works the
# browser drops every session cookie and a correct password looks wrong — a
# failure mode that costs an hour to recognise. Getting the certificate first
# means the instance is either reachable properly or not started at all.
#
# The certificate is obtained with `certbot certonly --webroot`, never with the
# nginx installer plugin: that plugin edits the vhost in place, and the next
# deploy — which rewrites the vhost from the repo template — would throw its TLS
# block away. Issuance and configuration stay separate so both are reproducible.
# ---------------------------------------------------------------------------
if [ -n "${SITE_DOMAIN}" ]; then
    info "Publishing at ${SITE_DOMAIN}..."

    command -v nginx > /dev/null 2>&1 || \
        error "nginx is not installed on this host — --domain has nothing to configure."
    command -v certbot > /dev/null 2>&1 || \
        error "certbot is not installed on this host. Install it once, then re-run:
         sudo apt-get install -y certbot"

    if [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
        SITE_FILE="/etc/nginx/sites-available/${PROJECT_NAME}.conf"
        SITE_LINK="/etc/nginx/sites-enabled/${PROJECT_NAME}.conf"
    elif [ -d /etc/nginx/conf.d ]; then
        SITE_FILE="/etc/nginx/conf.d/${PROJECT_NAME}.conf"
        SITE_LINK=""
    else
        error "Neither /etc/nginx/sites-available nor /etc/nginx/conf.d exists — cannot place a vhost."
    fi

    HTTP_TEMPLATE="${PACKAGE_DIR}/nginx/nginx-site-http.conf"
    TLS_TEMPLATE="${PACKAGE_DIR}/nginx/nginx-site-tls.conf"
    [ -f "${HTTP_TEMPLATE}" ] && [ -f "${TLS_TEMPLATE}" ] || \
        error "nginx templates missing from the deploy package (nginx/nginx-site-{http,tls}.conf).
       Rebuild the package with scripts\\deploy\\deploy.bat."

    CERT_DIR="/etc/letsencrypt/live/${SITE_DOMAIN}"

    # One webroot for every instance; nginx must be able to read it as its own user.
    mkdir -p "${ACME_WEBROOT}/.well-known/acme-challenge"
    chmod -R 755 "${ACME_WEBROOT}"

    # The host file is REGENERATED from the repo template on every deploy — that is
    # what keeps the proxy configuration under version control. Never hand-edit
    # ${SITE_FILE}: the edit lives until the next deploy and no longer.
    write_site() {
        sed -e "s|__SERVER_NAME__|${SITE_DOMAIN}|g" \
            -e "s|__PROXY_PORT__|${SERVICE_PORT}|g" \
            -e "s|__ACME_WEBROOT__|${ACME_WEBROOT}|g" \
            -e "s|__CERT_DIR__|${CERT_DIR}|g" \
            "$1" > "${SITE_FILE}"
        chmod 644 "${SITE_FILE}"
        [ -n "${SITE_LINK}" ] && ln -sfn "${SITE_FILE}" "${SITE_LINK}"
        return 0
    }
    reload_nginx() {
        nginx -t || error "nginx rejected its configuration (see above).
       ${SITE_FILE} is in place but nginx was NOT reloaded — fix or remove it."
        systemctl reload nginx > /dev/null 2>&1 || nginx -s reload
    }

    if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
        # A warning rather than a gate: the public A record may legitimately point
        # at a NAT address this host does not recognise as its own.
        RESOLVED="$(getent hosts "${SITE_DOMAIN}" 2>/dev/null | awk '{print $1}' | head -n1 || true)"
        if [ -n "${RESOLVED}" ]; then
            info "${SITE_DOMAIN} resolves to ${RESOLVED}"
        else
            warn "${SITE_DOMAIN} does not resolve from this host — certbot will fail unless the DNS record exists."
        fi

        # Plain-HTTP vhost first: the challenge is served from the webroot by nginx
        # itself, so it works while the application is still down.
        write_site "${HTTP_TEMPLATE}"
        reload_nginx
        ok "HTTP vhost active — requesting a certificate"

        if ! certbot certonly --webroot -w "${ACME_WEBROOT}" -d "${SITE_DOMAIN}" \
             --non-interactive --agree-tos -m "${CERTBOT_EMAIL}" --keep-until-expiring; then
            error "certbot could not issue a certificate for ${SITE_DOMAIN} (see above). Usual causes:
         - the DNS A record does not point at this server yet;
         - port 80 is not reachable from the internet (firewall / port forwarding);
         - Let's Encrypt rate limit for this domain.
       Stopping BEFORE the first start on purpose: this instance runs with secure
       cookies, so over plain HTTP nobody could log in anyway. The HTTP vhost is
       already in place, so the domain will answer 502 until the deploy succeeds."
        fi
        ok "Certificate issued: ${CERT_DIR}"
    else
        ok "Certificate already present: ${CERT_DIR} (renewal is certbot's own timer)"
    fi

    write_site "${TLS_TEMPLATE}"
    reload_nginx
    ok "nginx vhost active: https://${SITE_DOMAIN} -> 127.0.0.1:${SERVICE_PORT}"
fi

# ---------------------------------------------------------------------------
# 10. Start and wait for health
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
# 11. (was: pg_hba for the docker subnet — moved to step 7b)
#
# It has to happen BEFORE the migrations, not after the app is up: here it was too
# late to help the very instance that needs it. See step 7b for the full story.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 12. Seed: a login for a database this run created
#
# The minimum a from-scratch instance needs, and no more. Two of the three layers
# are already done by the time we get here and are NOT reimplemented:
#   - the schema comes from dist/migrate.cjs (step 8);
#   - the design-template registry and the configured superadmin accounts come
#     from the application's own startup (syncBuiltinTemplates /
#     provisionSuperadmins, server/index.ts).
# What startup CANNOT do is hand over a usable password: provisionSuperadmins
# deliberately stores random unusable bytes and expects a password-reset email.
# On a brand-new instance whose SMTP has never been exercised that is a locked
# door, so this step sets a real password with the same helper the operator would
# use by hand (scripts/deploy/create-admin.mjs).
#
# Gated on SEED_NEEDED (decided in step 8c, before the app could add users of its
# own): seeding is part of BIRTH. A redeploy must never reset the password of an
# account that has been in use.
# ---------------------------------------------------------------------------
if [ -n "${SEED_ADMIN}" ]; then
    if [ "${SEED_NEEDED}" != true ]; then
        ok "Seed skipped: the instance is already in use (a redeploy never resets a live password)"
    else
        SEED_HELPER="${PACKAGE_DIR}/create-admin.mjs"
        [ -f "${SEED_HELPER}" ] || \
            error "create-admin.mjs missing from the deploy package — cannot seed the administrator.
       Rebuild the package with scripts\\deploy\\deploy.bat."

        info "Seeding administrator ${SEED_ADMIN}..."
        # Copied into /app, not /tmp: Node resolves modules relative to the script,
        # and the helper imports /app/server/config-loader.mjs plus /app/node_modules.
        docker cp "${SEED_HELPER}" "${PROJECT_NAME}:/app/create-admin.mjs"
        SEED_RC=0
        docker exec \
            -e CA_EMAIL="${SEED_ADMIN}" \
            -e CA_PASSWORD_B64="${SEED_ADMIN_PW_B64}" \
            "${PROJECT_NAME}" node /app/create-admin.mjs || SEED_RC=$?
        docker exec "${PROJECT_NAME}" rm -f /app/create-admin.mjs > /dev/null 2>&1 || true

        [ "${SEED_RC}" -eq 0 ] || error "Seeding the administrator failed (exit ${SEED_RC}).
       The instance is running but nobody can log in — fix and re-run, or create the
       account by hand with scripts\\deploy\\create-admin.bat."
        ok "Administrator seeded: ${SEED_ADMIN}"
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
if [ -n "${SITE_DOMAIN}" ]; then
    info "URL:     https://${SITE_DOMAIN}   (direct: http://$(hostname -I | awk '{print $1}'):${SERVICE_PORT})"
    info "Vhost:   ${SITE_FILE}  (rewritten by every deploy from the repo template)"
else
    info "URL:     http://$(hostname -I | awk '{print $1}'):${SERVICE_PORT}"
fi
[ -n "${SEED_ADMIN}" ] && [ "${SEED_NEEDED}" = true ] && \
    info "Login:   ${SEED_ADMIN} (password as given to the deploy)"
info "Logs:    cd ${APP_DIR} && docker compose logs -f"
info "Config:  nano ${CONFIG_DIR}/$(basename "${CONFIG_FILE_REL}") && docker compose restart"
info "         (repo is the source of truth — every deploy refreshes it)"
info "Secrets: nano ${ENV_FILE} && docker compose up -d   (host-owned, never overwritten)"
info "========================================"
