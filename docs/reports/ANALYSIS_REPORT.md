# Отчёт по анализу приложения SCORM Test Constructor

> **ARCHIVED.** Снимок состояния приложения на дату ниже. После массового обновления npm-пакетов (2026-05)
> часть зависимостей и архитектурных деталей устарела. Источник истины — текущий код и `package.json`.

**Дата анализа:** 05 января 2026  
**Версия приложения:** 1.0.0  
**Стек:** React + Express + PostgreSQL + Drizzle ORM

---

## Содержание
1. [Использование функций](#1-использование-функций)
2. [Общая работа приложения](#2-общая-работа-приложения)
3. [Найденные проблемы и недостатки](#3-найденные-проблемы-и-недостатки)

---

## 1. Использование функций

### 1.1 Правильно используемые функции

#### Backend (server/)

| Файл | Функция | Статус | Описание |
|------|---------|--------|----------|
| `routes.ts` | `requireAuth` | ✅ Используется | Middleware для проверки авторизации |
| `routes.ts` | `requireAuthor` | ✅ Используется | Middleware для проверки роли автора |
| `routes.ts` | `requireLearner` | ✅ Используется | Middleware для проверки роли ученика |
| `routes.ts` | `rejectBase64MediaUrl` | ✅ Используется | Защита от base64 медиа в URL |
| `routes.ts` | `checkAnswer` | ✅ Используется | Проверка ответов всех типов |
| `storage.ts` | Все методы CRUD | ✅ Используется | Полный набор операций с БД |
| `storage.ts` | `seedDatabase` | ✅ Используется | Инициализация тестовых данных |
| `scorm/index.ts` | `generateScormPackage` | ✅ Используется | Генерация SCORM-пакетов |
| `scorm/builders/*` | Все билдеры | ✅ Используется | Сборка компонентов SCORM |

#### Frontend (client/src/)

| Файл | Функция/Хук | Статус | Описание |
|------|-------------|--------|----------|
| `lib/auth.tsx` | `useAuth` | ✅ Используется | Хук авторизации |
| `lib/auth.tsx` | `AuthProvider` | ✅ Используется | Провайдер контекста авторизации |
| `lib/queryClient.ts` | `apiRequest` | ✅ Используется | Универсальный API-запрос |
| `lib/queryClient.ts` | `getQueryFn` | ✅ Используется | Фабрика query-функций |
| `lib/i18n.ts` | `t` (объект) | ✅ Используется | Локализация |
| `lib/i18n.ts` | `pluralize` | ✅ Используется | Склонение слов |
| `lib/i18n.ts` | `formatPoints` | ✅ Используется | Форматирование баллов |
| `lib/i18n.ts` | `formatQuestions` | ✅ Используется | Форматирование количества вопросов |
| `lib/i18n.ts` | `formatTopics` | ✅ Используется | Форматирование количества тем |
| `hooks/use-toast.ts` | `useToast` | ✅ Используется | Хук уведомлений |
| `hooks/use-mobile.tsx` | `useIsMobile` | ✅ Используется | Определение мобильного устройства |

#### SCORM Template (server/scorm/template/)

| Файл | Функция | Статус | Описание |
|------|---------|--------|----------|
| `adaptive/adaptive.js` | `initAdaptiveTest` | ✅ Используется | Инициализация адаптивного теста |
| `adaptive/adaptive.js` | `getCurrentAdaptiveQuestion` | ✅ Используется | Получение текущего вопроса |
| `adaptive/adaptive.js` | `submitAdaptiveAnswer` | ✅ Используется | Отправка ответа |
| `adaptive/adaptive.js` | `buildAdaptiveResult` | ✅ Используется | Построение результата |
| `render/mainRender.js` | `renderApp` | ✅ Используется | Главный рендер |
| `render/questions/*.js` | Все рендеры вопросов | ✅ Используется | Отображение типов вопросов |
| `dnd/matching.js` | Функции DnD | ✅ Используется | Drag-n-drop для matching |
| `dnd/ranking.js` | Функции DnD | ✅ Используется | Drag-n-drop для ranking |

### 1.2 Неиспользуемые функции

#### Frontend - Неиспользуемые UI компоненты

**19 из 47 UI компонентов НЕ используются в приложении:**

| Компонент | Файл | Рекомендация |
|-----------|------|--------------|
| Accordion | `ui/accordion.tsx` | ❌ Удалить |
| Aspect Ratio | `ui/aspect-ratio.tsx` | ❌ Удалить |
| Breadcrumb | `ui/breadcrumb.tsx` | ❌ Удалить |
| Calendar | `ui/calendar.tsx` | ❌ Удалить |
| Carousel | `ui/carousel.tsx` | ❌ Удалить |
| Chart | `ui/chart.tsx` | ❌ Удалить |
| Command | `ui/command.tsx` | ❌ Удалить |
| Context Menu | `ui/context-menu.tsx` | ❌ Удалить |
| Drawer | `ui/drawer.tsx` | ❌ Удалить |
| Dropdown Menu | `ui/dropdown-menu.tsx` | ❌ Удалить |
| Hover Card | `ui/hover-card.tsx` | ❌ Удалить |
| Input OTP | `ui/input-otp.tsx` | ❌ Удалить |
| Menubar | `ui/menubar.tsx` | ❌ Удалить |
| Navigation Menu | `ui/navigation-menu.tsx` | ❌ Удалить |
| Pagination | `ui/pagination.tsx` | ❌ Удалить |
| Popover | `ui/popover.tsx` | ❌ Удалить |
| Resizable | `ui/resizable.tsx` | ❌ Удалить |
| Table | `ui/table.tsx` | ❌ Удалить |
| Toggle Group | `ui/toggle-group.tsx` | ❌ Удалить |

#### Неиспользуемая функция локализации

```typescript
// client/src/lib/i18n.ts
export function formatAttempts(count: number): string {
  return `${count} ${pluralize(count, "попытка", "попытки", "попыток")}`;
}
```
**Статус:** ⚠️ Объявлена, но не используется в коде

### 1.3 Функции с неправильным использованием

#### 1.3.1 TypeScript ошибки в routes.ts

```typescript
// Строка 33 - Некорректная типизация callback для multer
fileFilter: (_req, file, cb) => {
  cb(ok ? null : new Error("Unsupported media type"), ok);
  // Ошибка: Argument of type 'Error | null' is not assignable to parameter of type 'null'
}
```

**Исправление:**
```typescript
fileFilter: (_req, file, cb) => {
  if (ok) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported media type") as any, false);
  }
}
```

#### 1.3.2 TypeScript ошибки итерации в routes.ts

Множественные ошибки использования `Set` и `Map` итераторов без `downlevelIteration`:

- Строка 2537: `for ... of Set<string>`
- Строка 3117: `for ... of MapIterator`
- Строка 3636: `for ... of MapIterator`
- Строка 3774: `for ... of MapIterator`
- Строка 3930: `for ... of MapIterator`
- Строка 3976: `for ... of MapIterator`
- Строка 4384: `for ... of Set<string>`
- Строка 4799: `for ... of Set<number>`

**Решение:** Добавить в `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2015",
    // или
    "downlevelIteration": true
  }
}
```

#### 1.3.3 Ошибка типизации в analytics.tsx

```typescript
// Строка 236 - 'right' is of type 'unknown'
.map(([left, right]) => `${leftItems[+left]} → ${rightItems[+right as number]}`)
```

**Исправление:**
```typescript
.map(([left, right]: [string, unknown]) => 
  `${leftItems[+left]} → ${rightItems[+(right as string)]}`)
```

#### 1.3.4 Null-safety ошибки в routes.ts

```typescript
// Строка 3711 - Argument of type 'string | null' is not assignable to parameter of type 'string'
// Строка 3925 - testId может быть null
```

---

## 2. Общая работа приложения

### 2.1 Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                         │
├──────────────────┬──────────────────┬──────────────────────────┤
│   Author Panel   │  Learner Panel   │     Shared Components    │
│  - Topics        │  - Test List     │     - Auth Provider      │
│  - Questions     │  - Take Test     │     - Query Client       │
│  - Tests         │  - Results       │     - Theme Provider     │
│  - Analytics     │  - History       │     - UI Components      │
└────────┬─────────┴────────┬─────────┴────────────┬─────────────┘
         │                  │                      │
         └──────────────────┴──────────────────────┘
                            │ REST API
         ┌──────────────────┴──────────────────────┐
         │              BACKEND (Express)           │
         ├──────────────────────────────────────────┤
         │  - Authentication (Session-based)        │
         │  - CRUD Operations                       │
         │  - SCORM Export                          │
         │  - Telemetry Collection                  │
         │  - File Upload (Multer)                  │
         └────────────────────┬─────────────────────┘
                              │
         ┌────────────────────┴─────────────────────┐
         │            DATABASE (PostgreSQL)          │
         │              via Drizzle ORM              │
         └──────────────────────────────────────────┘
```

### 2.2 Основные функциональные модули

#### Модуль авторизации
- ✅ Session-based аутентификация
- ✅ Ролевая модель (author/learner)
- ✅ Защита маршрутов по ролям

#### Модуль управления темами
- ✅ CRUD операций для тем
- ✅ Иерархия папок
- ✅ Рекомендуемые курсы для тем
- ✅ Массовое удаление
- ✅ Дублирование тем с вопросами

#### Модуль управления вопросами
- ✅ 4 типа вопросов (single, multiple, matching, ranking)
- ✅ Медиа-вложения (image, audio, video)
- ✅ Настройка сложности (0-100)
- ✅ Перемешивание ответов
- ✅ Импорт/экспорт Excel
- ✅ Обратная связь (общая и условная)

#### Модуль тестирования
- ✅ Стандартный режим (фиксированный набор вопросов)
- ✅ Адаптивный режим (динамическая сложность)
- ✅ Ограничение времени
- ✅ Ограничение попыток
- ✅ Критерии прохождения (процент/абсолют)
- ✅ Показ правильных ответов

#### Модуль SCORM-экспорта
- ✅ SCORM 2004 совместимость
- ✅ Телеметрия для LMS
- ✅ Встроенные медиа-файлы
- ✅ Адаптивный режим в SCORM
- ✅ PDF-экспорт результатов

#### Модуль аналитики
- ✅ Статистика по тестам
- ✅ Статистика по темам
- ✅ Тренды попыток
- ✅ Комбинированная аналитика (Web + LMS)
- ✅ Детализация попыток

### 2.3 Потоки данных

```
Создание теста:
┌─────────┐    POST /api/tests     ┌──────────┐    INSERT     ┌────────┐
│ Author  │ ──────────────────────►│  Server  │ ─────────────►│   DB   │
│  UI     │                        │ (routes) │               │        │
└─────────┘                        └──────────┘               └────────┘

Прохождение теста:
┌─────────┐  POST /api/attempts    ┌──────────┐   SELECT      ┌────────┐
│ Learner │ ──────────────────────►│  Server  │ ─────────────►│   DB   │
│  UI     │◄─────────────────────  │ (routes) │◄──────────────│        │
└─────────┘    variant + questions └──────────┘   questions   └────────┘

SCORM Export:
┌─────────┐ GET /api/tests/:id/scorm ┌──────────┐  Build ZIP   ┌────────┐
│ Author  │ ─────────────────────────►│  Server  │ ────────────►│ ZIP    │
│  UI     │◄──────────────────────────│  SCORM   │              │ Buffer │
└─────────┘     application/zip       │ Builder  │              └────────┘
                                      └──────────┘
```

---

## 3. Найденные проблемы и недостатки

### 3.1 Критические проблемы

#### 🔴 P1: TypeScript ошибки компиляции

**12 TypeScript ошибок** препятствуют успешной сборке:

1. **multer callback типизация** (routes.ts:33)
2. **Set/Map итерация** (8 мест в routes.ts)
3. **unknown type в analytics.tsx** (строка 236)
4. **null-safety** (2 места в routes.ts)

**Влияние:** Невозможность запуска `npm run check` без ошибок.

#### 🔴 P2: Файл с кириллицей в имени

```
server/scorm/template/app/render/startPage здесь кнопка меняется.js
```

**Проблемы:**
- Может вызывать ошибки на разных ОС и файловых системах
- Затрудняет работу с git
- Является дублем `startPage.js`

**Рекомендация:** Удалить файл.

### 3.2 Серьёзные проблемы

#### 🟠 P3: Пароль базы данных в .env

```
DATABASE_URL=postgresql://postgres:Bhbyf0901@localhost:5432/scorm_db
```

**Риск:** Утечка учётных данных при коммите в репозиторий.

**Рекомендация:** 
- Добавить `.env` в `.gitignore`
- Использовать `.env.example` с плейсхолдерами

#### 🟠 P4: Уязвимости npm пакетов

```
7 vulnerabilities (5 moderate, 2 high)
```

**Рекомендация:** Выполнить `npm audit fix`

#### 🟠 P5: Закомментированный код в server/index.ts

```typescript
// httpServer.listen(
//   {
//     port,
//     host: "0.0.0.0",
//     reusePort: true,
//   },
//   () => {
//     log(`serving on port ${port}`);
//   },
// );
```

**Рекомендация:** Удалить или использовать environment variable для выбора хоста.

#### 🟠 P6: Hardcoded localhost в server

```typescript
httpServer.listen(port, "127.0.0.1", () => {
```

**Проблема:** Невозможность доступа извне контейнера/сервера.

**Рекомендация:** Использовать `process.env.HOST || "0.0.0.0"`

### 3.3 Средние проблемы

#### 🟡 P7: 19 неиспользуемых UI компонентов

Занимают ~150KB в бандле без пользы.

**Рекомендация:** Удалить неиспользуемые компоненты.

#### 🟡 P8: Session store в памяти

```typescript
store: new MemStore({ checkPeriod: 86400000 }),
```

**Проблема:** Потеря сессий при перезапуске сервера.

**Рекомендация для продакшн:** Использовать `connect-pg-simple` (уже в зависимостях).

#### 🟡 P9: Отсутствие rate limiting

API эндпоинты не защищены от DDoS/брутфорса.

**Рекомендация:** Добавить `express-rate-limit`.

#### 🟡 P10: Нет CSRF защиты

Session-based авторизация уязвима к CSRF.

**Рекомендация:** Добавить `csurf` middleware.

### 3.4 Незначительные проблемы

#### ⚪ P11: Дублирование логики проверки ответов

Функция `checkAnswer` существует в:
- `server/routes.ts` (для web)
- `server/scorm/template/app/actions/answers.js` (для SCORM)

**Рекомендация:** Синхронизировать логику или генерировать из единого источника.

#### ⚪ P12: Логирование в продакшн

```typescript
console.log("REQ", req.method, req.originalUrl, ...);
```

**Рекомендация:** Использовать уровни логирования (debug/info/warn/error).

#### ⚪ P13: Magic numbers

```typescript
limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
cookie: { maxAge: 24 * 60 * 60 * 1000 },
```

**Рекомендация:** Вынести в конфигурацию.

---

## Резюме

### Статистика проблем

| Приоритет | Количество | Категория |
|-----------|------------|-----------|
| 🔴 Критические | 2 | Блокеры сборки |
| 🟠 Серьёзные | 4 | Безопасность/Деплой |
| 🟡 Средние | 4 | Оптимизация |
| ⚪ Незначительные | 3 | Code quality |

### Общая оценка

**Качество кода:** 7/10
- ✅ Хорошая архитектура
- ✅ Полная функциональность
- ✅ Типизация TypeScript
- ⚠️ Требуется исправление TS ошибок
- ⚠️ Много неиспользуемого кода

**Готовность к продакшн:** 6/10
- Требуется исправление критических проблем
- Требуется настройка безопасности
- Требуется настройка деплоя

---

*Отчёт подготовлен автоматическим анализом кода*
