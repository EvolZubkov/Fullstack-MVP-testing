@echo off
:: =============================================================================
:: deploy-mirror.bat - raise a MIRROR of production: a production-shaped instance
:: created FROM SCRATCH under its own third-level domain.
::
:: Usage:
::   deploy-mirror.bat <user@server> <label> <port> [--reset-db] [--no-build]
::
::   label       third-level domain label AND instance suffix, e.g. "demo" ->
::               https://demo.<MIRROR_BASE_DOMAIN>, project <PROJECT_NAME>_demo
::   port        host port the container publishes (must be free on the server)
::   --reset-db  drop this mirror's database and re-create it EMPTY (re-seeds)
::   --no-build  reuse the existing dist/ and image
::
:: What a mirror gets, in order:
::   1. its own /srv/{app,logs,data}/<project> and its own empty database, owned by
::      the production PostgreSQL role (only the coordinates are borrowed);
::   2. its own generated SESSION_SECRET / ENCRYPTION_* - production keys are never
::      copied, there is nothing here encrypted with them - plus production's SMTP
::      account, which is the one thing a fresh instance cannot invent;
::   3. the schema, from the same drizzle migrations as every other instance;
::   4. an nginx vhost and a Let's Encrypt certificate for the domain, obtained
::      BEFORE the first start (the instance uses secure cookies: over plain HTTP
::      login silently fails);
::   5. the seed - design templates and superadmin accounts appear on the app's own
::      first boot; this script adds the one thing that boot cannot, a working
::      password for the administrator.
::
:: Anything this script needs and docker\config\deploy.env does not answer is
:: asked here, interactively. The password is never echoed and travels
:: base64-encoded.
::
:: BEFORE RUNNING: the DNS A record for <label>.<base domain> must already point at
:: the server and port 80 must be reachable from the internet - certbot validates
:: over http-01 and the deploy stops if it cannot.
:: =============================================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\.."
set "DEPLOY_ENV=%PROJECT_ROOT%\docker\config\deploy.env"

set "DEPLOY_TARGET=%~1"
set "LABEL=%~2"
set "PORT=%~3"

if "%DEPLOY_TARGET%"=="" goto :usage
if "%LABEL%"==""         goto :usage
if "%PORT%"==""          goto :usage

set "PASSTHROUGH="
shift & shift & shift
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--reset-db" ( set "PASSTHROUGH=!PASSTHROUGH! --reset-db" & shift & goto :parse_args )
if /i "%~1"=="--no-build" ( set "PASSTHROUGH=!PASSTHROUGH! --no-build" & shift & goto :parse_args )
echo ERROR: unknown argument: %~1
goto :usage
:args_done

:: ---------------------------------------------------------------------------
:: Load deploy.env for the defaults this script can answer without asking
:: ---------------------------------------------------------------------------
if not exist "%DEPLOY_ENV%" (
    echo ERROR: docker\config\deploy.env not found.
    echo Copy docker\config\deploy.env.example to docker\config\deploy.env and fill it in.
    exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%DEPLOY_ENV%") do (
    if not "%%a"=="" set "%%a=%%b"
)

:: ---------------------------------------------------------------------------
:: Ask for whatever is still missing
:: ---------------------------------------------------------------------------
if "%MIRROR_BASE_DOMAIN%"=="" (
    echo.
    echo MIRROR_BASE_DOMAIN is not set in deploy.env.
    rem No parentheses in the prompt: inside a parenthesised block cmd counts them
    rem even within quotes and the block ends early.
    set /p "MIRROR_BASE_DOMAIN=Base domain, e.g. edtech-rtk.ru: "
)
if "!MIRROR_BASE_DOMAIN!"=="" ( echo ERROR: base domain is required. & exit /b 1 )

if "%CERTBOT_EMAIL%"=="" (
    echo.
    echo CERTBOT_EMAIL is not set in deploy.env. Let's Encrypt registers the ACME
    echo account against it and sends certificate-expiry notices there.
    set /p "CERTBOT_EMAIL=Contact email for certbot: "
)
if "!CERTBOT_EMAIL!"=="" ( echo ERROR: certbot contact email is required. & exit /b 1 )

