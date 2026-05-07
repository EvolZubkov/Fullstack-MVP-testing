# SCORM Test Constructor

Веб-приложение для создания, управления и экспорта интерактивных тестов в формате SCORM 2004 4th Edition. Поддерживает стандартный и адаптивный режимы тестирования с интеграцией в LMS.

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

**SCORM Test Constructor** -- полнофункциональное веб-приложение для создания интерактивных тестов с экспортом в формат SCORM 2004 4th Edition. Приложение разделено на две роли:

- **Авторы (Author)** -- создают банки вопросов, группируют их по темам, конструируют тесты с гибкими правилами прохождения, управляют пользователями и группами, просматривают аналитику
- **Учащиеся (Learner)** -- проходят тесты в стандартном или адаптивном режиме, получают детальные результаты с рекомендациями курсов

---

## Возможности

### Для авторов

#### Управление темами

- Создание и организация тем с иерархией папок
- Добавление описаний и обратной связи
- Прикрепление рекомендованных курсов (название + URL)
- Дублирование тем вместе со всеми вопросами
- Массовое удаление тем

#### Банк вопросов

- 4 типа вопросов: single choice, multiple choice, matching, ranking
- Настройка баллов и уровня сложности
- Медиа-вложения (изображения, аудио, видео) с загрузкой до 200 MB
- Перемешивание вариантов ответов (опция)
- Обратная связь: общая или условная (для правильного/неправильного ответа)
- Дублирование и массовое удаление вопросов
- Импорт/экспорт через Excel

#### Конструктор тестов

- Два режима тестирования:
  - **Стандартный** -- фиксированный набор вопросов из выбранных тем с настраиваемым drawCount
  - **Адаптивный** -- динамическая сложность с уровнями, порогами прохождения и связанными ресурсами
- Гибкие правила прохождения (по процентам или абсолютным числам) для каждой темы и теста в целом
- Ограничение по времени и количеству попыток
- Показ правильных ответов после прохождения
- Кастомный контент на стартовой странице
- Публикация / снятие с публикации

#### Управление пользователями и группами

- Создание и управление учетными записями учащихся
- Организация пользователей в группы
- Назначение тестов пользователям и группам (с дедлайном)
- Статусы пользователей: pending, active, inactive
- Принудительная смена пароля при первом входе

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

### Безопасность и GDPR

- Шифрование email-адресов в базе данных (AES)
- Хеширование паролей (bcrypt)
- Сброс пароля через email-токены (HMAC-SHA256)
- Отслеживание согласия GDPR при первом входе
- Маскирование email при отображении

---

## Технологический стек

### Frontend

| Технология | Версия | Назначение |
|---|---|---|
| React | 18.3 | UI-библиотека |
| TypeScript | 5.6 | Типизация |
| Vite | 5.4 | Сборщик и dev-сервер |
| Wouter | 3.3 | Легковесный роутинг |
| TanStack React Query | 5.60 | Управление серверным состоянием |
| React Hook Form | 7.55 | Формы |
| Zod | 3.24 | Валидация |
| shadcn/ui (Radix UI) | -- | Компоненты UI |
| Tailwind CSS | 3.4 | Стилизация |
| Recharts | 2.15 | Графики и визуализации |
| Lucide React | -- | Иконки |
| html2canvas + jsPDF | -- | PDF-экспорт результатов |

### Backend

| Технология | Версия | Назначение |
|---|---|---|
| Node.js | 18+ | Runtime |
| Express | 4.21 | Веб-фреймворк |
| TypeScript | 5.6 | Типизация |
| Drizzle ORM | 0.39 | Работа с БД |
| PostgreSQL | 14+ | База данных |
| express-session | 1.18 | Управление сессиями |
| bcryptjs | 3.0 | Хеширование паролей |
| Nodemailer | 7.0 | Отправка email |
| Multer | 2.0 | Загрузка файлов |
| Archiver | 7.0 | Создание SCORM ZIP-пакетов |
| XLSX | -- | Импорт/экспорт Excel |

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

- **Node.js** >= 18.0.0
- **npm** >= 8.0.0
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

