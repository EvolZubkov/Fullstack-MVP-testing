# Code Review Report: SCORM Test Constructor

**Дата:** 2026-02-05
**Версия:** 1.0
**Проект:** SCORM Test Constructor - веб-приложение для создания интерактивных тестов с SCORM 2004 4th Edition экспортом

---

## Содержание

1. [Общая информация](#1-общая-информация)
2. [Критические проблемы безопасности](#2-критические-проблемы-безопасности)
3. [Архитектурные проблемы бэкенда](#3-архитектурные-проблемы-бэкенда)
4. [Архитектурные проблемы фронтенда](#4-архитектурные-проблемы-фронтенда)
5. [Проблемы валидации данных](#5-проблемы-валидации-данных)
6. [Проблемы производительности](#6-проблемы-производительности)
7. [Отсутствующие компоненты](#7-отсутствующие-компоненты)
8. [Метрики качества кода](#8-метрики-качества-кода)
9. [План исправлений](#9-план-исправлений)

---

## 1. Общая информация

### 1.1 Технологический стек

| Слой | Технологии |
| ---- | ---------- |
| Frontend | React 18, Vite 5, Wouter, TanStack Query, Tailwind CSS, Radix UI |
| Backend | Express 4, TypeScript 5.6, Drizzle ORM, PostgreSQL |
| Shared | Zod validation schemas, Drizzle-Zod integration |
| Build | esbuild (backend), Vite (frontend), tsx (dev) |

### 1.2 Структура проекта

```text
project/
  client/           # React frontend
    src/
      components/   # UI components (50+ Radix wrappers)
      pages/        # Author and Learner pages
      lib/          # Auth context, API client, i18n
      hooks/        # Custom React hooks
  server/           # Express backend
    routes.ts       # All API endpoints (6054 lines)
    storage.ts      # Database operations (1057 lines)
    scorm/          # SCORM 2004 package generation
    utils/          # Crypto, email utilities
  shared/           # Shared schemas and types
    schema.ts       # Drizzle tables + Zod schemas
```

### 1.3 Статистика кодовой базы

| Компонент | Файлов | Строк кода | Проблемных файлов |
| --------- | ------ | ---------- | ----------------- |
| Backend | 18 | ~8000 | routes.ts (6054 lines) |
| Frontend | 60+ | ~15000 | take-test.tsx (2111), tests.tsx (1593), questions.tsx (1470) |
| Shared | 1 | ~750 | schema.ts (без JSON validation) |

---

## 2. Критические проблемы безопасности

### 2.1 Default Encryption Keys

**Файл:** `server/utils/crypto.ts:4-5`

**Суть проблемы:**

Криптографические ключи для шифрования email-адресов имеют значения по умолчанию, которые используются если переменные окружения не установлены:

```typescript
const ENCRYPTION_PASSWORD = process.env.ENCRYPTION_PASSWORD || "default-encryption-key-change-me";
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || "default-salt-change-me";
```

**Последствия:**

- Если сервер запущен без установленных переменных окружения, все email-адреса шифруются одинаковым ключом
- Злоумышленник, знающий исходный код, может расшифровать все email-адреса в базе данных
- Нарушение GDPR - персональные данные не защищены должным образом

**Решение:**

```typescript
// server/utils/crypto.ts

const ENCRYPTION_PASSWORD = process.env.ENCRYPTION_PASSWORD;
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;

if (!ENCRYPTION_PASSWORD || !ENCRYPTION_SALT) {
  throw new Error(
    "CRITICAL: ENCRYPTION_PASSWORD and ENCRYPTION_SALT environment variables must be set. " +
    "Generate secure values using: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}
```

---

### 2.2 Default Session Secret

**Файл:** `server/routes.ts:116`

**Суть проблемы:**

Session secret имеет значение по умолчанию:

```typescript
app.use(
  session({
    secret: process.env.SESSION_SECRET || "scorm-test-constructor-secret",
    // ...
  })
);
```

**Последствия:**

- Session cookies могут быть подделаны злоумышленником
- Возможен session hijacking - захват сессий других пользователей
- Полный доступ к аккаунтам без пароля

**Решение:**

```typescript
// server/index.ts - добавить проверку при старте

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error(
    "CRITICAL: SESSION_SECRET environment variable must be set. " +
    "Generate using: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
  );
}

// server/routes.ts
app.use(
  session({
    secret: process.env.SESSION_SECRET!, // Non-null assertion after validation
    // ...
  })
);
```

---

### 2.3 CORS Misconfiguration

**Файл:** `server/routes.ts:102-111`

**Суть проблемы:**

SCORM telemetry endpoints открыты для запросов с любого домена:

```typescript
app.use("/api/scorm-telemetry", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  // ...
});
```

**Последствия:**

- Любой сайт может отправлять запросы к SCORM telemetry API
- Возможна подделка данных телеметрии
- Потенциальная утечка информации о тестах и результатах

**Решение:**

```typescript
// server/routes.ts

// Разрешенные origins для SCORM пакетов (LMS домены)
const ALLOWED_SCORM_ORIGINS = process.env.ALLOWED_SCORM_ORIGINS?.split(",") || [];

app.use("/api/scorm-telemetry", (req, res, next) => {
  const origin = req.headers.origin;

  // Проверка origin против whitelist
  if (origin && ALLOWED_SCORM_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else if (process.env.NODE_ENV === "development") {
    // В development режиме разрешаем localhost
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  // В production без валидного origin - CORS ошибка

  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-SCORM-Package-Id");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
```

---

### 2.4 Insecure Session Cookies

**Файл:** `server/routes.ts:118-122`

**Суть проблемы:**

Session cookies передаются по HTTP без флага secure:

```typescript
cookie: {
  secure: false,
  maxAge: 24 * 60 * 60 * 1000,
}
```

**Последствия:**

- Session cookie может быть перехвачена при Man-in-the-Middle атаке
- Отсутствие httpOnly (неявный) и sameSite флагов увеличивает риск XSS и CSRF

**Решение:**

```typescript
// server/routes.ts

const isProduction = process.env.NODE_ENV === "production";

app.use(
  session({
    // ... other options
    cookie: {
      secure: isProduction,           // HTTPS only in production
      httpOnly: true,                 // Prevent XSS access to cookie
      sameSite: "lax",               // CSRF protection
      maxAge: 24 * 60 * 60 * 1000,   // 24 hours
    },
  })
);

// Также добавить trust proxy если за reverse proxy
if (isProduction) {
  app.set("trust proxy", 1);
}
```

---

### 2.5 No Input Validation

**Файл:** `server/routes.ts` - все endpoints

**Суть проблемы:**

Входные данные не валидируются через Zod schemas, используются только базовые проверки:

```typescript
// Текущий код (плохо)
app.post("/api/users", requireAuthor, async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  // Нет проверки формата email
  // Нет проверки сложности пароля
  // Нет проверки допустимых значений role
  // ...
});
```

**Последствия:**

- Некорректные данные могут попасть в базу
- Потенциальные injection атаки (хотя Drizzle ORM защищает от SQL injection)
- Runtime ошибки при обработке невалидных данных

**Решение:**

```typescript
// shared/schema.ts - добавить validation schemas

import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string()
    .email("Invalid email format")
    .max(255, "Email too long"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long")
    .regex(/[A-Z]/, "Password must contain uppercase letter")
    .regex(/[a-z]/, "Password must contain lowercase letter")
    .regex(/[0-9]/, "Password must contain number"),
  role: z.enum(["author", "learner"]),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// server/routes.ts - использовать validation

import { createUserSchema } from "@shared/schema";

app.post("/api/users", requireAuthor, async (req, res) => {
  // Валидация входных данных
  const parseResult = createUserSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parseResult.error.flatten().fieldErrors
    });
  }

  const { email, password, role, firstName, lastName } = parseResult.data;

  // Теперь данные гарантированно валидны
  // ...
});
```

---

### 2.6 Password Reset Token in Logs

**Файл:** `server/email.ts:44-48`

**Суть проблемы:**

Когда SMTP не настроен, токен сброса пароля выводится в консоль:

```typescript
console.log("===========================================");
console.log("PASSWORD RESET LINK (SMTP not configured):");
console.log(resetLink);
console.log("===========================================");
```

**Последствия:**

- Токен может попасть в лог-файлы сервера
- Администраторы с доступом к логам могут сбросить пароль любого пользователя
- При использовании cloud logging (CloudWatch, Stackdriver) токены хранятся в облаке

**Решение:**

```typescript
// server/email.ts

export async function sendPasswordResetEmail(email: string, resetLink: string): Promise<boolean> {
  if (!isSmtpConfigured()) {
    // В development - использовать безопасный вывод
    if (process.env.NODE_ENV === "development") {
      console.log("===========================================");
      console.log("PASSWORD RESET (SMTP not configured)");
      console.log("Email:", maskEmail(email));
      console.log("Token expires in 1 hour");
      console.log("Check server startup logs for dev token output");
      console.log("===========================================");

      // Вывести токен только при первом запуске в специальный dev-only файл
      const devTokensFile = path.join(process.cwd(), ".dev-tokens.log");
      fs.appendFileSync(devTokensFile, `${new Date().toISOString()} | ${email} | ${resetLink}\n`);

      return true;
    }

    // В production без SMTP - ошибка
    console.error("SMTP not configured in production - password reset unavailable");
    return false;
  }

  // Отправка через SMTP
  // ...
}
```

---

### 2.7 Weak Random for Shuffling

**Файл:** `server/routes.ts:2005`

**Суть проблемы:**

Для перемешивания вопросов используется `Math.random()`:

```typescript
const shuffled = levelQuestions.sort(() => Math.random() - 0.5);
```

**Последствия:**

- `Math.random()` не является криптографически безопасным
- Последовательность вопросов может быть предсказуема
- В адаптивном тестировании это может позволить угадать следующий вопрос

**Решение:**

```typescript
// server/utils/shuffle.ts

import { randomBytes } from "crypto";

/**
 * Cryptographically secure Fisher-Yates shuffle.
 * @param array - Array to shuffle
 * @returns New shuffled array
 */
export function secureShuffle<T>(array: T[]): T[] {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    // Генерируем криптографически безопасное случайное число
    const randomBuffer = randomBytes(4);
    const randomValue = randomBuffer.readUInt32BE(0);
    const j = randomValue % (i + 1);

    // Меняем местами
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

// server/routes.ts - использование
import { secureShuffle } from "./utils/shuffle";

const shuffled = secureShuffle(levelQuestions);
const selected = shuffled.slice(0, level.questionsCount);
```

---

## 3. Архитектурные проблемы бэкенда

### 3.1 Monolithic routes.ts (6054 lines)

**Файл:** `server/routes.ts`

**Суть проблемы:**

Все 100+ API endpoints находятся в одном файле размером 6054 строк:

- Невозможно быстро найти нужный endpoint
- Merge conflicts при работе нескольких разработчиков
- Невозможно тестировать отдельные модули
- Дублирование кода обработки ошибок (90+ try-catch блоков)
- Смешение бизнес-логики и HTTP обработки

**Решение:**

Разбить на модули по доменам:

```text
server/
  routes/
    index.ts          # Aggregator - собирает все роуты
    auth.ts           # POST /api/auth/login, logout, etc.
    users.ts          # GET/POST/PUT /api/users
    groups.ts         # GET/POST/PUT/DELETE /api/groups
    topics.ts         # GET/POST/PUT/DELETE /api/topics
    questions.ts      # GET/POST/PUT/DELETE /api/questions
    tests.ts          # GET/POST/PUT/DELETE /api/tests
    attempts.ts       # Start, answer, finish attempts
    adaptive.ts       # Adaptive testing endpoints
    scorm.ts          # SCORM export and telemetry
    analytics.ts      # Analytics and reports
    media.ts          # File uploads
  middleware/
    auth.ts           # requireAuth, requireAuthor, requireLearner
    validation.ts     # Zod validation middleware
    error-handler.ts  # Centralized error handling
  services/
    auth.service.ts   # Authentication business logic
    test.service.ts   # Test management logic
    attempt.service.ts # Attempt processing logic
```

**Пример структуры модуля:**

```typescript
// server/routes/users.ts

import { Router } from "express";
import { z } from "zod";
import { requireAuthor } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { storage } from "../storage";
import { createUserSchema, updateUserSchema } from "@shared/schema";

const router = Router();

/**
 * GET /api/users - List all users (author only)
 */
router.get("/", requireAuthor, async (req, res, next) => {
  try {
    const users = await storage.getUsers();
    res.json(users);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users - Create new user (author only)
 */
router.post("/", requireAuthor, validate(createUserSchema), async (req, res, next) => {
  try {
    const user = await storage.createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/:id - Get user by ID
 */
router.get("/:id", requireAuthor, async (req, res, next) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

export default router;

// server/routes/index.ts

import { Express } from "express";
import usersRouter from "./users";
import authRouter from "./auth";
import testsRouter from "./tests";
// ... other imports

export function registerRoutes(app: Express): void {
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/tests", testsRouter);
  // ... other routes
}
```

---

### 3.2 No Layered Architecture

**Суть проблемы:**

Бизнес-логика смешана с HTTP обработкой в routes.ts:

```typescript
// Текущий код - всё в одном месте
app.post("/api/tests/:testId/attempts/start", requireAuth, async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.session.userId!;

    // HTTP validation
    const test = await storage.getTest(testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    // Business logic mixed with HTTP
    const existingAttempts = await storage.getAttemptsByUserAndTest(userId, testId);
    if (test.maxAttempts && existingAttempts.length >= test.maxAttempts) {
      return res.status(400).json({ error: "Max attempts reached" });
    }

    // More business logic...
    const sections = await storage.getTestSections(testId);
    const variant = { sections: [] };
    for (const section of sections) {
      // Complex variant generation logic...
    }

    // Database operation
    const attempt = await storage.createAttempt({...});

    res.json(attempt);
  } catch (error) {
    res.status(500).json({ error: "Failed to start test" });
  }
});
```

**Решение:**

Разделить на слои Controller -> Service -> Repository:

```typescript
// server/services/attempt.service.ts

import { storage } from "../storage";
import { secureShuffle } from "../utils/shuffle";
import { AppError } from "../utils/errors";

export class AttemptService {
  /**
   * Start a new test attempt for user.
   * @throws AppError if test not found, not assigned, or max attempts reached
   */
  async startAttempt(userId: string, testId: string): Promise<AttemptWithQuestions> {
    // Get test
    const test = await storage.getTest(testId);
    if (!test) {
      throw new AppError("Test not found", 404);
    }

    // Check assignment
    const isAssigned = await this.isTestAssignedToUser(userId, testId);
    if (!isAssigned) {
      throw new AppError("Test not assigned to user", 403);
    }

    // Check max attempts
    const existingAttempts = await storage.getAttemptsByUserAndTest(userId, testId);
    if (test.maxAttempts && existingAttempts.length >= test.maxAttempts) {
      throw new AppError("Maximum attempts reached", 400);
    }

    // Generate variant
    const variant = await this.generateTestVariant(test);

    // Create attempt
    const attempt = await storage.createAttempt({
      userId,
      testId,
      variantJson: variant,
      startedAt: new Date(),
    });

    // Load questions for variant
    return this.loadAttemptWithQuestions(attempt);
  }

  private async generateTestVariant(test: Test): Promise<TestVariant> {
    const sections = await storage.getTestSections(test.id);
    const variantSections = [];

    for (const section of sections) {
      const questions = await storage.getQuestionsByTopic(section.topicId);
      const shuffled = secureShuffle(questions);
      const selected = shuffled.slice(0, section.drawCount || questions.length);

      variantSections.push({
        topicId: section.topicId,
        topicName: section.topic?.name || "",
        questionIds: selected.map(q => q.id),
      });
    }

    return { sections: variantSections };
  }

  // ... other methods
}

export const attemptService = new AttemptService();

// server/routes/attempts.ts

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { attemptService } from "../services/attempt.service";

const router = Router();

router.post("/tests/:testId/attempts/start", requireAuth, async (req, res, next) => {
  try {
    const attempt = await attemptService.startAttempt(
      req.session.userId!,
      req.params.testId
    );
    res.status(201).json(attempt);
  } catch (error) {
    next(error);
  }
});

export default router;
```

---

### 3.3 Console.log Instead of Proper Logging

**Файл:** `server/routes.ts` - 45+ вызовов console.log/error

**Суть проблемы:**

Используется console.log вместо структурированного логгера:

```typescript
console.log("User logged in:", email);
console.error("Failed to create user:", error);
```

**Последствия:**

- Нет уровней логирования (debug, info, warn, error)
- Нет структурированных данных для анализа
- Нет ротации логов
- Сложно фильтровать и искать в логах

**Решение:**

```typescript
// server/utils/logger.ts

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  transport: isProduction
    ? undefined
    : { target: "pino-pretty", options: { colorize: true } },
  redact: {
    paths: ["password", "token", "secret", "authorization"],
    censor: "[REDACTED]",
  },
});

// Child loggers for different modules
export const authLogger = logger.child({ module: "auth" });
export const testLogger = logger.child({ module: "test" });
export const scormLogger = logger.child({ module: "scorm" });

// server/routes/auth.ts - использование

import { authLogger } from "../utils/logger";

router.post("/login", async (req, res, next) => {
  const { email } = req.body;

  authLogger.info({ email: maskEmail(email) }, "Login attempt");

  try {
    const user = await authService.login(email, password);
    authLogger.info({ userId: user.id, role: user.role }, "Login successful");
    res.json(user);
  } catch (error) {
    authLogger.warn({ email: maskEmail(email), error: error.message }, "Login failed");
    next(error);
  }
});
```

---

### 3.4 Error Handler Throws After Response

**Файл:** `server/index.ts:85-91`

**Суть проблемы:**

Global error handler бросает исключение после отправки ответа:

```typescript
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
  throw err; // BUG: После res.json() - может привести к проблемам
});
```

**Последствия:**

- Uncaught exception после отправки ответа
- Потенциальный crash процесса
- Логи могут быть некорректными

**Решение:**

```typescript
// server/middleware/error-handler.ts

import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { AppError } from "../utils/errors";
import { ZodError } from "zod";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Логируем ошибку
  logger.error({
    err,
    method: req.method,
    url: req.url,
    userId: req.session?.userId,
  }, "Request error");

  // Определяем статус и сообщение
  let status = 500;
  let message = "Internal Server Error";
  let details: Record<string, unknown> | undefined;

  if (err instanceof AppError) {
    status = err.statusCode;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = "Validation Error";
    details = err.flatten().fieldErrors;
  } else if (err.name === "UnauthorizedError") {
    status = 401;
    message = "Unauthorized";
  }

  // В production не раскрываем детали 500 ошибок
  if (status === 500 && process.env.NODE_ENV === "production") {
    message = "Internal Server Error";
    details = undefined;
  }

  // Отправляем ответ (только если еще не отправлен)
  if (!res.headersSent) {
    res.status(status).json({
      error: message,
      ...(details && { details }),
    });
  }

  // НЕ бросаем исключение после ответа
}

// server/utils/errors.ts

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}
```

---

## 4. Архитектурные проблемы фронтенда

### 4.1 God Components

**Файлы:**

- `client/src/pages/learner/take-test.tsx` - 2111 строк
- `client/src/pages/author/tests.tsx` - 1593 строки
- `client/src/pages/author/questions.tsx` - 1470 строк

**Суть проблемы:**

Компоненты содержат слишком много логики и состояния:

```typescript
// take-test.tsx - 30+ useState вызовов
const [isStarting, setIsStarting] = useState(true);
const [testMode, setTestMode] = useState<"standard" | "adaptive" | null>(null);
const [testInfo, setTestInfo] = useState<Test | null>(null);
const [phase, setPhase] = useState<"loading" | "start" | "question" | "finished">("loading");
const [attempt, setAttempt] = useState<AttemptWithQuestions | null>(null);
const [currentIndex, setCurrentIndex] = useState(0);
const [answers, setAnswers] = useState<Record<string, any>>({});
const [adaptiveState, setAdaptiveState] = useState<AdaptiveState | null>(null);
const [showTransition, setShowTransition] = useState(false);
const [feedbackShown, setFeedbackShown] = useState(false);
const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
// ... еще 20+ состояний
```

**Последствия:**

- Сложно понять логику компонента
- Невозможно переиспользовать части логики
- Каждое изменение состояния перерисовывает весь компонент
- Трудно тестировать

**Решение:**

Разбить на подкомпоненты и custom hooks:

```typescript
// client/src/hooks/useTestAttempt.ts

import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface UseTestAttemptOptions {
  testId: string;
  onComplete?: (result: AttemptResult) => void;
}

interface UseTestAttemptReturn {
  // State
  phase: "loading" | "start" | "question" | "finished";
  attempt: AttemptWithQuestions | null;
  currentQuestion: Question | null;
  currentIndex: number;
  totalQuestions: number;
  answers: Record<string, unknown>;
  result: AttemptResult | null;
  isLoading: boolean;
  error: Error | null;

  // Actions
  startAttempt: () => Promise<void>;
  submitAnswer: (questionId: string, answer: unknown) => Promise<void>;
  goToQuestion: (index: number) => void;
  finishAttempt: () => Promise<void>;
}

export function useTestAttempt({ testId, onComplete }: UseTestAttemptOptions): UseTestAttemptReturn {
  const [phase, setPhase] = useState<"loading" | "start" | "question" | "finished">("loading");
  const [attempt, setAttempt] = useState<AttemptWithQuestions | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);

  // Load test info
  const { data: testInfo, isLoading: testLoading } = useQuery({
    queryKey: ["/api/tests", testId],
    queryFn: () => apiRequest("GET", `/api/tests/${testId}`).then(r => r.json()),
  });

  // Start attempt mutation
  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tests/${testId}/attempts/start`).then(r => r.json()),
    onSuccess: (data) => {
      setAttempt(data);
      setPhase("question");
    },
  });

  // Submit answer mutation
  const answerMutation = useMutation({
    mutationFn: ({ questionId, answer }: { questionId: string; answer: unknown }) =>
      apiRequest("POST", `/api/attempts/${attempt!.id}/answer`, { questionId, answer }),
    onSuccess: (_, { questionId, answer }) => {
      setAnswers(prev => ({ ...prev, [questionId]: answer }));
    },
  });

  // Finish attempt mutation
  const finishMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/attempts/${attempt!.id}/finish`).then(r => r.json()),
    onSuccess: (data) => {
      setResult(data);
      setPhase("finished");
      onComplete?.(data);
    },
  });

  // Computed values
  const currentQuestion = attempt?.questions[currentIndex] ?? null;
  const totalQuestions = attempt?.questions.length ?? 0;

  // Actions
  const startAttempt = useCallback(() => startMutation.mutateAsync(), [startMutation]);

  const submitAnswer = useCallback(
    (questionId: string, answer: unknown) => answerMutation.mutateAsync({ questionId, answer }),
    [answerMutation]
  );

  const goToQuestion = useCallback((index: number) => {
    if (index >= 0 && index < totalQuestions) {
      setCurrentIndex(index);
    }
  }, [totalQuestions]);

  const finishAttempt = useCallback(() => finishMutation.mutateAsync(), [finishMutation]);

  return {
    phase,
    attempt,
    currentQuestion,
    currentIndex,
    totalQuestions,
    answers,
    result,
    isLoading: testLoading || startMutation.isPending || finishMutation.isPending,
    error: startMutation.error || answerMutation.error || finishMutation.error,
    startAttempt,
    submitAnswer,
    goToQuestion,
    finishAttempt,
  };
}

// client/src/pages/learner/take-test.tsx - упрощенный компонент

import { useTestAttempt } from "@/hooks/useTestAttempt";
import { TestStartScreen } from "@/components/test/TestStartScreen";
import { TestQuestion } from "@/components/test/TestQuestion";
import { TestResult } from "@/components/test/TestResult";
import { TestTimer } from "@/components/test/TestTimer";

export default function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();

  const {
    phase,
    attempt,
    currentQuestion,
    currentIndex,
    totalQuestions,
    answers,
    result,
    isLoading,
    startAttempt,
    submitAnswer,
    goToQuestion,
    finishAttempt,
  } = useTestAttempt({ testId: testId! });

  if (phase === "loading" || isLoading) {
    return <LoadingSpinner />;
  }

  if (phase === "start") {
    return <TestStartScreen onStart={startAttempt} />;
  }

  if (phase === "finished" && result) {
    return <TestResult result={result} />;
  }

  return (
    <div className="flex flex-col h-full">
      <TestTimer attempt={attempt} onExpire={finishAttempt} />

      <TestQuestion
        question={currentQuestion}
        answer={answers[currentQuestion?.id ?? ""]}
        onAnswer={(answer) => submitAnswer(currentQuestion!.id, answer)}
        onNext={() => goToQuestion(currentIndex + 1)}
        onPrev={() => goToQuestion(currentIndex - 1)}
        isFirst={currentIndex === 0}
        isLast={currentIndex === totalQuestions - 1}
      />

      <TestProgress
        current={currentIndex + 1}
        total={totalQuestions}
        answers={answers}
        onNavigate={goToQuestion}
      />

      {currentIndex === totalQuestions - 1 && (
        <Button onClick={finishAttempt}>Finish Test</Button>
      )}
    </div>
  );
}
```

---

### 4.2 Duplicated CRUD Logic

**Файлы:** Все страницы author/ содержат повторяющийся код

**Суть проблемы:**

В каждой странице идентичный паттерн создания mutations:

```typescript
// topics.tsx, questions.tsx, tests.tsx, users.tsx - везде одинаково
const createMutation = useMutation({
  mutationFn: (data: any) => apiRequest("POST", "/api/topics", data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
    setIsDialogOpen(false);
    toast({ title: "Topic created" });
  },
  onError: () => {
    toast({ variant: "destructive", title: "Failed to create topic" });
  },
});

const updateMutation = useMutation({
  mutationFn: ({ id, data }: { id: string; data: any }) =>
    apiRequest("PUT", `/api/topics/${id}`, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
    setIsDialogOpen(false);
    toast({ title: "Topic updated" });
  },
  onError: () => {
    toast({ variant: "destructive", title: "Failed to update topic" });
  },
});

// ... аналогично для delete
```

**Решение:**

Создать фабрику CRUD hooks:

```typescript
// client/src/hooks/useCrudMutations.ts

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CrudConfig<TCreate, TUpdate> {
  baseUrl: string;
  queryKey: string[];
  entityName: string;
  onCreateSuccess?: () => void;
  onUpdateSuccess?: () => void;
  onDeleteSuccess?: () => void;
}

interface CrudMutations<TCreate, TUpdate, TEntity> {
  createMutation: UseMutationResult<TEntity, Error, TCreate>;
  updateMutation: UseMutationResult<TEntity, Error, { id: string; data: TUpdate }>;
  deleteMutation: UseMutationResult<void, Error, string>;
}

export function useCrudMutations<TCreate, TUpdate, TEntity>(
  config: CrudConfig<TCreate, TUpdate>
): CrudMutations<TCreate, TUpdate, TEntity> {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { baseUrl, queryKey, entityName } = config;

  const createMutation = useMutation({
    mutationFn: async (data: TCreate): Promise<TEntity> => {
      const res = await apiRequest("POST", baseUrl, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: `${entityName} created successfully` });
      config.onCreateSuccess?.();
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: `Failed to create ${entityName.toLowerCase()}`,
        description: error.message,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TUpdate }): Promise<TEntity> => {
      const res = await apiRequest("PUT", `${baseUrl}/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: `${entityName} updated successfully` });
      config.onUpdateSuccess?.();
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: `Failed to update ${entityName.toLowerCase()}`,
        description: error.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiRequest("DELETE", `${baseUrl}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: `${entityName} deleted successfully` });
      config.onDeleteSuccess?.();
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: `Failed to delete ${entityName.toLowerCase()}`,
        description: error.message,
      });
    },
  });

  return { createMutation, updateMutation, deleteMutation };
}

// client/src/pages/author/topics.tsx - использование

import { useCrudMutations } from "@/hooks/useCrudMutations";
import { CreateTopicInput, UpdateTopicInput, Topic } from "@shared/schema";

export default function TopicsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { createMutation, updateMutation, deleteMutation } = useCrudMutations<
    CreateTopicInput,
    UpdateTopicInput,
    Topic
  >({
    baseUrl: "/api/topics",
    queryKey: ["/api/topics"],
    entityName: "Topic",
    onCreateSuccess: () => setIsDialogOpen(false),
    onUpdateSuccess: () => setIsDialogOpen(false),
  });

  // Теперь код страницы значительно короче
  // ...
}
```

---

### 4.3 No React Query Key Factory

**Файлы:** Все файлы с useQuery

**Суть проблемы:**

Query keys разбросаны по коду как строки:

```typescript
// В разных файлах
useQuery({ queryKey: ["/api/topics"] });
useQuery({ queryKey: ["/api/topics", topicId] });
useQuery({ queryKey: ["/api/questions"] });
queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
```

**Последствия:**

- Опечатки в query keys не отлавливаются
- Трудно понять иерархию кэша
- Invalidation может не работать корректно

**Решение:**

```typescript
// client/src/lib/queryKeys.ts

export const queryKeys = {
  // Topics
  topics: {
    all: ["topics"] as const,
    lists: () => [...queryKeys.topics.all, "list"] as const,
    list: (filters?: TopicFilters) => [...queryKeys.topics.lists(), filters] as const,
    details: () => [...queryKeys.topics.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.topics.details(), id] as const,
  },

  // Questions
  questions: {
    all: ["questions"] as const,
    lists: () => [...queryKeys.questions.all, "list"] as const,
    list: (filters?: QuestionFilters) => [...queryKeys.questions.lists(), filters] as const,
    details: () => [...queryKeys.questions.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.questions.details(), id] as const,
    byTopic: (topicId: string) => [...queryKeys.questions.all, "topic", topicId] as const,
  },

  // Tests
  tests: {
    all: ["tests"] as const,
    lists: () => [...queryKeys.tests.all, "list"] as const,
    list: (filters?: TestFilters) => [...queryKeys.tests.lists(), filters] as const,
    details: () => [...queryKeys.tests.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.tests.details(), id] as const,
    sections: (testId: string) => [...queryKeys.tests.detail(testId), "sections"] as const,
  },

  // Attempts
  attempts: {
    all: ["attempts"] as const,
    byTest: (testId: string) => [...queryKeys.attempts.all, "test", testId] as const,
    byUser: (userId: string) => [...queryKeys.attempts.all, "user", userId] as const,
    detail: (attemptId: string) => [...queryKeys.attempts.all, attemptId] as const,
  },

  // Analytics
  analytics: {
    all: ["analytics"] as const,
    test: (testId: string) => [...queryKeys.analytics.all, "test", testId] as const,
    combined: () => [...queryKeys.analytics.all, "combined"] as const,
  },

  // Users
  users: {
    all: ["users"] as const,
    lists: () => [...queryKeys.users.all, "list"] as const,
    detail: (id: string) => [...queryKeys.users.all, id] as const,
    me: () => [...queryKeys.users.all, "me"] as const,
  },
};

// Использование
import { queryKeys } from "@/lib/queryKeys";

// Запросы
useQuery({
  queryKey: queryKeys.topics.list(),
  queryFn: () => fetchTopics(),
});

useQuery({
  queryKey: queryKeys.questions.byTopic(topicId),
  queryFn: () => fetchQuestionsByTopic(topicId),
});

// Invalidation - теперь type-safe
queryClient.invalidateQueries({ queryKey: queryKeys.topics.all });
queryClient.invalidateQueries({ queryKey: queryKeys.questions.byTopic(topicId) });
```

---

### 4.4 Incorrect React Query Configuration

**Файл:** `client/src/lib/queryClient.ts`

**Суть проблемы:**

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // Данные никогда не считаются устаревшими
      retry: false,        // Нет повторных попыток при ошибках
    },
  },
});
```

**Последствия:**

- Данные не обновляются автоматически даже если изменились на сервере
- Сетевые ошибки не обрабатываются (нет retry)
- Пользователь видит устаревшие данные

**Решение:**

```typescript
// client/src/lib/queryClient.ts

import { QueryClient, QueryClientConfig } from "@tanstack/react-query";

const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // Разные staleTime для разных типов данных
      staleTime: 5 * 60 * 1000, // 5 минут по умолчанию

      // Retry с экспоненциальной задержкой
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Refetch при возврате на вкладку
      refetchOnWindowFocus: true,

      // Не refetch при mount если данные свежие
      refetchOnMount: true,
    },
    mutations: {
      // Retry mutations только для сетевых ошибок
      retry: (failureCount, error) => {
        if (failureCount >= 3) return false;
        // Retry только для network errors, не для 4xx/5xx
        return error instanceof TypeError && error.message === "Failed to fetch";
      },
    },
  },
};

