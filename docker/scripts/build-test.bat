@echo off
:: =============================================================================
:: build-test.bat - Build and deploy the CURRENT branch to the test instance.
::
:: Usage:
::   build-test.bat <user@server>
::
:: What this script does:
::   1. Read TEST_PROJECT and EXPOSE_PORT from docker\config\deploy.env
::   2. Build project (npm run build)
::   3. Build Docker image tagged as <test_project>:latest
::   4. Save image to <test_project>.tar
::   5. Upload to server via SCP
::   6. On server: docker load + update compose image tag + docker compose up -d
::
:: Use this to push a new code version to the test instance without re-cloning the DB.
:: Use deploy-test.bat for the initial setup (creates directories, clones DB, etc.)
:: =============================================================================

setlocal enabledelayedexpansion

:: ---------------------------------------------------------------------------
:: Parameters
:: ---------------------------------------------------------------------------
set "DEPLOY_TARGET=%~1"

set "SCRIPT_DIR=%~dp0"
set "DOCKER_DIR=%SCRIPT_DIR%.."
set "PROJECT_ROOT=%DOCKER_DIR%\.."
set "CONFIG_FILE=%DOCKER_DIR%\config\deploy.env"

if "%DEPLOY_TARGET%"=="" goto :usage

:: ---------------------------------------------------------------------------
:: Load deploy.env
:: ---------------------------------------------------------------------------
if not exist "%CONFIG_FILE%" (
    echo ERROR: docker\config\deploy.env not found.
    echo Copy docker\config\deploy.env.example to docker\config\deploy.env.
    exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
    if not "%%a"=="" set "%%a=%%b"
)

if "%PROJECT_NAME%"=="" ( echo ERROR: PROJECT_NAME not set in deploy.env & exit /b 1 )
if "%EXPOSE_PORT%"==""   ( echo ERROR: EXPOSE_PORT not set in deploy.env   & exit /b 1 )

if "%TEST_PROJECT%"=="" set "TEST_PROJECT=%PROJECT_NAME%_test"
if "%TEST_PORT%"==""    set "TEST_PORT=8082"

set "IMAGE_NAME=%TEST_PROJECT%"
set "IMAGE_FILE=%TEST_PROJECT%.tar"
set "REMOTE_TAR=/tmp/%IMAGE_FILE%"
set "TEST_APP_DIR=/srv/app/%TEST_PROJECT%"

echo.
echo ===================================================
echo  test-builder: build and deploy to test instance
echo ===================================================
echo  Test project:  %TEST_PROJECT%
echo  Image:         %IMAGE_NAME%:latest
echo  Archive:       %IMAGE_FILE%
echo  Server:        %DEPLOY_TARGET%
echo ===================================================
echo.

:: ---------------------------------------------------------------------------
:: Step 1: Build project
:: ---------------------------------------------------------------------------
echo [1/4] Building project (npm run build)...
cd /d "%PROJECT_ROOT%"
call npm run build
if errorlevel 1 ( echo ERROR: npm run build failed & exit /b 1 )
echo [1/4] OK: dist/
echo.

:: ---------------------------------------------------------------------------
:: Step 2: Build Docker image with test tag
:: ---------------------------------------------------------------------------
echo [2/4] Building Docker image %IMAGE_NAME%:latest...
set "DOCKER_BUILDKIT=1"
docker build ^
    --build-arg "SERVICE_PORT=%TEST_PORT%" ^
    -t "%IMAGE_NAME%:latest" ^
    -f docker\Dockerfile ^
    --progress=plain ^
    .
if errorlevel 1 ( echo ERROR: docker build failed & exit /b 1 )
echo [2/4] OK: %IMAGE_NAME%:latest
echo.

:: ---------------------------------------------------------------------------
:: Step 3: Save image
:: ---------------------------------------------------------------------------
echo [3/4] Saving image to %IMAGE_FILE%...
docker save -o "%IMAGE_FILE%" "%IMAGE_NAME%:latest"
if errorlevel 1 ( echo ERROR: docker save failed & exit /b 1 )
for %%F in ("%IMAGE_FILE%") do set "IMAGE_SIZE=%%~zF"
set /a "IMAGE_SIZE_MB=!IMAGE_SIZE! / 1048576"
echo [3/4] OK: %IMAGE_FILE% (!IMAGE_SIZE_MB! MB)
echo.

:: ---------------------------------------------------------------------------
:: Step 4: Upload and reload on server
:: ---------------------------------------------------------------------------
echo [4/4] Uploading to %DEPLOY_TARGET% and reloading...

:: Drop a stale remote tar first: a prior run as root leaves a root-owned
:: %REMOTE_TAR%, and /tmp is sticky, so a non-root scp can neither overwrite
:: nor unlink it ("dest open ... Permission denied"). The trailing rm below
:: only runs when the whole remote step succeeds, so leftovers do happen.
ssh -tt "%DEPLOY_TARGET%" "sudo rm -f %REMOTE_TAR%"
if errorlevel 1 ( echo ERROR: remote cleanup failed & exit /b 1 )

scp "%IMAGE_FILE%" "%DEPLOY_TARGET%:%REMOTE_TAR%"
if errorlevel 1 ( echo ERROR: scp failed & exit /b 1 )

:: -tt forces a TTY so the sudo commands below can prompt for a password when
:: passwordless sudo is not configured. drizzle-kit migrate is non-interactive
:: (no diff prompts, unlike the former push --force).
::
:: The migrate step redirects to a file inside the container and prints it back.
:: Without that its failure is INVISIBLE: drizzle-kit ends a failed run with
:: process.exit(1), which truncates pending writes to a pipe (Node pipe writes are
:: async), so the deploy just stopped after the spinner with no error at all — the
:: same trap already fixed in deploy.sh for the production path. Writes to a FILE
:: are synchronous and survive the exit.
ssh -tt "%DEPLOY_TARGET%" "docker load -i %REMOTE_TAR% && sudo sed -i 's|image: .*:latest|image: %IMAGE_NAME%:latest|' %TEST_APP_DIR%/docker-compose.yml && cd %TEST_APP_DIR% && sudo docker compose up -d --force-recreate && echo 'Waiting for container...' && sleep 5 && echo 'Applying DB migrations (drizzle-kit migrate)...' && { sudo docker exec %IMAGE_NAME% sh -c 'npx drizzle-kit migrate > /tmp/migrate.log 2>&1; ec=$?; cat /tmp/migrate.log; exit $ec' || { echo ''; echo 'drizzle-kit migrate FAILED - see the error above. Two known causes on a test clone:'; echo '1) permission denied for database: the app role lacks CREATE on the DB (migrate needs it for the drizzle schema). As the postgres superuser, GRANT CREATE ON DATABASE %TEST_PROJECT% to the role from DATABASE_URL, then redeploy.'; echo '2) relation/table already exists: the clone predates the prod baseline. Run ONCE, then redeploy:'; echo '   sudo docker exec %IMAGE_NAME% node script/run-sql.cjs drizzle/baseline-existing-db.sql'; exit 1; }; } && rm -f %REMOTE_TAR%"
if errorlevel 1 ( echo ERROR: remote reload failed & exit /b 1 )

echo.
echo ===================================================
echo  Done. Test instance updated.
echo  URL: http://^<server^>:%TEST_PORT%
echo ===================================================
goto :end

:usage
echo.
echo Usage: build-test.bat ^<user@server^>
echo.
echo   Builds current branch and deploys to the test instance.
echo   Does NOT re-clone the database (use deploy-test.bat for that).
echo.
echo Example:
echo   build-test.bat vvlad1973@192.168.1.200
exit /b 1

:end
endlocal