При первом запуске автоматически создаются демо-пользователи:

- **admin** / admin123 (role: author)
- **learner** / learner123 (role: learner)

### 5. Запуск

```bash
npm run dev
```

Приложение будет доступно по адресу `http://localhost:5000`.

---

## Структура проекта

```text
Fullstack-MVP-testing/
|-- client/                          # Frontend (React SPA)
|   |-- src/
|   |   |-- components/              # React-компоненты
|   |   |   |-- ui/                  # shadcn/ui компоненты (47 штук)
|   |   |   |-- questions/           # Компоненты вопросов (media-uploader)
|   |   |   |-- app-sidebar.tsx      # Боковая навигация
|   |   |   |-- assign-test-dialog.tsx # Диалог назначения тестов
|   |   |   |-- empty-state.tsx
|   |   |   |-- loading-state.tsx
|   |   |   |-- page-header.tsx
|   |   |   |-- password-input.tsx
|   |   |   |-- theme-provider.tsx
|   |   |   +-- theme-toggle.tsx
|   |   |-- hooks/                   # Custom React hooks
|   |   |   |-- use-mobile.tsx
|   |   |   +-- use-toast.ts
|   |   |-- lib/                     # Утилиты и конфигурация
|   |   |   |-- auth.tsx             # Контекст аутентификации
|   |   |   |-- i18n.ts             # Интернационализация (RU)
|   |   |   |-- queryClient.ts      # React Query setup
|   |   |   +-- utils.ts
|   |   |-- pages/                   # Страницы
|   |   |   |-- author/              # Панель автора
|   |   |   |   |-- analytics.tsx    # Общая аналитика
|   |   |   |   |-- test-analytics.tsx # Аналитика по тесту
|   |   |   |   |-- topics.tsx       # Управление темами
|   |   |   |   |-- questions.tsx    # Банк вопросов
|   |   |   |   |-- tests.tsx        # Конструктор тестов
|   |   |   |   |-- users.tsx        # Управление пользователями
|   |   |   |   |-- groups.tsx       # Управление группами
|   |   |   |   +-- layout.tsx
|   |   |   |-- learner/             # Панель учащегося
|   |   |   |   |-- test-list.tsx    # Доступные тесты
|   |   |   |   |-- take-test.tsx    # Прохождение теста
|   |   |   |   |-- result.tsx       # Результаты
|   |   |   |   |-- history.tsx      # История попыток
|   |   |   |   +-- layout.tsx
|   |   |   |-- login.tsx
|   |   |   |-- first-login.tsx      # Первый вход (GDPR)
|   |   |   |-- forgot-password.tsx  # Запрос сброса пароля
|   |   |   |-- reset-password.tsx   # Сброс пароля
|   |   |   +-- not-found.tsx
|   |   |-- App.tsx                  # Главный компонент + роутинг
|   |   |-- main.tsx                 # Entry point
|   |   +-- index.css                # Глобальные стили
|   +-- index.html
|
|-- server/                          # Backend (Express)
|   |-- scorm/                       # SCORM 2004 генератор
|   |   |-- builders/                # Сборщики пакета
|   |   |   |-- manifest.ts         # imsmanifest.xml
|   |   |   |-- metadata.ts         # Метаданные SCORM
|   |   |   |-- media-assets.ts     # Обработка медиа
|   |   |   +-- test-json.ts        # Данные теста
|   |   |-- assets/                  # Runtime-файлы SCORM
|   |   |-- template/               # JS-логика SCORM-пакета
|   |   |   +-- app/                # Приложение (adaptive, dnd, render, timer, telemetry)
|   |   |-- utils/
|   |   |-- index.ts                # Главный экспорт
|   |   +-- zip.ts                  # ZIP-упаковка
|   |-- utils/
|   |   |-- crypto.ts               # Шифрование/дешифрование email
|   |   +-- mask-email.ts           # Маскирование email
|   |-- db.ts                       # Подключение к БД (Drizzle)
|   |-- email.ts                    # Отправка email (сброс пароля)
|   |-- index.ts                    # Entry point сервера
|   |-- routes.ts                   # Все API endpoints (~6000 строк)
|   |-- scorm-exporter.ts           # Оркестратор SCORM-экспорта
|   |-- static.ts                   # Раздача статики (production)
|   +-- storage.ts                  # Data Access Layer (~1000 строк)
|
|-- shared/                          # Общий код (client + server)
|   +-- schema.ts                   # Drizzle-схема БД + Zod-типы (~700 строк)
|
|-- script/                          # Утилиты
|   |-- build.ts                    # Скрипт production-сборки
|   |-- create-admin.ts             # Создание администратора
|   |-- migrate-emails.ts           # Миграция email
|   +-- test-crypto.ts              # Тесты шифрования
|
|-- docs/                            # Документация
|   |-- guides/
|   |   +-- design_guidelines.md    # Гайдлайны дизайна
|   +-- reports/
|       |-- ANALYSIS_REPORT.md      # Отчет об анализе
|       +-- CODE_REVIEW.md          # Отчет code review
|
|-- migrations/                      # Drizzle-миграции БД
|-- uploads/                         # Загруженные файлы
|   |-- media/                      # Медиа-файлы вопросов
|   +-- scorm/                      # Сгенерированные SCORM-пакеты
|
|-- .env.example                     # Шаблон переменных окружения
|-- drizzle.config.ts               # Конфиг Drizzle Kit
|-- package.json
|-- tsconfig.json
|-- tailwind.config.ts
|-- vite.config.ts
|-- components.json                  # Конфиг shadcn/ui
+-- postcss.config.js
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

### Ролевая модель

```text
+------------+
|    User    |
+-----+------+
      |
      +----------------+
      |                |