export const queryClient = new QueryClient(queryClientConfig);

// Для конкретных запросов можно переопределить staleTime
// Например, для аналитики - 1 минута, для справочников - 30 минут

// client/src/pages/author/analytics.tsx
useQuery({
  queryKey: queryKeys.analytics.test(testId),
  queryFn: fetchTestAnalytics,
  staleTime: 60 * 1000, // 1 минута для аналитики
});

// client/src/pages/author/topics.tsx
useQuery({
  queryKey: queryKeys.topics.list(),
  queryFn: fetchTopics,
  staleTime: 30 * 60 * 1000, // 30 минут для справочников
});
```

---

## 5. Проблемы валидации данных

### 5.1 No JSON Field Validation in Schema

**Файл:** `shared/schema.ts`

**Суть проблемы:**

JSON поля в базе данных не имеют валидации структуры:

```typescript
// Текущее определение
export const questions = pgTable("questions", {
  // ...
  dataJson: jsonb("data_json").notNull(),     // Может быть любым JSON
  correctJson: jsonb("correct_json").notNull(), // Может быть любым JSON
});

// insertQuestionSchema не валидирует содержимое JSON
export const insertQuestionSchema = createInsertSchema(questions).omit({ id: true });
```

**Последствия:**

- В базу могут попасть невалидные данные
- Runtime ошибки при чтении данных
- Несоответствие типов между разными типами вопросов

**Решение:**

```typescript
// shared/schema.ts - добавить типизированные схемы для JSON полей

