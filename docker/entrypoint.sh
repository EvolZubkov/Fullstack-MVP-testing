#!/bin/bash
# =============================================================================
# Container entrypoint for test-builder.
# Runs as root to prepare volume mount points, then drops privileges to nodejs.
#
# Expected volume mounts (configured by docker/scripts/deploy.sh):
#   /app/uploads/   - media and SCORM uploads (writable)
#   /app/logs/      - application logs (writable)
#   /app/.env       - application env file (read-only)
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
    ok "ENV: /app/.env (file, secrets)"
elif [ -n "${DATABASE_URL:-}" ]; then
    ok "ENV: injected from environment"
else
    warn "No /app/.env file and DATABASE_URL not set — app may fail to start"
fi

# Non-secret settings come from the baked, committed per-environment config file
# (config/<NODE_ENV>.config.jsonc, falling back to config/config.jsonc), selected
# by NODE_ENV. Only secrets are host-side (/app/.env).
if [ -f "/app/config/${NODE_ENV}.config.jsonc" ]; then
    ok "CONFIG: /app/config/${NODE_ENV}.config.jsonc (baked)"
else
    ok "CONFIG: /app/config/config.jsonc (baked default; NODE_ENV=${NODE_ENV:-unset})"
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
