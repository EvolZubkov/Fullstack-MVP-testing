@echo off
:: =============================================================================
:: deploy.bat - build test-builder and deploy it to a server. ONE script for
:: every instance; prefer the deploy-prod.bat / deploy-test.bat wrappers.
::
:: Usage:
::   deploy.bat <user@server> <prod|test> [--reset-db] [--no-build]
::
::   prod        production instance   (PROJECT_NAME / EXPOSE_PORT from deploy.env)
::   test        test instance         (TEST_PROJECT / TEST_PORT from deploy.env);
::               its database is cloned from the production one when missing
::   --reset-db  test only: drop the test database and re-clone it
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
shift & shift
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--reset-db" ( set "RESET_DB=--reset-db" & shift & goto :parse_args )
if /i "%~1"=="--no-build" ( set "SKIP_BUILD=1"        & shift & goto :parse_args )
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
if /i "%INSTANCE%"=="prod" (
    set "PROJECT=%PROJECT_NAME%"
    set "PORT=%EXPOSE_PORT%"
    set "NODE_ENV_NAME=production"
    set "CLONE_ARG="
    set "ENV_SRC=.env"
    set "ENV_SRC_FALLBACK=docker\templates\.env.example"
) else if /i "%INSTANCE%"=="test" (
    set "PROJECT=%TEST_PROJECT%"
    set "PORT=%TEST_PORT%"
    set "NODE_ENV_NAME=test"
    set "CLONE_ARG=--clone-from %PROJECT_NAME%"
    rem Optional: when absent the server derives the test secrets from the
    rem production instance (and aligns DATABASE_URL / ENCRYPTION_* to the clone).
    set "ENV_SRC=.env.test"
    set "ENV_SRC_FALLBACK="
) else (
    echo ERROR: instance must be 'prod' or 'test', got: %INSTANCE%
    goto :usage
)

if not "%RESET_DB%"=="" if /i not "%INSTANCE%"=="test" (
    echo ERROR: --reset-db applies to the test instance only.
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
if not "%CLONE_ARG%"=="" echo  DB source: %PROJECT_NAME% (cloned when missing)
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

:: ---------------------------------------------------------------------------
:: Step 1: build the application
:: ---------------------------------------------------------------------------
if "%SKIP_BUILD%"=="1" (
    if not exist "dist\index.cjs" ( echo ERROR: --no-build given but dist\index.cjs is missing & exit /b 1 )
    echo [1/5] Build skipped ^(--no-build^)
) else (
    echo [1/5] Building project ^(npm run build^)...
    call npm run build
    if errorlevel 1 ( echo ERROR: npm run build failed & exit /b 1 )
    echo [1/5] OK: dist/
)
echo.

:: ---------------------------------------------------------------------------
:: Step 2: build and save the image (.env, config/ and uploads/ are excluded via
:: docker\.dockerignore - they are host-side volumes)
:: ---------------------------------------------------------------------------
if "%SKIP_BUILD%"=="1" (
    if not exist "%IMAGE_FILE%" ( echo ERROR: --no-build given but %IMAGE_FILE% is missing & exit /b 1 )
    echo [2/5] Image reused: %IMAGE_FILE%
) else (
    echo [2/5] Building Docker image %IMAGE_NAME%:latest...
    set "DOCKER_BUILDKIT=1"
    docker build --build-arg "SERVICE_PORT=%PORT%" -t "%IMAGE_NAME%:latest" -f docker\Dockerfile --progress=plain .
    if errorlevel 1 ( echo ERROR: docker build failed & exit /b 1 )

    echo       Saving image to %IMAGE_FILE%...
    docker save -o "%IMAGE_FILE%" "%IMAGE_NAME%:latest"
    if errorlevel 1 ( echo ERROR: docker save failed & exit /b 1 )
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
    ) else (
        echo ERROR: no .env and no docker\templates\.env.example to ship.
        exit /b 1
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
ssh -tt "%DEPLOY_TARGET%" "rm -rf ~/%REMOTE_DIR% && mkdir -p ~/%REMOTE_DIR% && tar -xf ~/%REMOTE_PACKAGE% -C ~/%REMOTE_DIR% && bash ~/%REMOTE_DIR%/run-deploy.sh %PROJECT% %PORT% ~/%REMOTE_DIR%/%IMAGE_FILE% %NODE_ENV_NAME% %CLONE_ARG% %RESET_DB%; rc=$?; rm -rf ~/%REMOTE_DIR% ~/%REMOTE_PACKAGE%; exit $rc"
if errorlevel 1 ( echo ERROR: remote deploy failed & exit /b 1 )

echo.
echo ===================================================
echo  Deployment complete: %PROJECT% on %DEPLOY_TARGET%
echo  URL: http://^<server^>:%PORT%
echo ===================================================
goto :end

:usage
echo.
echo Usage: deploy.bat ^<user@server^> ^<prod^|test^> [--reset-db] [--no-build]
echo.
echo   Prefer the wrappers:
echo     scripts\deploy\deploy-prod.bat ^<user@server^> [--no-build]
echo     scripts\deploy\deploy-test.bat ^<user@server^> [--reset-db] [--no-build]
echo.
echo Example:
echo   scripts\deploy\deploy.bat vvlad1973@192.168.1.200 test
exit /b 1

:end
endlocal
