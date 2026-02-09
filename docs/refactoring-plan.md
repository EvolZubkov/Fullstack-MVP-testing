# План рефакторинга: разделение на backend и frontend

## Принятые решения

- **Структура:** npm workspaces (один репозиторий)
- **Production:** Отдельный хостинг frontend (CDN/nginx), backend только API
- **CORS:** Требуется для production и development
- **Тесты:** Unit + Integration в каждом пакете, E2E в корне

## Текущее состояние

Монорепозиторий с единым `package.json` (~70 зависимостей), где:

- `client/` - React 18 frontend (Vite, Wouter, React Query, Tailwind, Radix UI)
- `server/` - Express backend (Drizzle ORM, PostgreSQL)
- `shared/schema.ts` - Drizzle таблицы + Zod схемы (28KB, используется обеими сторонами)

**Ключевые связи:**

- Frontend использует относительные пути `/api/*`
- Сессионная аутентификация через cookies
- Backend в production раздает статику из `dist/public` (будет удалено)

## Целевая структура

```text
/
├── packages/
│   ├── shared/                       # Общие типы и схемы
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── schema.ts             # Drizzle таблицы (backend-only)
│   │       ├── types.ts              # Zod схемы + типы (общие)
│   │       └── index.ts
│   ├── frontend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── index.html
│   │   ├── src/                      # Из client/src
│   │   └── tests/
│   │       ├── unit/                 # Unit-тесты компонентов и хуков
│   │       │   ├── components/
│   │       │   └── hooks/
│   │       └── integration/          # Интеграционные тесты (React Testing Library)
│   │           └── pages/
│   └── backend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── drizzle.config.ts
│       ├── src/                      # Из server/
│       └── tests/
│           ├── unit/                 # Unit-тесты сервисов и утилит
│           │   ├── services/
│           │   └── utils/
│           └── integration/          # Интеграционные тесты API (supertest)
│               └── routes/
├── e2e/                              # E2E тесты (Playwright)
│   ├── package.json
│   ├── playwright.config.ts
│   └── specs/
│       ├── auth.spec.ts
│       ├── test-taking.spec.ts
│       └── author-panel.spec.ts
├── package.json                      # Workspace root
├── docker/
├── migrations/
└── uploads/
```

## Этапы реализации

### Этап 1: Подготовка структуры каталогов

1. Создать `packages/shared/`, `packages/frontend/`, `packages/backend/`
2. Создать базовые `package.json` для каждого пакета

### Этап 2: Разделение shared/schema.ts

**Критический файл:** `shared/schema.ts` (28KB)

Разделить на:

- `packages/shared/src/schema.ts` - Drizzle таблицы (импорт только в backend)
- `packages/shared/src/types.ts` - Zod схемы и TypeScript типы (импорт в обоих)

### Этап 3: Миграция frontend

1. Переместить `client/src/` в `packages/frontend/src/`
2. Переместить `client/index.html` в `packages/frontend/`
3. Переместить конфиги: `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `components.json`
4. Добавить поддержку API base URL в `queryClient.ts`
5. Настроить Vite proxy для development

**Изменения в queryClient.ts:**

```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
fetch(`${API_BASE}${url}`, { credentials: "include" });
```

**Vite proxy (development):**

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:5000',
    '/uploads': 'http://localhost:5000'
  }
}
```

### Этап 4: Миграция backend

1. Переместить `server/` в `packages/backend/src/`
2. Переместить `drizzle.config.ts` в `packages/backend/`
3. Обновить `script/build.ts` для новой структуры
4. Удалить `server/static.ts` (больше не нужен)
5. Добавить CORS middleware (для dev и production)

**CORS middleware:**

```typescript
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
```

**Новые env-переменные:**

- `CORS_ORIGIN` - URL frontend в production (например, `https://app.example.com`)

### Этап 5: Обновление импортов

**Frontend:**

```typescript
// Было: import type { User } from "@shared/schema";
// Стало: import type { User } from "@scorm-test/shared/types";
```

**Backend:**

```typescript
// Было: import * as schema from "@shared/schema";
// Стало: import * as schema from "@scorm-test/shared/schema";
```

