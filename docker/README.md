# Docker Deploy

## Overview

One pipeline deploys every instance. The image is built **locally** (not on the
server), packaged with the deploy scripts, the compose file, the config files and
the secrets, and uploaded as a single archive. The server only loads the
pre-built image — no compiler, no npm, no build tools required.

```text
Local machine                    Server
------------                     ------
npm run build                    tar -xf tb-deploy-<project>.tar
docker build  -->  image.tar --> docker load
                  + compose   --> deploy.sh: dirs, secrets, config, DB, migrate
                  + config    --> docker compose up -d + wait for healthy
                  + .env
                  + scripts
```

The image contains only the runtime and the compiled application. Secrets
(`.env`), non-secret configuration (`config/*.config.jsonc`), uploads and logs
are host-side volumes.

**Production and test are the same deploy.** Same image build, same compose
file, same server script, same config mechanics. The single difference is
database initialization: a test instance whose database does not exist yet gets
one cloned from production (`--clone-from`), production never creates a database
implicitly.

## Setup (one time)

1. Copy the config template:

   ```batch
   copy docker\config\deploy.env.example docker\config\deploy.env
   ```

2. Fill in `docker\config\deploy.env`:

   | Variable | Description |
   | -------- | ----------- |
   | `PROJECT_NAME` | Production project: container, image tag and `/srv/*/<name>` |
   | `EXPOSE_PORT` | Port published on the host (the app listens on it too) |
   | `TEST_PROJECT` | Test project name (separate container and database) |
   | `TEST_PORT` | Port for the test instance |

3. Optional but recommended — set up key authentication so the deploy asks for
   nothing at all:

   ```batch
   type %USERPROFILE%\.ssh\id_rsa.pub | ssh vvlad1973@192.168.1.200 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
   ```

## Deploy

```batch
rem production
docker\scripts\deploy-prod.bat vvlad1973@192.168.1.200

rem test instance (clones the production DB when the test one is missing)
docker\scripts\deploy-test.bat vvlad1973@192.168.1.200

rem test instance with a fresh clone of the production DB
docker\scripts\deploy-test.bat vvlad1973@192.168.1.200 --reset-db

rem redeploy without rebuilding (reuse dist/ and the saved image)
docker\scripts\deploy-prod.bat vvlad1973@192.168.1.200 --no-build
```

Both wrappers call `docker\scripts\deploy.bat <user@server> <prod|test>`, which
does the whole run:

1. `npm run build` — backend + frontend
2. `docker build` / `docker save` — image without `.env`, `config/` or `uploads/`
3. assembles the deploy package
4. **one `scp`** — uploads it (password prompt 1 of 2)
5. **one `ssh -tt`** — unpacks, deploys and cleans up (password prompt 2 of 2)

Two SSH connections is the minimum without key authentication: `scp` needs one,
and the deploy needs an interactive TTY so `sudo` can prompt on the server. With
a key installed there are no prompts at all.

### What deploy.sh does on the server

1. `docker load` + validates the image entrypoint
2. Creates the host layout:

   ```text
   /srv/app/<project>/
     docker-compose.yml     - copied verbatim from the repo template
     .env                   - COMPOSE variables (TB_*), generated
     env/.env               - application secrets, host-owned (:ro mount)
     config/*.config.jsonc  - non-secret config (:ro mount)
     config-backup/         - previous versions of replaced config files
   /srv/logs/<project>/
   /srv/data/<project>/uploads/{media,scorm,templates}
   ```

3. Secrets — deployed only when missing; an existing `env/.env` is never
   overwritten (a differing shipped copy is saved as `env/.env.incoming`)
4. Config — refreshed from the package on **every** deploy, previous content
   kept under `config-backup/` and the diff printed
5. Database — the only instance-specific step (see below)
6. `drizzle-kit migrate` in a one-off container, before the app boots
7. `docker compose up -d`, then waits until the container reports **healthy**

### Database initialization

| Case | What happens |
| ---- | ------------ |
| Production, DB exists | migrations only |
| Production, DB missing | deploy stops with the `createdb` command to run |
| Test, DB exists | migrations only (data preserved) |
| Test, DB missing | created, cloned from the production DB, ownership and grants fixed, then migrations |
| Test, `--reset-db` | dropped, then cloned as above |

