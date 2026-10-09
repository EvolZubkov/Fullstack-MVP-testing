@echo off
:: =============================================================================
:: deploy.bat - build test-builder and deploy it to a server. ONE script for
:: every instance; prefer the deploy-prod.bat / deploy-test.bat wrappers.
::
:: Usage:
::   deploy.bat <user@server> <prod|test> [--reset-db] [--no-build]
::   deploy.bat <user@server> mirror --name <label> --port <port>
::              [--domain <fqdn>] [--admin-email <email>] [--admin-password-b64 <b64>]
::              [--certbot-email <email>] [--reset-db] [--no-build]
::
::   prod        production instance   (PROJECT_NAME / EXPOSE_PORT from deploy.env)
::   test        test instance         (TEST_PROJECT / TEST_PORT from deploy.env);
::               its database is cloned from the production one when missing
::   mirror      a production-shaped instance raised FROM SCRATCH under its own
::               third-level domain: own empty database, own generated secrets,
::               own nginx vhost + Let's Encrypt certificate. Prefer the
::               deploy-mirror.bat wrapper, which asks for what deploy.env lacks.
::   --reset-db  test/mirror only: drop the database and re-create it
::   --no-build  reuse the existing dist/ and image (skip npm run build + docker build)
::
:: What it does:
::   1. npm run build            - compiles the backend + frontend
::   2. docker build / save      - image with the app; NO .env, NO config, NO uploads
::   3. builds one deploy package (image + scripts + compose + config + secrets)
::   4. uploads it               - ONE scp   (password prompt 1 of 2)
::   5. runs the deploy remotely - ONE ssh   (password prompt 2 of 2)
::
:: The SSH password is asked at most twice, once per connection; `sudo` on the
:: server may ask for its own password once inside the second connection. Set up
:: key authentication to remove the prompts entirely:
::   type %%USERPROFILE%%\.ssh\id_rsa.pub | ssh <user@server> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
::
:: Requirements: Docker, Node.js, tar/scp/ssh in PATH, docker\config\deploy.env
:: =============================================================================

setlocal enabledelayedexpansion

rem Resolve paths BEFORE parsing: `shift` moves %0 as well, so %~dp0 stops
rem pointing at this script once arguments have been consumed.
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\.."
set "DEPLOY_ENV=%PROJECT_ROOT%\docker\config\deploy.env"

set "DEPLOY_TARGET=%~1"
set "INSTANCE=%~2"

if "%DEPLOY_TARGET%"=="" goto :usage
if "%INSTANCE%"=="" goto :usage

set "RESET_DB="
set "SKIP_BUILD="
set "MIRROR_LABEL="
set "MIRROR_PORT="
set "MIRROR_DOMAIN="
set "MIRROR_ADMIN="
set "MIRROR_ADMIN_PW_B64="
set "MIRROR_CERT_EMAIL="
shift & shift
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--reset-db" ( set "RESET_DB=--reset-db" & shift & goto :parse_args )
if /i "%~1"=="--no-build" ( set "SKIP_BUILD=1"        & shift & goto :parse_args )
if /i "%~1"=="--name"     ( set "MIRROR_LABEL=%~2"       & shift & shift & goto :parse_args )
if /i "%~1"=="--port"     ( set "MIRROR_PORT=%~2"        & shift & shift & goto :parse_args )
if /i "%~1"=="--domain"   ( set "MIRROR_DOMAIN=%~2"      & shift & shift & goto :parse_args )
if /i "%~1"=="--admin-email"       ( set "MIRROR_ADMIN=%~2"        & shift & shift & goto :parse_args )
if /i "%~1"=="--admin-password-b64" ( set "MIRROR_ADMIN_PW_B64=%~2" & shift & shift & goto :parse_args )
if /i "%~1"=="--certbot-email"     ( set "MIRROR_CERT_EMAIL=%~2"   & shift & shift & goto :parse_args )
echo ERROR: unknown argument: %~1
goto :usage
:args_done

:: ---------------------------------------------------------------------------
:: Load deploy.env
:: ---------------------------------------------------------------------------
if not exist "%DEPLOY_ENV%" (
    echo ERROR: docker\config\deploy.env not found.
    echo Copy docker\config\deploy.env.example to docker\config\deploy.env and fill it in.
    exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%DEPLOY_ENV%") do (
    if not "%%a"=="" set "%%a=%%b"
)

