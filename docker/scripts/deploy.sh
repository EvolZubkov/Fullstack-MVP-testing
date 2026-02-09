#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find archive next to script
ARCHIVE=$(ls -t "$SCRIPT_DIR"/test_builder_deploy_*.tar.gz 2>/dev/null | head -1)

if [ -z "$ARCHIVE" ]; then
    echo "Error: archive test_builder_deploy_*.tar.gz not found in $SCRIPT_DIR"
    exit 1
fi

echo "=== Extracting $(basename "$ARCHIVE") ==="
DEPLOY_DIR=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$DEPLOY_DIR"

# Load configuration
source "$DEPLOY_DIR/config/deploy.env"

# Derived paths
APP_DIR="${SRV_APP_BASE}/${PROJECT_NAME}"
DATA_DIR="${SRV_DATA_BASE}/${PROJECT_NAME}"
ENV_DIR="${APP_DIR}/env"
UPLOADS_DIR="${DATA_DIR}/uploads"
CONTAINER_NAME="${PROJECT_NAME}"
IMAGE_NAME="${PROJECT_NAME}"

echo "=== Deploy ${PROJECT_NAME} ==="
echo "APP_DIR: $APP_DIR"
echo "DATA_DIR: $DATA_DIR"

# Create directory structure
echo "Creating directories..."
mkdir -p "$APP_DIR" "$ENV_DIR"
mkdir -p "$UPLOADS_DIR/media" "$UPLOADS_DIR/scorm"

# Check .env
if [ ! -f "$ENV_DIR/.env" ]; then
    echo "Copying .env template..."
    cp "$DEPLOY_DIR/env/.env.example" "$ENV_DIR/.env"
    echo ""
    echo "!!! WARNING: Edit $ENV_DIR/.env before starting !!!"
    echo "nano $ENV_DIR/.env"
    echo ""
    read -p "Press Enter after editing .env..."
fi

# Generate docker-compose.yml with variable substitution
echo "Generating docker-compose.yml..."
export IMAGE_NAME CONTAINER_NAME EXPOSE_PORT INTERNAL_PORT UPLOADS_DIR ENV_DIR
envsubst < "$DEPLOY_DIR/config/docker-compose.yml" > "$APP_DIR/docker-compose.yml"

# Set ownership
chown -R "${DIR_OWNER}:${DIR_GROUP}" "$APP_DIR"
chown -R "${DIR_OWNER}:${DIR_GROUP}" "$DATA_DIR"

# Build image from temp directory
echo "Building Docker image..."
cd "$DEPLOY_DIR/source"
docker build -t "$IMAGE_NAME:latest" .

# Stop old container (if exists)
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping old container..."
    docker stop "$CONTAINER_NAME" || true
    docker rm "$CONTAINER_NAME" || true
fi

# Start new container
echo "Starting container..."
cd "$APP_DIR"
docker compose up -d

# Cleanup temp directory
rm -rf "$DEPLOY_DIR"

# Check status
echo ""
echo "=== Status ==="
docker ps --filter "name=$CONTAINER_NAME"

echo ""
echo "=== Done ==="
echo "Logs: docker logs -f $CONTAINER_NAME"
echo "URL: http://localhost:${EXPOSE_PORT}"
echo ""
echo "Management commands:"
echo "  cd $APP_DIR && docker compose stop"
echo "  cd $APP_DIR && docker compose start"
echo "  cd $APP_DIR && docker compose down"

# Initialize DB (if first run)
read -p "Initialize DB (npm run db:push)? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker exec "$CONTAINER_NAME" npm run db:push
fi
