# SCORM Test Constructor

> **ARCHIVED.** Снимок README прошлой ревизии. После массового обновления npm-пакетов (2026-05)
> ряд зависимостей и инструкций здесь устарел. Источник истины — `README.md` в корне.
>
> Веб-приложение для создания учебных тестов с экспортом в SCORM 2004
> для интеграции с системами управления обучением (LMS)

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-18.x-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.6.3-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## 📋 Содержание

- [О проекте](#-о-проекте)
- [Возможности](#-возможности)
- [Технологический стек](#-технологический-стек)
- [Системные требования](#-системные-требования)
- [Установка и запуск](#-установка-и-запуск)
  - [Windows](#windows)
  - [macOS / Linux](#macos--linux)
- [Структура проекта](#-структура-проекта)
- [Архитектура](#-архитектура)
- [База данных](#-база-данных)
- [API Endpoints](#-api-endpoints)
- [Типы вопросов](#-типы-вопросов)
- [SCORM Export](#-scorm-export)
- [Руководство пользователя](#-руководство-пользователя)
  - [Для авторов](#для-авторов)
  - [Для учащихся](#для-учащихся)
- [Разработка](#-разработка)
- [Сборка и деплой](#-сборка-и-деплой)
- [Переменные окружения](#-переменные-окружения)
- [Решение проблем](#-решение-проблем)
- [Roadmap](#-roadmap)
- [Лицензия](#-лицензия)

---

## 🎯 О проекте

**SCORM Test Constructor** — это современное веб-приложение для создания интерактивных тестов с последующим экспортом в формат SCORM 2004 4th Edition. Приложение позволяет авторам создавать структурированные тесты, а учащимся — проходить их и получать детальную обратную связь с рекомендациями курсов для улучшения знаний.

### Основная идея

Приложение разделено на две роли:
- **Авторы** — создают банки вопросов, группируют их по темам, конструируют тесты с гибкими правилами прохождения
- **Учащиеся** — проходят тесты, получают детальные результаты с разбивкой по темам и рекомендации курсов

---

## ✨ Возможности

### Для авторов

#### 📁 Управление темами
- Создание и организация тем
- Добавление описаний и обратной связи
- Прикрепление рекомендованных курсов (название + URL)
- Дублирование тем вместе со всеми вопросами
- Каскадное удаление (тема → все вопросы → курсы)

#### ❓ Банк вопросов
- **4 типа вопросов:**
  - Один правильный ответ (single choice)
  - Несколько правильных ответов (multiple choice)
  - Сопоставление элементов (matching)
  - Ранжирование (ranking)
- Настройка баллов за вопрос
- Перемешивание вариантов ответов (опция)
- Обратная связь по вопросам (общая или условная)
- Дублирование вопросов
- Массовое удаление
- **Импорт/Экспорт Excel** с полями:
  - Тема, Тип вопроса, Текст вопроса, Балл
  - Варианты ответов (# separated)
  - Номера правильных ответов
  - Следование вариантов (Random/Fixed)

#### 🧪 Конструктор тестов
- Многоэтапный визард создания теста
- Выбор тем для включения в тест
- Настройка количества случайных вопросов из каждой темы
- **Гибкие правила прохождения:**
  - По темам (процент или абсолютное число)
  - Общие по всему тесту
- Ограничение по времени (опционально)
- Ограничение количества попыток
- Показ правильных ответов после прохождения
- Кастомный контент на стартовой странице

#### 📊 Аналитика
- Общая статистика по всем тестам
- Детализация по каждому тесту
- Статистика по темам
- Топ самых проваливаемых тем
- Графики трендов за 30 дней
- Детальная таблица результатов

#### 📦 SCORM Экспорт
- Совместимость с SCORM 2004 4th Edition
- Автоматическая генерация ZIP-пакета
- Включение всех метаданных
- Отправка score, completion, success в LMS
- Детальные interactions по темам

### Для учащихся

#### 📝 Прохождение тестов
- Просмотр доступных тестов
- Информация о тесте (вопросы, время, темы)
- Фокусный режим прохождения (один вопрос на экране)
- Прогресс-бар
- Навигация вперед/назад
- Сохранение прогресса

#### 📈 Результаты
- Визуализация общего результата (круговая диаграмма)
- Разбивка по темам с прогресс-барами
- Индикаторы "Сдан/Не сдан" по темам
- **Рекомендованные курсы** для проваленных тем
- Возможность пересдачи
- Кнопка "Посмотреть разбор" (если включено)

#### 📜 История попыток
- Группировка по тестам
- Отслеживание улучшения результатов (дельта между попытками)
- Индикация устаревших версий тестов
- Детальный просмотр каждой попытки

---

## 🛠 Технологический стек

### Frontend
- **React 18.3** - UI библиотека
- **TypeScript 5.6** - типизация
- **Vite 5.4** - сборщик и dev-сервер
- **Wouter 3.3** - легкий роутинг
- **TanStack React Query 5.6** - управление server state
- **React Hook Form 7.55** + **Zod 3.24** - формы и валидация
- **shadcn/ui** - UI компоненты на базе Radix UI
- **Tailwind CSS 3.4** - стилизация
- **Recharts 2.15** - графики и визуализации
- **Lucide React** - иконки

### Backend
- **Node.js 18+** - runtime
- **Express 4.21** - веб-фреймворк
- **TypeScript 5.6** - типизация
- **Drizzle ORM 0.39** - работа с БД
- **PostgreSQL** - база данных
- **Passport.js** - аутентификация
- **bcrypt** - хеширование паролей
- **Express Session** - управление сессиями

### Dev Tools
- **tsx** - TypeScript executor
- **Drizzle Kit** - миграции БД
- **ESBuild** - быстрая сборка
- **cross-env** - кросс-платформенные env переменные

### Дополнительно
- **Archiver** - создание SCORM ZIP
- **XLSX** - импорт/экспорт Excel
- **date-fns** - работа с датами

---

## 💻 Системные требования

### Обязательно
- **Node.js**: версия 18.x или выше
- **npm**: версия 9.x или выше (идет с Node.js)
- **PostgreSQL**: версия 13 или выше

### Рекомендуется
- **RAM**: минимум 4 GB
- **Место на диске**: минимум 500 MB для зависимостей
- **ОС**: Windows 10+, macOS 10.15+, или Linux (Ubuntu 20.04+)

### Опционально
- **Docker Desktop** - для запуска PostgreSQL в контейнере
- **VS Code** - рекомендуемый редактор кода

---

## 🚀 Установка и запуск

### Windows

#### 1. Установите зависимости

```powershell
# Клонируйте или распакуйте проект
cd D:\path\to\scorm-test-constructor

# Установите npm пакеты
npm install
```

#### 2. Настройте PostgreSQL

**Вариант A: Docker (рекомендуется)**

```powershell
# Убедитесь что Docker Desktop запущен
docker run --name scorm-postgres `
  -e POSTGRES_HOST_AUTH_METHOD=trust `
  -e POSTGRES_DB=scorm_db `
  -p 5432:5432 `
  -d postgres:15

# Проверьте что контейнер запущен
docker ps
```

**Вариант B: Локальный PostgreSQL**

Создайте базу данных через pgAdmin или psql:
```sql
CREATE DATABASE scorm_db;
```

#### 3. Создайте файл .env

```powershell
# Создайте .env файл в корне проекта
@"
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/scorm_db
PORT=5000
NODE_ENV=development
"@ | Out-File -FilePath .env -Encoding UTF8
```

**Замените:**
- `your_password` на ваш реальный пароль PostgreSQL
- Порт `5432` если используете другой

#### 4. Инициализируйте базу данных

```powershell
npm run db:push
```

Вы должны увидеть:
```
[✓] Pulling schema from database...
[✓] Changes applied
```

#### 5. Запустите приложение

```powershell
npm run dev
```

Приложение запустится на `http://localhost:5000`

---

### macOS / Linux

#### 1. Установите зависимости

```bash
# Клонируйте или распакуйте проект
cd /path/to/scorm-test-constructor

# Установите npm пакеты
npm install
```

#### 2. Настройте PostgreSQL

**Вариант A: Docker (рекомендуется)**

```bash
# Запустите PostgreSQL контейнер
docker run --name scorm-postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=scorm_db \
  -p 5432:5432 \
  -d postgres:15

# Проверьте статус
docker ps
```

**Вариант B: Установка через пакетный менеджер**

```bash
# macOS
brew install postgresql@15
brew services start postgresql@15

# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql

# Создайте базу данных
createdb scorm_db
```

#### 3. Создайте файл .env

```bash
cat > .env << EOF
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/scorm_db
PORT=5000
NODE_ENV=development
EOF
```

#### 4. Инициализируйте базу данных

```bash
npm run db:push
```

#### 5. Запустите приложение

```bash
npm run dev
```

---

## 📁 Структура проекта

```
scorm-test-constructor/
├── client/                      # Frontend приложение
│   ├── public/
│   │   └── favicon.png         # Иконка сайта
│   ├── src/
│   │   ├── components/         # React компоненты
│   │   │   ├── ui/            # shadcn/ui компоненты
│   │   │   ├── app-sidebar.tsx
│   │   │   ├── empty-state.tsx
│   │   │   ├── loading-state.tsx
│   │   │   ├── page-header.tsx
│   │   │   ├── theme-provider.tsx
│   │   │   └── theme-toggle.tsx
│   │   ├── hooks/             # Custom React hooks
│   │   │   ├── use-mobile.tsx
│   │   │   └── use-toast.ts
│   │   ├── lib/               # Утилиты и конфигурация
│   │   │   ├── auth.tsx       # Контекст аутентификации
│   │   │   ├── i18n.ts        # Интернационализация
│   │   │   ├── queryClient.ts # React Query setup
│   │   │   └── utils.ts       # Общие утилиты
│   │   ├── pages/             # Страницы приложения
│   │   │   ├── author/        # Страницы автора
│   │   │   │   ├── analytics.tsx
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── questions.tsx
│   │   │   │   ├── tests.tsx
│   │   │   │   └── topics.tsx
│   │   │   ├── learner/       # Страницы учащегося
│   │   │   │   ├── history.tsx
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── result.tsx
│   │   │   │   ├── take-test.tsx
│   │   │   │   └── test-list.tsx
│   │   │   ├── login.tsx
│   │   │   └── not-found.tsx
│   │   ├── App.tsx            # Главный компонент + роутинг
│   │   ├── index.css          # Глобальные стили
│   │   └── main.tsx           # Entry point
│   └── index.html
├── server/                     # Backend приложение
│   ├── db.ts                  # Подключение к БД
│   ├── index.ts               # Entry point сервера
│   ├── routes.ts              # API endpoints
│   ├── scorm-exporter.ts      # SCORM генерация
│   ├── static.ts              # Раздача статики
│   ├── storage.ts             # Seed данных
│   └── vite.ts                # Vite dev server setup
├── shared/                     # Общий код
│   └── schema.ts              # Drizzle схема БД + Zod типы
├── script/
│   └── build.ts               # Скрипт сборки
├── migrations/                 # Drizzle миграции (авто-генерация)
├── .env                       # Переменные окружения (создать!)
├── .gitignore
├── components.json            # shadcn/ui конфиг
├── design_guidelines.md       # Гайдлайны дизайна
├── drizzle.config.ts          # Drizzle Kit конфигурация
├── package.json               # Зависимости и скрипты
├── postcss.config.js          # PostCSS конфиг
├── README.md                  # Этот файл
├── replit.md                  # Документация Replit
├── tailwind.config.ts         # Tailwind конфигурация
├── tsconfig.json              # TypeScript конфигурация
└── vite.config.ts             # Vite конфигурация
```

---

## 🏗 Архитектура

### Общая структура

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  ┌───────────────────────────────────────────┐  │
│  │         React SPA (Vite)                  │  │
│  │  - Wouter routing                         │  │
│  │  - TanStack Query (state)                 │  │
│  │  - shadcn/ui components                   │  │
│  └───────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │ HTTP/REST API
                   │ /api/*
┌──────────────────▼──────────────────────────────┐
│              Express Server                      │
│  ┌───────────────────────────────────────────┐  │
│  │  Routes (server/routes.ts)                │  │
│  │  - Auth endpoints                         │  │
│  │  - CRUD operations                        │  │
│  │  - SCORM export                           │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  Session Management                       │  │
│  │  - Passport.js                            │  │
│  │  - express-session                        │  │
│  └───────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │ Drizzle ORM
                   │ SQL queries
┌──────────────────▼──────────────────────────────┐
│            PostgreSQL Database                   │
│  - users, topics, questions                      │
│  - tests, test_sections                          │
│  - attempts, results                             │
│  - topic_courses                                 │
└──────────────────────────────────────────────────┘
```

### Ролевая модель

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │
       ├─────────────┐
       │             │
┌──────▼──────┐ ┌───▼────────┐
│   Author    │ │  Learner   │
│             │ │            │
│ - Topics    │ │ - Tests    │
│ - Questions │ │ - Attempts │
│ - Tests     │ │ - Results  │
│ - Analytics │ │ - History  │
└─────────────┘ └────────────┘
```

### Структура теста

```
Test
├── title, description
├── overallPassRule (percent/absolute)
├── settings (timeLimit, maxAttempts, showAnswers)
└── TestSections[]
    ├── Topic
    │   ├── name, description
    │   ├── recommendedCourses[]
    │   └── Questions[]
    ├── drawCount (сколько случайных вопросов взять)
    └── topicPassRule (опциональный)
```

### Процесс прохождения теста

```
1. Учащийся выбирает тест
          ↓
2. Генерируется вариант теста (TestVariant)
   - Случайный выбор вопросов по drawCount
   - Сохранение в attempt.variantJson
          ↓
3. Учащийся отвечает на вопросы
   - Ответы сохраняются в attempt.answersJson
          ↓
4. Отправка теста на проверку
   - Вычисление правильности ответов
   - Применение правил прохождения
   - Генерация AttemptResult
          ↓
5. Отображение результатов
   - Общий балл и статус
   - Разбивка по темам
   - Рекомендованные курсы (для проваленных тем)
```

---

## 🗄 База данных

### Схема (Drizzle ORM)

#### users
```typescript
- id: varchar(36) PK
- username: text UNIQUE
- password: text (bcrypt hash)
- role: enum('author', 'learner')
```

#### folders
```typescript
- id: varchar(36) PK
- name: text
- parentId: varchar(36) FK -> folders.id
```

#### topics
```typescript
- id: varchar(36) PK
- name: text
- description: text?
- feedback: text?
- folderId: varchar(36) FK -> folders.id?
```

#### topic_courses
```typescript
- id: varchar(36) PK
- topicId: varchar(36) FK -> topics.id
- title: text
- url: text
```

#### questions
```typescript
- id: varchar(36) PK
- topicId: varchar(36) FK -> topics.id
- type: enum('single', 'multiple', 'matching', 'ranking')
- prompt: text
- dataJson: jsonb (варианты ответов)
- correctJson: jsonb (правильные ответы)
- points: integer DEFAULT 1
- mediaUrl: text?
- mediaType: enum('image', 'audio', 'video')?
- shuffleAnswers: boolean DEFAULT true
- feedback: text?
- feedbackMode: enum('general', 'conditional')
- feedbackCorrect: text?
- feedbackIncorrect: text?
```

#### tests
```typescript
- id: varchar(36) PK
- title: text
- description: text?
- overallPassRuleJson: jsonb
- webhookUrl: text?
- published: boolean DEFAULT false
- version: integer DEFAULT 1
- feedback: text?
- timeLimitMinutes: integer?
- maxAttempts: integer?
- showCorrectAnswers: boolean DEFAULT false
- startPageContent: text?
```

#### test_sections
```typescript
- id: varchar(36) PK
- testId: varchar(36) FK -> tests.id
- topicId: varchar(36) FK -> topics.id
- drawCount: integer
- topicPassRuleJson: jsonb?
```

#### attempts
```typescript
- id: varchar(36) PK
- userId: varchar(36) FK -> users.id
- testId: varchar(36) FK -> tests.id
- testVersion: integer DEFAULT 1
- variantJson: jsonb (сгенерированный вариант)
- answersJson: jsonb? (ответы учащегося)
- resultJson: jsonb? (результаты проверки)
- startedAt: timestamp
- finishedAt: timestamp?
```

### Диаграмма связей

```
users
  └─── attempts
         └─── tests
                └─── test_sections
                       └─── topics
                              ├─── questions
                              └─── topic_courses
```

---

## 🔌 API Endpoints

### Аутентификация

```
POST   /api/auth/login          # Вход
POST   /api/auth/logout         # Выход
GET    /api/auth/me             # Текущий пользователь
```

### Темы (Author только)

```
GET    /api/topics              # Список всех тем
POST   /api/topics              # Создать тему
GET    /api/topics/:id          # Получить тему
PUT    /api/topics/:id          # Обновить тему
DELETE /api/topics/:id          # Удалить тему
POST   /api/topics/:id/duplicate # Дублировать тему
```

### Вопросы (Author только)

```
GET    /api/questions           # Список вопросов
POST   /api/questions           # Создать вопрос
GET    /api/questions/:id       # Получить вопрос
PUT    /api/questions/:id       # Обновить вопрос
DELETE /api/questions/:id       # Удалить вопрос
POST   /api/questions/:id/duplicate # Дублировать вопрос
POST   /api/questions/bulk-delete # Массовое удаление
GET    /api/questions/export    # Экспорт в Excel
POST   /api/questions/import    # Импорт из Excel
```

### Тесты (Author только)

```
GET    /api/tests               # Список тестов
POST   /api/tests               # Создать тест
GET    /api/tests/:id           # Получить тест
PUT    /api/tests/:id           # Обновить тест
DELETE /api/tests/:id           # Удалить тест
POST   /api/tests/:id/export    # Экспорт SCORM
```

### Учащийся

```
GET    /api/learner/tests       # Доступные тесты
POST   /api/learner/tests/:id/start # Начать тест
POST   /api/learner/attempts/:id/submit # Отправить ответы
GET    /api/learner/attempts/:id/result # Получить результат
GET    /api/learner/attempts    # История попыток
```

### Аналитика (Author только)

```
GET    /api/analytics           # Общая аналитика
GET    /api/analytics/tests/:id # Аналитика по тесту
```

---

## 📝 Типы вопросов

### 1. Один вариант (Single Choice)

**Структура данных:**
```typescript
dataJson: {
  options: string[]  // ["Вариант A", "Вариант B", "Вариант C"]
}

correctJson: {
  correctIndex: number  // 0, 1, 2...
}
```

**UI:** Radio buttons

### 2. Несколько вариантов (Multiple Choice)

**Структура данных:**
```typescript
dataJson: {
  options: string[]  // ["Вариант A", "Вариант B", "Вариант C"]
}

correctJson: {
  correctIndices: number[]  // [0, 2] - правильные A и C
}
```

**UI:** Checkboxes

**Проверка:** Точное совпадение (все правильные выбраны, неправильные - нет)

### 3. Сопоставление (Matching)

**Структура данных:**
```typescript
dataJson: {
  left: string[]   // ["Термин 1", "Термин 2"]
  right: string[]  // ["Определение A", "Определение B"]
}

correctJson: {
  pairs: Array<{left: number, right: number}>
  // [{left: 0, right: 1}, {left: 1, right: 0}]
}
```

**UI:** Две колонки с dropdown выбором или drag-and-drop

### 4. Ранжирование (Ranking)

**Структура данных:**
```typescript
dataJson: {
  items: string[]  // ["Элемент A", "Элемент B", "Элемент C"]
}

correctJson: {
  correctOrder: number[]  // [2, 0, 1] - правильный порядок индексов
}
```

**UI:** Drag-and-drop список

---

## 📦 SCORM Export

### Структура SCORM пакета

```
test_<id>_<timestamp>.zip
├── imsmanifest.xml           # Манифест SCORM
├── adlcp_v1p3.xsd           # Schema
├── ims_xml.xsd              # Schema
├── imscp_v1p1.xsd           # Schema
├── imsmd_v1p2p4.xsd         # Schema
├── imsss_v1p0.xsd           # Schema
└── content/
    ├── index.html           # Главная страница теста
    ├── styles.css           # Стили
    ├── scorm_api.js         # SCORM API обёртка
    └── test_data.js         # Данные теста (questions, etc.)
```

### SCORM API вызовы

```javascript
// Инициализация
scormAPI.initialize();

// Установка данных
scormAPI.setValue('cmi.score.raw', score);
scormAPI.setValue('cmi.score.scaled', scaledScore);
scormAPI.setValue('cmi.success_status', 'passed|failed');
scormAPI.setValue('cmi.completion_status', 'completed');

// Interactions по темам
scormAPI.setValue('cmi.interactions.n.id', topicId);
scormAPI.setValue('cmi.interactions.n.result', 'correct|incorrect');
scormAPI.setValue('cmi.interactions.n.learner_response', response);

// Завершение
scormAPI.commit();
scormAPI.terminate();
```

---

## 📖 Руководство пользователя

### Для авторов

#### Создание теста (пошагово)

**Шаг 1: Создание тем**

1. Перейдите в раздел **"Темы"**
2. Нажмите **"+ Создать тему"**
3. Заполните:
   - Название темы
   - Описание (опционально)
   - Обратная связь (опционально)
4. Добавьте рекомендованные курсы (опционально)
5. Сохраните

**Шаг 2: Добавление вопросов**

1. Перейдите в **"Банк вопросов"**
2. Нажмите **"+ Добавить вопрос"**
3. Выберите тему
4. Выберите тип вопроса
5. Заполните текст вопроса
6. Добавьте варианты ответов
7. Укажите правильные ответы
8. Настройте:
   - Баллы (по умолчанию 1)
   - Перемешивание ответов (по умолчанию включено)
   - Обратную связь
9. Сохраните

**Шаг 3: Создание теста**

1. Перейдите в **"Тесты"**
2. Нажмите **"+ Создать тест"**
3. Заполните основную информацию:
   - Название теста
   - Описание
4. Выберите темы для включения
5. Для каждой темы укажите:
   - Количество случайных вопросов (drawCount)
   - Правило прохождения темы (опционально)
6. Настройте общие правила прохождения
7. Дополнительные настройки (опционально):
   - Ограничение по времени
   - Максимум попыток
   - Показывать правильные ответы
8. Сохраните

**Шаг 4: Экспорт SCORM**

1. Откройте нужный тест
2. Нажмите **"Экспорт SCORM"**
3. Скачайте ZIP-файл
4. Загрузите в вашу LMS (Moodle, Canvas, и т.д.)

#### Массовое создание вопросов через Excel

**Экспорт шаблона:**
1. Перейдите в **"Банк вопросов"**
2. Нажмите **"Экспорт в Excel"**
3. Получите файл с существующими вопросами

**Формат Excel:**

| Тема | Тип вопроса | Текст вопроса | Балл | Варианты ответов | Правильные ответы | Перемешивание |
|------|-------------|---------------|------|------------------|-------------------|---------------|
| Математика | single | Сколько будет 2+2? | 1 | 3#4#5#6 | 1 | Random |
| История | multiple | Выберите страны Европы | 2 | Франция#Япония#Германия#Китай | 0,2 | Random |

**Импорт:**
1. Подготовьте Excel файл по формату
2. Нажмите **"Импорт из Excel"**
3. Выберите файл
4. Проверьте результат

---

### Для учащихся

#### Прохождение теста

1. Войдите в систему
2. На главной странице увидите список доступных тестов
3. Выберите тест и нажмите **"Начать тест"**
4. Читайте вопросы внимательно
5. Выбирайте ответы
6. Используйте кнопки **"Назад"**/**"Далее"** для навигации
7. После последнего вопроса нажмите **"Отправить тест"**

#### Просмотр результатов

1. После отправки теста увидите:
   - Общий балл (в процентах и дроби)
   - Статус "Сдан" или "Не сдан"
   - Детализация по темам
2. Для проваленных тем увидите:
   - Рекомендованные курсы с ссылками
3. Можете:
   - Пересдать тест (если есть попытки)
   - Посмотреть правильные ответы (если включено)

#### История попыток

1. Перейдите в **"История"**
2. Увидите все ваши попытки, сгруппированные по тестам
3. Для каждой попытки видно:
   - Дата и время
   - Результат
   - Изменение относительно предыдущей попытки (дельта)
   - Статус версии теста
4. Нажмите **"Посмотреть"** для детального просмотра

---

## 💻 Разработка

### Структура команд

```bash
# Разработка
npm run dev          # Запуск dev-сервера (hot reload)

# База данных
npm run db:push      # Применить изменения схемы к БД

# Проверка типов
npm run check        # TypeScript type checking

# Сборка
npm run build        # Production build
npm run start        # Запуск production версии
```

### Hot Module Replacement (HMR)

При изменении файлов:
- **Frontend** - мгновенное обновление через Vite HMR
- **Backend** - автоматический перезапуск через tsx watch

### Работа с базой данных

#### Изменение схемы

1. Откройте `shared/schema.ts`
2. Измените таблицы используя Drizzle ORM синтаксис
3. Примените изменения:
```bash
npm run db:push
```

#### Пример добавления поля

```typescript
// shared/schema.ts
export const questions = pgTable("questions", {
  // ... существующие поля
  difficulty: text("difficulty", { 
    enum: ["easy", "medium", "hard"] 
  }),
});
```

### Добавление новых API endpoints

1. Откройте `server/routes.ts`
2. Добавьте новый route:
```typescript
app.get("/api/custom-endpoint", async (req, res) => {
  // Ваша логика
  res.json({ data: "result" });
});
```

### Создание новых страниц

1. Создайте файл в `client/src/pages/`
2. Добавьте route в `client/src/App.tsx`:
```typescript
<Route path="/custom-page">
  <CustomPage />
</Route>
```

### Стилизация

Используйте Tailwind утилиты:
```typescript
<div className="flex items-center gap-4 p-6 rounded-lg bg-card">
  <span className="text-lg font-semibold">Заголовок</span>
</div>
```

Или создайте компоненты на базе shadcn/ui:
```bash
npx shadcn-ui@latest add dialog
```

---

## 🏭 Сборка и деплой

### Production сборка

```bash
# 1. Сборка фронтенда и бэкенда
npm run build

# 2. Результат:
# - dist/public/ - статические файлы фронтенда
# - dist/index.cjs - собранный бэкенд

# 3. Запуск
npm run start
```

### Деплой на различные платформы

#### Replit

Приложение уже настроено для Replit:
- `.replit` файл с командами
- Автоматический запуск через `npm run dev`

#### Heroku

```bash
# 1. Создайте приложение
heroku create scorm-test-app

# 2. Добавьте PostgreSQL
heroku addons:create heroku-postgresql:mini

# 3. Установите переменные окружения
heroku config:set NODE_ENV=production

# 4. Deploy
git push heroku main
```

#### Railway.app

1. Подключите GitHub репозиторий
2. Railway автоматически определит Node.js приложение
3. Добавьте PostgreSQL из маркетплейса
4. Переменная `DATABASE_URL` будет добавлена автоматически

#### Vercel (Frontend) + Railway (Backend)

**Не рекомендуется** для этого проекта, так как у нас monorepo.
Лучше использовать платформы с поддержкой fullstack.

#### VPS (DigitalOcean, Linode, AWS EC2)

```bash
# 1. Установите Node.js и PostgreSQL на сервере

# 2. Клонируйте проект
git clone <your-repo>
cd scorm-test-constructor

# 3. Установите зависимости
npm install

# 4. Создайте .env
nano .env

# 5. Инициализируйте БД
npm run db:push

# 6. Соберите проект
npm run build

# 7. Используйте PM2 для запуска
npm install -g pm2
pm2 start npm --name "scorm-app" -- start
pm2 save
pm2 startup
```

### Docker деплой

Создайте `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 5000

CMD ["npm", "start"]
```

`docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/scorm_db
      - NODE_ENV=production
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=scorm_db
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Запуск:
```bash
docker-compose up -d
```

---

## ⚙️ Переменные окружения

### Обязательные

```env
# База данных
DATABASE_URL=postgresql://user:password@host:port/database

# Порт приложения
PORT=5000

# Режим работы
NODE_ENV=development|production
```

### Опциональные

```env
# Секрет для сессий (авто-генерируется если не указан)
SESSION_SECRET=your-secret-key-here

# Настройки сессии
SESSION_MAX_AGE=86400000  # 24 часа в миллисекундах

# CORS (если нужен)
CORS_ORIGIN=http://localhost:3000
```

### Пример .env для разработки

```env
DATABASE_URL=postgresql://postgres:postgres123@localhost:5432/scorm_db
PORT=5000
NODE_ENV=development
```

### Пример .env для production

```env
DATABASE_URL=postgresql://user:strong_password@db.example.com:5432/scorm_prod
PORT=8080
NODE_ENV=production
SESSION_SECRET=very-long-random-secret-key-generate-with-openssl
```

---

## 🔧 Решение проблем

### База данных

#### "Connection refused" при подключении к PostgreSQL

**Проблема:** Приложение не может подключиться к базе данных.

**Решение:**
```bash
# 1. Проверьте что PostgreSQL запущен
# Docker:
docker ps | grep postgres

# Локальный (Windows):
Get-Service postgresql*

# Локальный (macOS):
brew services list | grep postgresql

# Локальный (Linux):
sudo systemctl status postgresql

# 2. Проверьте DATABASE_URL в .env
# 3. Проверьте порт (обычно 5432)
# 4. Проверьте права пользователя
```

#### "password authentication failed"

**Проблема:** Неверный пароль в DATABASE_URL.

**Решение:**
```bash
# Docker - используйте trust метод:
docker run --name scorm-postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=scorm_db \
  -p 5432:5432 \
  -d postgres:15

# Локальный - сбросьте пароль или используйте правильный
```

#### "relation does not exist"

**Проблема:** Таблицы не созданы в базе данных.

**Решение:**
```bash
npm run db:push
```

### Сборка и запуск

#### "MODULE_NOT_FOUND" ошибки

**Проблема:** Не установлены зависимости.

**Решение:**
```bash
rm -rf node_modules package-lock.json
npm install
```

#### "PORT already in use"

**Проблема:** Порт 5000 уже занят.

**Решение:**
```bash
# Измените порт в .env
PORT=3000

# Или найдите процесс и убейте его
# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# macOS/Linux:
lsof -ti:5000 | xargs kill -9
```

#### TypeScript ошибки в Windows

**Проблема:** Ошибки с путями Windows в ESM.

**Решение:**
Уже исправлено в `package.json`:
```json
"dev": "cross-env NODE_ENV=development tsx watch ./server/index.ts"
```

### Фронтенд

#### Белый экран после сборки

**Проблема:** Неправильные пути к статике.

**Решение:**
```bash
# 1. Проверьте что файлы собраны
ls dist/public/

# 2. Проверьте vite.config.ts base path

# 3. Пересоберите
npm run build
```

#### HMR не работает в dev режиме

**Проблема:** Vite HMR не обновляет изменения.

**Решение:**
```bash
# 1. Перезапустите dev сервер
# 2. Очистите кэш браузера
# 3. Проверьте что файлы в client/src/
```

### Аутентификация

#### "Unauthorized" при запросах к API

**Проблема:** Сессия не сохраняется.

**Решение:**
```typescript
// Проверьте что в queryClient.ts используется:
credentials: "include"

// В fetch запросах:
fetch(url, {
  credentials: "include",
  // ...
})
```

#### Постоянный logout

**Проблема:** Сессии сбрасываются.

**Решение:**
```bash
# 1. Проверьте SESSION_SECRET в .env
# 2. Проверьте что express-session настроен правильно
# 3. В production используйте connect-pg-simple вместо memorystore
```

---

## 🗺 Roadmap

### v1.1 (В разработке)
- [ ] Перемешивание вариантов ответов
- [ ] Валидация выбора ответа перед отправкой
- [ ] Таймер обратного отсчета для тестов
- [ ] Автосохранение прогресса

### v1.2 (Планируется)
- [ ] Медиа в вопросах (изображения, аудио, видео)
- [ ] Редактор формул (LaTeX)
- [ ] Экспорт результатов в PDF
- [ ] Email уведомления

### v2.0 (Будущее)
- [ ] Адаптивные тесты (IRT)
- [ ] Социальное обучение (комментарии, обсуждения)
- [ ] Интеграция с внешними курсами (Coursera, Udemy)
- [ ] Мобильное приложение
- [ ] Поддержка SCORM 1.2 и xAPI (Tin Can)

### Идеи для контрибуции
- Локализация на другие языки
- Темы оформления (светлая/темная уже есть)
- Импорт из других форматов (QTI, Moodle XML)
- AI-генерация вопросов
- Plagiarism detection

---

## 🤝 Контрибуция

Мы приветствуем вклад в проект! Вот как вы можете помочь:

### Reporting Bugs

1. Проверьте что баг еще не зарепорчен в Issues
2. Создайте новый Issue с:
   - Описанием проблемы
   - Шагами для воспроизведения
   - Ожидаемым поведением
   - Скриншотами (если применимо)
   - Версией Node.js и ОС

### Suggesting Features

1. Опишите фичу и зачем она нужна
2. Приведите примеры использования
3. Опишите альтернативы (если есть)

### Pull Requests

1. Fork проекта
2. Создайте feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit изменения (`git commit -m 'Add some AmazingFeature'`)
4. Push в branch (`git push origin feature/AmazingFeature`)
5. Откройте Pull Request

### Code Style

- Используйте TypeScript
- Следуйте существующему стилю кода
- Добавляйте комментарии для сложной логики
- Пишите чистые, понятные имена переменных

---

## 📄 Лицензия

MIT License

Copyright (c) 2024 SCORM Test Constructor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 📞 Контакты и поддержка

- **GitHub Issues**: [Create an issue](https://github.com/your-repo/issues)
- **Email**: support@scorm-test-constructor.example
- **Documentation**: [Full docs](https://docs.scorm-test-constructor.example)

---

## 🙏 Благодарности

- [shadcn/ui](https://ui.shadcn.com/) - за отличные UI компоненты
- [Drizzle ORM](https://orm.drizzle.team/) - за типобезопасную работу с БД
- [Vite](https://vitejs.dev/) - за быструю сборку
- [React](https://react.dev/) - за мощный UI фреймворк

---

**Сделано с ❤️ для образования**
