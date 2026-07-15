@echo off
:: =============================================================================
:: set-password.bat - Set (reset) a user account password on a remote instance.
::
:: Usage:
::   set-password.bat <user@server> <email> [--force-change] [--container <name>]
::
:: Parameters:
::   user@server     SSH target (e.g. vvlad1973@192.168.1.200)
::   email           account email to set the password for
::   --force-change  require the user to change the password on next login
::                   (default: the new password works as-is)
::   --container     container name (default: PROJECT_NAME from deploy.env)
::
:: How it works:
::   1. Reads the new password silently (no echo, no shell history).
::   2. Uploads set-password.mjs to the server and into the container.
::   3. Runs it inside the container (reuses DATABASE_URL / @vvlad1973/crypto / pg).
::
:: The password is passed base64-encoded end-to-end to avoid shell-quoting
:: issues with special characters.
::
:: Requirements: ssh + scp in PATH (Git for Windows / OpenSSH).
:: =============================================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "DOCKER_DIR=%SCRIPT_DIR%.."
set "CONFIG_FILE=%DOCKER_DIR%\config\deploy.env"

:: ---------------------------------------------------------------------------
:: Parse arguments
:: ---------------------------------------------------------------------------
set "DEPLOY_TARGET=%~1"
set "EMAIL=%~2"
set "FORCE_CHANGE=false"
set "CONTAINER="

shift
shift
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--force-change" (
    set "FORCE_CHANGE=true"
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
:: Resolve container name from deploy.env if not given
:: ---------------------------------------------------------------------------
if "%CONTAINER%"=="" (
    if not exist "%CONFIG_FILE%" (
        echo ERROR: docker\config\deploy.env not found and no --container given.
        exit /b 1
    )
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
        if /i "%%a"=="PROJECT_NAME" set "CONTAINER=%%b"
    )
)
if "%CONTAINER%"=="" ( echo ERROR: could not resolve container name & exit /b 1 )

if not exist "%SCRIPT_DIR%set-password.mjs" (
    echo ERROR: set-password.mjs not found next to this script.
    exit /b 1
)

echo.
echo ===================================================
echo  Set account password
echo ===================================================
echo  Server:     %DEPLOY_TARGET%
echo  Container:  %CONTAINER%
echo  Email:      %EMAIL%
echo  Force change on next login: %FORCE_CHANGE%
echo ===================================================
echo.

:: ---------------------------------------------------------------------------
:: Read the password silently and base64-encode it (handles special chars)
:: ---------------------------------------------------------------------------
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s=Read-Host 'New password' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); if([string]::IsNullOrEmpty($b)){''}else{[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($b))}"`) do set "SP_PW_B64=%%p"

if "%SP_PW_B64%"=="" ( echo ERROR: empty password, aborted. & exit /b 1 )

:: ---------------------------------------------------------------------------
:: Upload the script and run it inside the container
:: ---------------------------------------------------------------------------
echo Uploading helper...
scp "%SCRIPT_DIR%set-password.mjs" "%DEPLOY_TARGET%:/tmp/set-password.mjs"
if errorlevel 1 ( echo ERROR: scp failed & exit /b 1 )

echo Applying...
:: Copy into /app (not /tmp) so Node's module resolution finds /app/node_modules.
:: Capture node's exit code, clean up, then propagate it so a failure is detected.
ssh -t "%DEPLOY_TARGET%" "sudo docker cp /tmp/set-password.mjs %CONTAINER%:/app/set-password.mjs && sudo docker exec -e SP_EMAIL=\"%EMAIL%\" -e SP_PASSWORD_B64=\"%SP_PW_B64%\" -e SP_FORCE_CHANGE=%FORCE_CHANGE% %CONTAINER% node /app/set-password.mjs; rc=$?; sudo docker exec %CONTAINER% rm -f /app/set-password.mjs; rm -f /tmp/set-password.mjs; exit $rc"
set "SSH_RC=%errorlevel%"

set "SP_PW_B64="

if not "%SSH_RC%"=="0" (
    echo.
    echo ERROR: remote command failed ^(exit %SSH_RC%^).
    exit /b 1
)

echo.
echo ===================================================
echo  Done.
echo ===================================================
goto :end

:usage
echo.
echo Usage: set-password.bat ^<user@server^> ^<email^> [--force-change] [--container ^<name^>]
echo.
echo   user@server     SSH target, e.g. vvlad1973@192.168.1.200
echo   email           account email
echo   --force-change  require password change on next login
echo   --container     container name (default: PROJECT_NAME from deploy.env)
echo.
echo Example:
echo   set-password.bat vvlad1973@192.168.1.200 admin@test.com
exit /b 1

:end
endlocal