Cloning also aligns the test instance's secrets: `DATABASE_URL` points at the
test database, and `ENCRYPTION_PASSWORD` / `ENCRYPTION_SALT` are inherited from
production — the cloned rows are encrypted with those keys, so without them the
emails would not decrypt.

## Configuration

Nothing configurable is baked into the image:

| What | Where on the host | Mount | Deploy behaviour |
| ---- | ----------------- | ----- | ---------------- |
| Secrets | `/srv/app/<project>/env/.env` | `/app/.env` (ro) | host-owned, never overwritten |
| Non-secret settings | `/srv/app/<project>/config/*.config.jsonc` | `/app/config` (ro) | refreshed from the repo every deploy |

Which file the app loads is set explicitly by compose (`CONFIG_FILE`):
`config/production.config.jsonc` for production, `config/test.config.jsonc` for
the test instance, both falling back to `config/config.jsonc`.

`NODE_ENV` alone cannot select it: the server bundle is built with `NODE_ENV`
folded to `"production"` (`script/build.ts`), which is what keeps the built app
in production mode wherever it runs. `CONFIG_FILE` is read at runtime, so it
always wins.

### The repo is the source of truth

Every deploy writes the shipped config files to the host, so a setting changed
upstream reaches the server without manual steps. Before replacing a host file
that differs, the deploy copies it to
`/srv/app/<project>/config-backup/<name>.<timestamp>` (five most recent kept) and
prints the diff.

Consequence: an ad-hoc edit made on the server survives only until the next
deploy. Carry a lasting change into `config/*.config.jsonc` in the repository.

Apply a settings change immediately, without a rebuild or a deploy:

```bash
cd /srv/app/test_builder
nano config/production.config.jsonc
docker compose restart
```

The entrypoint refuses to start when `/app/config` holds no config file — that
means the volume is missing or empty, not that the image is broken.

## Container management (on server)

```bash
cd /srv/app/test_builder

docker compose ps
docker compose logs -f
docker compose stop
docker compose start
docker compose restart
```

The compose service is named `app` in every instance; the container keeps the
project name (`docker exec test_builder ...` still works).

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
  .dockerignore               - excludes .env, config/ and uploads/ from the image
  Dockerfile                  - image definition (nodejs user, gosu, entrypoint)
  entrypoint.sh               - privilege drop + config check + app start
  config/
    deploy.env.example        - deploy config template
    deploy.env                - actual deploy config (NOT in git)
  templates/
    docker-compose.yml        - THE compose file, identical for every instance
    .env.example              - application secrets template
  scripts/
    deploy.bat                - build + upload + deploy (Windows), any instance
    deploy-prod.bat           - wrapper: production
    deploy-test.bat           - wrapper: test instance (DB cloned when missing)
    deploy.sh                 - server-side deploy, any instance
    run-deploy.sh             - CRLF fix + sudo wrapper (entry point on server)
    rollback.sh               - full cleanup
    create-admin.bat/.mjs     - create an administrator in a running container
    set-password.bat/.mjs     - reset a password in a running container
    backup/                   - superseded scripts, kept for reference only
```

## Environment variables

### deploy.env (deploy config, Windows side)

| Variable | Description |
| -------- | ----------- |
| `PROJECT_NAME` | Production project identifier |
| `EXPOSE_PORT` | Production port |
| `TEST_PROJECT` | Test project identifier |
| `TEST_PORT` | Test port |

### /srv/app/&lt;project&gt;/.env (compose variables, generated)

| Variable | Description |
| -------- | ----------- |
| `TB_PROJECT` | Container and hostname |
| `TB_IMAGE` | Image tag to run |
| `TB_PORT` | Published and internal port |
| `TB_NODE_ENV` | `production` or `test` |
| `TB_CONFIG_FILE` | Config file the app loads |
| `TB_LOG_DIR`, `TB_DATA_DIR` | Host paths for logs and uploads |

### env/.env (application secrets)

| Variable | Description |
| -------- | ----------- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session secret |
| `ENCRYPTION_PASSWORD` | Email encryption password |
| `ENCRYPTION_SALT` | Email encryption salt |
| `SUPERADMIN_EMAILS` | Superadmin accounts (comma-separated) |
| `SMTP_*` | Mail settings (optional) |

`PORT` and `NODE_ENV` are infra-controlled: compose sets them, and the deploy
strips them from this file so a stray value cannot move the listener.
