# Superseded deploy scripts

These scripts were replaced by the unified deploy (`docker/scripts/deploy.bat`
plus the `deploy-prod.bat` / `deploy-test.bat` wrappers and the single
server-side `docker/scripts/deploy.sh`). They are kept here for reference only —
nothing calls them, and they are NOT maintained.

| File | Replaced by |
| ---- | ----------- |
| `build-docker.bat` | `deploy-prod.bat` (build + upload + deploy in one run) |
| `deploy-docker.bat` | `deploy-prod.bat --no-build` |
| `build-test.bat` | `deploy-test.bat` |
| `deploy-test.bat` | `deploy-test.bat` (same name, now a wrapper over `deploy.bat`) |
| `deploy-test.sh` | `deploy.sh` (one server script; the test instance differs only in DB init) |
| `prepare-deploy.bat` | nothing — legacy staging pipeline (`docker/build/`), dead since the image-based deploy |
| `upload-deploy.bat` | nothing — legacy companion of `prepare-deploy.bat` |

Why they went away:

- Two schemes drifted apart. The production compose file came from a versioned
  template, the test one was written inline by `deploy-test.sh`, so every change
  had to be made twice — and was not: the test instance ran a healthcheck on
  `wget`, which does not exist in the image, and never mounted its log directory.
- Each run asked for the SSH password three or four times (separate cleanup,
  upload and deploy connections).

The unified script keeps one compose template, one server script, and two SSH
connections per deploy (one `scp`, one `ssh`).
