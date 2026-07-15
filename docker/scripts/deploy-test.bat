@echo off
:: =============================================================================
:: deploy-test.bat - Deploy test instance of test-builder on the server.
::
:: Usage:
::   deploy-test.bat <user@server> [--reset-db]
::
:: Parameters:
::   user@server  SSH target (e.g. vvlad1973@192.168.1.200)
::   --reset-db   Drop and re-clone the test database from production
::
:: What this script does:
::   1. Read config from docker\config\deploy.env
::   2. Upload deploy-test.sh to the server via SCP
::   3. Execute it on the server via SSH
::
:: Requirements:
::   - ssh and scp in PATH (Git for Windows / OpenSSH)
::   - docker\config\deploy.env present
::   - docker\scripts\deploy-test.sh present
:: =============================================================================

setlocal enabledelayedexpansion

:: ---------------------------------------------------------------------------
:: Parameters
:: ---------------------------------------------------------------------------
set "DEPLOY_TARGET=%~1"
set "RESET_FLAG=%~2"

set "SCRIPT_DIR=%~dp0"
set "DOCKER_DIR=%SCRIPT_DIR%.."
set "CONFIG_FILE=%DOCKER_DIR%\config\deploy.env"

if "%DEPLOY_TARGET%"=="" goto :usage

if not "%RESET_FLAG%"=="" if not "%RESET_FLAG%"=="--reset-db" (
    echo ERROR: Unknown flag: %RESET_FLAG%
    goto :usage
)

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

set "REMOTE_SCRIPT=/tmp/deploy-test-%PROJECT_NAME%.sh"
:: Optional operator secrets: the project's .env.test (git-ignored). When present it
:: is shipped and becomes the test instance's .env (server aligns DATABASE_URL +
:: ENCRYPTION_* to the prod clone). Absent -> the server copies secrets from prod .env.
set "REMOTE_ENV=/tmp/deploy-test-%PROJECT_NAME%.env.test"
set "LOCAL_ENV=%SCRIPT_DIR%..\..\.env.test"

echo.
echo ===================================================
echo  test-builder: deploy test instance
echo ===================================================
echo  Prod project:  %PROJECT_NAME%
echo  Test project:  %TEST_PROJECT%
echo  Test port:     %TEST_PORT%
echo  Server:        %DEPLOY_TARGET%
if not "%RESET_FLAG%"=="" echo  Reset DB:      yes
echo ===================================================
echo.

:: ---------------------------------------------------------------------------
:: Verify source script
:: ---------------------------------------------------------------------------
if not exist "%SCRIPT_DIR%deploy-test.sh" (
    echo ERROR: docker\scripts\deploy-test.sh not found.
    exit /b 1
)

:: ---------------------------------------------------------------------------
:: Step 1: Upload deploy-test.sh
:: ---------------------------------------------------------------------------
echo [1/2] Uploading deploy-test.sh to %DEPLOY_TARGET%...
scp "%SCRIPT_DIR%deploy-test.sh" "%DEPLOY_TARGET%:%REMOTE_SCRIPT%"
if errorlevel 1 ( echo ERROR: scp failed & exit /b 1 )

if exist "%LOCAL_ENV%" (
    echo   Shipping .env.test ^(operator secrets^)...
    scp "%LOCAL_ENV%" "%DEPLOY_TARGET%:%REMOTE_ENV%"
    if errorlevel 1 ( echo ERROR: scp of .env.test failed & exit /b 1 )
) else (
    echo   No .env.test in project root — server will copy secrets from prod .env.
)
echo [1/2] OK
echo.

:: ---------------------------------------------------------------------------
:: Step 2: Execute on server
:: ---------------------------------------------------------------------------
echo [2/2] Running on %DEPLOY_TARGET%...
echo.

ssh -t "%DEPLOY_TARGET%" "sudo bash %REMOTE_SCRIPT% %PROJECT_NAME% %TEST_PROJECT% %TEST_PORT% %RESET_FLAG%"
if errorlevel 1 (
    echo.
    echo ERROR: Remote deploy failed ^(exit code %errorlevel%^)
    exit /b 1
)

echo.
echo ===================================================
echo  Done.
echo ===================================================
goto :end

:usage
echo.
echo Usage: deploy-test.bat ^<user@server^> [--reset-db]
echo.
echo   user@server  SSH target, e.g. vvlad1973@192.168.1.200
echo   --reset-db   Drop and re-clone the test database from production
echo.
echo Examples:
echo   deploy-test.bat vvlad1973@192.168.1.200
echo   deploy-test.bat vvlad1973@192.168.1.200 --reset-db
exit /b 1

:end
endlocal
