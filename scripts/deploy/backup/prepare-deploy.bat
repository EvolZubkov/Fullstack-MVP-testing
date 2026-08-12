@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set DOCKER_DIR=%SCRIPT_DIR%..
set PROJECT_ROOT=%DOCKER_DIR%\..
set BUILD_DIR=%DOCKER_DIR%\build

:: Generate timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,8%_%datetime:~8,6%
set ARCHIVE_NAME=test_builder_deploy_%TIMESTAMP%.tar.gz

echo === Preparing deploy package ===

:: Build project
echo Building project...
cd /d "%PROJECT_ROOT%"
call npm run build
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b 1
)

:: Clean and create build directory
if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%\source"
mkdir "%BUILD_DIR%\config"
mkdir "%BUILD_DIR%\env"

:: Copy build artifacts
echo Copying build artifacts...
copy "%PROJECT_ROOT%\package.json" "%BUILD_DIR%\source\"
copy "%PROJECT_ROOT%\package-lock.json" "%BUILD_DIR%\source\"
xcopy "%PROJECT_ROOT%\dist" "%BUILD_DIR%\source\dist\" /e /i /q

:: Copy schema files needed for drizzle-kit db:push inside container
echo Copying schema files for migrations...
xcopy "%PROJECT_ROOT%\shared" "%BUILD_DIR%\source\shared\" /e /i /q
copy "%PROJECT_ROOT%\drizzle.config.ts" "%BUILD_DIR%\source\"

:: Copy Dockerfile
copy "%DOCKER_DIR%\Dockerfile" "%BUILD_DIR%\source\"

:: Copy deploy config
echo Copying deploy config...
copy "%DOCKER_DIR%\templates\docker-compose.yml" "%BUILD_DIR%\config\"
copy "%DOCKER_DIR%\config\deploy.env" "%BUILD_DIR%\config\"

:: Copy .env
if exist "%PROJECT_ROOT%\.env" (
    echo Using .env from project
    copy "%PROJECT_ROOT%\.env" "%BUILD_DIR%\env\.env.example"
) else (
    echo Using .env.example template
    copy "%DOCKER_DIR%\templates\.env.example" "%BUILD_DIR%\env\.env.example"
)

:: Convert line endings to LF for Linux compatibility
echo Converting line endings to LF...
powershell -NoProfile -ExecutionPolicy Bypass ^
  "$files = Get-ChildItem -Path '%BUILD_DIR%' -Recurse -File | Where-Object { $_.Name -match '^(Dockerfile|.*\.(sh|env|yml|yaml|ts))$' }; " ^
  "foreach ($f in $files) { " ^
  "  $content = [System.IO.File]::ReadAllText($f.FullName); " ^
  "  $content = $content -replace '`r`n', '`n'; " ^
  "  [System.IO.File]::WriteAllText($f.FullName, $content, (New-Object System.Text.UTF8Encoding($false))); " ^
  "}"

if %errorlevel% neq 0 (
    echo LF conversion failed!
    pause
    exit /b 1
)

:: Create archive
echo Creating archive %ARCHIVE_NAME%...
cd /d "%BUILD_DIR%"
tar -czvf "..\%ARCHIVE_NAME%" .

echo.
echo === Done ===
echo Archive: %DOCKER_DIR%\%ARCHIVE_NAME%
pause
