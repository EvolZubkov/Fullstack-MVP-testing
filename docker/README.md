# Docker Deploy

## Алгоритм деплоя

### Подготовка (один раз)

1. Скопировать конфиг:

   ```batch
   copy docker\config\deploy.env.example docker\config\deploy.env
   ```

2. Заполнить `docker\config\deploy.env`:
   - `SERVER_HOST` - IP сервера
   - `SERVER_USER` - пользователь SSH
   - `SERVER_PATH` - путь для временных файлов (/tmp)
   - `PROJECT_NAME` - имя проекта
   - `EXPOSE_PORT` - внешний порт

### Деплой

#### 1. Подготовка пакета (Windows)

```batch
docker\scripts\prepare-deploy.bat
```

Что происходит:

- Запускается `npm run build` (компиляция TypeScript)
- Создается `docker/build/` с:
  - `source/` - package.json, package-lock.json, dist/, Dockerfile
  - `config/` - docker-compose.yml, deploy.env
  - `env/` - .env.example (или .env из проекта)
- Упаковывается в `docker/test_builder_deploy_YYYYMMDD_HHMMSS.tar.gz`

#### 2. Загрузка на сервер (Windows)

```batch
docker\scripts\upload-deploy.bat
```

Что происходит:

- Читает настройки из `deploy.env`
- Копирует через scp:
  - Архив `test_builder_deploy_*.tar.gz`
  - Скрипт `deploy.sh`
  - Скрипт `rollback.sh`

#### 3. Запуск деплоя (на сервере)

```bash
cd /tmp && sudo bash deploy.sh
```

Что происходит:

- Распаковывает архив во временную директорию
- Читает конфигурацию из `deploy.env`
- Создает структуру:

  ```txt
  /srv/app/test_builder/
    docker-compose.yml
    env/
      .env

  /srv/data/test_builder/
    uploads/
      media/
      scorm/
  ```

- Устанавливает владельца (`DIR_OWNER:DIR_GROUP`)
- Если `.env` не существует - копирует шаблон и просит отредактировать
- Генерирует `docker-compose.yml` с подстановкой переменных
- Собирает Docker-образ из временной директории (исходники внутри образа)
- Останавливает старый контейнер (если есть)
- Запускает новый контейнер (`docker compose up -d`)
- Спрашивает про инициализацию БД (`npm run db:push`)

### Управление контейнером (на сервере)

```bash
cd /srv/app/test_builder

# Остановить
docker compose stop

# Запустить
docker compose start

# Перезапустить
docker compose restart

# Логи
docker logs -f test_builder
```

Для обновления приложения - повторный деплой через `deploy.sh`.

### Откат

```bash
cd /tmp && sudo bash rollback.sh
```

Что происходит:

- Останавливает и удаляет контейнер
- Удаляет Docker-образ
- Удаляет `/srv/app/test_builder/`
- Удаляет `/srv/data/test_builder/` (включая uploads!)

## Структура файлов

```bash

docker/
  config/
    deploy.env.example    # шаблон конфигурации
    deploy.env            # конфигурация (не в git)
  templates/
    docker-compose.yml    # шаблон композиции
    .env.example          # шаблон переменных приложения
  scripts/
    prepare-deploy.bat    # подготовка пакета (Windows)
    upload-deploy.bat     # загрузка на сервер (Windows)
    deploy.sh             # деплой (Linux)
    rollback.sh           # откат (Linux)
  Dockerfile
  build/                  # временная директория сборки (не в git)
```

## Переменные окружения

### deploy.env (деплой)

| Переменная | Описание |
| ---------- | -------- |
| SERVER_HOST | IP-адрес сервера |
| SERVER_USER | SSH-пользователь |
| SERVER_PATH | Путь для временных файлов |
| PROJECT_NAME | Имя проекта |
| SRV_APP_BASE | Базовый путь приложений (/srv/app) |
| SRV_DATA_BASE | Базовый путь данных (/srv/data) |
| DIR_OWNER | Владелец директорий |
| DIR_GROUP | Группа директорий |
| EXPOSE_PORT | Внешний порт |
| INTERNAL_PORT | Внутренний порт контейнера |

### .env (приложение)

| Переменная | Описание |
| ---------- | -------- |
| DATABASE_URL | Подключение к PostgreSQL |
| SESSION_SECRET | Секрет сессий |
| ENCRYPTION_PASSWORD | Пароль шифрования email |
| ENCRYPTION_SALT | Соль шифрования |
| SMTP_* | Настройки почты (опционально) |
