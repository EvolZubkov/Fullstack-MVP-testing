# SCORM Test Constructor

Веб-приложение для создания, управления и экспорта интерактивных тестов в формате SCORM 2004. Поддерживает стандартный и адаптивный режимы тестирования.

## 📋 Содержание

- [Возможности](#-возможности)
- [Технологии](#-технологии)
- [Требования](#-требования)
- [Установка](#-установка)
- [Запуск](#-запуск)
- [Деплой в продакшн](#-деплой-в-продакшн)
- [Структура проекта](#-структура-проекта)
- [API Reference](#-api-reference)
- [Архитектура](#-архитектура)
- [Конфигурация](#-конфигурация)

---

## ✨ Возможности

### Для авторов (Author role)
- **Управление темами** — создание, редактирование, удаление тем с иерархией папок
- **Управление вопросами** — 4 типа вопросов с медиа-вложениями:
  - Single choice (один ответ)
  - Multiple choice (несколько ответов)
  - Matching (соответствие)
  - Ranking (ранжирование)
- **Создание тестов** — два режима:
  - Стандартный (фиксированный набор вопросов)
  - Адаптивный (динамическая сложность)
- **SCORM экспорт** — генерация пакетов SCORM 2004 для LMS
- **Аналитика** — статистика по тестам, темам, пользователям
- **Импорт/Экспорт** — Excel для массовой работы с вопросами

### Для учеников (Learner role)
- Прохождение тестов с таймером
- Адаптивное тестирование с динамическим уровнем сложности
- История попыток с детализацией
- Рекомендации по обучению на основе результатов

### SCORM пакеты
- Совместимость с SCORM 2004
- Телеметрия результатов обратно на сервер
- Работа оффлайн в LMS
- PDF-экспорт результатов
- Поддержка медиа-файлов

---

## 🛠 Технологии

### Frontend
- **React 18** — UI библиотека
- **TypeScript** — типизация
- **Tailwind CSS** — стилизация
- **shadcn/ui** — компонентная библиотека
- **TanStack Query** — управление состоянием сервера
- **Wouter** — роутинг
- **React Hook Form + Zod** — формы и валидация

### Backend
- **Express.js** — веб-фреймворк
- **PostgreSQL** — база данных
- **Drizzle ORM** — работа с БД
- **Passport.js** — аутентификация
- **Multer** — загрузка файлов
- **Archiver** — создание ZIP

### Инструменты
- **Vite** — сборка и dev server
- **ESBuild** — production сборка
- **tsx** — запуск TypeScript

---

## 📦 Требования

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 14.0
- **npm** >= 8.0.0

---

## 🚀 Установка

### 1. Клонирование репозитория

```bash
git clone <repository-url>
cd Fullstack-MVP-testing
```

### 2. Установка зависимостей

```bash
npm install
```

### 3. Настройка базы данных

Создайте базу данных PostgreSQL:

```sql
CREATE DATABASE scorm_db;
```

### 4. Конфигурация окружения

Создайте файл `.env` в корне проекта:

```env
# База данных
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/scorm_db

# Сервер
PORT=5001
NODE_ENV=development

# API (для SCORM телеметрии)
API_BASE_URL=http://localhost:5001

# Сессии (опционально)
SESSION_SECRET=your-secret-key-here
```

### 5. Инициализация БД

```bash
npm run db:push
```

При первом запуске автоматически создаются демо-пользователи:
- **admin** / admin123 (role: author)
- **learner** / learner123 (role: learner)

---

## ▶️ Запуск

### Development режим

```bash
npm run dev
```

Приложение будет доступно по адресу: `http://localhost:5001`

### Production сборка

```bash
npm run build
npm start
```

### Проверка типов

```bash
npm run check
```

---

## 🌐 Деплой в продакшн

### Вариант 1: Традиционный сервер (VPS/Dedicated)

#### 1. Подготовка сервера

```bash
# Установка Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установка PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Установка PM2 (менеджер процессов)
sudo npm install -g pm2
```

#### 2. Настройка PostgreSQL

```bash
sudo -u postgres psql

CREATE USER scorm_user WITH PASSWORD 'secure_password';
CREATE DATABASE scorm_db OWNER scorm_user;
GRANT ALL PRIVILEGES ON DATABASE scorm_db TO scorm_user;
\q
```

#### 3. Деплой приложения

```bash
# Клонирование
git clone <repository-url> /var/www/scorm-app
cd /var/www/scorm-app

# Установка зависимостей
npm ci --production

# Сборка
npm run build

# Создание .env
cat > .env << EOF
DATABASE_URL=postgresql://scorm_user:secure_password@localhost:5432/scorm_db
PORT=5001
NODE_ENV=production
API_BASE_URL=https://your-domain.com
SESSION_SECRET=$(openssl rand -hex 32)
EOF

# Инициализация БД
npm run db:push

# Запуск через PM2
pm2 start dist/index.cjs --name scorm-app
pm2 save
pm2 startup
```

#### 4. Настройка Nginx (reverse proxy)

```nginx
# /etc/nginx/sites-available/scorm-app
server {
    listen 80;
    server_name your-domain.com;

    # Редирект на HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Размер загружаемых файлов
    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Статические файлы медиа
    location /uploads {
        alias /var/www/scorm-app/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/scorm-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. SSL сертификат (Let's Encrypt)

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Вариант 2: Docker

#### Dockerfile

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm ci --production
EXPOSE 5001
CMD ["node", "dist/index.cjs"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "5001:5001"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/scorm_db
      - NODE_ENV=production
      - PORT=5001
      - API_BASE_URL=https://your-domain.com
      - SESSION_SECRET=your-secret
    depends_on:
      - db
    volumes:
      - uploads:/app/uploads

  db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=scorm_db
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
  uploads:
```

```bash
docker-compose up -d
```

### Вариант 3: Cloud платформы

#### Railway

```bash
# Установите Railway CLI
npm install -g @railway/cli

# Логин и деплой
railway login
railway init
railway add postgresql
railway up
```

#### Render

1. Создайте Web Service из репозитория
2. Build Command: `npm install && npm run build`
3. Start Command: `npm start`
4. Добавьте PostgreSQL addon
5. Настройте Environment Variables

---

## 📁 Структура проекта

```
├── client/                    # Frontend (React)
│   ├── src/
│   │   ├── components/        # Компоненты
│   │   │   ├── ui/            # shadcn/ui компоненты
│   │   │   └── ...            # Кастомные компоненты
│   │   ├── hooks/             # React хуки
│   │   ├── lib/               # Утилиты (auth, i18n, queryClient)
│   │   ├── pages/             # Страницы
│   │   │   ├── author/        # Панель автора
│   │   │   └── learner/       # Панель ученика
│   │   ├── App.tsx            # Главный компонент
│   │   └── main.tsx           # Entry point
│   └── index.html
│
├── server/                    # Backend (Express)
│   ├── scorm/                 # SCORM генератор
│   │   ├── assets/            # Статика для пакета
│   │   ├── builders/          # Сборщики (manifest, test-json)
│   │   ├── template/          # JS логика для SCORM
│   │   │   └── app/           # Приложение SCORM-пакета
│   │   └── index.ts           # Главный экспорт
│   ├── db.ts                  # Подключение к БД
│   ├── index.ts               # Entry point сервера
│   ├── routes.ts              # API endpoints
│   ├── storage.ts             # Data access layer
│   └── vite.ts                # Vite dev middleware
│
├── shared/                    # Общий код
│   └── schema.ts              # Схема БД и типы
│
├── uploads/                   # Загруженные медиа
│   └── media/
│
├── .env                       # Переменные окружения (не коммитить!)
├── drizzle.config.ts          # Конфиг Drizzle
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── vite.config.ts
```

---

## 📡 API Reference

### Аутентификация

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/auth/login` | Вход в систему |
| POST | `/api/auth/logout` | Выход |
| GET | `/api/auth/me` | Текущий пользователь |

### Темы (требуется author role)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/topics` | Список тем |
| POST | `/api/topics` | Создать тему |
| PUT | `/api/topics/:id` | Обновить тему |
| DELETE | `/api/topics/:id` | Удалить тему |
| POST | `/api/topics/:id/duplicate` | Дублировать тему |
| POST | `/api/topics/bulk-delete` | Массовое удаление |

### Вопросы

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/questions` | Список вопросов |
| POST | `/api/questions` | Создать вопрос |
| PUT | `/api/questions/:id` | Обновить вопрос |
| DELETE | `/api/questions/:id` | Удалить вопрос |
| POST | `/api/questions/:id/duplicate` | Дублировать |
| GET | `/api/questions/export` | Экспорт в Excel |
| POST | `/api/questions/import` | Импорт из Excel |

### Тесты

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/tests` | Список тестов |
| POST | `/api/tests` | Создать тест |
| PUT | `/api/tests/:id` | Обновить тест |
| DELETE | `/api/tests/:id` | Удалить тест |
| GET | `/api/tests/:id/scorm` | Экспорт SCORM |
| PUT | `/api/tests/:id/publish` | Публикация |

### Попытки (Learner)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/learner/tests` | Доступные тесты |
| POST | `/api/tests/:id/attempts` | Начать тест |
| POST | `/api/attempts/:id/submit` | Завершить тест |
| GET | `/api/attempts/:id` | Результат попытки |
| GET | `/api/attempts` | История попыток |

### Аналитика (Author)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/analytics/combined` | Общая аналитика |
| GET | `/api/analytics/tests/:id` | Аналитика теста |
| GET | `/api/analytics/tests/:id/attempts` | Попытки теста |

---

## 🏗 Архитектура

### Потоки данных

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (React SPA)                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                      Express Server                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │   Routes    │  │   Storage   │  │   SCORM Builder     │   │
│  │  (REST API) │  │   (DAL)     │  │   (ZIP Generator)   │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │
└─────────┼────────────────┼─────────────────────┼─────────────┘
          │                │                     │
          ▼                ▼                     ▼
    ┌──────────┐    ┌──────────┐         ┌──────────────┐
    │ Sessions │    │PostgreSQL│         │ ZIP Download │
    │ (Memory) │    │ (Drizzle)│         │              │
    └──────────┘    └──────────┘         └──────────────┘
```

### Модель данных

```
users
  └── attempts (1:N)

folders
  └── topics (1:N)
        └── questions (1:N)
        └── topic_courses (1:N)

tests
  └── test_sections (1:N)
        └── references → topics
  └── adaptive_topic_settings (1:N) [adaptive mode]
        └── adaptive_levels (1:N)
              └── adaptive_level_links (1:N)

scorm_packages
  └── scorm_attempts (1:N)
        └── scorm_answers (1:N)
```

---

## ⚙️ Конфигурация

### Environment Variables

| Переменная | Обязательна | По умолчанию | Описание |
|------------|-------------|--------------|----------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `PORT` | ❌ | 5000 | Порт сервера |
| `NODE_ENV` | ❌ | development | Режим (development/production) |
| `API_BASE_URL` | ❌ | http://localhost:PORT | URL для SCORM телеметрии |
| `SESSION_SECRET` | ❌ | auto | Секрет для сессий |

### Лимиты

| Параметр | Значение | Где изменить |
|----------|----------|--------------|
| Размер файла | 200 MB | `server/routes.ts` (mediaUpload) |
| Время сессии | 24 часа | `server/routes.ts` (session cookie) |
| Body limit | 50 MB | `server/index.ts` (express.json) |

---

## 🔒 Безопасность

### Рекомендации для продакшн

1. **Использовать HTTPS** — обязательно для cookies и данных
2. **Изменить SESSION_SECRET** — использовать криптографически стойкий ключ
3. **Настроить CORS** — ограничить разрешённые origins
4. **Rate limiting** — защита от DDoS
5. **Регулярные бэкапы БД** — pg_dump по расписанию
6. **Обновлять зависимости** — `npm audit fix`

---

## 📄 Лицензия

MIT License

---

## 🤝 Поддержка

При возникновении проблем создайте Issue в репозитории.