import { z } from "zod";

// ============ Question Data Schemas ============

/**
 * Single choice question data.
 */
export const singleChoiceDataSchema = z.object({
  options: z.array(z.string().min(1)).min(2, "At least 2 options required"),
});

export const singleChoiceCorrectSchema = z.object({
  correctIndex: z.number().int().min(0),
});

/**
 * Multiple choice question data.
 */
export const multipleChoiceDataSchema = z.object({
  options: z.array(z.string().min(1)).min(2, "At least 2 options required"),
});

export const multipleChoiceCorrectSchema = z.object({
  correctIndices: z.array(z.number().int().min(0)).min(1, "At least 1 correct answer required"),
});

/**
 * Matching question data.
 */
export const matchingDataSchema = z.object({
  pairs: z.array(z.object({
    left: z.string().min(1),
    right: z.string().min(1),
  })).min(2, "At least 2 pairs required"),
});

export const matchingCorrectSchema = z.object({
  correctPairs: z.array(z.object({
    leftIndex: z.number().int().min(0),
    rightIndex: z.number().int().min(0),
  })),
});

/**
 * Ranking question data.
 */
export const rankingDataSchema = z.object({
  items: z.array(z.string().min(1)).min(2, "At least 2 items required"),
});

export const rankingCorrectSchema = z.object({
  correctOrder: z.array(z.number().int().min(0)),
});

