#!/bin/bash
# Unpacking is done by the operator command printed by the Windows upload scripts.
# This wrapper normalizes shell scripts (CRLF -> LF) and runs the privileged deploy step.

set -euo pipefail

PROJECT_NAME="${1:?Usage: bash run-deploy.sh <project_name> <port> <image_tar>}"
SERVICE_PORT="${2:?Missing port argument}"
IMAGE_TAR="${3:?Missing image tar path}"

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${PACKAGE_DIR}"

sed -i 's/\r$//' "${PACKAGE_DIR}/deploy.sh"
chmod +x "${PACKAGE_DIR}/deploy.sh"

sudo bash "${PACKAGE_DIR}/deploy.sh" "${PROJECT_NAME}" "${SERVICE_PORT}" "${IMAGE_TAR}"
