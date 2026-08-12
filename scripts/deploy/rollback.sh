#!/bin/bash
# =============================================================================
# rollback.sh - remove an instance from the server: container, image and all of
# its host directories. Works for any instance (production or test) — the layout
# is identical, so the project name is the only input.
#
# Usage: sudo bash rollback.sh <project>
#
# The DATABASE IS NOT TOUCHED: dropping it is a separate, deliberate act
#   sudo -u postgres dropdb <db>
# =============================================================================

set -euo pipefail

PROJECT_NAME="${1:?Usage: sudo bash rollback.sh <project>}"

APP_DIR="/srv/app/${PROJECT_NAME}"
LOG_DIR="/srv/logs/${PROJECT_NAME}"
DATA_DIR="/srv/data/${PROJECT_NAME}"
CONTAINER_NAME="${PROJECT_NAME}"
IMAGE_NAME="${PROJECT_NAME}"

[ "$EUID" -ne 0 ] && { echo "Run with root privileges: sudo $0 $*"; exit 1; }

echo "=== Rollback ${PROJECT_NAME} ==="
echo ""
echo "WARNING! Will be deleted:"
echo "  - Container:      ${CONTAINER_NAME}"
echo "  - Image:          ${IMAGE_NAME}:latest"
echo "  - App directory:  ${APP_DIR}   (compose, secrets, config)"
echo "  - Log directory:  ${LOG_DIR}"
echo "  - Data directory: ${DATA_DIR}  (including uploads!)"
echo ""
echo "The database is NOT dropped."
echo ""
read -p "Are you sure? This action is irreversible! [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Prefer compose so the network and any one-off containers go too.
if [ -f "${APP_DIR}/docker-compose.yml" ]; then
    echo "Stopping compose project..."
    (cd "${APP_DIR}" && docker compose down --remove-orphans) || true
fi

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Removing container..."
    docker rm -f "${CONTAINER_NAME}" || true
fi

if docker images --format '{{.Repository}}' | grep -q "^${IMAGE_NAME}$"; then
    echo "Removing image..."
    docker rmi "${IMAGE_NAME}:latest" || true
fi

for dir in "${APP_DIR}" "${LOG_DIR}" "${DATA_DIR}"; do
    if [ -d "${dir}" ]; then
        echo "Removing ${dir}..."
        rm -rf "${dir}"
    fi
done

echo ""
echo "=== Rollback complete ==="
echo "Database left intact. To drop it as well:"
echo "  sudo -u postgres dropdb <database>"