/**
 * Discriminated union for all question types.
 */
export const questionDataSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("single"),
    data: singleChoiceDataSchema,
    correct: singleChoiceCorrectSchema,
  }),
  z.object({
    type: z.literal("multiple"),
    data: multipleChoiceDataSchema,
    correct: multipleChoiceCorrectSchema,
  }),
  z.object({
    type: z.literal("matching"),
    data: matchingDataSchema,
    correct: matchingCorrectSchema,
  }),
  z.object({
    type: z.literal("ranking"),
    data: rankingDataSchema,
    correct: rankingCorrectSchema,
  }),
]);

export type QuestionData = z.infer<typeof questionDataSchema>;

// ============ Attempt Variant Schemas ============

/**
 * Standard test variant structure.
 */
export const standardVariantSchema = z.object({
  mode: z.literal("standard").default("standard"),
  sections: z.array(z.object({
    topicId: z.string().uuid(),
    topicName: z.string(),
    questionIds: z.array(z.string().uuid()),
  })),
});

/**
 * Adaptive test variant structure.
 */
export const adaptiveVariantSchema = z.object({
  mode: z.literal("adaptive"),
  topics: z.array(z.object({
    topicId: z.string().uuid(),
    topicName: z.string(),
    levels: z.array(z.object({
      levelId: z.string().uuid(),
      questionIds: z.array(z.string().uuid()),
    })),
  })),
  currentTopicIndex: z.number().int().min(0),
  currentLevelIndex: z.number().int().min(0),
  currentQuestionIndex: z.number().int().min(0),
});

