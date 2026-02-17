# План: Docker-контейнеризация SCORM Test Constructor

## Цель

Создать систему деплоя с подготовкой пакета локально и разворачиванием на сервере.

## Структура в проекте

```text
Fullstack-MVP-testing/
  docker/
    config/
      deploy.env.example        # пример конфигурации (сервер, пути, Docker)
    templates/
      docker-compose.yml        # шаблон композиции
      .env.example              # пример переменных приложения
    scripts/
      prepare-deploy.bat        # Windows: создает tar.gz
      upload-deploy.bat         # Windows: копирует на сервер
      deploy.sh                 # Linux: разворачивает на сервере
      rollback.sh               # Linux: полный откат изменений
    Dockerfile
    .dockerignore
```

Важно: `docker/config/deploy.env` добавлен в `.gitignore` (содержит секреты).

## Структура на сервере (после деплоя)

```text
/srv/
  app/test_builder/
    env/
      .env                      # секреты (DATABASE_URL, SESSION_SECRET, etc)
    config/
      docker-compose.yml        # композиция контейнеров
    source/                     # исходники проекта
      package.json
      client/
      server/
      shared/
      Dockerfile
      .dockerignore

  data/test_builder/
    uploads/
      media/                    # загруженные медиафайлы
      scorm/
        identifiers.json        # маппинг ID тестов
```

## Файлы для создания

### 1. docker/config/deploy.env.example

Единый конфиг (копируется в deploy.env):

```bash
# === Подключение к серверу ===
SERVER_HOST=192.168.1.100
SERVER_USER=deploy
SERVER_PATH=/tmp

# === Имя проекта ===
PROJECT_NAME=test_builder

# === Пути на сервере ===
SRV_APP_BASE=/srv/app
SRV_DATA_BASE=/srv/data

# === Права доступа ===
DIR_OWNER=root
DIR_GROUP=botadmins

# === Docker ===
EXPOSE_PORT=5000
INTERNAL_PORT=5000
```

### 2. docker/Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p uploads/media uploads/scorm && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
```

### 3. docker/.dockerignore

```text
node_modules/
dist/
.git/
.env
*.zip
uploads/
.vscode/
docs/
*.md
```

### 4. docker/templates/docker-compose.yml

```yaml
services:
  app:
    image: ${IMAGE_NAME}:latest
    container_name: ${CONTAINER_NAME}
    restart: unless-stopped
    ports:
      - "${EXPOSE_PORT}:${INTERNAL_PORT}"
    volumes:
      - ${UPLOADS_DIR}:/app/uploads
    env_file:
      - ${ENV_DIR}/.env
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:5000/api/me"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### 5. docker/templates/.env.example

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/test_builder

# Session
SESSION_SECRET=your-secret-key-change-in-production

# Encryption (for email encryption in database)
ENCRYPTION_PASSWORD=change-this-to-strong-password
ENCRYPTION_SALT=change-this-to-random-salt

# SMTP (optional - if not set, password reset links will be logged to console)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# App
APP_NAME=Конструктор SCORM-тестов
```

### 6. docker/scripts/prepare-deploy.bat

Локальный скрипт для Windows (подготовка пакета):

```batch
@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set DOCKER_DIR=%SCRIPT_DIR%..
set PROJECT_ROOT=%DOCKER_DIR%\..
set BUILD_DIR=%DOCKER_DIR%\build

:: Генерация timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,8%_%datetime:~8,6%
set ARCHIVE_NAME=test_builder_deploy_%TIMESTAMP%.tar.gz

echo === Подготовка пакета для деплоя ===

:: Очистка и создание build директории
if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%\source"
mkdir "%BUILD_DIR%\config"
mkdir "%BUILD_DIR%\env"
mkdir "%BUILD_DIR%\scripts"

:: Копирование исходников (robocopy с исключениями)
echo Копирование исходников...
robocopy "%PROJECT_ROOT%" "%BUILD_DIR%\source" /e /xd node_modules dist uploads .git docker\build .vscode /xf *.zip .env /njh /njs /ndl /nc /ns

:: Копирование Dockerfile и .dockerignore в source
copy "%DOCKER_DIR%\Dockerfile" "%BUILD_DIR%\source\"
copy "%DOCKER_DIR%\.dockerignore" "%BUILD_DIR%\source\"

:: Копирование шаблонов
echo Копирование конфигурации...
copy "%DOCKER_DIR%\templates\docker-compose.yml" "%BUILD_DIR%\config\"
copy "%DOCKER_DIR%\templates\.env.example" "%BUILD_DIR%\env\"

:: Копирование конфига и скрипта деплоя
copy "%DOCKER_DIR%\config\deploy.env" "%BUILD_DIR%\config\"
copy "%DOCKER_DIR%\scripts\deploy.sh" "%BUILD_DIR%\scripts\"

