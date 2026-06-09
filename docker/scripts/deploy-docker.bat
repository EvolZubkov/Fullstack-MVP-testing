@echo off
:: =============================================================================
:: deploy-docker.bat - Package and upload a pre-built test-builder Docker image
::
:: Usage:
::   deploy-docker.bat <user@server>
::
:: Parameters:
::   user@server - SSH target (e.g. vvlad1973@192.168.1.200)
::
:: Prerequisites:
::   - <project>.tar present in project root (run build-docker.bat first)
::   - docker\config\deploy.env present
::   - .env present in project root (or docker\templates\.env.example is used)
::   - tar and scp in PATH (provided by Git for Windows)
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
    echo Copy docker\config\deploy.env.example to docker\config\deploy.env and set SERVER_HOST.
    exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
    if not "%%a"=="" set "%%a=%%b"
)

if "%PROJECT_NAME%"=="" ( echo ERROR: PROJECT_NAME not set in deploy.env & exit /b 1 )
if "%EXPOSE_PORT%"==""   ( echo ERROR: EXPOSE_PORT not set in deploy.env   & exit /b 1 )

set "IMAGE_FILE=%PROJECT_NAME%.tar"
set "PACKAGE_FILE=deploy-%PROJECT_NAME%.tar"
set "PACKAGE_STAGE=tmp\deploy-package-%PROJECT_NAME%"
set "REMOTE_DEPLOY_DIR=/tmp/deploy-%PROJECT_NAME%"
set "REMOTE_PACKAGE=deploy-%PROJECT_NAME%.tar"

echo.
echo ===================================================
echo  test-builder deploy
echo ===================================================
echo  Project:  %PROJECT_NAME%
echo  Port:     %EXPOSE_PORT%
echo  Archive:  %IMAGE_FILE%
echo  Package:  %PACKAGE_FILE%
echo  Server:   %DEPLOY_TARGET%
echo ===================================================
echo.

:: ---------------------------------------------------------------------------
:: Verify required local files
:: ---------------------------------------------------------------------------
cd /d "%PROJECT_ROOT%"

if not exist "%IMAGE_FILE%" (
    echo ERROR: %IMAGE_FILE% not found. Run build-docker.bat first.
    exit /b 1
)
if not exist "docker\scripts\deploy.sh" (
    echo ERROR: docker\scripts\deploy.sh not found.
    exit /b 1
)
if not exist "docker\scripts\run-deploy.sh" (
    echo ERROR: docker\scripts\run-deploy.sh not found.
    exit /b 1
)
if not exist "docker\templates\docker-compose.yml" (
    echo ERROR: docker\templates\docker-compose.yml not found.
    exit /b 1
)

if exist ".env" (
    set "ENV_SRC=.env"
) else if exist "docker\templates\.env.example" (
    set "ENV_SRC=docker\templates\.env.example"
    echo WARNING: .env not found - using template. Edit it on server before starting!
) else (
    echo ERROR: No .env or docker\templates\.env.example found.
    exit /b 1
)

:: ---------------------------------------------------------------------------
:: Step 1: Create deploy package
:: ---------------------------------------------------------------------------
echo [1/2] Creating deploy package...

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
echo [1/2] OK: %PACKAGE_FILE%

:: ---------------------------------------------------------------------------
:: Step 2: Upload the package
:: ---------------------------------------------------------------------------
echo [2/2] Uploading %PACKAGE_FILE% to %DEPLOY_TARGET%...
scp "%PACKAGE_FILE%" "%DEPLOY_TARGET%:/tmp/%REMOTE_PACKAGE%"
if errorlevel 1 ( echo ERROR: scp failed & exit /b 1 )
echo [2/2] OK

echo.
echo ===================================================
echo  Upload complete: %DEPLOY_TARGET%:/tmp/%REMOTE_PACKAGE%
echo  Run on server:
echo    bash -c 'cd /tmp ^&^& rm -rf %REMOTE_DEPLOY_DIR% ^&^& mkdir -p %REMOTE_DEPLOY_DIR% ^&^& tar -xf /tmp/%REMOTE_PACKAGE% -C %REMOTE_DEPLOY_DIR% ^&^& bash %REMOTE_DEPLOY_DIR%/run-deploy.sh %PROJECT_NAME% %EXPOSE_PORT% %REMOTE_DEPLOY_DIR%/%IMAGE_FILE%'
echo ===================================================
goto :end

:usage
echo.
echo Usage: deploy-docker.bat ^<user@server^>
echo.
echo   user@server  SSH target, e.g. vvlad1973@192.168.1.200
echo.
echo   Requires ^<project^>.tar in project root (run build-docker.bat first).
exit /b 1

:end
endlocal