/**
 * Union of all variant types.
 */
export const variantSchema = z.union([standardVariantSchema, adaptiveVariantSchema]);
export type Variant = z.infer<typeof variantSchema>;

// ============ Pass Rule Schema ============

export const passRuleSchema = z.object({
  type: z.enum(["percentage", "count"]),
  value: z.number().min(0),
});

export type PassRule = z.infer<typeof passRuleSchema>;

// ============ Extended Insert Schemas ============

/**
 * Question creation schema with validated JSON fields.
 */
export const createQuestionSchema = z.object({
  topicId: z.string().uuid(),
  type: z.enum(["single", "multiple", "matching", "ranking"]),
  text: z.string().min(1, "Question text is required"),
  dataJson: z.unknown(), // Will be validated based on type
  correctJson: z.unknown(), // Will be validated based on type
  difficulty: z.number().int().min(0).max(100).optional(),
  mediaType: z.enum(["image", "audio", "video", ""]).optional(),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  explanation: z.string().optional(),
  feedbackMode: z.enum(["none", "correct_incorrect", "with_explanation"]).optional(),
}).refine((data) => {
  // Validate dataJson and correctJson based on type
  try {
    switch (data.type) {
      case "single":
        singleChoiceDataSchema.parse(data.dataJson);
        singleChoiceCorrectSchema.parse(data.correctJson);
        break;
      case "multiple":
        multipleChoiceDataSchema.parse(data.dataJson);
        multipleChoiceCorrectSchema.parse(data.correctJson);
        break;
      case "matching":
        matchingDataSchema.parse(data.dataJson);
        matchingCorrectSchema.parse(data.correctJson);
        break;
      case "ranking":
        rankingDataSchema.parse(data.dataJson);
        rankingCorrectSchema.parse(data.correctJson);
        break;
    }
    return true;
  } catch {
    return false;
  }
}, {
  message: "Invalid question data or correct answer structure for the specified type",
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

/**
 * Test creation schema with validated pass rules.
 */
export const createTestSchema = z.object({
  title: z.string().min(1, "Test title is required").max(255),
  description: z.string().optional(),
  mode: z.enum(["standard", "adaptive"]).default("standard"),
  timeLimit: z.number().int().min(0).optional(),
  maxAttempts: z.number().int().min(1).optional(),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  showResults: z.boolean().default(true),
  overallPassRuleJson: passRuleSchema,
  sections: z.array(z.object({
    topicId: z.string().uuid(),
    drawCount: z.number().int().min(1).optional(),
    topicPassRuleJson: passRuleSchema.optional(),
  })).min(1, "At least one section is required"),
});

export type CreateTestInput = z.infer<typeof createTestSchema>;
```

---

## 6. Проблемы производительности

### 6.1 N+1 Query Problem

**Файл:** `server/storage.ts:199-200`

**Суть проблемы:**

При получении списка пользователей выполняется N операций дешифрования:

```typescript
async getUsers(): Promise<User[]> {
  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  return Promise.all(
    allUsers.map(async (user) => ({
      ...user,
      email: await decryptEmail(user.email),
    }))
  );
}
```

**Последствия:**

- Для 1000 пользователей: 1 SQL запрос + 1000 async decrypt операций
- Время ответа растет линейно с количеством пользователей
- Высокая нагрузка на CPU при дешифровании

**Решение:**

```typescript
// server/utils/crypto.ts - добавить batch decryption

/**
 * Batch decrypt multiple emails.
 * More efficient than calling decryptEmail() in a loop.
 */
export async function decryptEmailBatch(encryptedEmails: string[]): Promise<string[]> {
  const crypto = await getCryptoInstance();

  // Process in parallel with concurrency limit
  const BATCH_SIZE = 50;
  const results: string[] = [];

  for (let i = 0; i < encryptedEmails.length; i += BATCH_SIZE) {
    const batch = encryptedEmails.slice(i, i + BATCH_SIZE);
    const decrypted = await Promise.all(
      batch.map(async (email) => {
        try {
          return await crypto.decrypt(email);
        } catch {
          return "";
        }
      })
    );
    results.push(...decrypted);
  }

  return results;
}

// server/storage.ts - использовать batch decryption

async getUsers(): Promise<User[]> {
  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));

  // Batch decrypt all emails
  const encryptedEmails = allUsers.map(u => u.email);
  const decryptedEmails = await decryptEmailBatch(encryptedEmails);

  return allUsers.map((user, index) => ({
    ...user,
    email: decryptedEmails[index],
  }));
}
```

---

### 6.2 No Memoization in React Components

**Файлы:** Все страницы author/ и learner/

**Суть проблемы:**

Компоненты не используют мемоизацию, что приводит к лишним перерисовкам:

```typescript
// Текущий код
export default function QuestionsPage() {
  const [filter, setFilter] = useState({});

  // Фильтрация выполняется при каждом рендере
  const filteredQuestions = questions?.filter((q) => {
    if (filter.topicId && q.topicId !== filter.topicId) return false;
    // ...
  });

  return (
    <div>
      {filteredQuestions?.map((question) => (
        // QuestionCard перерисовывается при любом изменении состояния
        <QuestionCard key={question.id} question={question} />
      ))}
    </div>
  );
}
```

**Решение:**

```typescript
// client/src/pages/author/questions.tsx

