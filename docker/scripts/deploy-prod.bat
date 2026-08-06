@echo off
:: =============================================================================
:: deploy-prod.bat - deploy the PRODUCTION instance.
::
:: Usage:
::   deploy-prod.bat <user@server> [--no-build]
::
:: Thin wrapper over deploy.bat: same build, same package, same server script as
:: the test instance — production simply never clones a database (it must already
:: exist; deploy.sh says so explicitly if it does not).
:: =============================================================================

if "%~1"=="" (
    echo.
    echo Usage: deploy-prod.bat ^<user@server^> [--no-build]
    echo.
    echo Example:
    echo   docker\scripts\deploy-prod.bat vvlad1973@192.168.1.200
    exit /b 1
)

call "%~dp0deploy.bat" %1 prod %2 %3
exit /b %errorlevel%