if "%PROJECT_NAME%"=="" ( echo ERROR: PROJECT_NAME not set in deploy.env & exit /b 1 )
if "%EXPOSE_PORT%"==""  ( echo ERROR: EXPOSE_PORT not set in deploy.env  & exit /b 1 )
if "%TEST_PROJECT%"=="" set "TEST_PROJECT=%PROJECT_NAME%_test"
if "%TEST_PORT%"==""    set "TEST_PORT=8082"

:: ---------------------------------------------------------------------------
:: Instance profile — the ONLY differences between production and test
:: ---------------------------------------------------------------------------
set "EXTRA_ARGS="
if /i "%INSTANCE%"=="prod"   goto :profile_prod
if /i "%INSTANCE%"=="test"   goto :profile_test
if /i "%INSTANCE%"=="mirror" goto :profile_mirror
echo ERROR: instance must be 'prod', 'test' or 'mirror', got: %INSTANCE%
goto :usage

:profile_prod
set "PROJECT=%PROJECT_NAME%"
set "PORT=%EXPOSE_PORT%"
set "NODE_ENV_NAME=production"
set "ENV_SRC=.env"
set "ENV_SRC_FALLBACK=docker\templates\.env.example"
goto :profile_done

:profile_test
set "PROJECT=%TEST_PROJECT%"
set "PORT=%TEST_PORT%"
set "NODE_ENV_NAME=test"
set "EXTRA_ARGS=--clone-from %PROJECT_NAME%"
rem Optional: when absent the server derives the test secrets from the
rem production instance (and aligns DATABASE_URL / ENCRYPTION_* to the clone).
set "ENV_SRC=.env.test"
set "ENV_SRC_FALLBACK="
goto :profile_done

:profile_mirror
rem The label is a DNS label AND part of the container/database name, so it is
rem restricted to what all three accept. Hyphens are legal in a hostname but not in
rem an unquoted PostgreSQL identifier, so the project name uses underscores.
if "%MIRROR_LABEL%"=="" ( echo ERROR: mirror requires --name ^<label^> & goto :usage )
if "%MIRROR_PORT%"==""  ( echo ERROR: mirror requires --port ^<port^>  & goto :usage )
rem Validated through PowerShell, not findstr: findstr matches character RANGES
rem case-insensitively, so /r "[a-z]" happily accepts "Demo" — and an uppercase
rem label would then reach a DNS name and a PostgreSQL identifier that do not
rem accept it. The label is passed in the environment rather than interpolated, so
rem no value of it can alter the command.
set "TB_LABEL=%MIRROR_LABEL%"
set "LABEL_OK="
for /f %%v in ('powershell -NoProfile -Command "if ($env:TB_LABEL -cmatch '^[a-z0-9][a-z0-9-]*$') { 'ok' } else { 'bad' }"') do set "LABEL_OK=%%v"
set "TB_LABEL="
if not "%LABEL_OK%"=="ok" (
    echo ERROR: --name must be a lowercase DNS label ^(a-z, 0-9, hyphen^), got: %MIRROR_LABEL%
    exit /b 1
)
set "MIRROR_SUFFIX=%MIRROR_LABEL:-=_%"
set "PROJECT=%PROJECT_NAME%_%MIRROR_SUFFIX%"
set "PORT=%MIRROR_PORT%"
set "NODE_ENV_NAME=mirror"
rem No local secrets file: the server generates the mirror's own secrets and
rem borrows only the PostgreSQL coordinates and the SMTP account from production.
set "ENV_SRC="
set "ENV_SRC_FALLBACK="