import { useMemo, useCallback, memo } from "react";

// Мемоизированный компонент карточки
const QuestionCard = memo(function QuestionCard({
  question,
  onEdit,
  onDelete
}: QuestionCardProps) {
  return (
    <Card>
      {/* ... */}
    </Card>
  );
});

export default function QuestionsPage() {
  const [filter, setFilter] = useState<QuestionFilter>({});
  const { data: questions } = useQuery({...});

  // Мемоизированная фильтрация
  const filteredQuestions = useMemo(() => {
    if (!questions) return [];

    return questions.filter((q) => {
      if (filter.topicId && q.topicId !== filter.topicId) return false;
      if (filter.type && q.type !== filter.type) return false;
      if (filter.difficulty) {
        const diff = q.difficulty ?? 50;
        if (filter.difficulty === "easy" && diff > 33) return false;
        if (filter.difficulty === "medium" && (diff <= 33 || diff > 66)) return false;
        if (filter.difficulty === "hard" && diff <= 66) return false;
      }
      return true;
    });
  }, [questions, filter]);

  // Мемоизированные колбэки
  const handleEdit = useCallback((question: Question) => {
    setEditingQuestion(question);
    setIsDialogOpen(true);
  }, []);

  const handleDelete = useCallback((questionId: string) => {
    deleteMutation.mutate(questionId);
  }, [deleteMutation]);

  return (
    <div>
      {filteredQuestions.map((question) => (
        <QuestionCard
          key={question.id}
          question={question}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}
```

---

### 6.3 No List Virtualization

**Файлы:** Все страницы со списками

**Суть проблемы:**

При большом количестве элементов (1000+ вопросов/пользователей) все элементы рендерятся в DOM:

```typescript
// Текущий код - рендерит ВСЕ элементы
{filteredQuestions.map((question) => (
  <QuestionCard key={question.id} question={question} />
))}
```

**Последствия:**

- Медленный initial render
- Высокое потребление памяти
- Лаги при скролле

**Решение:**

```typescript
// client/src/components/VirtualizedList.tsx

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

interface VirtualizedListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize: number;
  overscan?: number;
}

export function VirtualizedList<T>({
  items,
  renderItem,
  estimateSize,
  overscan = 5,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Использование в questions.tsx
import { VirtualizedList } from "@/components/VirtualizedList";

<VirtualizedList
  items={filteredQuestions}
  estimateSize={120} // Примерная высота карточки
  renderItem={(question) => (
    <QuestionCard
      question={question}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  )}
/>
```

---

## 7. Отсутствующие компоненты

### 7.1 Security Headers (Helmet)

**Проблема:** Отсутствуют security headers для защиты от XSS, clickjacking и других атак.

**Решение:**

```bash
npm install helmet
```

```typescript
// server/index.ts

import helmet from "helmet";

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Для React
      styleSrc: ["'self'", "'unsafe-inline'"], // Для Tailwind
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Для загрузки медиа
}));
```

---

### 7.2 Rate Limiting

**Проблема:** Только password reset имеет rate limiting, остальные endpoints уязвимы для brute force и DoS.

**Решение:**

```bash
npm install express-rate-limit
```

```typescript
// server/middleware/rate-limit.ts

import rateLimit from "express-rate-limit";

/**
 * General API rate limit.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict rate limit for authentication endpoints.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

/**
 * Very strict rate limit for password reset.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: { error: "Too many password reset requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// server/routes/index.ts

import { apiLimiter, authLimiter, passwordResetLimiter } from "../middleware/rate-limit";

// Apply general rate limit to all API routes
app.use("/api", apiLimiter);

// Stricter limits for auth endpoints
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/forgot-password", passwordResetLimiter);
```

---

### 7.3 CSRF Protection

**Проблема:** Отсутствует защита от CSRF атак.

**Решение:**

```bash
npm install csurf
```

```typescript
// server/middleware/csrf.ts

import csrf from "csurf";
import { Request, Response, NextFunction } from "express";

// CSRF protection middleware
export const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  },
});

// Middleware to add CSRF token to response
export function addCsrfToken(req: Request, res: Response, next: NextFunction) {
  res.locals.csrfToken = req.csrfToken();
  next();
}

// server/routes/auth.ts

// Send CSRF token with auth response
router.get("/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Apply CSRF protection to state-changing endpoints
router.post("/login", csrfProtection, authLimiter, async (req, res, next) => {
  // ...
});

// client/src/lib/queryClient.ts

// Fetch CSRF token and include in requests
let csrfToken: string | null = null;

export async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const res = await fetch("/api/auth/csrf-token", { credentials: "include" });
    const data = await res.json();
    csrfToken = data.csrfToken;
  }
  return csrfToken;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};

  if (data) {
    headers["Content-Type"] = "application/json";
  }

  // Add CSRF token for state-changing requests
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    headers["X-CSRF-Token"] = await getCsrfToken();
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}
```

---

### 7.4 Error Boundary

**Проблема:** При ошибке в React компоненте отображается белый экран.

**Решение:**

```typescript
// client/src/components/ErrorBoundary.tsx

import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to monitoring service
    console.error("React Error Boundary caught an error:", error, errorInfo);

    // TODO: Send to error tracking service (Sentry, etc.)
    // errorTracker.captureException(error, { extra: errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <h2 className="text-2xl font-bold text-destructive mb-4">
            Something went wrong
          </h2>
          <p className="text-muted-foreground mb-6">
            An unexpected error occurred. Please try again.
          </p>
          {process.env.NODE_ENV === "development" && this.state.error && (
            <pre className="text-left text-sm bg-muted p-4 rounded mb-6 max-w-full overflow-auto">
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
          )}
          <div className="flex gap-4">
            <Button onClick={this.handleReset}>
              Try Again
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// client/src/App.tsx - использование

import { ErrorBoundary } from "@/components/ErrorBoundary";

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Router>
            {/* routes */}
          </Router>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
```

---

## 8. Метрики качества кода

### 8.1 Сводная таблица

| Категория | Оценка | Описание |
| --------- | ------ | -------- |
| **Безопасность** | 5/10 | Default secrets, CORS, insecure cookies |
| **Архитектура Backend** | 4/10 | Monolithic routes.ts, no layered architecture |
| **Архитектура Frontend** | 4/10 | God components, duplicated logic |
| **Type Safety** | 5/10 | JSON fields without validation |
| **Производительность** | 5/10 | N+1 queries, no memoization |
| **Поддерживаемость** | 3/10 | 6000+ lines in single file |
| **Тестируемость** | 2/10 | No tests, coupled code |
| **Документация** | 4/10 | CLAUDE.md exists, no API docs |
| **ИТОГО** | **4/10** | MVP requiring significant refactoring |

### 8.2 Критические файлы для рефакторинга

| Файл | Строк | Приоритет | Рекомендация |
| ---- | ----- | --------- | ------------ |
| server/routes.ts | 6054 | P0 | Split into 10+ modules |
| client/src/pages/learner/take-test.tsx | 2111 | P1 | Extract hooks and components |
| client/src/pages/author/tests.tsx | 1593 | P1 | Extract TestBuilder, AdaptiveConfig |
| client/src/pages/author/questions.tsx | 1470 | P1 | Extract QuestionForm, QuestionPreview |
| shared/schema.ts | 750 | P1 | Add JSON validation schemas |
| server/utils/crypto.ts | 71 | P0 | Remove default keys |

---

## 9. План исправлений

### Phase 1: Critical Security (1-2 days)

1. Remove default encryption/session secrets
2. Add secure cookie flags
3. Fix CORS configuration
4. Add helmet for security headers
5. Add rate limiting

### Phase 2: Input Validation (2-3 days)

1. Create Zod schemas for all JSON fields
2. Add validation middleware
3. Update all endpoints to use validation
4. Add type-safe error responses

### Phase 3: Backend Refactoring (3-5 days)

1. Split routes.ts into modules
2. Create service layer
3. Implement proper error handling
4. Replace console.log with structured logger
5. Add CSRF protection

### Phase 4: Frontend Refactoring (3-5 days)

1. Create custom hooks for CRUD operations
2. Split God components
3. Implement query key factory
4. Fix React Query configuration
5. Add Error Boundary

### Phase 5: Performance Optimization (2-3 days)

1. Implement batch operations for N+1 queries
2. Add memoization to components
3. Implement list virtualization
4. Optimize staleTime per query type

### Phase 6: Quality Assurance (ongoing)

1. Add unit tests for services
2. Add integration tests for API
3. Add E2E tests for critical flows
4. Set up CI/CD with test automation
5. Add API documentation (OpenAPI)

---

## Приложения

### A. Checklist для Production Deploy

- [ ] Все ENV переменные установлены (no defaults)
- [ ] HTTPS enabled
- [ ] Secure cookies enabled
- [ ] CORS configured for specific origins
- [ ] Rate limiting enabled
- [ ] Security headers enabled (helmet)
- [ ] CSRF protection enabled
- [ ] Input validation on all endpoints
- [ ] Error logging configured
- [ ] Database backups configured
- [ ] Monitoring and alerting set up

### B. Рекомендуемые зависимости для добавления

```json
{
  "dependencies": {
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "csurf": "^1.11.0",
    "pino": "^8.17.2",
    "pino-http": "^9.0.0"
  },
  "devDependencies": {
    "pino-pretty": "^10.3.1",
    "@tanstack/react-virtual": "^3.0.1",
    "vitest": "^1.2.0",
    "@testing-library/react": "^14.1.2"
  }
}
```

### C. Структура проекта после рефакторинга

```text
project/
  client/
    src/
      components/
        ui/              # Radix UI wrappers
        test/            # Test-related components
        question/        # Question-related components
        common/          # Shared components
        ErrorBoundary.tsx
        VirtualizedList.tsx
      hooks/
        useCrudMutations.ts
        useTestAttempt.ts
        useAdaptiveTest.ts
        useQuestionForm.ts
      lib/
        queryClient.ts
        queryKeys.ts
        auth.tsx
        i18n.ts
      pages/
        author/
        learner/
      types/
        api.ts           # API request/response types
  server/
    routes/
      index.ts
      auth.ts
      users.ts
      groups.ts
      topics.ts
      questions.ts
      tests.ts
      attempts.ts
      adaptive.ts
      scorm.ts
      analytics.ts
      media.ts
    services/
      auth.service.ts
      test.service.ts
      attempt.service.ts
      scorm.service.ts
    middleware/
      auth.ts
      validation.ts
      rate-limit.ts
      csrf.ts
      error-handler.ts
    utils/
      logger.ts
      crypto.ts
      errors.ts
      shuffle.ts
    scorm/
      # existing SCORM modules
  shared/
    schema.ts            # DB schema + Zod validation
    types.ts             # Shared TypeScript types
```
