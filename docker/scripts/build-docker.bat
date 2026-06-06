@echo off
:: =============================================================================
:: build-docker.bat - Build and deploy test-builder Docker image
::
:: Usage:
::   build-docker.bat [user@server]
::
:: Parameters:
::   user@server - (optional) SSH target for uploading the deploy package via SCP.
::                 If omitted, image is saved locally and instructions printed.
::
:: What this script does:
::   1. Read PROJECT_NAME and EXPOSE_PORT from docker\config\deploy.env
::   2. Build project (npm run build) - compiles TypeScript + Vite frontend
::   3. Build Docker image (dist + node_modules only, no .env/uploads)
::   4. Save image to <project>.tar in project root
::   5. Create one deploy package (deploy-<project>.tar)
::   6. Upload the package to the server via SCP (if target provided)
::
:: Requirements:
::   - Docker with BuildKit support
::   - Node.js + npm (for build step)
::   - tar and scp in PATH (provided by Git for Windows)
::   - docker\config\deploy.env present (copy from deploy.env.example)
::   - .env present in project root (or .env.example will be used as template)
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

:: ---------------------------------------------------------------------------
:: Load deploy.env
:: ---------------------------------------------------------------------------
if not exist "%CONFIG_FILE%" (
    echo ERROR: docker\config\deploy.env not found.
    echo Copy docker\config\deploy.env.example to docker\config\deploy.env and set SERVER_HOST.
    exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
    if not "%%a"=="" set "%%a=%%b"
)

if "%PROJECT_NAME%"=="" ( echo ERROR: PROJECT_NAME not set in deploy.env & exit /b 1 )
if "%EXPOSE_PORT%"==""   ( echo ERROR: EXPOSE_PORT not set in deploy.env   & exit /b 1 )

set "IMAGE_NAME=%PROJECT_NAME%"
set "IMAGE_FILE=%PROJECT_NAME%.tar"
set "PACKAGE_FILE=deploy-%PROJECT_NAME%.tar"
set "PACKAGE_STAGE=tmp\deploy-package-%PROJECT_NAME%"
set "REMOTE_DEPLOY_DIR=/tmp/deploy-%PROJECT_NAME%"
set "REMOTE_PACKAGE=deploy-%PROJECT_NAME%.tar"

echo.
echo ===================================================
echo  test-builder Docker build
echo ===================================================
echo  Project:  %PROJECT_NAME%
echo  Port:     %EXPOSE_PORT%
echo  Image:    %IMAGE_NAME%:latest
echo  Archive:  %IMAGE_FILE%
echo  Package:  %PACKAGE_FILE%
if not "%DEPLOY_TARGET%"=="" (
    echo  Deploy:   %DEPLOY_TARGET%
)
echo ===================================================
echo.

:: ---------------------------------------------------------------------------
:: Step 1: Build project (TypeScript + Vite).
:: Output: dist/ - compiled backend + frontend static bundle.
:: ---------------------------------------------------------------------------
echo [1/4] Building project (npm run build)...
cd /d "%PROJECT_ROOT%"
call npm run build
if errorlevel 1 (
    echo ERROR: npm run build failed
    exit /b 1
)
echo [1/4] OK: dist/
echo.

:: ---------------------------------------------------------------------------
:: Step 2: Build Docker image.
:: .env and uploads/ are excluded via docker/.dockerignore.
:: ---------------------------------------------------------------------------
echo [2/4] Building Docker image...
set "DOCKER_BUILDKIT=1"
docker build ^
    --build-arg "SERVICE_PORT=%EXPOSE_PORT%" ^
    -t "%IMAGE_NAME%:latest" ^
    -f docker\Dockerfile ^
    --progress=plain ^
    .
if errorlevel 1 (
    echo ERROR: docker build failed
    exit /b 1
)
echo [2/4] OK: %IMAGE_NAME%:latest
echo.