rem A bare label is completed with the base domain; a value containing a dot is
rem taken as the full FQDN.
if "%MIRROR_DOMAIN%"=="" (
    if "%MIRROR_BASE_DOMAIN%"=="" (
        echo ERROR: set MIRROR_BASE_DOMAIN in docker\config\deploy.env, or pass --domain ^<fqdn^>.
        goto :fail
    )
    set "MIRROR_DOMAIN=%MIRROR_LABEL%.%MIRROR_BASE_DOMAIN%"
)
if "%MIRROR_CERT_EMAIL%"=="" set "MIRROR_CERT_EMAIL=%CERTBOT_EMAIL%"
if "%MIRROR_CERT_EMAIL%"=="" (
    echo ERROR: a certbot contact address is required. Set CERTBOT_EMAIL in
    echo        docker\config\deploy.env, or pass --certbot-email ^<email^>.
    exit /b 1
)
if "%MIRROR_ADMIN%"=="" set "MIRROR_ADMIN=%MIRROR_ADMIN_EMAIL%"
if "%MIRROR_ADMIN%"=="" (
    echo ERROR: --admin-email is required: a mirror starts with an empty database
    echo        and would otherwise have no account to log in with.
    exit /b 1
)
if "%MIRROR_ADMIN_PW_B64%"=="" (
    echo ERROR: --admin-password-b64 is required ^(use scripts\deploy\deploy-mirror.bat,
    echo        which asks for the password without echoing it^).
    exit /b 1
)
set "EXTRA_ARGS=--init-db-from %PROJECT_NAME% --domain !MIRROR_DOMAIN! --certbot-email %MIRROR_CERT_EMAIL% --seed-admin %MIRROR_ADMIN% --seed-admin-password-b64 %MIRROR_ADMIN_PW_B64%"
goto :profile_done

:profile_done

if not "%RESET_DB%"=="" if /i not "%INSTANCE%"=="test" if /i not "%INSTANCE%"=="mirror" (
    echo ERROR: --reset-db applies to the test and mirror instances only.
    exit /b 1
)

set "IMAGE_NAME=%PROJECT%"
set "IMAGE_FILE=%PROJECT%.tar"
set "PACKAGE_FILE=deploy-%PROJECT%.tar"
set "PACKAGE_STAGE=tmp\deploy-package-%PROJECT%"
:: Staged in the user's HOME, not /tmp: /tmp is sticky and a previous root-owned
:: leftover there could neither be overwritten nor removed by a non-root scp,
:: which is exactly why the old scripts needed an extra `ssh sudo rm` round trip.
set "REMOTE_PACKAGE=tb-deploy-%PROJECT%.tar"
set "REMOTE_DIR=tb-deploy-%PROJECT%"

echo.
echo ===================================================
echo  test-builder deploy
echo ===================================================
echo  Instance:  %INSTANCE%
echo  Project:   %PROJECT%
echo  Port:      %PORT%
echo  NODE_ENV:  %NODE_ENV_NAME%
echo  Server:    %DEPLOY_TARGET%
if /i "%INSTANCE%"=="test"   echo  DB source: %PROJECT_NAME% (cloned when missing)
if /i "%INSTANCE%"=="mirror" echo  Domain:    %MIRROR_DOMAIN%
if /i "%INSTANCE%"=="mirror" echo  DB:        empty, created when missing
if /i "%INSTANCE%"=="mirror" echo  Admin:     %MIRROR_ADMIN%
if not "%RESET_DB%"==""  echo  Reset DB:  yes
if not "%SKIP_BUILD%"==""  echo  Build:     skipped (--no-build)
echo ===================================================
echo.

cd /d "%PROJECT_ROOT%"

:: ---------------------------------------------------------------------------
:: Required inputs
:: ---------------------------------------------------------------------------
if not exist "scripts\deploy\deploy.sh"            ( echo ERROR: scripts\deploy\deploy.sh not found            & exit /b 1 )
if not exist "scripts\deploy\run-deploy.sh"        ( echo ERROR: scripts\deploy\run-deploy.sh not found        & exit /b 1 )
if not exist "docker\templates\docker-compose.yml" ( echo ERROR: docker\templates\docker-compose.yml not found & exit /b 1 )
if not exist "config\config.jsonc"                 ( echo ERROR: config\config.jsonc not found                 & exit /b 1 )
if not exist "config\%NODE_ENV_NAME%.config.jsonc" ( echo ERROR: config\%NODE_ENV_NAME%.config.jsonc not found & exit /b 1 )
if /i "%INSTANCE%"=="mirror" (
    if not exist "docker\templates\nginx-site-http.conf" ( echo ERROR: docker\templates\nginx-site-http.conf not found & goto :fail )
    if not exist "docker\templates\nginx-site-tls.conf"  ( echo ERROR: docker\templates\nginx-site-tls.conf not found  & goto :fail )
    if not exist "scripts\deploy\create-admin.mjs"       ( echo ERROR: scripts\deploy\create-admin.mjs not found       & goto :fail )
)

