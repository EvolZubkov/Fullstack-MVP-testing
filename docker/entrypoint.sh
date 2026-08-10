#!/bin/bash
# =============================================================================
# Container entrypoint for test-builder.
# Runs as root to prepare volume mount points, then drops privileges to nodejs.
#
# Expected volume mounts (configured by scripts/deploy/deploy.sh):
#   /app/uploads/   - media and SCORM uploads (writable)
#   /app/logs/      - application logs (writable)
#   /app/.env       - application env file, secrets (read-only)
#   /app/config/    - non-secret config, *.config.jsonc (read-only, required)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${BLUE}[entrypoint]${NC} $*"; }
ok()    { echo -e "${GREEN}[entrypoint]${NC} $*"; }
warn()  { echo -e "${YELLOW}[entrypoint]${NC} $*"; }
error() { echo -e "${RED}[entrypoint]${NC} $*"; exit 1; }

[ -z "${PORT:-}" ] && error "PORT env var is not set"

# ---------------------------------------------------------------------------
# Configuration source: either a mounted /app/.env file (read by dotenv) or
# environment variables injected by compose `env_file:`. Both are supported.
# The app fails fast on its own if DATABASE_URL is missing, so we only warn.
# ---------------------------------------------------------------------------
if [ -f /app/.env ]; then
    # Readable BY THE APP USER, not by root: the app runs as nodejs (gosu, below).
    # A root-owned 0640 mount passes every root-side check and then fails inside
    # dotenv with EACCES, which it reports only in a return value — the app would
    # boot with an empty environment and die on "DATABASE_URL must be set" with the
    # file plainly present. Fail here instead, with the fix.
    if gosu nodejs test -r /app/.env; then
        ok "ENV: /app/.env (file, secrets)"
    else
        # The command below is deliberately written with a glob instead of a
        # <placeholder>: it has to survive being copy-pasted verbatim, and a shell
        # would swallow angle brackets as a redirection.
        error "/app/.env exists but is NOT readable by the app user (UID 1500).
       Fix the ownership of the mounted file on the host, then recreate:
         sudo chown 1500 /srv/app/*/env/.env
         cd /srv/app/<this project> && sudo docker compose up -d --force-recreate
       Group and mode 0640 can stay — only the owner must be the app UID."
    fi
elif [ -n "${DATABASE_URL:-}" ]; then
    ok "ENV: injected from environment"
else
    warn "No /app/.env file and DATABASE_URL not set — app may fail to start"
fi

# Non-secret settings come from the MOUNTED config volume (/app/config), not from
# the image: the deploy puts the config files on the host and mounts them
# read-only, so a settings change is an edit plus a restart. Secrets stay in
# /app/.env. Fail fast when nothing is mounted — otherwise the app would silently
# boot on built-in defaults with an empty DATABASE_URL and fail later with a far
# less obvious error.
#
# Which file the app picks is NOT decided by NODE_ENV here: the server bundle has
# NODE_ENV folded to "production" at build time (scripts/build/build.ts), so on its own it
# would always look for config/production.config.jsonc. Compose therefore sets
# CONFIG_FILE explicitly for every instance (docker/templates/docker-compose.yml);
# it is read at runtime and wins. Mirror that order so this check matches reality.
#
# Readability is checked as the APP USER for the same reason as /app/.env above:
# root can read a mount the application cannot.
if [ -n "${CONFIG_FILE:-}" ]; then
    if gosu nodejs test -r "/app/${CONFIG_FILE#/app/}"; then
        ok "CONFIG: ${CONFIG_FILE} (mounted, CONFIG_FILE)"
    elif [ -f "/app/${CONFIG_FILE#/app/}" ]; then
        error "CONFIG_FILE=${CONFIG_FILE} exists but is NOT readable by the app user (UID 1500).
       Make the mounted config world-readable on the host:
         sudo chmod 755 /srv/app/<project>/config && sudo chmod 644 /srv/app/<project>/config/*.jsonc"
    else
        error "CONFIG_FILE=${CONFIG_FILE} does not exist in the container.
       It is resolved relative to /app and must come from the mounted config volume."
    fi
elif gosu nodejs test -r /app/config/production.config.jsonc; then
    ok "CONFIG: /app/config/production.config.jsonc (mounted)"
elif gosu nodejs test -r /app/config/config.jsonc; then
    ok "CONFIG: /app/config/config.jsonc (mounted default)"
else
    error "No config file under /app/config (expected production.config.jsonc or config.jsonc).
       The config volume is not mounted or is empty — the image carries no config.
       Check the 'config' volume in docker-compose.yml and /srv/app/<project>/config on the host."
fi

# ---------------------------------------------------------------------------
# Ensure writable volume mount points exist (may be new empty volumes) and are
# owned by the app user. A host bind-mount can come up root-owned (e.g. created
# by `mkdir` as root in a deploy script); the app runs as nodejs and must be able
# to create uploads/templates/<id>/, uploads/media/..., etc. `chown nodejs`
# (owner only, no group) makes the dirs app-writable WITHOUT touching the
# host-side group deploy.sh sets (botadmins + setgid) for host file management,
# and only rewrites the directory nodes (fast — not recursive into media).
# ---------------------------------------------------------------------------
mkdir -p /app/uploads/media /app/uploads/scorm /app/uploads/templates /app/logs /app/tmp
chown nodejs /app/uploads /app/uploads/media /app/uploads/scorm /app/uploads/templates /app/logs /app/tmp
ok "Volume mount points ready"

# ---------------------------------------------------------------------------
# Drop privileges and start the application
# ---------------------------------------------------------------------------
info "Starting test-builder as nodejs (PORT=${PORT})..."
exec gosu nodejs node dist/index.cjs
