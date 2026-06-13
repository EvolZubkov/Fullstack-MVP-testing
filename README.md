# SCORM Test Constructor

Веб-приложение для создания, управления и экспорта интерактивных тестов в формате SCORM 2004 4th Edition.
Поддерживает стандартный и адаптивный режимы тестирования с интеграцией в LMS.

---

## Содержание

- [О проекте](#о-проекте)
- [Возможности](#возможности)
- [Технологический стек](#технологический-стек)
- [Системные требования](#системные-требования)
- [Установка и запуск](#установка-и-запуск)
- [Структура проекта](#структура-проекта)
- [Архитектура](#архитектура)
- [База данных](#база-данных)
- [API Reference](#api-reference)
- [Типы вопросов](#типы-вопросов)
- [SCORM Export](#scorm-export)
- [Руководство пользователя](#руководство-пользователя)
- [Разработка](#разработка)
- [Сборка и деплой](#сборка-и-деплой)
- [Конфигурация](#конфигурация)
- [Решение проблем](#решение-проблем)
- [Лицензия](#лицензия)

---

## О проекте

**SCORM Test Constructor** -- полнофункциональное веб-приложение для создания интерактивных тестов с экспортом
в формат SCORM 2004 4th Edition. Доступ построен на ролевой модели (PRD-13): пользователь держит **набор**
из пяти ролей (superuser, administrator, author, manager, learner), а эффективные права -- объединение по
ролям плюс конфигурационный суперадмин. Условно роли делятся на две стороны:

- **Контентные роли (author / manager / administrator)** -- создают банки вопросов, группируют их по темам,
  конструируют тесты с гибкими правилами прохождения, публикуют их версиями-снапшотами, управляют
  пользователями, группами и доступом, просматривают аналитику. Поверх ролей действуют объектные области:
  владелец и гранты тестов, владелец/видимость и гранты тем.
- **Учащиеся (learner)** -- проходят тесты в стандартном или адаптивном режиме, получают детальные
  результаты с рекомендациями.

---

## Возможности

### Для авторов

#### Управление темами

- Создание и организация тем с иерархией папок
- Владение темами и видимость (`private` / `shared`), гранты доступа `use` / `manage` (PRD-15)
- Богатая обратная связь темы (`feedback_json`): текст, ссылки на курсы, документы, мероприятия
- Дублирование тем вместе со всеми вопросами
- Массовое удаление тем (с защитой от удаления контента, используемого в тестах)

#### Банк вопросов

- 4 типа вопросов: single choice, multiple choice, matching, ranking
- Уровень сложности вопроса (0–100); **оценка (цена ответа) -- свойство теста, а не вопроса** (PRD-15):
  вопрос несёт только контент, баллы и градуировка задаются в редакторе теста (вкладка «Оценка»)
- **Теги (подтемы)** -- метки вопроса для квот выдачи: chip-инпут с автодополнением из тегов банка
- Медиа-вложения (изображения, аудио, видео) с загрузкой до 200 MB
- Перемешивание вариантов ответов (опция)
- Обратная связь: общая или условная (для правильного/неправильного ответа)
- Дублирование и массовое удаление вопросов
- Импорт/экспорт через Excel (книга с листами «Вопросы»/«Оценка»/«Шкалы»/«Показатели»/«Измерения»)

#### Конструктор тестов

- Два режима тестирования:
  - **Стандартный** -- фиксированный набор вопросов из выбранных тем с настраиваемым drawCount
  - **Адаптивный** -- динамическая сложность с уровнями, порогами прохождения и связанными ресурсами
- **Квоты выдачи по тегам** -- на теме опциональная стратифицированная выдача: гарантированное
  покрытие подтем (тегов) -- «ровно N» или «не менее N» вопросов с тегом внутри общей выборки
- **Оценка (PRD-15, вкладка «Оценка»)** -- умолчания цены вопроса на уровне теста и секции, переопределения
  по конкретным вопросам, конструктор градуированного балла (веса опций / ступенчатая таблица «условие → балл»),
  индикатор устаревших переопределений
- **Показатели и шкалы (PRD-2/5)** -- пользовательские итоговые показатели (DSL-формулы `result.*`),
  многомерные шкалы компетенций и матрица вкладов вопросов; передача итогов в LMS без ручной постобработки
- **Контентные страницы (PRD-1)** -- стартовая, промежуточные и итоговые экраны из дизайн-шаблонов
- **Гибкий поток (PRD-4/8)** -- линейный поток, поток по темам или сценарий через страницу-маршрутизатор
- Гибкие правила прохождения (по процентам или абсолютным числам) для каждой темы и теста в целом
- Ограничение по времени и количеству попыток; гейт повторного прохождения / cooldown (PRD-6)
- Показ правильных ответов после прохождения
- **Публикация версиями-снапшотами (PRD-15)** -- опубликованный тест неизменен: попытки доигрываются на своей
  версии, правки банка не влияют на выданные варианты до переопубликации; экстренная переопубликация и
  обнаружение дрейфа контента

#### Управление пользователями и группами

- Создание и управление учётными записями; назначение набора ролей пользователю (мультироль)
- Организация пользователей в группы
- Назначение тестов пользователям и группам (с дедлайном и magic-link доступом без пароля)
- Статусы пользователей: pending, active, inactive
- Принудительная смена пароля при первом входе
- Панель «Общий доступ»: гранты на тесты (`edit` / `assign`) и темы (`use` / `manage`)

#### Аналитика

- Общая статистика по всем тестам
- Детализация по каждому тесту с таблицей попыток
- Статистика по темам, топ проваливаемых тем
- Графики трендов за 30 дней

#### SCORM экспорт

- Генерация пакетов SCORM 2004 4th Edition (ZIP)
- Телеметрия результатов обратно на сервер
- Поддержка медиа-файлов в пакете
- PDF-экспорт результатов внутри SCORM-пакета
- Передача score, completion, success status в LMS
- Детальные interactions по темам

### Для учащихся

#### Прохождение тестов

- Просмотр доступных и назначенных тестов
- Фокусный режим (один вопрос на экране)
- Таймер обратного отсчета
- Прогресс-бар и навигация вперед/назад
- Адаптивное тестирование с динамическим уровнем сложности

#### Результаты

- Визуализация общего результата
- Разбивка по темам с индикаторами "Сдан/Не сдан"
- Рекомендованные курсы для проваленных тем
- Возможность пересдачи (при наличии попыток)
- Просмотр правильных ответов (если разрешено автором)

#### История попыток

- Группировка по тестам
- Отслеживание динамики результатов (дельта между попытками)
- Индикация устаревших версий тестов
- Детальный просмотр каждой попытки

### Безопасность и доступ

- Ролевая модель (PRD-13): 5 ролей, мультироль, объединение прав, конфигурационный суперадмин (`SUPERADMIN_EMAILS`)
- Объектные области доступа: владелец и гранты тестов, владелец/видимость и гранты тем
- Шифрование email-адресов в базе данных (AES)
- Хеширование паролей (bcrypt)
- Сброс пароля через email-токены (HMAC-SHA256)
- Отслеживание согласия GDPR при первом входе
- Маскирование email при отображении

---

## Технологический стек

### Frontend

| Технология | Версия | Назначение |
| --- | --- | --- |
| React | 19.2 | UI-библиотека |
| TypeScript | 6.0 | Типизация |
| Vite | 8.0 | Сборщик и dev-сервер |
| Wouter | 3.10 | Легковесный роутинг |
| TanStack React Query | 5.100 | Управление серверным состоянием |
| React Hook Form | 7.76 | Формы |
| Zod | 4.4 | Валидация |
| shadcn/ui (Radix UI) | -- | Компоненты UI |
| Tailwind CSS | 4.3 | Стилизация (новый движок, `@tailwindcss/postcss`) |
| Lucide React | -- | Иконки |
| html2canvas + jsPDF | 1.4.1 / 2.5.1 | PDF-экспорт в SCORM-runtime; вендорятся в пакет из `assets/vendor/` (devDep-пин, без CDN) |

### Backend

| Технология | Версия | Назначение |
| --- | --- | --- |
| Node.js | 20+ | Runtime |
| Express | 5.2 | Веб-фреймворк |
| TypeScript | 6.0 | Типизация |
| Drizzle ORM | 0.45 | Работа с БД |
| PostgreSQL | 14+ | База данных |
| express-session | 1.19 | Управление сессиями |
| bcryptjs | 3.0 | Хеширование паролей |
| @vvlad1973/crypto | 2.3 | Шифрование email (AES) |
| Nodemailer | 8.0 | Отправка email |
| Multer | 2.1 | Загрузка файлов |
| Archiver | 7.0 | Создание SCORM ZIP-пакетов |
| ExcelJS | 4.4 | Импорт/экспорт Excel |

### Инструменты сборки

| Технология | Назначение |
| ---------- | ---------- |
| tsx | TypeScript executor (dev-сервер) |
| esbuild | Production-сборка бэкенда |
| Drizzle Kit | Управление схемой БД |
| cross-env | Кроссплатформенные переменные окружения |

---

## Системные требования

### Обязательно

- **Node.js** >= 20.0.0 (React 19 + Vite 8 требуют современный Node)
- **npm** >= 10.0.0
- **PostgreSQL** >= 14.0

### Рекомендуется

- **RAM**: минимум 4 GB
- **Место на диске**: минимум 500 MB для зависимостей
- **ОС**: Windows 10+, macOS 10.15+, Linux (Ubuntu 20.04+)

---

## Установка и запуск

### 1. Клонирование и установка зависимостей

```bash
git clone <repository-url>
cd Fullstack-MVP-testing
npm install
```

### 2. Настройка PostgreSQL

**Вариант A: Docker (рекомендуется)**:

```bash
docker run --name scorm-postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=scorm_db \
  -p 5432:5432 \
  -d postgres:15
```

**Вариант B: Локальный PostgreSQL**:

```sql
CREATE DATABASE scorm_db;
```

### 3. Конфигурация окружения

Скопируйте `.env.example` в `.env` и заполните значения:

```bash
cp .env.example .env
```

Минимально необходимые переменные:

```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/scorm_db
```

Полный список переменных описан в разделе [Конфигурация](#конфигурация).

### 4. Инициализация базы данных

```bash
npm run db:push
```

При первом запуске (пустая БД) автоматически создаются демо-пользователи и демо-контент. Вход по email:

- **<admin@test.com>** / admin123 (роль: administrator)
- **<learner@test.com>** / learner123 (роль: learner)

### 5. Запуск

```bash
npm run dev
```

Приложение будет доступно по адресу `http://localhost:5000`.

---

## Структура проекта

```text
test-builder/
|-- client/                          # Frontend (React SPA)
|   |-- src/
|   |   |-- components/              # Общие React-компоненты
|   |   |   |-- ui/                  # shadcn/ui компоненты-обёртки (Radix UI)
|   |   |   |-- questions/           # Компоненты вопросов (media-uploader)
|   |   |   |-- app-sidebar.tsx      # Боковая навигация (DS AppShell + Sidebar)
|   |   |   |-- assign-test-dialog.tsx # Диалог назначения тестов
|   |   |   |-- role-picker.tsx      # Мультироль-редактор (PRD-13)
|   |   |   |-- template-screen.tsx  # React-хост общего рендерера (PRD-12, Shadow DOM)
|   |   |   |-- empty-state.tsx  loading-state.tsx  page-header.tsx
|   |   |   |-- password-input.tsx  theme-provider.tsx  theme-toggle.tsx
|   |   |-- features/                # Фичевые модули
|   |   |   |-- tests/editor/        # Редактор теста (Drawer, секции, мапперы, валидация; PRD-7/15)
|   |   |   |-- topics/              # Drawer темы: «Свойства» + «Доступ» (PRD-15)
|   |   |   |-- templates/           # Админ-реестр шаблонов: список, загрузка, превью (PRD-3)
|   |   |   +-- content-protection/  # UI защиты контента (409 + dry-run, PRD-15)
|   |   |-- hooks/                   # Custom React hooks
|   |   |-- lib/                     # Утилиты и конфигурация
|   |   |   |-- auth.tsx             # Контекст аутентификации
|   |   |   |-- roles.ts            # Клиентская модель ролей/прав (PRD-13)
|   |   |   |-- i18n.ts  queryClient.ts  utils.ts
|   |   |-- pages/                   # Страницы
|   |   |   |-- author/              # Панель контентных ролей
|   |   |   |   |-- topics.tsx  questions.tsx  tests.tsx  tags-input.tsx
|   |   |   |   |-- users.tsx  groups.tsx  templates.tsx  import.tsx  logs.tsx
|   |   |   |   |-- analytics.tsx  test-analytics.tsx  layout.tsx
|   |   |   |-- learner/             # Панель учащегося
|   |   |   |   |-- test-list.tsx  take-test.tsx  template-question-screen.tsx
|   |   |   |   |-- result.tsx  history.tsx  use-section-timer.ts  layout.tsx
|   |   |   |-- login.tsx  first-login.tsx  forgot-password.tsx  reset-password.tsx
|   |   |   |-- no-access.tsx  not-found.tsx
|   |   |-- styles/                  # tb-components.css, tb-tests-list.css, vendor/
|   |   |-- App.tsx  main.tsx  index.css
|   +-- index.html
|
|-- server/                          # Backend (Express)
|   |-- routes/                      # Модульные роутеры по доменам (монтируются в routes.ts)
|   |   |-- index.ts                # routerConfig: список path -> router
|   |   |-- auth.ts  users.ts  groups.ts  topics.ts  questions.ts  tests.ts
|   |   |-- attempts.ts  assignments.ts  folders.ts  test-folders.ts  access.ts
|   |   |-- content-pages.ts  result-variables.ts  scales.ts
|   |   |-- templates.ts  admin-templates.ts (PRD-3)  workbook.ts  tests-workbook.ts (PRD-14)
|   |   |-- analytics/  scorm-telemetry.ts  logs.ts
|   |-- services/                    # Доменные сервисы (вне route-хендлеров)
|   |   |-- result-compute.ts  result-context.ts  scoring-config.ts  effective-scoring.ts
|   |   |-- retake-gate.ts (PRD-6)  template-render.ts  flow-policy-validator.ts
|   |   |-- variant-binding.ts  test-settings.ts  content-pages-lifecycle.ts
|   |   |-- access.ts  test-access.ts  topic-access.ts (PRD-13/15)
|   |   |-- content-guard.ts  draw-feasibility.ts  test-snapshot.ts (PRD-15)
|   |   |-- workbook-import.ts  questions-import.ts  questions-export.ts (PRD-14)
|   |-- scorm/                       # SCORM 2004 генератор
|   |   |-- builders/                # Сборщики пакета (manifest, metadata, test-json,
|   |   |                            #   media-assets, shared-runtime — esbuild-бандл @shared)
|   |   |-- assets/                  # Runtime-файлы SCORM
|   |   |-- template/app/            # JS-логика пакета (adaptive, dnd, render, timer, telemetry)
|   |   |-- templates/<id>/          # Дизайн-шаблоны: layouts + styles + manifest (PRD-7/12)
|   |   |-- index.ts                # generateScormPackage
|   |   +-- zip.ts                  # ZIP-упаковка
|   |-- middleware/                  # auth.ts, test-scope.ts, upload.ts (Multer)
|   |-- utils/                       # crypto.ts (email AES), excel.ts, mask-email.ts
|   |-- config.ts                    # Конфигурация (в т.ч. SUPERADMIN_EMAILS)
|   |-- db.ts                        # Подключение к БД (Drizzle)
|   |-- email.ts                     # Отправка email (сброс пароля)
|   |-- logger.ts                    # Логирование
|   |-- index.ts                     # Entry point сервера
|   |-- routes.ts                    # registerRoutes — тонкий оркестратор (~100 строк)
|   |-- scorm-exporter.ts            # Точка входа SCORM-экспорта
|   |-- template-registry.ts         # Реестр дизайн-шаблонов
|   |-- static.ts                    # Раздача статики (production)
|   +-- storage.ts                   # Data Access Layer (Repository pattern)
|
|-- shared/                          # Общий код (client + server + SCORM-пакет)
|   |-- schema.ts                   # Drizzle-схема БД + Zod-типы
|   |-- scoring/ scales/ formula/   # Чистые доменные движки (PRD-2/5/10/15)
|   |-- eligibility/ draw/ tags.ts  # Retake-eligibility (PRD-6), квоты выдачи (PRD-11)
|   |-- access/                     # Модель ролей/прав (PRD-13)
|   +-- template/                   # Единый рендерер (PRD-12): dsl, render-screen,
|                                    #   renderers, context, *-context builders, dnd/
|
|-- script/                          # Build + админ-утилиты (build.ts, create-admin.ts,
|                                    #   migrate-emails.ts, reencrypt-emails.ts, test-crypto.ts)
|-- scripts/                         # SCORM-тулинг + dev (scorm-player.mjs,
|                                    #   generate-sample/template-scorm.ts, превью, check-wireframes-ds)
|
|-- docs/                            # Документация
|   |-- specs/                       # BRD + PRD-1..15 + scoring-model + спецификации
|   |-- architecture/                # service-architecture, test-editor-contracts, ...
|   |-- guides/                      # design_guidelines, import-template-guide, template-development
|   |-- wireframes/                  # HTML-эскизы
|   |-- ROADMAP.md  RUNBOOK_*.md  AUDIT_*.md  PLAN_*.md
|
|-- migrations/                      # Нумерованные SQL-миграции БД (001..028)
|-- uploads/                         # Загруженные файлы
|   |-- media/                      # Медиа-файлы вопросов
|   |-- scorm/                      # Сгенерированные SCORM-пакеты
|   +-- templates/                  # Распакованные загруженные шаблоны (PRD-3)
|
|-- .env.example                     # Шаблон переменных окружения
|-- drizzle.config.ts               # Конфиг Drizzle Kit
|-- package.json  tsconfig.json  vite.config.ts  tailwind.config.ts  postcss.config.js
+-- components.json                  # Конфиг shadcn/ui
```

---

## Архитектура

### Общая схема

```text
+----------------------------------------------------------+
|                     Browser (React SPA)                    |
|   Wouter routing, TanStack Query, shadcn/ui, Tailwind     |
+----------------------------+-----------------------------+
                             |  HTTP/REST API
                             |  /api/*
+----------------------------v-----------------------------+
|                     Express Server                        |
|  +-------------+  +-------------+  +------------------+  |
|  |   Routes    |  |   Storage   |  |  SCORM Builder   |  |
|  |  (REST API) |  |    (DAL)    |  | (ZIP Generator)  |  |
|  +------+------+  +------+------+  +--------+---------+  |
|         |                |                   |            |
|  +------+------+  +------+------+            |            |
|  |   Session   |  |   Email     |            |            |
|  | (express-   |  | (Nodemailer)|            |            |
|  |  session)   |  |             |            |            |
|  +-------------+  +-------------+            |            |
+---------+----------------+-------------------+-----------+
          |                |                   |
          v                v                   v
   +------------+   +------------+      +-------------+
   |  Sessions  |   | PostgreSQL |      | ZIP / Files |
   | (Memory)   |   | (Drizzle)  |      | (uploads/)  |
   +------------+   +------------+      +-------------+
```

### Модульность и общий код

- **Роутеры**: API разнесён по доменным модулям в `server/routes/` (auth, users, topics,
  questions, tests, attempts, scales, result-variables, content-pages и др.) и монтируется
  тонким `server/routes.ts` (`registerRoutes`). Это не монолит.
- **Слой сервисов** (`server/services/`): расчёт результата, контекст итогов, retake-гейт,
  рендер-пейлоад и валидаторы вынесены из route-хендлеров.
- **Доменные движки** (`shared/`): scoring/scales/formula/eligibility/draw/tags — чистые
  модули, общие для клиента, сервера и SCORM-пакета (единый источник логики, без копий).

### Единый рендерер ученических экранов (PRD-12)

Экраны прохождения (старт, контент, вопрос, итоги, transition, блок) рендерятся из ОДНИХ
дизайн-шаблонов на ОБОИХ хостах. `shared/template/` содержит framework-free рендерер
(`dsl.ts` -- mustache-субсет, `renderScreenInto`, публичный контекст и сборщики, `dnd/`).
Веб импортирует его напрямую (Vite); SCORM-пакет получает через esbuild-бандл (глобал
`TBTemplate`). CSS тоже единый: компонентный источник `server/scorm/templates/<id>/styles/`
(`theme.css` + `base.css`), из которого на сборке генерируется `styles.css` пакета.

### Ролевая модель (PRD-13)

Пользователь держит **набор** ролей (`user_roles`); эффективные права -- объединение по ролям плюс
конфигурационный суперадмин (`SUPERADMIN_EMAILS`). Поверх ролей действуют объектные области доступа.

```text
                          +------------+
                          |    User    |  держит набор ролей (union прав)
                          +-----+------+
                                |
   +-------------+--------------+--------------+--------------+-------------+
   |             |              |              |              |             |
+--v------+ +----v-------+ +----v-----+ +------v-----+ +------v----+        |
|superuser| |administrator| |  author  | |  manager   | |  learner  |        |
| (всё)   | | (упр-е      | | (контент:| | (назначение| | (прохожд- |        |
|         | |  польз./    | |  темы,   | |  тестов)   | |  ение,    |        |
|         | |  доступ)    | |  вопросы,| |            | |  результ.,|        |
|         | |             | |  тесты)  | |            | |  история) |        |
+---------+ +------------+ +----------+ +------------+ +-----------+        |
                                                                            |
   Объектные области доступа поверх ролей: -----------------------------+---+
   - тест: владелец (owner_id) + гранты test_access_grants (edit / assign)
   - тема: владелец + видимость (private/shared) + гранты topic_access_grants (use / manage)
```

`superadmin` нигде не хранится -- вычисляется в рантайме из `SUPERADMIN_EMAILS`.

### Режимы тестирования

**Стандартный режим:**

```text
Test
+-- title, description, mode: "standard"
+-- overallPassRule (percent | absolute)
+-- settings (timeLimit, maxAttempts, showAnswers)
+-- TestSections[]
    +-- Topic
    |   +-- Questions[]
    +-- drawCount (количество случайных вопросов)
    +-- topicPassRule (опционально)
```

**Адаптивный режим:**

```text
Test
+-- title, description, mode: "adaptive"
+-- AdaptiveTopicSettings[]
    +-- Topic
    +-- failureFeedback
    +-- AdaptiveLevels[]
        +-- levelName, levelIndex
        +-- minDifficulty, maxDifficulty
        +-- questionsCount, passThreshold
        +-- AdaptiveLevelLinks[] (ресурсы для обучения)
```

### Процесс прохождения теста

1. Учащийся выбирает тест
2. Опубликованный тест доставляется из неизменного снапшота (`attempts.snapshot_id`); попытка
   пинуется к своей версии и доигрывается на ней даже после правок банка (PRD-15)
3. Генерируется вариант теста (variantJson) -- выборка вопросов по drawCount / квотам по тегам /
   адаптивным уровням
4. Учащийся отвечает на вопросы (ответы сохраняются в answersJson)
5. Отправка теста -- серверный расчёт результата (баллы, шкалы `scale.*`, показатели `result.*`,
   правила прохождения)
6. Результаты -- общий балл, разбивка по темам, показатели и рекомендации

---

## База данных

PostgreSQL + Drizzle ORM, **29 таблиц**. Схема и Zod-типы -- в [shared/schema.ts](shared/schema.ts).
Изменения схемы применяются через `npm run db:push` (Drizzle Kit); история структурных изменений -- в
нумерованных SQL-миграциях `migrations/` (001..028).

### Таблицы (Drizzle ORM, PostgreSQL)

#### users

| Поле | Тип | Описание |
| ---- | --- | -------- |
| id | varchar(36) PK | UUID |
| email | text | Зашифрованный email (AES) |
| emailHash | varchar(64) | SHA-256 хеш для поиска |
| passwordHash | text | bcrypt хеш пароля |
| name | text | Отображаемое имя |
| status | enum | pending, active, inactive |
| mustChangePassword | boolean | Принудительная смена пароля |
| gdprConsent | boolean | Согласие GDPR |
| gdprConsentAt | timestamp | Дата согласия |
| lastLoginAt | timestamp | Последний вход |
| expiresAt | timestamp | Срок действия аккаунта |
| createdAt | timestamp | Дата создания |
| createdBy | varchar | Создатель |

Столбец `role` удалён (миграция 017): роли живут в `user_roles` (см. ниже) + конфиг-суперадмин.

#### userRoles

Роли пользователя (многие-ко-многим, PRD-13): `userId`, `role` (superuser/administrator/author/manager/learner),
`grantedBy`. Единственный источник хранимых ролей.

#### groups

| Поле | Тип | Описание |
| ---- | --- | -------- |
| id | varchar(36) PK | UUID |
| name | text | Название группы |
| description | text | Описание |
| createdBy | varchar FK | Создатель |

#### userGroups

Связь many-to-many между users и groups.

#### testAssignments

Назначение тестов пользователям или группам (с дедлайном).

#### passwordResetTokens

Токены сброса пароля (HMAC-SHA256, с TTL).

#### folders

Иерархическая структура папок для тем (parentId -> folders.id, createdBy).

#### topics

| Поле | Тип | Описание |
| --- | --- | --- |
| id | varchar(36) PK | UUID |
| name | text | Название темы |
| description | text | Описание |
| feedback | text | Обратная связь (legacy text) |
| feedbackJson | jsonb | Богатая обратная связь: текст, ссылки/курсы, документы, мероприятия (TD-02) |
| folderId | varchar | Папка |
| createdBy | varchar | Создатель (аудит, PRD-15) |
| ownerId | varchar | Владелец темы (NULL = legacy common pool) |
| visibility | enum | private / shared (PRD-15) |
| nameNormalized | text | Нормализованное имя для одноимённости в рамках владельца |

Таблицы `topic_courses` / `topic_events` удалены (миграция 024): рекомендации живут в `topics.feedback_json`.

#### topicAccessGrants

Гранты доступа к теме для пользователя (PRD-15): `granteeId`, `accessLevel` (use / manage),
`state` (active / revoked_in_use). Гранты адресуют только пользователей (TD-01).

#### questions

| Поле | Тип | Описание |
| --- | --- | --- |
| id | varchar(36) PK | UUID |
| topicId | varchar | Тема |
| type | enum | single, multiple, matching, ranking |
| prompt | text | Текст вопроса |
| dataJson | jsonb | Варианты ответов |
| correctJson | jsonb | Правильные ответы |
| difficulty | integer | Уровень сложности (0–100, по умолчанию 50) |
| tags | jsonb | Теги-подтемы (PRD-11/2) |
| contentHash | text | Хеш контента (пин переопределений оценки, дрейф) |
| mediaUrl | text | URL медиа-файла |
| mediaType | enum | image, audio, video |
| shuffleAnswers | boolean | Перемешивание ответов |
| feedback | text | Обратная связь (общая) |
| feedbackMode | enum | general, conditional |
| feedbackCorrect / feedbackIncorrect | text | Условная обратная связь |
| createdBy | varchar | Создатель (аудит, PRD-15) |

Столбцы `points` / `scoring_json` удалены (миграция 028, T-40): **оценка -- свойство теста**, не вопроса.
Вопрос несёт только контент; цена и градуировка резолвятся через `test_question_scoring` -> умолчания
секции/теста -> системное (1 балл, точное совпадение) в [shared/scoring/effective-scoring](shared/scoring/).

#### tests

| Поле | Тип | Описание |
| --- | --- | --- |
| id | varchar(36) PK | UUID |
| ownerId | varchar | Владелец теста (PRD-13; NULL = legacy) |
| title / description | text | Название / описание |
| mode | enum | standard, adaptive |
| showDifficultyLevel | boolean | Показывать сложность |
| overallPassRuleJson | jsonb | Общее правило прохождения |
| status | enum | draft / published / archived (`published` boolean — deprecated) |
| version | integer | Версия теста |
| flowPolicyJson | jsonb | Политика потока (PRD-4/8) |
| feedbackJson | jsonb | Обратная связь теста |
| designSettingsJson | jsonb | Параметры дизайн-шаблона (PRD-7) |
| retakePolicyJson | jsonb | Гейт повторного прохождения / cooldown (PRD-6) |
| defaultQuestionPoints | integer | Умолчание цены вопроса для теста (PRD-15) |
| telemetryEnabled | boolean | Телеметрия SCORM |
| timeLimitMinutes / maxAttempts | integer | Лимит времени / попыток |
| showCorrectAnswers | boolean | Показывать ответы |

#### testAccessGrants

Гранты доступа к тесту для не-владельца (PRD-13): `userId`, `accessLevel` (edit / assign), `grantedBy`.

#### testSections

Секции теста (topicId, drawCount, drawAll, topicPassRuleJson, required, sortOrder, timeLimitMinutes).
`drawBlueprintJson` -- квоты выдачи по тегам (PRD-11); `defaultPoints` -- умолчание цены вопроса для секции (PRD-15).

#### adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks

Настройки адаптивного тестирования: темы, уровни сложности, пороги прохождения, ссылки на ресурсы.

#### attempts

| Поле | Тип | Описание |
| --- | --- | --- |
| id | varchar(36) PK | UUID |
| userId | varchar | Учащийся |
| testId | varchar | Тест |
| testVersion | integer | Версия теста |
| snapshotId | varchar | Снапшот доставки (PRD-15; NULL = live/legacy) |
| variantJson | jsonb | Сгенерированный вариант |
| answersJson | jsonb | Ответы учащегося |
| resultJson | jsonb | Результаты проверки |
| startedAt / finishedAt | timestamp | Начало / завершение |

#### testSnapshots

Неизменный снапшот теста на момент публикации (PRD-15): `version`, `contentJson` (полный
доставляемый контент), `publishedAt`, `publishedBy`. Доставка опубликованного теста читает только снапшот.

#### testQuestionScoring

Переопределение оценки по паре (тест, вопрос) (PRD-15, блок D): `points`, `scoringJson` (градуированный балл),
`difficulty`, `pinnedContentHash` (пин для индикатора устаревания). Оценка -- свойство теста.

#### scormPackages

Экспортированные SCORM-пакеты (testId, secretKey, apiBaseUrl, testMode).

#### scormAttempts

Попытки прохождения через LMS (packageId, sessionId, lmsUserId, lmsUserName).

#### scormAnswers

Индивидуальные ответы в SCORM-попытках (questionId, userAnswer, isCorrect, earnedPoints).

#### Таблицы и колонки PRD-расширений

| Таблица / колонка | PRD | Назначение |
| ----------------- | --- | ---------- |
| `templates` | PRD-7/3 | Дизайн-шаблоны (layouts, стили, manifest) + админ-реестр внешних ZIP |
| `content_pages` | PRD-1 | Контентные страницы (intro/между темами/после итогов) |
| `result_variables` | PRD-2 | Показатели результата (DSL-формулы `result.*`) |
| `scales` + `question_measurements` | PRD-5 | Шкалы и вклады вопросов в шкалы (многомерные измерения) |
| `user_roles` | PRD-13 | Роли пользователя (мультироль; единственный источник хранимых ролей) |
| `test_access_grants` | PRD-13 | Гранты доступа к тесту (edit / assign) |
| `topic_access_grants` | PRD-15 | Гранты доступа к теме (use / manage) |
| `test_snapshots` + `attempts.snapshot_id` | PRD-15 | Неизменные опубликованные версии + пин доставки попытки |
| `test_question_scoring` | PRD-15 | Переопределение оценки по (тест, вопрос); оценка -- свойство теста |
| `tests.default_question_points`, `test_sections.default_points` | PRD-15 | Умолчания цены вопроса (тест/секция) |
| `topics.owner_id` / `visibility` / `feedback_json` / `name_normalized` | PRD-15 | Владение/видимость темы, богатая ОС, одноимённость |
| `created_by` (folders/topics/questions/test_folders) | PRD-15 | Аудит авторства (NULL = legacy) |
| `test_folders`, `assignment_access_tokens` | -- | Папки тестов, magic-link токены доступа |
| `questions.tags` | PRD-11/2 | Теги-подтемы (квоты выдачи + источники формул показателей) |
| `test_sections.draw_blueprint_json` | PRD-11 | Квоты выдачи по тегам (иначе равномерная выборка) |
| `tests.retake_policy_json` | PRD-6 | Гейт повторного прохождения / cooldown (иначе только `maxAttempts`) |

Все опциональные колонки nullable/с дефолтом: их отсутствие сохраняет легаси-поведение.

### Диаграмма связей

```text
users
  +--- userRoles (1:N)            # роли (мультироль, PRD-13)
  +--- attempts (1:N) --- testSnapshots (доставка из снапшота)
  +--- userGroups (N:M) --- groups
  +--- testAssignments (1:N) --- assignmentAccessTokens (magic link)
  +--- passwordResetTokens (1:N)

folders (self-referencing)
  +--- topics (1:N)               # owner_id + visibility + feedback_json
         +--- questions (1:N)     # контент; оценка — в тесте
         +--- topicAccessGrants (1:N, use/manage)

tests                              # owner_id + status + snapshots
  +--- testSections (1:N, standard) --- topics
  +--- adaptiveTopicSettings (1:N, adaptive) --- topics
  |      +--- adaptiveLevels (1:N)
  |             +--- adaptiveLevelLinks (1:N)
  +--- testQuestionScoring (1:N) --- questions    # переопределение оценки (PRD-15)
  +--- testSnapshots (1:N)        # неизменные версии
  +--- testAccessGrants (1:N, edit/assign)
  +--- scales (1:N) + resultVariables (1:N) + contentPages (1:N)
  +--- attempts (1:N)
  +--- testAssignments (1:N)
  +--- scormPackages (1:N)
         +--- scormAttempts (1:N)
                +--- scormAnswers (1:N)
```

---

## API Reference

### Аутентификация (`/api/auth`)

| Метод | Endpoint | Описание |
| --- | --- | --- |
| POST | `/api/auth/login` | Вход в систему |
| POST | `/api/auth/logout` | Выход |
| GET | `/api/auth/me` | Текущий пользователь |
| POST | `/api/auth/change-password` | Смена пароля |
| POST | `/api/auth/forgot-password` | Запрос сброса пароля |
| GET | `/api/auth/verify-reset-token` | Проверка токена сброса |
| POST | `/api/auth/reset-password` | Сброс пароля по токену |
| POST | `/api/auth/complete-first-login` | Первый вход (GDPR + смена пароля) |

### Пользователи

| Метод | Endpoint | Описание |
| --- | --- | --- |
| GET | `/api/users` | Список пользователей |
| POST | `/api/users` | Создать пользователя (с набором ролей) |
| PUT | `/api/users/:id` | Обновить пользователя / роли |

### Группы (Author)

| Метод | Endpoint | Описание |
| --- | --- | --- |
| GET | `/api/groups` | Список групп |
| POST | `/api/groups` | Создать группу |
| PUT | `/api/groups/:id` | Обновить группу |
| DELETE | `/api/groups/:id` | Удалить группу |
| GET | `/api/users/:id/groups` | Группы пользователя |

### Темы (Author)

| Метод | Endpoint | Описание |
| --- | --- | --- |
| GET | `/api/topics` | Список тем |
| POST | `/api/topics` | Создать тему |
| PUT | `/api/topics/:id` | Обновить тему |
| DELETE | `/api/topics/:id` | Удалить тему |
| POST | `/api/topics/:id/duplicate` | Дублировать тему |
| POST | `/api/topics/bulk-delete` | Массовое удаление |

### Вопросы

| Метод | Endpoint | Описание |
| --- | --- | --- |
| GET | `/api/questions` | Список вопросов |
| POST | `/api/questions` | Создать вопрос (только контент, без оценки) |
| PUT | `/api/questions/:id` | Обновить вопрос |
| DELETE | `/api/questions/:id` | Удалить вопрос |
| POST | `/api/questions/:id/duplicate` | Дублировать вопрос |
| POST | `/api/questions/bulk-delete` | Массовое удаление |
| GET | `/api/questions/export` | Экспорт в Excel (без оценки, T-40) |
| GET | `/api/questions/template` | Шаблон Excel-импорта |
| POST | `/api/questions/import` | Импорт из Excel |

### Тесты

| Метод | Endpoint | Описание |
| --- | --- | --- |
| GET | `/api/tests` | Список тестов |
| POST | `/api/tests` | Создать тест |
| PUT | `/api/tests/:id` | Обновить тест |
| DELETE | `/api/tests/:id` | Удалить тест |
| PATCH | `/api/tests/:id/status` | Сменить статус (опубликовать / в архив) |
| POST | `/api/tests/:id/republish-force` | Экстренная переопубликация (PRD-15) |
| POST | `/api/tests/:id/restore` | Восстановить из архива |
| PUT | `/api/tests/:id/design` | Параметры дизайн-шаблона |
| GET | `/api/tests/:id/export/scorm` | Экспорт SCORM |
| GET/POST/DELETE | `/api/tests/:id/access` | Гранты доступа к тесту (PRD-13) |
| PATCH | `/api/tests/:id/owner` | Сменить владельца теста |

### Назначения и попытки (Learner)

| Метод | Endpoint | Описание |
| --- | --- | --- |
| GET | `/api/learner/tests` | Доступные тесты |
| GET | `/api/learner/assigned-tests` | Назначенные тесты |
| POST | `/api/tests/:testId/attempts/start` | Начать тест |
| POST | `/api/tests/:testId/attempts/start-adaptive` | Начать адаптивный тест |
| POST | `/api/attempts/:attemptId/save-progress` | Сохранить прогресс |
| GET | `/api/tests/:testId/resume` | Возобновить попытку |
| POST | `/api/attempts/:attemptId/finish` | Завершить тест |
| GET | `/api/attempts/:attemptId/result` | Результат попытки |
| GET | `/api/learner/attempts` | История попыток |
| GET/POST | `/api/tests/:id/assignments` | Назначения теста |

### Аналитика

| Метод | Endpoint | Описание |
| --- | --- | --- |
| GET | `/api/analytics` | Общая аналитика |
| GET | `/api/analytics/combined` | Сводная аналитика |
| GET | `/api/analytics/tests/:testId/attempts` | Попытки по тесту |
| GET | `/api/analytics/tests/:testId/export/excel` | Экспорт аналитики теста в Excel |

### Медиа

| Метод | Endpoint | Описание |
| --- | --- | --- |
| POST | `/api/media/upload` | Загрузка медиа-файла |

### Прочие группы эндпоинтов

API разнесён по модульным роутерам (`server/routes/`). Помимо перечисленного выше, есть
группы: `/api/folders` и `/api/test-folders` (иерархия), `/api/tests/:id/content-pages`
(PRD-1), `/api/tests/:id/result-variables` (PRD-2), `/api/tests/:id/scales` (PRD-5),
`/api/tests/:id/workbook/import|export` + `/api/workbook/*` (PRD-14 Excel), `/api/templates`
(PRD-7) и `/api/admin/templates` (PRD-3 админ-реестр), `/api/groups`, `/api/analytics`,
`/access/*` (magic-link, до session guard), телеметрия SCORM и `/api/logs`. Полный список
маршрутов -- `routerConfig` в [server/routes/index.ts](server/routes/index.ts).

---

## Типы вопросов

### Single Choice (один правильный ответ)

```typescript
dataJson: { options: ["Вариант A", "Вариант B", "Вариант C"] }
correctJson: { correctIndex: 0 }
```

UI: radio buttons.

### Multiple Choice (несколько правильных ответов)

```typescript
dataJson: { options: ["Вариант A", "Вариант B", "Вариант C"] }
correctJson: { correctIndices: [0, 2] }
```

UI: checkboxes. Проверка: точное совпадение выбранных вариантов.

### Matching (сопоставление)

```typescript
dataJson: { left: ["Термин 1", "Термин 2"], right: ["Определение A", "Определение B"] }
correctJson: { pairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }] }
```

UI: drag-and-drop или dropdown.

### Ranking (ранжирование)

```typescript
dataJson: { items: ["Элемент A", "Элемент B", "Элемент C"] }
correctJson: { correctOrder: [2, 0, 1] }
```

UI: drag-and-drop список.

---

## SCORM Export

### Структура SCORM-пакета

```text
test_<id>_<timestamp>.zip
+-- imsmanifest.xml            # Манифест SCORM 2004
+-- content/
    +-- index.html             # Главная страница теста
    +-- styles.css             # Стили
    +-- app.js                 # Приложение (рендеринг, навигация, адаптив)
    +-- runtime.js             # SCORM API обертка
    +-- test_data.js           # Данные теста (вопросы, настройки)
    +-- media/                 # Медиа-файлы (логотипы, вложения)
```

### Телеметрия SCORM

SCORM-пакет отправляет результаты обратно на сервер (если настроен `API_BASE_URL`):

- Создание попытки (scormAttempts)
- Сохранение ответов (scormAnswers)
- Передача итогового результата

### SCORM API (взаимодействие с LMS)

```javascript
// Инициализация
scormAPI.initialize();

// Установка результатов
scormAPI.setValue('cmi.score.raw', score);
scormAPI.setValue('cmi.score.scaled', scaledScore);
scormAPI.setValue('cmi.success_status', 'passed' | 'failed');
scormAPI.setValue('cmi.completion_status', 'completed');

// Interactions по темам
scormAPI.setValue('cmi.interactions.n.id', topicId);
scormAPI.setValue('cmi.interactions.n.result', 'correct' | 'incorrect');

// Завершение
scormAPI.commit();
scormAPI.terminate();
```

---

## Руководство пользователя

### Для авторов

#### Шаг 1: Создание тем

1. Перейдите в раздел **"Темы"**
2. Нажмите **"Создать тему"**
3. Заполните название, описание, обратную связь
4. Добавьте рекомендованные курсы (опционально)

#### Шаг 2: Добавление вопросов

1. Перейдите в **"Банк вопросов"**
2. Нажмите **"Добавить вопрос"**
3. Выберите тему и тип вопроса
4. Заполните текст, варианты ответов, правильные ответы
5. Настройте баллы, сложность, перемешивание, обратную связь
6. При необходимости прикрепите медиа-файл

#### Шаг 3: Массовый импорт через Excel

1. Скачайте шаблон книги: **"Шаблон"** (лист-справка с форматом колонок)
2. Заполните лист **«Вопросы»**: тема, тип, текст, варианты, правильные ответы, теги, условная обратная связь,
   перемешивание. **Оценка (цена ответа) в листе «Вопросы» НЕ задаётся** (T-40) -- она живёт в test-scoped
   листе **«Оценка»** книги конкретного теста (PRD-14/15)
3. Проверьте импорт без записи: **предпросмотр (dry-run)** показывает изменения и построчные ошибки
4. Импортируйте: **"Импорт из Excel"**

Книга одного теста поддерживает листы `Вопросы` / `Оценка` / `Шкалы` / `Показатели` / `Измерения`
с round-trip экспортом/импортом. Подробнее -- [docs/guides/import-template-guide.md](docs/guides/import-template-guide.md).

#### Шаг 4: Создание теста

1. Перейдите в **"Тесты"** и нажмите **"Создать тест"**
2. Заполните название и описание
3. Выберите режим: стандартный или адаптивный
4. Для стандартного: выберите темы, укажите drawCount (или квоты по тегам) и правила прохождения
5. Для адаптивного: настройте уровни сложности и пороги
6. На вкладке **«Оценка»** задайте умолчания цены вопроса и при необходимости переопределения по вопросам
7. Настройте лимит времени, количество попыток, показ ответов, гейт повторного прохождения
8. Опубликуйте тест -- создаётся неизменный снапшот версии; правки банка не затронут выданные попытки

#### Шаг 5: Управление пользователями

1. Перейдите в **"Пользователи"**
2. Создавайте аккаунты учащихся
3. Организуйте пользователей в группы
4. Назначайте тесты пользователям или группам

#### Шаг 6: Экспорт SCORM

1. Откройте тест и нажмите **"Экспорт SCORM"**
2. Скачайте ZIP-файл
3. Загрузите в LMS (Moodle, Canvas и др.)

### Для учащихся

#### Прохождение теста

1. Войдите в систему (при первом входе -- примите GDPR и смените пароль)
2. На главной странице выберите тест
3. Нажмите **"Начать тест"**
4. Отвечайте на вопросы, используя навигацию вперед/назад
5. После последнего вопроса нажмите **"Завершить"**

#### Просмотр результатов

- Общий балл и статус "Сдан/Не сдан"
- Детализация по темам
- Рекомендованные курсы для проваленных тем
- Возможность пересдачи (если есть попытки)

#### История

- Все попытки сгруппированы по тестам
- Дельта результатов между попытками
- Индикация устаревших версий тестов

---

## Разработка

### Команды

```bash
npm run dev          # Development-сервер (tsx + Vite HMR; tsx запускается БЕЗ --watch)
npm run build        # Production-сборка (esbuild + Vite)
npm start            # Запуск production-версии
npm run check        # Проверка типов TypeScript (tsc)
npm test             # Запуск тестов (vitest)
npm run db:push      # Применить изменения схемы к БД (Drizzle Kit)
npm run create-admin # Создать администратора
npm run lint:md      # Линт markdown-документации (markdownlint-cli2)

# SCORM-инструменты (локальная приёмка):
npm run scorm:sample    # Собрать демонстрационный SCORM-пакет в out/
npm run scorm:template  # Собрать пакет дизайн-шаблона в out/
npm run scorm:player    # Локальный SCORM-плеер на :5050 (грузит out/*.zip)
```

### Hot Reload

- **Frontend** -- работает Vite HMR.
- **Backend** -- авто-перезапуск ОТСУТСТВУЕТ: dev-скрипт намеренно использует `tsx` без
  `--watch` (под `tsx watch` зависает `createServer` Vite 8). После правок на сервере
  перезапустите `npm run dev` вручную.

### Алиасы путей

| Алиас | Путь |
| --- | --- |
| `@/*` | `client/src/*` |
| `@shared/*` | `shared/*` |
| `@assets/*` | `attached_assets/*` |

### Изменение схемы БД

1. Отредактируйте `shared/schema.ts`
2. Примените изменения:

```bash
npm run db:push
```

### Добавление новых страниц

1. Создайте файл в `client/src/pages/`
2. Добавьте route в `client/src/App.tsx`

---

## Сборка и деплой

### Production-сборка

```bash
npm run build
```

Результат:

- `dist/public/` -- статические файлы фронтенда
- `dist/index.cjs` -- собранный бэкенд (CommonJS)

```bash
npm start
```

### Деплой на VPS

```bash
# 1. Установите Node.js 18+ и PostgreSQL на сервере
# 2. Клонируйте проект
git clone <repository-url>
cd Fullstack-MVP-testing

# 3. Установите зависимости
npm ci --production

# 4. Создайте .env (см. раздел Конфигурация)
# 5. Инициализируйте БД
npm run db:push

# 6. Соберите проект
npm run build

# 7. Запустите через PM2
npm install -g pm2
pm2 start dist/index.cjs --name scorm-app
pm2 save
pm2 startup
```

### Настройка Nginx (reverse proxy)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /uploads {
        alias /var/www/scorm-app/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### Деплой на облачные платформы

**Railway:**

```bash
npm install -g @railway/cli
railway login
railway init
railway add postgresql
railway up
```

**Render:**

1. Создайте Web Service из репозитория
2. Build Command: `npm install && npm run build`
3. Start Command: `npm start`
4. Добавьте PostgreSQL addon
5. Настройте Environment Variables

---

## Конфигурация

### Переменные окружения

| Переменная | Обязательна | По умолчанию | Описание |
| --- | --- | --- | --- |
| `DATABASE_URL` | Да | -- | PostgreSQL connection string |
| `PORT` | Нет | 5000 | Порт сервера |
| `NODE_ENV` | Нет | development | Режим: development / production |
| `SESSION_SECRET` | Нет | auto | Секрет для сессий |
| `API_BASE_URL` | Нет | `http://localhost:PORT` | URL для SCORM-телеметрии |
| `APP_NAME` | Нет | -- | Название приложения (в email) |
| `SUPERADMIN_EMAILS` | Нет | -- | Email суперадминов через запятую (PRD-13); права вычисляются в рантайме, в БД не хранятся |
| `ENCRYPTION_PASSWORD` | Да | -- | Ключ шифрования email |
| `ENCRYPTION_SALT` | Да | -- | Соль шифрования email |
| `SMTP_HOST` | Нет | -- | SMTP-сервер |
| `SMTP_PORT` | Нет | 587 | Порт SMTP |
| `SMTP_SECURE` | Нет | false | Использовать TLS |
| `SMTP_USER` | Нет | -- | Логин SMTP |
| `SMTP_PASS` | Нет | -- | Пароль SMTP |
| `SMTP_FROM` | Нет | -- | Адрес отправителя |

Если SMTP не настроен, ссылки сброса пароля выводятся в консоль сервера.

### Лимиты

| Параметр | Значение | Где настроить |
| --- | --- | --- |
| Размер медиа-файла | 200 MB | `server/middleware/upload.ts` (Multer) |
| Время сессии | 24 часа | `server/routes.ts` (session cookie, `registerRoutes`) |
| Body limit | 50 MB | `server/index.ts` (express.json) |

---

## Решение проблем

### "Connection refused" при подключении к PostgreSQL

Проверьте, что PostgreSQL запущен и `DATABASE_URL` в `.env` корректен:

```bash
# Docker:
docker ps | grep postgres

# Windows:
Get-Service postgresql*

# macOS:
brew services list | grep postgresql

# Linux:
sudo systemctl status postgresql
```

### "relation does not exist"

Таблицы не созданы. Выполните:

```bash
npm run db:push
```

### "MODULE_NOT_FOUND"

Переустановите зависимости:

```bash
rm -rf node_modules package-lock.json
npm install
```

### "PORT already in use"

Измените порт в `.env` или завершите процесс, занимающий порт:

```bash
# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# macOS/Linux:
lsof -ti:5000 | xargs kill -9
```

### Белый экран после сборки

```bash
# Проверьте наличие файлов сборки
ls dist/public/

# Пересоберите
npm run build
```

### Сессия сбрасывается

- Проверьте `SESSION_SECRET` в `.env`
- Текущая конфигурация использует `memorystore` (in-memory с TTL).
- Для масштабирования на несколько инстансов используйте session-store с поддержкой PostgreSQL
  (например, `connect-pg-simple`) и обновите конфиг сессии в `server/index.ts`.

---

## Лицензия

MIT License

Copyright (c) 2024 SCORM Test Constructor