if "%MIRROR_ADMIN_EMAIL%"=="" (
    echo.
    echo A mirror starts with an EMPTY database, so it needs one account to log in
    echo with. It also becomes a configured superadmin of this instance.
    set /p "MIRROR_ADMIN_EMAIL=Administrator email: "
)
if "!MIRROR_ADMIN_EMAIL!"=="" ( echo ERROR: administrator email is required. & exit /b 1 )

:: ---------------------------------------------------------------------------
:: Password: read silently, or generate one when the operator just presses Enter.
:: Only the base64 form is passed on; the plaintext is printed once at the end so
:: a generated password is not lost.
:: ---------------------------------------------------------------------------
echo.
echo Administrator password - leave empty to generate a strong one.
rem The generator loop is written WITHOUT a pipeline on purpose: `|` inside the
rem double-quoted command is not a cmd pipe, but `^|` is not unescaped there either
rem - PowerShell would receive a literal caret and fail to parse. A plain `for`
rem loop avoids the question entirely.
for /f "usebackq tokens=1,2" %%p in (`powershell -NoProfile -Command "$s=Read-Host 'Password' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); $gen=$false; if ([string]::IsNullOrEmpty($b)) { $gen=$true; $set='abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_@#$*'.ToCharArray(); $c=New-Object char[] 20; for ($i=0; $i -lt 20; $i++) { $c[$i]=$set[(Get-Random -Maximum $set.Length)] }; $b=-join $c }; $e=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($b)); if ($gen) { Write-Output ($b+' '+$e) } else { Write-Output ('- '+$e) }"`) do (
    set "ADMIN_PW_PLAIN=%%p"
    set "ADMIN_PW_B64=%%q"
)
if "!ADMIN_PW_B64!"=="" ( echo ERROR: could not read the password. & exit /b 1 )

set "FQDN=%LABEL%.!MIRROR_BASE_DOMAIN!"

:: ---------------------------------------------------------------------------
:: Confirm: this reaches outside - it requests a real certificate for a real
:: domain (Let's Encrypt rate-limits repeated failures) and publishes the instance.
:: ---------------------------------------------------------------------------
echo.
echo ===================================================
echo  Raise a mirror of production
echo ===================================================
echo  Server:     %DEPLOY_TARGET%
echo  Instance:   %LABEL%   (port %PORT%)
echo  URL:        https://!FQDN!
echo  Database:   created EMPTY, seeded with the administrator below
echo  Admin:      !MIRROR_ADMIN_EMAIL!
if not "!ADMIN_PW_PLAIN!"=="-" echo  Password:   generated, shown when the deploy finishes
echo  Certbot:    !CERTBOT_EMAIL!
echo ===================================================
echo  The DNS record for !FQDN! must already point at this
echo  server and port 80 must be reachable, or certbot fails.
echo ===================================================
echo.
set /p "CONFIRM=Proceed? [y/N] "
if /i not "!CONFIRM!"=="y" ( echo Aborted. & exit /b 1 )

call "%SCRIPT_DIR%deploy.bat" "%DEPLOY_TARGET%" mirror ^
    --name "%LABEL%" --port "%PORT%" --domain "!FQDN!" ^
    --certbot-email "!CERTBOT_EMAIL!" ^
    --admin-email "!MIRROR_ADMIN_EMAIL!" --admin-password-b64 "!ADMIN_PW_B64!" ^
    !PASSTHROUGH!
set "DEPLOY_RC=%errorlevel%"

set "ADMIN_PW_B64="

if not "%DEPLOY_RC%"=="0" (
    set "ADMIN_PW_PLAIN="
    exit /b %DEPLOY_RC%
)

if not "!ADMIN_PW_PLAIN!"=="-" (
    echo.
    echo ===================================================
    echo  Generated administrator password - save it now,
    echo  it is not stored anywhere:
    echo.
    echo      !MIRROR_ADMIN_EMAIL!
    echo      !ADMIN_PW_PLAIN!
    echo ===================================================
)
set "ADMIN_PW_PLAIN="
goto :end

:usage
echo.
echo Usage: deploy-mirror.bat ^<user@server^> ^<label^> ^<port^> [--reset-db] [--no-build]
echo.
echo   label   third-level domain label, e.g. "demo" -^> https://demo.^<base domain^>
echo   port    host port for the container ^(must be free on the server^)
echo.
echo Example:
echo   scripts\deploy\deploy-mirror.bat vvlad1973@192.168.1.200 demo 8083
exit /b 1

:end
endlocal