### Этап 6: Настройка npm workspaces

**Корневой package.json:**

```json
{
  "workspaces": ["packages/*", "e2e"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w @scorm-test/backend\" \"npm run dev -w @scorm-test/frontend\"",
    "build": "npm run build -w @scorm-test/shared && npm run build -w @scorm-test/frontend && npm run build -w @scorm-test/backend",
    "start": "npm start -w @scorm-test/backend",
    "test": "npm run test -w @scorm-test/backend && npm run test -w @scorm-test/frontend",
    "test:unit": "npm run test:unit -w @scorm-test/backend && npm run test:unit -w @scorm-test/frontend",
    "test:integration": "npm run test:integration -w @scorm-test/backend && npm run test:integration -w @scorm-test/frontend",
    "test:e2e": "npm test -w e2e"
  }
}
```

### Этап 7: Обновление Docker

Обновить `docker/Dockerfile`:

1. Build shared
2. Build backend (без frontend)
3. Отдельный Dockerfile для frontend (статика для nginx/CDN)

### Этап 8: Обновление TypeScript конфигов

Создать отдельные `tsconfig.json` для каждого пакета с project references.

### Этап 9: Настройка тестирования

#### Backend тесты (Vitest + supertest)

1. Создать `packages/backend/vitest.config.ts`
2. Структура `packages/backend/tests/`:
   - `unit/utils/` - криптография, хелперы
   - `unit/services/` - бизнес-логика (подсчет баллов, SCORM экспорт)
   - `integration/routes/` - API endpoints через supertest с тестовой БД
3. Зависимости: `vitest`, `supertest`, `@types/supertest`

Скрипты в `packages/backend/package.json`:

```json
{
  "test": "vitest run",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:watch": "vitest"
}
```

#### Frontend тесты (Vitest + React Testing Library)

1. Создать `packages/frontend/vitest.config.ts`
2. Структура `packages/frontend/tests/`:
   - `unit/components/` - изолированные компоненты
   - `unit/hooks/` - кастомные хуки
   - `integration/pages/` - страницы с мокированным API через MSW
3. Зависимости: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `msw`

Скрипты в `packages/frontend/package.json`:

```json
{
  "test": "vitest run",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:watch": "vitest"
}
```

#### E2E тесты (Playwright)

1. Создать `e2e/` как отдельный workspace пакет
2. Настроить `e2e/playwright.config.ts`
3. Сценарии:
   - `e2e/specs/auth.spec.ts` - логин, логаут, сброс пароля
   - `e2e/specs/author-panel.spec.ts` - создание тем, вопросов, тестов
   - `e2e/specs/test-taking.spec.ts` - прохождение теста, результаты
   - `e2e/specs/scorm-export.spec.ts` - экспорт SCORM пакета
4. Зависимости: `@playwright/test`

Скрипты в `e2e/package.json`:

```json
{
  "test": "playwright test",
  "test:ui": "playwright test --ui",
  "test:headed": "playwright test --headed"
}
```

#### Корневые скрипты тестирования

В корневом `package.json`:

```json
{
  "test": "npm run test -w @scorm-test/backend && npm run test -w @scorm-test/frontend",
  "test:unit": "npm run test:unit -w @scorm-test/backend && npm run test:unit -w @scorm-test/frontend",
  "test:integration": "npm run test:integration -w @scorm-test/backend && npm run test:integration -w @scorm-test/frontend",
  "test:e2e": "npm test -w e2e"
}
```

## Критические файлы для изменения

| Файл | Действие |
| ---- | -------- |
| `shared/schema.ts` | Разделить на schema.ts + types.ts |
| `client/src/lib/queryClient.ts` | Добавить API_BASE_URL |
| `package.json` | Преобразовать в workspace root |
| `vite.config.ts` | Добавить proxy, обновить пути |
| `server/index.ts` | Добавить CORS middleware |
| `server/static.ts` | Удалить (не нужен) |
| `docker/Dockerfile` | Только backend |
| `packages/backend/vitest.config.ts` | Создать (backend тесты) |
| `packages/frontend/vitest.config.ts` | Создать (frontend тесты) |
| `e2e/playwright.config.ts` | Создать (E2E тесты) |