+-----v------+   +-----v------+
|   Author   |   |  Learner   |
|            |   |            |
| - Topics   |   | - Tests    |
| - Questions|   | - Attempts |
| - Tests    |   | - Results  |
| - Users    |   | - History  |
| - Groups   |   |            |
| - Analytics|   |            |
+------------+   +------------+
```

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
2. Генерируется вариант теста (variantJson) -- случайная выборка вопросов по drawCount / адаптивным уровням
3. Учащийся отвечает на вопросы (ответы сохраняются в answersJson)
4. Отправка теста -- вычисление результатов, применение правил прохождения
5. Результаты -- общий балл, разбивка по темам, рекомендации курсов

---

## База данных

### Таблицы (Drizzle ORM, PostgreSQL)

#### users

| Поле | Тип | Описание |
| ---- | --- | -------- |
| id | varchar(36) PK | UUID |
| email | text | Зашифрованный email (AES) |
| emailHash | text | SHA-256 хеш для поиска |
| passwordHash | text | bcrypt хеш пароля |
| name | text | Отображаемое имя |
| role | enum | author, learner |
| status | enum | pending, active, inactive |
| mustChangePassword | boolean | Принудительная смена пароля |
| gdprConsent | boolean | Согласие GDPR |
| gdprConsentAt | timestamp | Дата согласия |
| lastLoginAt | timestamp | Последний вход |
| expiresAt | timestamp | Срок действия аккаунта |
| createdAt | timestamp | Дата создания |
| createdBy | varchar FK | Создатель (author) |

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

Иерархическая структура папок для тем (parentId -> folders.id).

#### topics

| Поле | Тип | Описание |
|---|---|---|
| id | varchar(36) PK | UUID |
| name | text | Название темы |
| description | text | Описание |
| feedback | text | Обратная связь |
| folderId | varchar FK | Папка |

#### topicCourses

Рекомендованные курсы для темы (title + URL).

#### questions

| Поле | Тип | Описание |
|---|---|---|
| id | varchar(36) PK | UUID |
| topicId | varchar FK | Тема |
| type | enum | single, multiple, matching, ranking |
| prompt | text | Текст вопроса |
| dataJson | jsonb | Варианты ответов |
| correctJson | jsonb | Правильные ответы |
| points | integer | Баллы (по умолчанию 1) |
| difficulty | text | Уровень сложности |
| mediaUrl | text | URL медиа-файла |
| mediaType | enum | image, audio, video |
| shuffleAnswers | boolean | Перемешивание ответов |
| feedback | text | Обратная связь (общая) |
| feedbackMode | enum | general, conditional |
| feedbackCorrect | text | Для правильного ответа |
| feedbackIncorrect | text | Для неправильного ответа |

#### tests

| Поле | Тип | Описание |
|---|---|---|
| id | varchar(36) PK | UUID |
| title | text | Название теста |
| description | text | Описание |
| mode | enum | standard, adaptive |
| showDifficultyLevel | boolean | Показывать сложность |
| overallPassRuleJson | jsonb | Общее правило прохождения |
| published | boolean | Опубликован |
| version | integer | Версия теста |
| timeLimitMinutes | integer | Лимит времени |
| maxAttempts | integer | Макс. попыток |
| showCorrectAnswers | boolean | Показывать ответы |
| startPageContent | text | Контент стартовой страницы |

#### testSections

Секции теста в стандартном режиме (topicId, drawCount, topicPassRuleJson).

#### adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks

Настройки адаптивного тестирования: темы, уровни сложности, пороги прохождения, ссылки на ресурсы.

#### attempts

| Поле | Тип | Описание |
|---|---|---|
| id | varchar(36) PK | UUID |
| userId | varchar FK | Учащийся |
| testId | varchar FK | Тест |
| testVersion | integer | Версия теста |
| variantJson | jsonb | Сгенерированный вариант |
| answersJson | jsonb | Ответы учащегося |
| resultJson | jsonb | Результаты проверки |
| startedAt | timestamp | Начало |
| finishedAt | timestamp | Завершение |

#### scormPackages

Экспортированные SCORM-пакеты (testId, secretKey, apiBaseUrl, testMode).

#### scormAttempts

Попытки прохождения через LMS (packageId, sessionId, lmsUserId, lmsUserName).

#### scormAnswers

Индивидуальные ответы в SCORM-попытках (questionId, userAnswer, isCorrect, earnedPoints).

### Диаграмма связей

```text
users
  +--- attempts (1:N)
  +--- userGroups (N:M) --- groups
  +--- testAssignments (1:N)
  +--- passwordResetTokens (1:N)

