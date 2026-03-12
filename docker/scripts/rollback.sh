#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Search for deploy.env (next to script or in temp archive)
if [ -f "$SCRIPT_DIR/config/deploy.env" ]; then
    source "$SCRIPT_DIR/config/deploy.env"
elif [ -f "$SCRIPT_DIR/deploy.env" ]; then
    source "$SCRIPT_DIR/deploy.env"
else
    echo "Error: deploy.env not found"
    echo "Searched in:"
    echo "  - $SCRIPT_DIR/config/deploy.env"
    echo "  - $SCRIPT_DIR/deploy.env"
    exit 1
fi

# Derived paths
APP_DIR="${SRV_APP_BASE}/${PROJECT_NAME}"
DATA_DIR="${SRV_DATA_BASE}/${PROJECT_NAME}"
CONTAINER_NAME="${PROJECT_NAME}"
IMAGE_NAME="${PROJECT_NAME}"

echo "=== Rollback ${PROJECT_NAME} ==="
echo ""
echo "WARNING! Will be deleted:"
echo "  - Container: $CONTAINER_NAME"
echo "  - Image: $IMAGE_NAME"
echo "  - App directory: $APP_DIR"
echo "  - Data directory: $DATA_DIR (including uploads!)"
echo ""
read -p "Are you sure? This action is irreversible! [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Stop and remove container
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping container..."
    docker stop "$CONTAINER_NAME" || true
    echo "Removing container..."
    docker rm "$CONTAINER_NAME" || true
fi

# Remove image
if docker images --format '{{.Repository}}' | grep -q "^${IMAGE_NAME}$"; then
    echo "Removing image..."
    docker rmi "$IMAGE_NAME:latest" || true
fi

# Remove directories
if [ -d "$APP_DIR" ]; then
    echo "Removing $APP_DIR..."
    rm -rf "$APP_DIR"
fi

if [ -d "$DATA_DIR" ]; then
    echo "Removing $DATA_DIR..."
    rm -rf "$DATA_DIR"
fi

echo ""
echo "=== Rollback complete ==="
