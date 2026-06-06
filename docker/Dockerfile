# syntax=docker/dockerfile:1
# =============================================================================
# test-builder Dockerfile
# Image contains: Node.js runtime + compiled application + node_modules.
#
# .env and uploads/ are NOT baked in — they are mounted as volumes
# from the host at runtime (see docker/scripts/deploy.sh).
#
# Build args:
#   SERVICE_PORT - TCP port the app listens on (default: 8081)
# =============================================================================

FROM node:20-slim

ARG SERVICE_PORT=8081

ENV PORT=${SERVICE_PORT} \
    NODE_ENV=production \
    TZ=Europe/Moscow

# Install gosu for privilege drop in entrypoint (Docker-canonical pattern)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gosu && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Unprivileged application user with fixed UID/GID=1500.
# Fixed IDs allow host-side permission management:
#   sudo groupadd -g 1500 appgroup
#   sudo usermod -aG appgroup <your-user>
RUN groupadd -r -g 1500 nodejs && \
    useradd -r -u 1500 -g nodejs -s /bin/bash -d /app nodejs

WORKDIR /app

COPY package*.json ./
# drizzle-kit is a production dependency in this deployment: migrations run via
# `drizzle-kit push` inside the container, and drizzle.config.ts imports it.
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled application artifacts (source excluded via .dockerignore)
COPY --chown=nodejs:nodejs dist ./dist
COPY --chown=nodejs:nodejs shared ./shared
COPY --chown=nodejs:nodejs drizzle.config.ts ./

# Built-in design template manifests/previews — read from disk at runtime by
# server/template-registry.ts and the preview routes (process.cwd()/server/scorm/templates).
# Without these the templates table stays empty and every test reports "template missing".
COPY --chown=nodejs:nodejs server/scorm/templates ./server/scorm/templates

COPY docker/entrypoint.sh ./docker/entrypoint.sh

# Normalize line endings (Windows CRLF -> LF) and make executable
RUN sed -i 's/\r$//' /app/docker/entrypoint.sh && \
    chmod +x /app/docker/entrypoint.sh

# Create volume mount points owned by nodejs (writable at runtime)
RUN mkdir -p /app/uploads/media /app/uploads/scorm /app/logs /app/tmp && \
    chown nodejs:nodejs /app/uploads /app/logs /app/tmp

EXPOSE ${SERVICE_PORT}

ENTRYPOINT ["/app/docker/entrypoint.sh"]
