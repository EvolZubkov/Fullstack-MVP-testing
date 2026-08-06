@echo off
:: =============================================================================
:: deploy-test.bat - deploy the TEST instance (alongside production).
::
:: Usage:
::   deploy-test.bat <user@server> [--reset-db] [--no-build]
::
::   --reset-db  drop the test database and re-clone it from production
::
:: Thin wrapper over deploy.bat. The test instance uses the same image, compose
:: file and config mechanics as production; the only difference is the database:
:: when the test database does not exist it is created and cloned from the
:: production one (secrets are then aligned so the cloned data decrypts).
:: =============================================================================

if "%~1"=="" (
    echo.
    echo Usage: deploy-test.bat ^<user@server^> [--reset-db] [--no-build]
    echo.
    echo Examples:
    echo   docker\scripts\deploy-test.bat vvlad1973@192.168.1.200
    echo   docker\scripts\deploy-test.bat vvlad1973@192.168.1.200 --reset-db
    exit /b 1
)

call "%~dp0deploy.bat" %1 test %2 %3
exit /b %errorlevel%