:: ---------------------------------------------------------------------------
:: Step 1: build the application
:: ---------------------------------------------------------------------------
if "%SKIP_BUILD%"=="1" (
    if not exist "dist\index.cjs" ( echo ERROR: --no-build given but dist\index.cjs is missing & goto :fail )
    echo [1/5] Build skipped ^(--no-build^)
) else (
    echo [1/5] Building project ^(npm run build^)...
    call npm run build
    if errorlevel 1 ( echo ERROR: npm run build failed & goto :fail )
    echo [1/5] OK: dist/
)
echo.

:: ---------------------------------------------------------------------------
:: Step 2: build and save the image (.env, config/ and uploads/ are excluded via
:: docker\.dockerignore - they are host-side volumes)
:: ---------------------------------------------------------------------------
if "%SKIP_BUILD%"=="1" (
    if not exist "%IMAGE_FILE%" ( echo ERROR: --no-build given but %IMAGE_FILE% is missing & goto :fail )
    echo [2/5] Image reused: %IMAGE_FILE%
) else (
    echo [2/5] Building Docker image %IMAGE_NAME%:latest...
    set "DOCKER_BUILDKIT=1"
    docker build --build-arg "SERVICE_PORT=%PORT%" -t "%IMAGE_NAME%:latest" -f docker\Dockerfile --progress=plain .
    if errorlevel 1 ( echo ERROR: docker build failed & goto :fail )

    echo       Saving image to %IMAGE_FILE%...
    docker save -o "%IMAGE_FILE%" "%IMAGE_NAME%:latest"
    if errorlevel 1 ( echo ERROR: docker save failed & goto :fail )
    for %%F in ("%IMAGE_FILE%") do set "IMAGE_SIZE=%%~zF"
    set /a "IMAGE_SIZE_MB=!IMAGE_SIZE! / 1048576"
    echo [2/5] OK: %IMAGE_FILE% ^(!IMAGE_SIZE_MB! MB^)
)
echo.

:: ---------------------------------------------------------------------------
:: Step 3: assemble the deploy package
:: ---------------------------------------------------------------------------
echo [3/5] Assembling deploy package...

if exist "%PACKAGE_STAGE%" rmdir /s /q "%PACKAGE_STAGE%"
mkdir "%PACKAGE_STAGE%\config"
if errorlevel 1 ( echo ERROR: cannot create staging directory & exit /b 1 )

copy /y "%IMAGE_FILE%"                        "%PACKAGE_STAGE%\%IMAGE_FILE%"       >nul
copy /y "scripts\deploy\deploy.sh"            "%PACKAGE_STAGE%\deploy.sh"          >nul
copy /y "scripts\deploy\run-deploy.sh"        "%PACKAGE_STAGE%\run-deploy.sh"      >nul
copy /y "docker\templates\docker-compose.yml" "%PACKAGE_STAGE%\docker-compose.yml" >nul
copy /y "config\config.jsonc"                 "%PACKAGE_STAGE%\config\"            >nul
copy /y "config\%NODE_ENV_NAME%.config.jsonc" "%PACKAGE_STAGE%\config\"            >nul
if errorlevel 1 ( echo ERROR: failed to copy package files & exit /b 1 )

:: A mirror publishes itself: the server needs the vhost templates (the repo is the
:: source of truth for the proxy configuration) and the account bootstrapper.
if /i "%INSTANCE%"=="mirror" (
    mkdir "%PACKAGE_STAGE%\nginx"
    copy /y "docker\templates\nginx-site-http.conf" "%PACKAGE_STAGE%\nginx\" >nul
    copy /y "docker\templates\nginx-site-tls.conf"  "%PACKAGE_STAGE%\nginx\" >nul
    copy /y "scripts\deploy\create-admin.mjs"       "%PACKAGE_STAGE%\"       >nul
    if errorlevel 1 ( echo ERROR: failed to copy mirror package files & goto :fail )
)