:: ---------------------------------------------------------------------------
:: Step 3: Save image to tar archive.
:: ---------------------------------------------------------------------------
echo [3/4] Saving image to %IMAGE_FILE%...
docker save -o "%IMAGE_FILE%" "%IMAGE_NAME%:latest"
if errorlevel 1 (
    echo ERROR: docker save failed
    exit /b 1
)
for %%F in ("%IMAGE_FILE%") do set "IMAGE_SIZE=%%~zF"
set /a "IMAGE_SIZE_MB=!IMAGE_SIZE! / 1048576"
echo [3/4] OK: %IMAGE_FILE% (!IMAGE_SIZE_MB! MB)
echo.

:: ---------------------------------------------------------------------------
:: Step 4: Create deploy package and upload (only if server target provided).
:: ---------------------------------------------------------------------------
if "%DEPLOY_TARGET%"=="" goto :no_deploy

echo [4/4] Creating deploy package and uploading to %DEPLOY_TARGET%...

if not exist "docker\scripts\deploy.sh" (
    echo ERROR: docker\scripts\deploy.sh not found
    exit /b 1
)
if not exist "docker\scripts\run-deploy.sh" (
    echo ERROR: docker\scripts\run-deploy.sh not found
    exit /b 1
)
if not exist "docker\templates\docker-compose.yml" (
    echo ERROR: docker\templates\docker-compose.yml not found
    exit /b 1
)

if exist ".env" (
    set "ENV_SRC=.env"
) else if exist "docker\templates\.env.example" (
    set "ENV_SRC=docker\templates\.env.example"
    echo       WARNING: .env not found - using template. Edit it on server before starting!
) else (
    echo ERROR: No .env or docker\templates\.env.example found
    exit /b 1
)

if exist "%PACKAGE_STAGE%" rmdir /s /q "%PACKAGE_STAGE%"
mkdir "%PACKAGE_STAGE%\env"
if errorlevel 1 ( echo ERROR: Cannot create staging directory & exit /b 1 )

copy /y "%IMAGE_FILE%"                        "%PACKAGE_STAGE%\%IMAGE_FILE%"          >nul
copy /y "docker\scripts\deploy.sh"            "%PACKAGE_STAGE%\deploy.sh"             >nul
copy /y "docker\scripts\run-deploy.sh"        "%PACKAGE_STAGE%\run-deploy.sh"         >nul
copy /y "docker\templates\docker-compose.yml" "%PACKAGE_STAGE%\docker-compose.yml"    >nul
copy /y "docker\config\deploy.env"            "%PACKAGE_STAGE%\deploy.env"            >nul
copy /y "%ENV_SRC%"                           "%PACKAGE_STAGE%\env\.env"              >nul
if errorlevel 1 ( echo ERROR: Failed to copy package files & exit /b 1 )

if exist "%PACKAGE_FILE%" del /q "%PACKAGE_FILE%"
tar -cf "%PACKAGE_FILE%" -C "%PACKAGE_STAGE%" .
if errorlevel 1 ( echo ERROR: tar package creation failed & exit /b 1 )

echo       Package created: %PACKAGE_FILE%
echo       Uploading to %DEPLOY_TARGET%...
scp "%PACKAGE_FILE%" "%DEPLOY_TARGET%:/tmp/%REMOTE_PACKAGE%"
if errorlevel 1 ( echo ERROR: scp failed & exit /b 1 )

echo.
echo ===================================================
echo  Upload complete: %DEPLOY_TARGET%:/tmp/%REMOTE_PACKAGE%
echo  Run on server:
echo    bash -c 'cd /tmp ^&^& rm -rf %REMOTE_DEPLOY_DIR% ^&^& mkdir -p %REMOTE_DEPLOY_DIR% ^&^& tar -xf /tmp/%REMOTE_PACKAGE% -C %REMOTE_DEPLOY_DIR% ^&^& bash %REMOTE_DEPLOY_DIR%/run-deploy.sh %PROJECT_NAME% %EXPOSE_PORT% %REMOTE_DEPLOY_DIR%/%IMAGE_FILE%'
echo ===================================================
goto :end

:no_deploy
echo.
echo ===================================================
echo  Image saved locally: %IMAGE_FILE%
echo  To upload later, run:
echo    docker\scripts\deploy-docker.bat ^<user@server^>
echo ===================================================

:end
endlocal
