@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set DOCKER_DIR=%SCRIPT_DIR%..
set CONFIG_DIR=%DOCKER_DIR%\config

:: Load config
if not exist "%CONFIG_DIR%\deploy.env" (
    echo Error: deploy.env not found!
    echo Copy deploy.env.example to deploy.env and fill server data.
    pause
    exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in ("%CONFIG_DIR%\deploy.env") do (
    set "%%a=%%b"
)

:: Prompt for credentials
set /p "SERVER_USER=SSH User: "

:: Find latest archive
for /f "delims=" %%i in ('dir /b /o-d "%DOCKER_DIR%\test_builder_deploy_*.tar.gz" 2^>nul') do (
    set "ARCHIVE=%%i"
    goto :found
)
echo Error: archive not found. Run prepare-deploy.bat first
pause
exit /b 1

:found
echo === Upload to server %SERVER_HOST% ===
echo Archive: %ARCHIVE%
echo Path: %SERVER_PATH%

:: Copy via scp
scp "%DOCKER_DIR%\%ARCHIVE%" "%SCRIPT_DIR%deploy.sh" "%SCRIPT_DIR%rollback.sh" %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/

if %errorlevel% neq 0 (
    echo Error copying files!
    pause
    exit /b 1
)

:: Set execute permissions
echo Setting permissions...
ssh %SERVER_USER%@%SERVER_HOST% "chmod +x %SERVER_PATH%/deploy.sh %SERVER_PATH%/rollback.sh"

echo.
echo === Done ===
echo Files copied to %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%
echo.
echo To deploy on server:
echo   ssh %SERVER_USER%@%SERVER_HOST%
echo   cd %SERVER_PATH% ^&^& sudo bash deploy.sh

pause
