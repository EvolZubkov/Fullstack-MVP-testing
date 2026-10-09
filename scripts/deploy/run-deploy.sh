#!/bin/bash
# Entry point on the server: normalizes the shell scripts written on Windows
# (CRLF -> LF) and runs the privileged deploy step. Invoked by
# scripts/deploy/deploy.bat over the single SSH connection it opens.
#
# Usage: bash run-deploy.sh <project> <port> <image_tar> <node_env> [deploy.sh options...]
#
# Every argument is passed through to deploy.sh untouched — see its header for the
# option list (--clone-from, --init-db-from, --reset-db, --domain, --certbot-email,
# --seed-admin, --seed-admin-password-b64).

set -euo pipefail

PROJECT_NAME="${1:?Usage: bash run-deploy.sh <project> <port> <image_tar> <node_env> [deploy.sh options...]}"
SERVICE_PORT="${2:?Missing port argument}"
IMAGE_TAR="${3:?Missing image tar path}"
NODE_ENV_NAME="${4:?Missing node_env argument}"
shift 4

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${PACKAGE_DIR}"

sed -i 's/\r$//' "${PACKAGE_DIR}/deploy.sh"
chmod +x "${PACKAGE_DIR}/deploy.sh"

sudo bash "${PACKAGE_DIR}/deploy.sh" \
    "${PROJECT_NAME}" "${SERVICE_PORT}" "${IMAGE_TAR}" "${NODE_ENV_NAME}" "$@"