## Проверка

1. `npm install` - установка зависимостей workspaces
2. `npm run dev` - параллельный запуск frontend (5173) и backend (5000)
3. `npm run build` - сборка всех пакетов
4. `npm start` - production режим (только backend)
5. `npm test` - unit и интеграционные тесты
6. `npm run test:e2e` - E2E тесты
7. Проверить CORS с разных origins

## CORS (Cross-Origin Resource Sharing)

### Что такое CORS

CORS - механизм безопасности браузера, который блокирует запросы между разными origins.
Origin = протокол + домен + порт.

**Примеры разных origins:**

- `http://localhost:5173` и `http://localhost:5000` - разные (порты)
- `https://app.example.com` и `https://api.example.com` - разные (домены)
- `https://example.com` и `https://example.com/api` - одинаковые (same-origin)

### Когда нужен CORS

| Сценарий | CORS |
| -------- | ---- |
| Frontend и backend на разных портах (dev) | Нужен |
| Frontend и backend на разных доменах (prod) | Нужен |
| nginx proxy: frontend на `/`, backend на `/api/` | Не нужен |
| Backend раздает frontend статику | Не нужен |

### Настройка CORS в backend

**Установка:**

```bash
npm install cors
```

**Код (packages/backend/src/index.ts):**

```typescript
import cors from 'cors';

// Для development или если frontend на другом домене
if (process.env.CORS_ORIGIN) {
  app.use(cors({
    origin: process.env.CORS_ORIGIN,   // URL frontend
    credentials: true,                  // Разрешить cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type']
  }));
}
```

**Переменные окружения:**

```bash
# Development (frontend на localhost:5173)
CORS_ORIGIN=http://localhost:5173

# Production с разными доменами
CORS_ORIGIN=https://app.example.com

# Production с nginx proxy (CORS не нужен)
# CORS_ORIGIN не указывать
```

### CORS и cookies (сессии)

При cross-origin запросах cookies требуют дополнительной настройки:

Frontend (queryClient.ts):

```typescript
fetch(url, {
  credentials: 'include'  // Отправлять cookies
});
```

Backend (session config):

```typescript
app.use(session({
  cookie: {
    secure: true,         // Только HTTPS
    httpOnly: true,       // Недоступны из JS
    sameSite: 'none',     // Разрешить cross-origin
    // sameSite: 'lax'    // Для same-origin (nginx proxy)
  }
}));
```

### Варианты деплоя и CORS

#### Вариант A: nginx reverse proxy (рекомендуется)

```text
example.com/     -> nginx -> packages/frontend/dist/
example.com/api/ -> nginx -> localhost:5000
```

- CORS: не нужен (same-origin)
- Cookies: `sameSite: 'lax'`
- Проще настройка

#### Вариант B: Разные домены

```text
app.example.com  -> CDN/nginx -> packages/frontend/dist/
api.example.com  -> server -> localhost:5000
```

- CORS: обязателен (`CORS_ORIGIN=https://app.example.com`)
- Cookies: `sameSite: 'none'`, `secure: true`
- Гибче масштабирование

### Отладка CORS

Если видите ошибку в консоли браузера:

```text
Access to fetch at 'http://localhost:5000/api/...' from origin
'http://localhost:5173' has been blocked by CORS policy
```

Проверьте:

1. Backend запущен с `CORS_ORIGIN=http://localhost:5173`
2. Frontend использует `credentials: 'include'`
3. Backend отвечает с заголовками `Access-Control-Allow-*`

## Деплой после рефакторинга

### Переменные окружения

**Backend (.env):**

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/scorm
SESSION_SECRET=<secure-random-string>
ENCRYPTION_PASSWORD=<encryption-key>
ENCRYPTION_SALT=<encryption-salt>
PORT=5000

# Только если frontend на другом домене
CORS_ORIGIN=https://app.example.com
```

**Frontend (.env.production):**

```bash
# nginx proxy (один домен) - пустое значение
VITE_API_BASE_URL=

