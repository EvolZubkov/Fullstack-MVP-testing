#!/bin/bash
# Entry point on the server: normalizes the shell scripts written on Windows
# (CRLF -> LF) and runs the privileged deploy step. Invoked by
# docker/scripts/deploy.bat over the single SSH connection it opens.
#
# Usage: bash run-deploy.sh <project> <port> <image_tar> <node_env> \
#            [--clone-from <source_project>] [--reset-db]
#
# Every argument is passed through to deploy.sh untouched.

set -euo pipefail

PROJECT_NAME="${1:?Usage: bash run-deploy.sh <project> <port> <image_tar> <node_env> [--clone-from <src>] [--reset-db]}"
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