folders (self-referencing)
  +--- topics (1:N)
         +--- questions (1:N)
         +--- topicCourses (1:N)

tests
  +--- testSections (1:N, standard) --- topics
  +--- adaptiveTopicSettings (1:N, adaptive) --- topics
  |      +--- adaptiveLevels (1:N)
  |             +--- adaptiveLevelLinks (1:N)
  +--- attempts (1:N)
  +--- testAssignments (1:N)
  +--- scormPackages (1:N)
         +--- scormAttempts (1:N)
                +--- scormAnswers (1:N)
```

---

## API Reference

### Аутентификация

| Метод | Endpoint | Описание |
|---|---|---|
| POST | `/api/login` | Вход в систему |
| POST | `/api/logout` | Выход |
| POST | `/api/register` | Регистрация пользователя |
| GET | `/api/auth/me` | Текущий пользователь |
| POST | `/api/request-password-reset` | Запрос сброса пароля |
| POST | `/api/reset-password` | Сброс пароля по токену |

### Пользователи (Author)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | `/api/users` | Список пользователей |
| POST | `/api/users` | Создать пользователя |
| GET | `/api/user/profile` | Профиль текущего пользователя |
| PUT | `/api/user/password` | Смена пароля |

### Группы (Author)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | `/api/groups` | Список групп |
| POST | `/api/groups` | Создать группу |
| PUT | `/api/groups/:id` | Обновить группу |
| DELETE | `/api/groups/:id` | Удалить группу |
| GET | `/api/users/:id/groups` | Группы пользователя |

### Темы (Author)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | `/api/topics` | Список тем |
| POST | `/api/topics` | Создать тему |
| PUT | `/api/topics/:id` | Обновить тему |
| DELETE | `/api/topics/:id` | Удалить тему |
| POST | `/api/topics/:id/duplicate` | Дублировать тему |
| POST | `/api/topics/bulk-delete` | Массовое удаление |

### Вопросы (Author)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | `/api/questions` | Список вопросов |
| POST | `/api/questions` | Создать вопрос |
| PUT | `/api/questions/:id` | Обновить вопрос |
| DELETE | `/api/questions/:id` | Удалить вопрос |
| POST | `/api/questions/:id/duplicate` | Дублировать вопрос |
| POST | `/api/questions/bulk-delete` | Массовое удаление |
| GET | `/api/questions/export` | Экспорт в Excel |
| POST | `/api/questions/import` | Импорт из Excel |

### Тесты (Author)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | `/api/tests` | Список тестов |
| POST | `/api/tests` | Создать тест |
| PUT | `/api/tests/:id` | Обновить тест |
| DELETE | `/api/tests/:id` | Удалить тест |
| PUT | `/api/tests/:id/publish` | Опубликовать / снять |
| POST | `/api/tests/:id/assign` | Назначить тест |
| POST | `/api/tests/:id/export-scorm` | Экспорт SCORM |

### Попытки (Learner)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | `/api/learner/tests` | Доступные тесты |
| POST | `/api/tests/:id/start` | Начать тест |
| POST | `/api/attempts/:id/answer` | Сохранить ответ |
| POST | `/api/attempts/:id/finish` | Завершить тест |
| GET | `/api/attempts/:id` | Результат попытки |
| GET | `/api/attempts` | История попыток |

### Аналитика (Author)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | `/api/analytics` | Общая аналитика |
| GET | `/api/analytics/:testId` | Аналитика по тесту |

### Медиа

| Метод | Endpoint | Описание |
|---|---|---|
| POST | `/api/media/upload` | Загрузка медиа-файла |

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

1. Экспортируйте шаблон: **"Экспорт в Excel"**
2. Заполните файл по формату:

| Тема | Тип | Текст | Балл | Варианты (#-разделитель) | Правильные | Перемешивание |
|---|---|---|---|---|---|---|
| Математика | single | Сколько 2+2? | 1 | 3#4#5#6 | 1 | Random |
| История | multiple | Страны Европы | 2 | Франция#Япония#Германия | 0,2 | Random |

3. Импортируйте: **"Импорт из Excel"**

#### Шаг 4: Создание теста

1. Перейдите в **"Тесты"** и нажмите **"Создать тест"**
2. Заполните название и описание
3. Выберите режим: стандартный или адаптивный
4. Для стандартного: выберите темы, укажите drawCount и правила прохождения
5. Для адаптивного: настройте уровни сложности и пороги
6. Настройте лимит времени, количество попыток, показ ответов
7. Опубликуйте тест

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
npm run dev          # Development-сервер (tsx watch + Vite)
npm run build        # Production-сборка (esbuild + Vite)
npm start            # Запуск production-версии
npm run check        # Проверка типов TypeScript
npm run db:push      # Применить изменения схемы к БД
```

### Hot Reload

- **Frontend** -- обновление через Vite (HMR отключен из-за проблем с reverse proxy, используется полная перезагрузка)
- **Backend** -- автоматический перезапуск через tsx watch

### Алиасы путей

| Алиас | Путь |
|---|---|
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
|---|---|---|---|
| `DATABASE_URL` | Да | -- | PostgreSQL connection string |
| `PORT` | Нет | 5000 | Порт сервера |
| `NODE_ENV` | Нет | development | Режим: development / production |
| `SESSION_SECRET` | Нет | auto | Секрет для сессий |
| `API_BASE_URL` | Нет | `http://localhost:PORT` | URL для SCORM-телеметрии |
| `APP_NAME` | Нет | -- | Название приложения (в email) |
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
|---|---|---|
| Размер медиа-файла | 200 MB | `server/routes.ts` (Multer) |
| Время сессии | 24 часа | `server/routes.ts` (session cookie) |
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
- В production рассмотрите использование connect-pg-simple вместо MemoryStore

---

## Лицензия

MIT License

Copyright (c) 2024 SCORM Test Constructor
