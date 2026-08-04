@echo off
:: =============================================================================
:: create-admin.bat - Create (or promote) an administrator on a remote instance.
::
:: Usage:
::   create-admin.bat <user@server> <email> [--name "<display name>"] [--container <name>]
::
:: Parameters:
::   user@server     SSH target (e.g. vvlad1973@192.168.1.200)
::   email           account email for the new administrator
::   --name          display name (default: Администратор)
::   --container     container name (default: TEST_PROJECT from deploy.env, i.e.
::                   the TEST instance — pass --container <PROJECT_NAME> for prod)
::
:: How it works (mirrors set-password.bat):
::   1. Reads the password silently (no echo, no shell history).
::   2. Uploads create-admin.mjs to the server and into the container.
::   3. Runs it inside the container (reuses DATABASE_URL / @vvlad1973/crypto / pg).
::
:: Idempotent: an existing account with this email is promoted to administrator
:: and its password reset. The password is passed base64-encoded end-to-end.
::
:: Requirements: ssh + scp in PATH (Git for Windows / OpenSSH).
:: =============================================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\.."
set "CONFIG_FILE=%PROJECT_ROOT%\docker\config\deploy.env"

:: ---------------------------------------------------------------------------
:: Parse arguments
:: ---------------------------------------------------------------------------
set "DEPLOY_TARGET=%~1"
set "EMAIL=%~2"
set "CA_NAME_VAL="
set "CONTAINER="

shift
shift
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--name" (
    set "CA_NAME_VAL=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--container" (
    set "CONTAINER=%~2"
    shift
    shift
    goto parse_args
)
echo ERROR: unknown argument: %~1
goto usage
:args_done

if "%DEPLOY_TARGET%"=="" goto :usage
if "%EMAIL%"=="" goto :usage

:: ---------------------------------------------------------------------------
:: Resolve container from deploy.env if not given. Defaults to the TEST instance
:: (TEST_PROJECT), since this tool is mainly used to bootstrap a login on the test
:: stand; pass --container <PROJECT_NAME> to target production.
:: ---------------------------------------------------------------------------
if "%CONTAINER%"=="" (
    if not exist "%CONFIG_FILE%" (
        echo ERROR: docker\config\deploy.env not found and no --container given.
        exit /b 1
    )
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
        if /i "%%a"=="PROJECT_NAME" set "PROJECT_NAME=%%b"
        if /i "%%a"=="TEST_PROJECT" set "CONTAINER=%%b"
    )
    if "!CONTAINER!"=="" if not "!PROJECT_NAME!"=="" set "CONTAINER=!PROJECT_NAME!_test"
)
if "%CONTAINER%"=="" ( echo ERROR: could not resolve container name & exit /b 1 )

if not exist "%SCRIPT_DIR%create-admin.mjs" (
    echo ERROR: create-admin.mjs not found next to this script.
    exit /b 1
)

echo.
echo ===================================================
echo  Create administrator
echo ===================================================
echo  Server:     %DEPLOY_TARGET%
echo  Container:  %CONTAINER%
echo  Email:      %EMAIL%
if not "%CA_NAME_VAL%"=="" echo  Name:       %CA_NAME_VAL%
echo ===================================================
echo.

:: ---------------------------------------------------------------------------
:: Read the password silently and base64-encode it (handles special chars)
:: ---------------------------------------------------------------------------
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s=Read-Host 'New password' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); if([string]::IsNullOrEmpty($b)){''}else{[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($b))}"`) do set "CA_PW_B64=%%p"

if "%CA_PW_B64%"=="" ( echo ERROR: empty password, aborted. & exit /b 1 )

:: ---------------------------------------------------------------------------
:: Upload the script and run it inside the container
:: ---------------------------------------------------------------------------
echo Uploading helper...
scp "%SCRIPT_DIR%create-admin.mjs" "%DEPLOY_TARGET%:/tmp/create-admin.mjs"
if errorlevel 1 ( echo ERROR: scp failed & exit /b 1 )

echo Applying...
:: Copy into /app (not /tmp) so Node's module resolution finds /app/node_modules.
:: Capture node's exit code, clean up, then propagate it so a failure is detected.
ssh -t "%DEPLOY_TARGET%" "sudo docker cp /tmp/create-admin.mjs %CONTAINER%:/app/create-admin.mjs && sudo docker exec -e CA_EMAIL=\"%EMAIL%\" -e CA_PASSWORD_B64=\"%CA_PW_B64%\" -e CA_NAME=\"%CA_NAME_VAL%\" %CONTAINER% node /app/create-admin.mjs; rc=$?; sudo docker exec %CONTAINER% rm -f /app/create-admin.mjs; rm -f /tmp/create-admin.mjs; exit $rc"
set "SSH_RC=%errorlevel%"

set "CA_PW_B64="

if not "%SSH_RC%"=="0" (
    echo.
    echo ERROR: remote command failed ^(exit %SSH_RC%^).
    exit /b 1
)

echo.
echo ===================================================
echo  Done. Log in at the instance and change the password.
echo ===================================================
goto :end

:usage
echo.
echo Usage: create-admin.bat ^<user@server^> ^<email^> [--name "^<display name^>"] [--container ^<name^>]
echo.
echo   user@server     SSH target, e.g. vvlad1973@192.168.1.200
echo   email           new administrator email
echo   --name          display name (default: Администратор)
echo   --container     container (default: TEST_PROJECT from deploy.env)
echo.
echo Example (test instance):
echo   create-admin.bat vvlad1973@192.168.1.200 debug-admin@rtk.local
exit /b 1

:end
endlocal