:: Создание архива (требуется tar, встроен в Windows 10+)
echo Создание архива %ARCHIVE_NAME%...
cd /d "%BUILD_DIR%"
tar -czvf "..\%ARCHIVE_NAME%" .

echo.
echo === Готово ===
echo Архив: %DOCKER_DIR%\%ARCHIVE_NAME%
echo.
echo Для деплоя:
echo   1. Скопируйте архив на сервер: scp %DOCKER_DIR%\%ARCHIVE_NAME% user@server:/tmp/
echo   2. На сервере: cd /tmp ^&^& tar -xzf %ARCHIVE_NAME%
echo   3. Запустите: sudo bash scripts/deploy.sh

pause
```

### 7. docker/scripts/upload-deploy.bat

Копирует архив и скрипт на сервер:

```batch
@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set DOCKER_DIR=%SCRIPT_DIR%..
set CONFIG_DIR=%DOCKER_DIR%\config

:: Загрузка конфигурации
if not exist "%CONFIG_DIR%\deploy.env" (
    echo Ошибка: deploy.env не найден!
    echo Скопируйте deploy.env.example в deploy.env и заполните данные сервера.
    pause
    exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in ("%CONFIG_DIR%\deploy.env") do (
    set "%%a=%%b"
)

:: Поиск последнего архива
for /f "delims=" %%i in ('dir /b /o-d "%DOCKER_DIR%\test_builder_deploy_*.tar.gz" 2^>nul') do (
    set "ARCHIVE=%%i"
    goto :found
)
echo Ошибка: архив не найден. Сначала запустите prepare-deploy.bat
pause
exit /b 1

:found
echo === Загрузка на сервер %SERVER_HOST% ===
echo Архив: %ARCHIVE%
echo Путь: %SERVER_PATH%

:: Копирование через scp (архив + оба скрипта)
scp "%DOCKER_DIR%\%ARCHIVE%" "%SCRIPT_DIR%deploy.sh" "%SCRIPT_DIR%rollback.sh" %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/

if %errorlevel% neq 0 (
    echo Ошибка при копировании!
    pause
    exit /b 1
)

echo.
echo === Готово ===
echo Файлы скопированы в %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%
echo.
echo Для запуска деплоя на сервере:
echo   ssh %SERVER_USER%@%SERVER_HOST%
echo   cd %SERVER_PATH% ^&^& sudo bash deploy.sh

pause
```

### 8. docker/scripts/deploy.sh

Серверный скрипт (копируется на сервер вместе с архивом, сам распаковывает):

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Поиск архива рядом со скриптом
ARCHIVE=$(ls -t "$SCRIPT_DIR"/test_builder_deploy_*.tar.gz 2>/dev/null | head -1)

if [ -z "$ARCHIVE" ]; then
    echo "Ошибка: архив test_builder_deploy_*.tar.gz не найден в $SCRIPT_DIR"
    exit 1
fi

echo "=== Распаковка $(basename "$ARCHIVE") ==="
DEPLOY_DIR=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$DEPLOY_DIR"

# Загрузка конфигурации
source "$DEPLOY_DIR/config/deploy.env"

# Производные пути
APP_DIR="${SRV_APP_BASE}/${PROJECT_NAME}"
DATA_DIR="${SRV_DATA_BASE}/${PROJECT_NAME}"
SOURCE_DIR="${APP_DIR}/source"
CONFIG_DIR="${APP_DIR}/config"
ENV_DIR="${APP_DIR}/env"
UPLOADS_DIR="${DATA_DIR}/uploads"
CONTAINER_NAME="${PROJECT_NAME}"
IMAGE_NAME="${PROJECT_NAME}"

echo "=== Деплой ${PROJECT_NAME} ==="
echo "APP_DIR: $APP_DIR"
echo "DATA_DIR: $DATA_DIR"

# Создание структуры директорий
echo "Создание директорий..."
mkdir -p "$SOURCE_DIR" "$CONFIG_DIR" "$ENV_DIR"
mkdir -p "$UPLOADS_DIR/media" "$UPLOADS_DIR/scorm"

# Установка владельца
chown -R "${DIR_OWNER}:${DIR_GROUP}" "$APP_DIR"
chown -R "${DIR_OWNER}:${DIR_GROUP}" "$DATA_DIR"

# Копирование файлов
echo "Копирование исходников..."
rsync -av --delete "$DEPLOY_DIR/source/" "$SOURCE_DIR/"

echo "Копирование конфигурации..."
cp "$DEPLOY_DIR/config/docker-compose.yml" "$CONFIG_DIR/"

# Проверка .env
if [ ! -f "$ENV_DIR/.env" ]; then
    echo "Копирование примера .env..."
    cp "$DEPLOY_DIR/env/.env.example" "$ENV_DIR/.env"
    echo ""
    echo "!!! ВНИМАНИЕ: Отредактируйте $ENV_DIR/.env перед запуском !!!"
    echo "nano $ENV_DIR/.env"
    echo ""
    read -p "Нажмите Enter после редактирования .env..."
fi

# Подстановка переменных в docker-compose.yml
echo "Генерация docker-compose.yml..."
export IMAGE_NAME CONTAINER_NAME EXPOSE_PORT INTERNAL_PORT UPLOADS_DIR ENV_DIR
envsubst < "$DEPLOY_DIR/config/docker-compose.yml" > "$CONFIG_DIR/docker-compose.yml"

# Сборка образа
echo "Сборка Docker образа..."
cd "$SOURCE_DIR"
docker build -t "$IMAGE_NAME:latest" .

# Остановка старого контейнера (если есть)
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Остановка старого контейнера..."
    docker stop "$CONTAINER_NAME" || true
    docker rm "$CONTAINER_NAME" || true
fi

# Запуск нового контейнера
echo "Запуск контейнера..."
cd "$CONFIG_DIR"
docker compose up -d

# Очистка временной директории
rm -rf "$DEPLOY_DIR"

# Проверка статуса
echo ""
echo "=== Статус ==="
docker ps --filter "name=$CONTAINER_NAME"

echo ""
echo "=== Готово ==="
echo "Логи: docker logs -f $CONTAINER_NAME"
echo "URL: http://localhost:${EXPOSE_PORT}"

# Инициализация БД (если первый запуск)
read -p "Инициализировать БД (npm run db:push)? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker exec "$CONTAINER_NAME" npm run db:push
fi
```

### 9. docker/scripts/rollback.sh

Полный откат изменений (удаляет контейнер, образ, директории):

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Поиск конфига (может быть рядом или в распакованном архиве)
if [ -f "$SCRIPT_DIR/config/deploy.env" ]; then
    source "$SCRIPT_DIR/config/deploy.env"
elif [ -f "$SCRIPT_DIR/../config/deploy.env" ]; then
    source "$SCRIPT_DIR/../config/deploy.env"
else
    echo "Ошибка: deploy.env не найден"
    exit 1
fi

# Производные пути
APP_DIR="${SRV_APP_BASE}/${PROJECT_NAME}"
DATA_DIR="${SRV_DATA_BASE}/${PROJECT_NAME}"
CONTAINER_NAME="${PROJECT_NAME}"
IMAGE_NAME="${PROJECT_NAME}"

echo "=== Откат ${PROJECT_NAME} ==="
echo ""
echo "ВНИМАНИЕ! Будут удалены:"
echo "  - Контейнер: $CONTAINER_NAME"
echo "  - Образ: $IMAGE_NAME"
echo "  - Директория приложения: $APP_DIR"
echo "  - Директория данных: $DATA_DIR (включая uploads!)"
echo ""
read -p "Вы уверены? Это действие необратимо! [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Отменено."
    exit 0
fi

# Остановка и удаление контейнера
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Остановка контейнера..."
    docker stop "$CONTAINER_NAME" || true
    echo "Удаление контейнера..."
    docker rm "$CONTAINER_NAME" || true
fi

# Удаление образа
if docker images --format '{{.Repository}}' | grep -q "^${IMAGE_NAME}$"; then
    echo "Удаление образа..."
    docker rmi "$IMAGE_NAME:latest" || true
fi

# Удаление директорий
if [ -d "$APP_DIR" ]; then
    echo "Удаление $APP_DIR..."
    rm -rf "$APP_DIR"
fi

if [ -d "$DATA_DIR" ]; then
    echo "Удаление $DATA_DIR..."
    rm -rf "$DATA_DIR"
fi

echo ""
echo "=== Откат завершен ==="
```

## Использование

### Первоначальная настройка

```batch
:: Скопировать и заполнить конфиг с секретами
copy docker\config\deploy.env.example docker\config\deploy.env
notepad docker\config\deploy.env
```

### 1. Подготовка пакета (Windows)

```batch
docker\scripts\prepare-deploy.bat
```

Результат: `docker\test_builder_deploy_YYYYMMDD_HHMMSS.tar.gz`

### 2. Загрузка на сервер (Windows)

```batch
docker\scripts\upload-deploy.bat
```

Копирует архив, deploy.sh и rollback.sh на сервер через scp.

### 3. Запуск деплоя (на сервере)

```bash
cd /tmp && sudo bash deploy.sh
```

Скрипт сам распаковывает архив и разворачивает приложение.

### 4. Откат (на сервере, если нужно)

```bash
cd /tmp && sudo bash rollback.sh
```

Полностью удаляет контейнер, образ и все директории проекта.

## Изменяемые файлы в runtime

| Путь                                                    | Назначение               |
|---------------------------------------------------------|--------------------------|
| `/srv/data/test_builder/uploads/media/`                 | Загруженные медиафайлы   |
| `/srv/data/test_builder/uploads/scorm/identifiers.json` | Маппинг ID тестов        |

Примечание: SCORM-пакеты (zip) создаются в памяти, сессии хранятся в PostgreSQL.
