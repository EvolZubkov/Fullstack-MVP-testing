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

# SQL migrations + a tiny runner. `drizzle-kit push` syncs SCHEMA only; data
# migrations (e.g. the PRD-13 role backfill in migrations/016) are applied by the
# deploy scripts via `node script/run-sql.cjs <file>` BEFORE push drops legacy
# columns. Both must be in the image because the deploy runs them in a one-off
# container and the DB is external (no psql/tsx available here).
COPY --chown=nodejs:nodejs migrations ./migrations
COPY --chown=nodejs:nodejs script/run-sql.cjs ./script/run-sql.cjs

# Built-in design template manifests/previews — read from disk at runtime by
# server/template-registry.ts and the preview routes (process.cwd()/server/scorm/templates).
# Without these the templates table stays empty and every test reports "template missing".
COPY --chown=nodejs:nodejs server/scorm/templates ./server/scorm/templates

COPY docker/entrypoint.sh ./docker/entrypoint.sh

# Normalize line endings (Windows CRLF -> LF) and make executable
RUN sed -i 's/\r$//' /app/docker/entrypoint.sh && \
    chmod +x /app/docker/entrypoint.sh

# Create volume mount points owned by nodejs (writable at runtime).
# `uploads/templates` holds uploaded PRD-3 design-template packages
# (server/services/template-package.ts extracts to uploads/templates/<id>/).
# Recursive chown so every subdir is app-writable in the no-volume / image-default
# case; a host bind-mount over /app/uploads is re-owned at runtime by entrypoint.sh.
RUN mkdir -p /app/uploads/media /app/uploads/scorm /app/uploads/templates /app/logs /app/tmp && \
    chown -R nodejs:nodejs /app/uploads /app/logs /app/tmp

EXPOSE ${SERVICE_PORT}

ENTRYPOINT ["/app/docker/entrypoint.sh"]
