# Docker Deploy

## Overview

The deploy pipeline builds the Docker image **locally** (not on the server),
packages it with the env file and deploy scripts, and uploads a single archive.
The server only loads the pre-built image — no compiler, no npm, no build tools required.

```text
Local machine                    Server
------------                     ------
npm run build                    tar -xf deploy-test_builder.tar
docker build  -->  image.tar --> docker load
                  + .env      --> docker compose up
                  + scripts
```

## Setup (one time)

1. Copy config template:

   ```batch
   copy docker\config\deploy.env.example docker\config\deploy.env
   ```

2. Fill in `docker\config\deploy.env`:

   | Variable | Description |
   | -------- | ----------- |
   | `PROJECT_NAME` | Project identifier (`test_builder`) |
   | `EXPOSE_PORT` | Port exposed on the host |
   | `INTERNAL_PORT` | Port Express listens on inside container |
   | `DIR_GROUP` | Unix group for host directories (`botadmins`) |

## Deploy workflow

### Option A: build and upload in one step

```batch
docker\scripts\build-docker.bat vvlad1973@192.168.1.200
```

What happens:

1. `npm run build` - compiles TypeScript backend + Vite frontend
2. `docker build` - builds image locally (dist + node_modules only)
3. `docker save` - saves image to `test_builder.tar`
4. Creates `deploy-test_builder.tar` with: image + scripts + compose template + `.env`
5. Uploads archive via SCP

### Option B: build locally, upload later

```batch
rem Step 1 — build (saves test_builder.tar locally)
docker\scripts\build-docker.bat

rem Step 2 — upload when ready
docker\scripts\deploy-docker.bat vvlad1973@192.168.1.200
```

### Step 3: run on server

After upload, the script prints the exact command to run. It looks like:

```bash
bash -c 'cd /tmp && rm -rf /tmp/deploy-test_builder && mkdir -p /tmp/deploy-test_builder \
  && tar -xf /tmp/deploy-test_builder.tar -C /tmp/deploy-test_builder \
  && bash /tmp/deploy-test_builder/run-deploy.sh test_builder 8081 /tmp/deploy-test_builder/test_builder.tar'
```

`run-deploy.sh` normalizes line endings and calls `sudo deploy.sh`.

### What deploy.sh does on the server

1. Loads pre-built Docker image (`docker load`)
2. Validates image entrypoint
3. Creates directory structure:

   ```text
   /srv/app/test_builder/
     docker-compose.yml
     env/
       .env

   /srv/logs/test_builder/
   /srv/data/test_builder/
     uploads/
       media/
       scorm/
   ```

4. Deploys `.env` (skips if already present — preserves edits)
5. Generates `docker-compose.yml` from template
6. Runs `docker compose up -d`
7. Waits for container readiness, then runs `npx drizzle-kit push --force`

## Container management (on server)

```bash
cd /srv/app/test_builder

docker compose stop
docker compose start
docker compose restart
docker compose logs -f
```

## Rollback

```bash
cd /tmp && sudo bash rollback.sh
```

Stops and removes the container, image, and all host directories (including uploads).

## Host directory permissions

The container runs as `nodejs` (UID/GID 1500). The `botadmins` group
gets read/write access to logs and data directories so that operators
can manage files without sudo:

```bash
sudo usermod -aG botadmins <your-username>
```

## File structure

```text
docker/
  .dockerignore
  Dockerfile                  - image definition (nodejs user, gosu, entrypoint)
  entrypoint.sh               - privilege drop + app start
  config/
    deploy.env.example        - config template
    deploy.env                - actual config (NOT in git)
  templates/
    docker-compose.yml        - compose template (placeholders substituted by deploy.sh)
    .env.example              - app env template
  scripts/
    build-docker.bat          - build image + optional upload (Windows)
    deploy-docker.bat         - upload pre-built image (Windows)
    deploy.sh                 - server-side deploy
    run-deploy.sh             - CRLF fix + sudo wrapper (entry point on server)
    rollback.sh               - full cleanup
  build/                      - temporary staging dir (NOT in git)
```

## Environment variables

### deploy.env (deploy config)

| Variable | Description |
| -------- | ----------- |
| `PROJECT_NAME` | Project identifier |
| `SRV_APP_BASE` | Base path for app directories (`/srv/app`) |
| `SRV_DATA_BASE` | Base path for data directories (`/srv/data`) |
| `DIR_GROUP` | Unix group for directory permissions |
| `EXPOSE_PORT` | External port |
| `INTERNAL_PORT` | Internal container port |

### .env (application)

| Variable | Description |
| -------- | ----------- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session secret |
| `ENCRYPTION_PASSWORD` | Email encryption password |
| `ENCRYPTION_SALT` | Email encryption salt |
| `PORT` | Express listen port (must match `INTERNAL_PORT`) |
| `SMTP_*` | Mail settings (optional) |