:: Secrets: shipped only for a first-time instance. The server never overwrites an
:: existing env/.env - it keeps the host copy and saves ours as .env.incoming.
set "ENV_PACKED="
if not "%ENV_SRC%"=="" if exist "%ENV_SRC%" (
    mkdir "%PACKAGE_STAGE%\env"
    copy /y "%ENV_SRC%" "%PACKAGE_STAGE%\env\.env" >nul
    set "ENV_PACKED=%ENV_SRC%"
)
if "!ENV_PACKED!"=="" if not "%ENV_SRC_FALLBACK%"=="" if exist "%ENV_SRC_FALLBACK%" (
    mkdir "%PACKAGE_STAGE%\env"
    copy /y "%ENV_SRC_FALLBACK%" "%PACKAGE_STAGE%\env\.env" >nul
    set "ENV_PACKED=%ENV_SRC_FALLBACK%"
    echo       WARNING: %ENV_SRC% not found - shipping the template. Edit it on the server before use.
)
if "!ENV_PACKED!"=="" (
    if /i "%INSTANCE%"=="test" (
        echo       No .env.test locally - the server will derive the test secrets from production.
    ) else if /i "%INSTANCE%"=="mirror" (
        echo       No secrets shipped - the server generates the mirror's own and takes
        echo       the PostgreSQL coordinates and SMTP account from production.
    ) else (
        echo ERROR: no .env and no docker\templates\.env.example to ship.
        goto :fail
    )
) else (
    echo       Secrets packed from !ENV_PACKED!
)

if exist "%PACKAGE_FILE%" del /q "%PACKAGE_FILE%"
tar -cf "%PACKAGE_FILE%" -C "%PACKAGE_STAGE%" .
if errorlevel 1 ( echo ERROR: tar package creation failed & exit /b 1 )
echo [3/5] OK: %PACKAGE_FILE%
echo.

:: ---------------------------------------------------------------------------
:: Step 4: upload (SSH connection 1 of 2)
:: ---------------------------------------------------------------------------
echo [4/5] Uploading to %DEPLOY_TARGET% ^(password prompt 1 of 2^)...
scp "%PACKAGE_FILE%" "%DEPLOY_TARGET%:%REMOTE_PACKAGE%"
if errorlevel 1 ( echo ERROR: scp failed & exit /b 1 )
echo [4/5] OK
echo.

:: ---------------------------------------------------------------------------
:: Step 5: deploy (SSH connection 2 of 2)
::
:: -tt forces a TTY so `sudo` inside run-deploy.sh can prompt for its password.
:: Everything - unpack, deploy, cleanup - happens in this single connection.
:: ---------------------------------------------------------------------------
echo [5/5] Deploying on %DEPLOY_TARGET% ^(password prompt 2 of 2^)...
ssh -tt "%DEPLOY_TARGET%" "rm -rf ~/%REMOTE_DIR% && mkdir -p ~/%REMOTE_DIR% && tar -xf ~/%REMOTE_PACKAGE% -C ~/%REMOTE_DIR% && bash ~/%REMOTE_DIR%/run-deploy.sh %PROJECT% %PORT% ~/%REMOTE_DIR%/%IMAGE_FILE% %NODE_ENV_NAME% %EXTRA_ARGS% %RESET_DB%; rc=$?; rm -rf ~/%REMOTE_DIR% ~/%REMOTE_PACKAGE%; exit $rc"
if errorlevel 1 ( echo ERROR: remote deploy failed & exit /b 1 )

echo.
echo ===================================================
echo  Deployment complete: %PROJECT% on %DEPLOY_TARGET%
if /i "%INSTANCE%"=="mirror" (
    echo  URL: https://%MIRROR_DOMAIN%
    echo  Login: %MIRROR_ADMIN%
) else (
    echo  URL: http://^<server^>:%PORT%
)
echo ===================================================
goto :end

:fail
:: `exit /b 1` executed from inside a NESTED parenthesised block silently loses the
:: code: cmd runs it, the script ends — and reports 0. A caller (deploy-mirror.bat,
:: CI, an operator's `if errorlevel`) then treats a refused deploy as a successful
:: one. Jumping to this label leaves every block first, so the exit is taken at the
:: top level, where the code survives.
exit /b 1

:usage
echo.
echo Usage: deploy.bat ^<user@server^> ^<prod^|test^> [--reset-db] [--no-build]
echo        deploy.bat ^<user@server^> mirror --name ^<label^> --port ^<port^> [options]
echo.
echo   Prefer the wrappers:
echo     scripts\deploy\deploy-prod.bat   ^<user@server^> [--no-build]
echo     scripts\deploy\deploy-test.bat   ^<user@server^> [--reset-db] [--no-build]
echo     scripts\deploy\deploy-mirror.bat ^<user@server^> ^<label^> ^<port^> [--reset-db] [--no-build]
echo.
echo Example:
echo   scripts\deploy\deploy.bat vvlad1973@192.168.1.200 test
exit /b 1

:end
endlocal