# Разные домены
VITE_API_BASE_URL=https://api.example.com
```

### Сборка

```bash
npm install
npm run build
```

### Чеклист

- [ ] PostgreSQL доступен, миграции применены
- [ ] Backend собран и запущен
- [ ] Frontend собран с правильным `VITE_API_BASE_URL`
- [ ] CORS настроен (если разные домены)
- [ ] SSL сертификаты установлены
- [ ] Проверена авторизация
- [ ] Проверена загрузка файлов

## Оценка затрат

### Трудоемкость по этапам

| Этап | Описание | Оценка |
| ---- | -------- | ------ |
| 1 | Создание структуры каталогов | 0.5 часа |
| 2 | Разделение shared/schema.ts | 2-3 часа |
| 3 | Миграция frontend | 2-3 часа |
| 4 | Миграция backend | 2-3 часа |
| 5 | Обновление импортов (~50 файлов) | 3-4 часа |
| 6 | Настройка npm workspaces | 1-2 часа |
| 7 | Обновление Docker | 1-2 часа |
| 8 | Обновление TypeScript конфигов | 1 час |
| 9 | Настройка тестирования | 4-6 часов |
| - | Отладка и проверка | 3-4 часа |

Итого: 20-28 часов (3-4 рабочих дня)

### Сложность по компонентам

| Компонент | Сложность | Причина |
| --------- | --------- | ------- |
| shared/schema.ts | Высокая | 28KB, 88 экспортов, зависимости Drizzle/Zod |
| Импорты | Средняя | ~50 файлов требуют обновления |
| package.json | Средняя | Разделение ~70 зависимостей |
| Vite config | Низкая | Простые изменения путей |
| Docker | Средняя | Multi-stage build для workspaces |
| Backend тесты | Средняя | supertest + тестовая БД, моки сервисов |
| Frontend тесты | Средняя | RTL + MSW для мокирования API |
| E2E тесты | Высокая | Playwright + запуск обоих серверов |

## Риски и митигация

### Высокий риск

1. Поломка импортов
   - Проблема: После разделения schema.ts часть импортов станет невалидной
   - Признак: TypeScript ошибки при сборке
   - Митигация: Использовать `tsc --noEmit` после каждого этапа

2. Несовместимость типов
   - Проблема: Drizzle типы и Zod схемы связаны, разделение может сломать типизацию
   - Признак: Ошибки типов в routes.ts, storage.ts
   - Митигация: Сначала разделить schema.ts и проверить сборку, потом продолжать

### Средний риск

1. Сессии и cookies
   - Проблема: При cross-origin сессии могут не работать
   - Признак: Авторизация пропадает после refresh страницы
   - Митигация: Тестировать авторизацию на каждом этапе

2. Загрузка файлов
   - Проблема: Пути к uploads/ могут сломаться
   - Признак: 404 при загрузке изображений
   - Митигация: Проверить пути в backend после миграции

3. SCORM экспорт
   - Проблема: Пути к assets в scorm/ зависят от структуры
   - Признак: Битые SCORM пакеты
   - Митигация: Тестировать экспорт после завершения

### Низкий риск

1. npm workspaces
   - Проблема: Проблемы с hoisting зависимостей
   - Признак: Module not found при запуске
   - Митигация: Использовать `npm install --legacy-peer-deps` при проблемах

2. Docker build
   - Проблема: Изменение путей сломает Dockerfile
   - Признак: Ошибки при docker build
   - Митигация: Обновлять Dockerfile последним, после проверки локальной сборки

## Стратегия отката

При критических проблемах:

```bash
# Откат к исходному состоянию
git checkout main
git branch -D refactoring-split
```

Рекомендация: выполнять рефакторинг в отдельной ветке с частыми коммитами.

## Альтернативы

Если полный рефакторинг слишком рискован:

### Минимальный вариант

1. Добавить CORS middleware в текущий backend
2. Добавить `VITE_API_BASE_URL` в frontend
3. Оставить структуру без изменений

Позволяет деплоить frontend отдельно без разделения репозитория.
Затраты: 2-3 часа.
