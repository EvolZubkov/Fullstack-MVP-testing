# Область действия ссылки-приглашения. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ссылка-приглашение перестаёт быть входом в систему и становится доступом к одному тесту, оставаясь
действительной по сроку независимо от успешного прохождения.

**Architecture:** Сессия, созданная обработчиком `/access/:token`, помечается полем `magic = { assignmentId,
testId }`. Один guard-middleware стоит до всех роутеров и пропускает под `/api/*` только то, что перечислено в
таблице разрешений, сверяя `testId` и принадлежность попытки. Клиент узнаёт об ограничении из
`GET /api/auth/me` и сам не предлагает переходов за границу теста.

**Tech Stack:** Express 4 плюс `express-session`, TypeScript, Drizzle ORM; React 19, Wouter, `@universityrt/ui-kit`;
Vitest плюс supertest, jsdom.

Основание: `docs/superpowers/specs/2026-07-30-magic-link-scope-design.md`.

---

## Что нужно знать перед началом

- Роутеры монтируются циклом по `routerConfig` в `server/routes.ts`; guard встаёт до этого цикла и после
  session-middleware.
- Тесты роутов пишутся на supertest поверх мини-приложения Express с замоканным `../server/storage` — образец
  целиком лежит в `tests/routes.access.test.ts`.
- Запуск: `npm test -- <путь>` для одного файла, `npm run check` для типов. Порог покрытия 80 процентов
  действует на весь прогон; поднимать покрытие вне кода задачи не нужно.
- Стартовый экран учащегося уже умеет показывать исчерпание попыток: `buildStartState` в
  `shared/template/start-state.ts` при `noAttempts && hasCompleted` выставляет `canViewResults`. Отдельный
  экран для этого делать не надо.
- В сообщениях коммитов не должно быть строки `Co-Authored-By`.

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `server/middleware/magic-scope-rules.ts` | Создаётся. Таблица разрешений и чистый матчер пути. Вся область видна здесь |
| `server/middleware/magic-scope.ts` | Создаётся. Middleware: решение по таблице плюс сверка `testId` и владельца попытки |
| `server/routes/access.ts` | Правится. Ставит `session.magic`, отдаёт заголовки гигиены |
| `server/routes/auth.ts` | Правится. Логин снимает `magic`; `/me` отдаёт `magicScope` |
| `server/routes/attempts.ts` | Правится. `/api/learner/tests` урезается до одного теста |
| `server/routes.ts` | Правится. Регистрация guard, объявление поля сессии |
| `client/src/lib/magic-scope.ts` | Создаётся. Флаг «получен 403 MAGIC_SCOPE» с подпиской |
| `client/src/lib/queryClient.ts` | Правится. Выставляет флаг при 403 MAGIC_SCOPE |
| `client/src/App.tsx` | Правится. Ветка ограниченной сессии в `ProtectedRoute` |
| `client/src/pages/learner/layout.tsx` | Правится. Шапка без навигации |
| `client/src/pages/learner/take-test.tsx` | Правится. `ATTEMPTS_EXHAUSTED` остаётся на стартовом экране |
| `docs/wireframes/magic-scope-required.html` | Создаётся. Эскиз шапки ограниченной сессии |

---

### Task 1: Таблица разрешений и матчер пути

Чистая функция без ввода-вывода — с неё начинаем, потому что на ней держится весь guard.

**Files:**

- Create: `server/middleware/magic-scope-rules.ts`
- Test: `tests/magic-scope-rules.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @module tests/magic-scope-rules
 * @description Unit tests for the magic-link scope rule table and its path matcher:
 * exact matches, parameter capture, method sensitivity, and the deny-by-default
 * behaviour for anything absent from the table.
 */
import { describe, it, expect } from "vitest";
import { matchMagicScopeRule } from "../server/middleware/magic-scope-rules";

describe("matchMagicScopeRule", () => {
  it("matches a static allowed path", () => {
    const m = matchMagicScopeRule("GET", "/api/auth/me");
    expect(m?.rule.bind).toBe("none");
  });

  it("captures the test id and asks for a test binding", () => {
    const m = matchMagicScopeRule("GET", "/api/tests/t1/resume");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("t1");
  });

  it("captures the attempt id and asks for an attempt binding", () => {
    const m = matchMagicScopeRule("POST", "/api/attempts/a1/finish");
    expect(m?.rule.bind).toBe("attempt");
    expect(m?.params.attemptId).toBe("a1");
  });

  it("captures both segments of the screen-template path", () => {
    const m = matchMagicScopeRule("GET", "/api/tests/t1/screen-template/question");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("t1");
  });

  it("is method sensitive", () => {
    expect(matchMagicScopeRule("DELETE", "/api/auth/me")).toBeNull();
  });

  it("denies anything absent from the table", () => {
    expect(matchMagicScopeRule("GET", "/api/learner/attempts")).toBeNull();
    expect(matchMagicScopeRule("GET", "/api/home")).toBeNull();
    expect(matchMagicScopeRule("POST", "/api/auth/change-password")).toBeNull();
    expect(matchMagicScopeRule("GET", "/api/tests")).toBeNull();
  });

  it("does not let a longer path slip through a shorter rule", () => {
    expect(matchMagicScopeRule("GET", "/api/tests/t1/resume/extra")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/magic-scope-rules.test.ts`
Expected: FAIL, `Failed to resolve import "../server/middleware/magic-scope-rules"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * @module server/middleware/magic-scope-rules
 * @description The allow-list for a magic-link session and its path matcher. A
 * session opened through `/access/:token` may reach ONLY what this table names:
 * anything absent is denied, so a newly added route is closed until someone puts
 * it here deliberately. Keeping the whole scope in one file is the point — it is
 * reviewable at a glance.
 *
 * `bind` says what the guard must additionally verify:
 *   - `none`    — no object binding (session-level routes);
 *   - `test`    — the captured `testId` must equal the session's magic test;
 *   - `attempt` — the captured `attemptId` must be an attempt of that test owned
 *                 by the session user.
 */

/** How a matched route is bound to the session's magic scope. */
export type MagicScopeBind = "none" | "test" | "attempt";

/** One entry of the allow-list. */
export interface MagicScopeRule {
  method: string;
  /** Path pattern; a `:name` segment captures a parameter. */
  pattern: string;
  bind: MagicScopeBind;
}

/** A matched rule together with the captured path parameters. */
export interface MagicScopeMatch {
  rule: MagicScopeRule;
  params: Record<string, string>;
}

/**
 * Everything a magic-link session may call. Ordered by area: session, the test's
 * own metadata and templates, the attempt lifecycle, the attempt report assets.
 */
export const MAGIC_SCOPE_RULES: MagicScopeRule[] = [
  { method: "GET", pattern: "/api/auth/me", bind: "none" },
  { method: "POST", pattern: "/api/auth/logout", bind: "none" },
  // The handler itself narrows the payload down to the magic test.
  { method: "GET", pattern: "/api/learner/tests", bind: "none" },
  { method: "GET", pattern: "/api/tests/:testId/screen-template/:screen", bind: "test" },
  { method: "POST", pattern: "/api/tests/:testId/attempts/start", bind: "test" },
  { method: "POST", pattern: "/api/tests/:testId/attempts/start-adaptive", bind: "test" },
  { method: "GET", pattern: "/api/tests/:testId/resume", bind: "test" },
  { method: "POST", pattern: "/api/attempts/:attemptId/save-progress", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/section-timer", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/section-result", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/finish", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/answer-adaptive", bind: "attempt" },
  { method: "POST", pattern: "/api/attempts/:attemptId/expire-topic-adaptive", bind: "attempt" },
  { method: "GET", pattern: "/api/attempts/:attemptId/result", bind: "attempt" },
  { method: "GET", pattern: "/api/report/lib/:file", bind: "none" },
  { method: "GET", pattern: "/api/report/asset/:file", bind: "none" },
];

function splitPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

/**
 * Find the rule covering `method` plus `pathname`, capturing `:name` segments.
 * Returns `null` when nothing matches — the caller must treat that as a denial.
 */
export function matchMagicScopeRule(method: string, pathname: string): MagicScopeMatch | null {
  const actual = splitPath(pathname);
  for (const rule of MAGIC_SCOPE_RULES) {
    if (rule.method !== method.toUpperCase()) continue;
    const expected = splitPath(rule.pattern);
    if (expected.length !== actual.length) continue;

    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < expected.length; i += 1) {
      const segment = expected[i];
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(actual[i]);
      } else if (segment !== actual[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { rule, params };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/magic-scope-rules.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add server/middleware/magic-scope-rules.ts tests/magic-scope-rules.test.ts
git commit -m "feat(access): таблица разрешений и матчер пути для ограниченной сессии"
```

---

### Task 2: Guard-middleware

**Files:**

- Create: `server/middleware/magic-scope.ts`
- Test: `tests/magic-scope-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @module tests/magic-scope-guard
 * @description Tests for the magic-link scope guard: an unrestricted session passes
 * through untouched, a restricted one reaches only the allow-listed API paths, and
 * object binding rejects another test's id or an attempt that belongs elsewhere.
 * Non-API paths are outside the guard's remit entirely.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock } = vi.hoisted(() => ({
  storageMock: { getAttempt: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { magicScopeGuard } from "../server/middleware/magic-scope";

/** Mini app: a fake session is injected, then the guard, then a catch-all echo. */
function makeApp(magic: { assignmentId: string; testId: string } | null, userId = "u1") {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = magic
      ? { userId, magic }
      : { userId };
    next();
  });
  app.use(magicScopeGuard);
  app.use((req, res) => res.json({ reached: req.path }));
  return app;
}

describe("magicScopeGuard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets a normal session through", async () => {
    const res = await request(makeApp(null)).get("/api/home");
    expect(res.status).toBe(200);
  });

  it("ignores everything outside /api", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/uploads/media/x.png");
    expect(res.status).toBe(200);
  });

  it("denies an API path absent from the table", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/learner/attempts");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MAGIC_SCOPE");
  });

  it("allows an unbound API path", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/auth/me");
    expect(res.status).toBe(200);
  });

  it("allows the scope's own test", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/tests/t1/resume");
    expect(res.status).toBe(200);
  });

  it("denies another test's id", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/tests/t2/resume");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MAGIC_SCOPE");
  });

  it("allows an attempt of this test owned by this user", async () => {
    storageMock.getAttempt.mockResolvedValue({ id: "at1", userId: "u1", testId: "t1" });
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at1/result");
    expect(res.status).toBe(200);
  });

  it("denies an attempt of another test", async () => {
    storageMock.getAttempt.mockResolvedValue({ id: "at2", userId: "u1", testId: "t9" });
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at2/result");
    expect(res.status).toBe(403);
  });

  it("denies an attempt owned by someone else", async () => {
    storageMock.getAttempt.mockResolvedValue({ id: "at3", userId: "other", testId: "t1" });
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at3/result");
    expect(res.status).toBe(403);
  });

  it("denies a missing attempt", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/nope/result");
    expect(res.status).toBe(403);
  });

  it("answers 500 when the attempt lookup throws", async () => {
    storageMock.getAttempt.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at1/result");
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/magic-scope-guard.test.ts`
Expected: FAIL, `Failed to resolve import "../server/middleware/magic-scope"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * @module server/middleware/magic-scope
 * @description The guard that turns a magic-link session into access to ONE test.
 *
 * A session created by `/access/:token` carries `session.magic`; a password login
 * never sets it and clears it if present. When the field is there, this middleware
 * admits only the paths named in {@link MAGIC_SCOPE_RULES} and verifies the object
 * binding itself, so the individual handlers need no awareness of the restriction.
 *
 * Only `/api/*` is policed. The client bundle and `/uploads/media/*` (question
 * media, without which a question cannot render) are deliberately outside: data
 * travels solely through the API, and a media file carries no test binding to check.
 */
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { matchMagicScopeRule } from "./magic-scope-rules";

/** The scope a magic link opens: one assignment, one test. */
export interface MagicScope {
  assignmentId: string;
  testId: string;
}

declare module "express-session" {
  interface SessionData {
    /** Present only for a session opened by a magic link; absent = full session. */
    magic?: MagicScope;
  }
}

function deny(res: Response) {
  return res.status(403).json({ error: "Link scope", code: "MAGIC_SCOPE" });
}

/**
 * Deny-by-default scope guard. Registered once, before the routers, so a route
 * added later is closed until it is added to the rule table on purpose.
 */
export async function magicScopeGuard(req: Request, res: Response, next: NextFunction) {
  const magic = req.session?.magic;
  if (!magic) return next();
  if (!req.path.startsWith("/api/")) return next();

  const match = matchMagicScopeRule(req.method, req.path);
  if (!match) return deny(res);

  if (match.rule.bind === "test") {
    if (match.params.testId !== magic.testId) return deny(res);
    return next();
  }

  if (match.rule.bind === "attempt") {
    try {
      const attempt = await storage.getAttempt(match.params.attemptId);
      if (!attempt) return deny(res);
      if (attempt.userId !== req.session.userId) return deny(res);
      if (attempt.testId !== magic.testId) return deny(res);
      return next();
    } catch {
      return res.status(500).json({ error: "Authorization error" });
    }
  }

  return next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/magic-scope-guard.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/middleware/magic-scope.ts tests/magic-scope-guard.test.ts
git commit -m "feat(access): guard области для сессии, открытой по ссылке"
```

---

### Task 3: Ссылка помечает сессию и отдаёт заголовки гигиены

**Files:**

- Modify: `server/routes/access.ts:9-46`
- Test: `tests/routes.access.test.ts` (дополняется)

- [ ] **Step 1: Write the failing test**

Добавить в конец `describe("GET /access/:token")` в `tests/routes.access.test.ts`:

```ts
  it("marks the session as scoped to the assignment and the test", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord());
    const app = makeApp();
    // A probe route reports what the magic link put into the session.
    app.get("/probe", (req, res) => res.json({ magic: (req.session as unknown as { magic?: unknown }).magic }));

    const agent = request.agent(app);
    await agent.get(`/access/${validToken}`);
    const probe = await agent.get("/probe");
    expect(probe.body.magic).toEqual({ assignmentId: "asgn1", testId: "test1" });
  });

  it("sends the hygiene headers so the raw token cannot leak", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord());
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toContain("no-store");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/routes.access.test.ts`
Expected: FAIL — `magic` приходит `undefined`, заголовка `referrer-policy` нет.

- [ ] **Step 3: Write the implementation**

В `server/routes/access.ts` заменить тело обработчика от объявления `const { token }` до редиректа так:

```ts
router.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params;

  // The raw token is in the URL of THIS request: never let it travel onward in a
  // Referer header and never let a cache keep the response.
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  if (!token || token.length < 32) {
    return res.status(400).send(renderErrorPage("Недействительная ссылка"));
  }

  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const record = await storage.getAssignmentAccessToken(tokenHash);

    if (!record) {
      return res.status(404).send(renderErrorPage("Ссылка не найдена. Возможно, она уже была использована или никогда не существовала."));
    }

    if (record.revokedAt) {
      return res.status(403).send(renderErrorPage("Ссылка была отозвана. Обратитесь к организатору теста."));
    }

    if (record.expiresAt < new Date()) {
      return res.status(403).send(renderErrorPage("Срок действия ссылки истёк. Обратитесь к организатору теста."));
    }

    // The link is access to ONE test, not a login: the session is marked so the
    // scope guard can hold it inside that test. A password login clears the mark.
    req.session.userId = record.userId;
    req.session.magic = { assignmentId: record.assignmentId, testId: record.testId };
    await new Promise<void>((resolve, reject) =>
      req.session.save(err => err ? reject(err) : resolve())
    );

    logger.info(`Magic link login: userId=${record.userId} testId=${record.testId}`);

    // Редиректим на тест
    res.redirect(`/learner/test/${record.testId}`);
  } catch (error) {
    logger.error("Magic link error: " + (error as Error).message);
    res.status(500).send(renderErrorPage("Произошла ошибка. Попробуйте ещё раз или обратитесь к организатору."));
  }
});
```

Добавить импорт типа сессии в начало файла, сразу после существующих импортов:

```ts
import "../middleware/magic-scope";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/routes.access.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/routes/access.ts tests/routes.access.test.ts
git commit -m "feat(access): ссылка помечает сессию областью теста и не отдаёт токен наружу"
```

---

### Task 4: Вход по паролю снимает ограничение, `/me` его показывает

**Files:**

- Modify: `server/routes/auth.ts:64` и `server/routes/auth.ts:158-169`
- Test: `tests/routes.auth.test.ts` (дополняется)

- [ ] **Step 1: Write the failing test**

В `tests/routes.auth.test.ts` расширить фабрику `makeApp` (она начинается на строке 34): в middleware,
который сейчас проставляет `userId` из заголовка `x-test-user`, добавить вторую строку и смонтировать
пробный маршрут. Итоговая фабрика:

```ts
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));

  // Inject userId into session for authenticated routes
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    // A magic-link session is seeded once and then lives in the session store, so
    // a later request without the header still sees it — that is what lets the
    // login test assert that the mark was actually REMOVED.
    if (req.headers["x-test-magic"] && !req.session.magic) {
      req.session.magic = JSON.parse(req.headers["x-test-magic"]);
    }
    next();
  });

  app.get("/probe-session", (req: any, res: any) => res.json({ magic: req.session.magic ?? null }));
  app.use("/api/auth", authRouter);
  return app;
}
```

Затем добавить тесты (новый `describe` в конце файла):

```ts
// ─── magic-link scope ─────────────────────────────────────────────────────────
describe("magic-link scope on the session", () => {
  const magicHeader = JSON.stringify({ assignmentId: "a1", testId: "t1" });

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(baseUser);
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
  });

  it("a password login clears the magic scope of the session", async () => {
    storageMock.validatePassword.mockResolvedValue(baseUser);
    storageMock.updateUserLastLogin.mockResolvedValue(undefined);
    const agent = request.agent(makeApp());

    const seeded = await agent.get("/probe-session").set("x-test-magic", magicHeader);
    expect(seeded.body.magic).toEqual({ assignmentId: "a1", testId: "t1" });

    const login = await agent.post("/api/auth/login").send({ email: "kate@test.com", password: "secret" });
    expect(login.status).toBe(200);

    const after = await agent.get("/probe-session");
    expect(after.body.magic).toBeNull();
  });

  it("GET /me reports the magic scope of a restricted session", async () => {
    const res = await request(makeApp())
      .get("/api/auth/me")
      .set("x-test-user", "u1")
      .set("x-test-magic", magicHeader);
    expect(res.status).toBe(200);
    expect(res.body.user.magicScope).toEqual({ testId: "t1" });
  });

  it("GET /me reports a null magic scope for a normal session", async () => {
    const res = await request(makeApp()).get("/api/auth/me").set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.user.magicScope).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/routes.auth.test.ts`
Expected: FAIL — `magic` после логина остаётся, `magicScope` в ответе `/me` отсутствует.

- [ ] **Step 3: Write the implementation**

В `server/routes/auth.ts` в обработчике `POST /login` заменить строку `req.session.userId = user.id;` на:

```ts
    req.session.userId = user.id;
    // A full authentication supersedes a magic-link session: dropping the mark is
    // what "log in with a password to leave the test" actually means.
    delete req.session.magic;
```

В обработчике `GET /me` в объект `user` ответа добавить последним полем:

```ts
        // Present only for a session opened by an assignment link; the client uses
        // it to keep the interface inside that one test.
        magicScope: req.session.magic ? { testId: req.session.magic.testId } : null,
```

В начало файла добавить импорт объявления типа сессии:

```ts
import "../middleware/magic-scope";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/routes.auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts tests/routes.auth.test.ts
git commit -m "feat(access): вход по паролю снимает ограничение области, /me отдаёт magicScope"
```

---

### Task 5: Список тестов урезается до одного

**Files:**

- Modify: `server/routes/attempts.ts:122-125`
- Test: `tests/routes.attempts-tests.test.ts` (дополняется)

- [ ] **Step 1: Write the failing test**

В `tests/routes.attempts-tests.test.ts` расширить фабрику `makeApp` (строка 67), добавив в её middleware
инъекцию области, и завести хелпер рядом с `asLearner`:

```ts
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    if (req.headers["x-test-magic"]) req.session.magic = JSON.parse(req.headers["x-test-magic"]);
    next();
  });
```

```ts
/** Learner whose session was opened by an assignment link scoped to `testId`. */
function asScopedLearner(req: request.Test, testId: string) {
  return asLearner(req).set("x-test-magic", JSON.stringify({ assignmentId: "a1", testId }));
}
```

Тест добавить в существующий `describe("Attempts routes — learner/tests")`:

```ts
  it("GET /learner/tests — narrows the list to the magic scope's test", async () => {
    const other = { ...dbTest, id: "test2", title: "Test 2" };
    storageMock.getAssignedTestsForUser.mockResolvedValue([dbTest, other]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 5 }]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);

    const res = await asScopedLearner(request(app).get("/api/learner/tests"), "test2");
    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: string }) => t.id)).toEqual(["test2"]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/routes.attempts-tests.test.ts`
Expected: FAIL — возвращаются оба теста.

- [ ] **Step 3: Write the implementation**

В `server/routes/attempts.ts` в обработчике `GET /learner/tests` заменить строку получения списка на:

```ts
    const allAssigned = await storage.getAssignedTestsForUser(req.session.userId!);
    // A magic-link session sees ONE test: the list is the start screen's data
    // source, and it must not enumerate the learner's other assignments.
    const magic = req.session.magic;
    const assignedTests = magic ? allAssigned.filter((t) => t.id === magic.testId) : allAssigned;
```

В начало файла добавить импорт объявления типа сессии:

```ts
import "../middleware/magic-scope";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/routes.attempts-tests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/attempts.ts tests/routes.attempts-tests.test.ts
git commit -m "feat(access): список тестов ученика урезается до теста ссылки"
```

---

### Task 6: Регистрация guard в цепочке

**Files:**

- Modify: `server/routes.ts:35-39` и `server/routes.ts:81-88`
- Test: `tests/magic-scope-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @module tests/magic-scope-wiring
 * @description Guards the ORDER of the middleware chain: the scope guard must sit
 * after the session middleware and before the routers, otherwise a restricted
 * session would reach handlers unchecked. Asserted on the module source, because
 * booting the whole app here would drag in the database.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(process.cwd(), "server/routes.ts"), "utf8");

describe("magic scope wiring", () => {
  it("registers the guard between the session middleware and the routers", () => {
    const session = source.indexOf("app.use(\n    session(");
    const guard = source.indexOf("magicScopeGuard");
    const routers = source.indexOf("for (const { path, router } of routerConfig)");
    expect(session).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(session);
    expect(routers).toBeGreaterThan(guard);
  });

  it("declares no local duplicate of the session type", () => {
    expect(source).not.toContain("declare module \"express-session\"");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/magic-scope-wiring.test.ts`
Expected: FAIL — `magicScopeGuard` в файле нет, локальное объявление типа присутствует.

- [ ] **Step 3: Write the implementation**

В `server/routes.ts` удалить блок

```ts
declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}
```

добавить в импорты

```ts
import { magicScopeGuard } from "./middleware/magic-scope";
```

и вставить регистрацию сразу после `app.use(session({...}))`, до строки `// Static files`:

```ts
  // A magic-link session is access to ONE test: everything under /api that the
  // rule table does not name is refused here, before any router sees it.
  app.use(magicScopeGuard);
```

Тип `SessionData.userId` при этом остаётся объявленным в `server/middleware/auth.ts`, а `magic` — в
`server/middleware/magic-scope.ts`; дубликат объявления в `server/routes.ts` больше не нужен.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/magic-scope-wiring.test.ts`
Expected: PASS, 2 tests.

Run: `npm run check`
Expected: без ошибок типизации.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts tests/magic-scope-wiring.test.ts
git commit -m "feat(access): guard области включён в цепочку до роутеров"
```

---

### Task 7: Эскиз шапки ограниченной сессии — ВЫПОЛНЕНО

Уточнение 2026-07-30: отдельного экрана блокировки нет, выход за границы ведёт на существующую форму входа
`/login`. Поэтому единственное новое в интерфейсе — шапка без навигации, и только она в эскизе.

**Files:**

- Create: `docs/wireframes/magic-scope-required.html`

- [x] **Step 1: Собрать эскиз**

Эскизный фрейм взят из `docs/wireframes/approved/prd15-topic-unavailable.html` дословно: навигационная панель
с переключателями темы и плотности, секции `wf-notes` и `wf-mapping`. В холсте — только реальный интерфейс на
классах дизайн-системы; пояснения исключительно в `wf-notes` и `wf-mapping`.

Содержимое: две шапки подряд — обычная сессия (с кластером «Главная / Тесты / История», логотип-ссылка) и
сессия по ссылке (кластера нет, логотип не ссылка). Разметка повторяет
`client/src/pages/learner/layout.tsx`.

- [x] **Step 2: Подключить актуальный дизайн-систему**

Взяты `client/src/styles/preflight.css` и `client/src/styles/vendor/university-rt.css` вместо обычной для
эскизов копии `docs/wireframes/ds/university-rt.css`. Причины: docs-копия отстала (в ней нет `.ou-separator`),
а без `preflight.css` ссылки рисуются подчёркнутыми, чего в приложении нет.

- [x] **Step 3: Проверить в браузере**

`python -m http.server 8123` из корня, затем headless-снимок обеих тем через глобальный
`chrome-headless-shell`. Проверено: обе темы, обе шапки, горизонтальной прокрутки нет.
Линтер `node scripts/check-wireframes-ds.mjs` по этому файлу замечаний не даёт.

- [x] **Step 4: Согласовать**

Согласовано 2026-07-30 вместе с решением убрать экран блокировки.

- [x] **Step 5: Commit**

Закоммичено как `docs(wireframes): эскиз экрана «ссылка открывает только этот тест»`.

---

### Task 8: Флаг «получен 403 MAGIC_SCOPE»

Крошечный модуль состояния: guard может отказать в запросе, о котором клиент не знал, и клиент обязан на это
отреагировать переходом на форму входа, а не молча упасть.

**Files:**

- Create: `client/src/lib/magic-scope.ts`
- Modify: `client/src/lib/queryClient.ts:3-8`
- Test: `client/src/lib/__tests__/magic-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @module client/src/lib/__tests__/magic-scope
 * @description Tests for the client-side scope-violation flag: it starts clear,
 * notifies subscribers when raised, stays raised, and unsubscribes cleanly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isScopeViolation,
  raiseScopeViolation,
  resetScopeViolation,
  subscribeScopeViolation,
} from "../magic-scope";

describe("magic scope violation flag", () => {
  beforeEach(() => resetScopeViolation());

  it("starts clear", () => {
    expect(isScopeViolation()).toBe(false);
  });

  it("notifies subscribers when raised", () => {
    const seen = vi.fn();
    subscribeScopeViolation(seen);
    raiseScopeViolation();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(isScopeViolation()).toBe(true);
  });

  it("does not notify twice for a repeated violation", () => {
    const seen = vi.fn();
    subscribeScopeViolation(seen);
    raiseScopeViolation();
    raiseScopeViolation();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const seen = vi.fn();
    const off = subscribeScopeViolation(seen);
    off();
    raiseScopeViolation();
    expect(seen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- client/src/lib/__tests__/magic-scope.test.ts`
Expected: FAIL, `Failed to resolve import "../magic-scope"`.

- [ ] **Step 3: Write the implementation**

Создать `client/src/lib/magic-scope.ts`:

```ts
/**
 * @module client/src/lib/magic-scope
 * @description A one-way flag raised when the server refuses a request with
 * `403 MAGIC_SCOPE`. Routing already keeps a magic-link session inside its test,
 * so this is the safety net for the case where the client and the server-side rule
 * table disagree: the flag flips once and routing sends the learner to the login
 * form instead of failing silently. Cleared only by a full page load (or by tests).
 */

type Listener = () => void;

let violated = false;
const listeners = new Set<Listener>();

/** Whether a scope violation has been observed in this page session. */
export function isScopeViolation(): boolean {
  return violated;
}

/** Raise the flag; subscribers are notified once, on the transition. */
export function raiseScopeViolation(): void {
  if (violated) return;
  violated = true;
  for (const listener of listeners) listener();
}

/** Subscribe to the transition; returns the unsubscribe function. */
export function subscribeScopeViolation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. Production code never lowers the flag. */
export function resetScopeViolation(): void {
  violated = false;
  listeners.clear();
}
```

В `client/src/lib/queryClient.ts` заменить `throwIfResNotOk` на:

```ts
import { raiseScopeViolation } from "./magic-scope";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // A magic-link session hit something outside its test. Routing normally
    // prevents this; when it does not, the learner is sent to the login form
    // rather than left with a bare 403.
    if (res.status === 403 && text.includes("MAGIC_SCOPE")) raiseScopeViolation();
    throw new Error(`${res.status}: ${text}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- client/src/lib/__tests__/magic-scope.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/magic-scope.ts client/src/lib/queryClient.ts client/src/lib/__tests__/magic-scope.test.ts
git commit -m "feat(access): клиентский признак выхода за границы ссылки"
```

---

### Task 10: Маршрутизация ограниченной сессии

**Files:**

- Modify: `client/src/lib/auth.tsx:10`
- Modify: `client/src/App.tsx:16-19` (импорты) и `client/src/App.tsx:40-68` (`ProtectedRoute`)
- Test: `client/src/__tests__/protected-route-scope.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @module client/src/__tests__/protected-route-scope
 * @description Tests for the restricted-session branch of ProtectedRoute: inside the
 * link's test the page renders, outside it the learner is redirected to the login
 * form, the first-login gate is bypassed, and a scope violation redirects too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { raiseScopeViolation, resetScopeViolation } from "@/lib/magic-scope";

let currentLocation = "/learner/test/t1";
vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, vi.fn()],
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  Route: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Switch: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const authState = {
  user: null as unknown,
  isLoading: false,
  can: () => true,
};
vi.mock("@/lib/auth", () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ProtectedRoute } from "../App";

const scopedUser = {
  id: "u1",
  gdprConsent: false,
  mustChangePassword: true,
  magicScope: { testId: "t1" },
};

describe("ProtectedRoute under a magic-link session", () => {
  beforeEach(() => {
    resetScopeViolation();
    authState.user = scopedUser;
    currentLocation = "/learner/test/t1";
  });

  it("renders the test page inside the scope and skips the first-login gate", () => {
    render(<ProtectedRoute><div data-testid="page">тест</div></ProtectedRoute>);
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("allows a result page of any attempt — the server decides ownership", () => {
    currentLocation = "/learner/result/at1";
    render(<ProtectedRoute><div data-testid="page">результат</div></ProtectedRoute>);
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("redirects a route outside the scope to the login form", () => {
    currentLocation = "/learner/history";
    render(<ProtectedRoute><div data-testid="page">история</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/login");
  });

  it("redirects another test's page", () => {
    currentLocation = "/learner/test/t2";
    render(<ProtectedRoute><div data-testid="page">чужой тест</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/login");
  });

  it("redirects after the API reported a scope violation", () => {
    raiseScopeViolation();
    render(<ProtectedRoute><div data-testid="page">тест</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/login");
  });

  it("keeps the first-login gate for a normal session", () => {
    authState.user = { ...scopedUser, magicScope: null };
    render(<ProtectedRoute><div data-testid="page">тест</div></ProtectedRoute>);
    expect(screen.queryByTestId("page")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- client/src/__tests__/protected-route-scope.test.tsx`
Expected: FAIL — `ProtectedRoute` не экспортируется из `App.tsx`, ветки ограниченной сессии нет.

- [ ] **Step 3: Write the implementation**

В `client/src/lib/auth.tsx` расширить тип:

```tsx
/**
 * User as returned by the auth API: DB fields plus the effective role set and
 * permission list computed by the server (PRD-13). `roles` includes the
 * configuration superadmin when applicable; `permissions` is the union.
 * `magicScope` is present only for a session opened by an assignment link and
 * names the single test that session may reach.
 */
export type AuthUser = User & {
  roles?: Role[];
  permissions?: Capability[];
  magicScope?: { testId: string } | null;
};
```

В `client/src/App.tsx` добавить импорты:

```tsx
import { useSyncExternalStore } from "react";
import { isScopeViolation, subscribeScopeViolation } from "@/lib/magic-scope";
```

Экспортировать `ProtectedRoute` (добавить `export` к объявлению функции) и вставить ветку ограниченной сессии
перед проверкой первого входа, то есть перед строкой `if (!user.gdprConsent || user.mustChangePassword)`:

```tsx
  // A session opened by an assignment link is access to ONE test. Two routes stay
  // open: that test and a result page — ownership of the attempt is the server's
  // call, so the client does not duplicate the check. Everything else, including
  // the first-login gate below, is outside the link's remit, and the way out of the
  // test is a full authentication — so send the learner straight to the login form
  // instead of an intermediate "you cannot go there" screen.
  if (user.magicScope) {
    const testPath = `/learner/test/${user.magicScope.testId}`;
    const insideScope =
      !scopeViolated && (location === testPath || location.startsWith("/learner/result/"));
    if (!insideScope) return <Redirect to="/login" />;
    return <>{children}</>;
  }
```

Значение `scopeViolated` получить в начале функции, рядом с `const [location] = useLocation();`:

```tsx
  const scopeViolated = useSyncExternalStore(subscribeScopeViolation, isScopeViolation, () => false);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- client/src/__tests__/protected-route-scope.test.tsx`
Expected: PASS, 6 tests.

Run: `npm run check`
Expected: без ошибок типизации.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/lib/auth.tsx client/src/__tests__/protected-route-scope.test.tsx
git commit -m "feat(access): ограниченная сессия ходит только по маршрутам своего теста"
```

---

### Task 11: Шапка учащегося без навигации

**Files:**

- Modify: `client/src/pages/learner/layout.tsx:12-69`
- Test: `client/src/pages/learner/__tests__/layout-scope.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @module client/src/pages/learner/__tests__/layout-scope
 * @description Tests that the learner header offers no navigation a magic-link
 * session cannot follow: the Home/Tests/History cluster disappears and the logo
 * stops linking to the test list, while logout stays available.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LearnerLayout } from "../layout";

vi.mock("wouter", () => ({
  useLocation: () => ["/learner/test/t1", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const authState = { user: { id: "u1", name: "Ученик" } as Record<string, unknown>, logout: vi.fn() };
vi.mock("@/lib/auth", () => ({ useAuth: () => authState }));

describe("LearnerLayout under a magic-link session", () => {
  it("renders the navigation for a normal session", () => {
    authState.user = { id: "u1", name: "Ученик", magicScope: null };
    render(<LearnerLayout><div /></LearnerLayout>);
    expect(screen.getByTestId("link-home")).toBeInTheDocument();
    expect(screen.getByTestId("link-tests")).toBeInTheDocument();
    expect(screen.getByTestId("link-history")).toBeInTheDocument();
  });

  it("hides every navigation target for a restricted session", () => {
    authState.user = { id: "u1", name: "Ученик", magicScope: { testId: "t1" } };
    render(<LearnerLayout><div /></LearnerLayout>);
    expect(screen.queryByTestId("link-home")).toBeNull();
    expect(screen.queryByTestId("link-tests")).toBeNull();
    expect(screen.queryByTestId("link-history")).toBeNull();
    expect(screen.getByTestId("button-logout")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- client/src/pages/learner/__tests__/layout-scope.test.tsx`
Expected: FAIL — навигация рендерится в обоих случаях.

- [ ] **Step 3: Write the implementation**

В `client/src/pages/learner/layout.tsx` после `const [location, navigate] = useLocation();` добавить:

```tsx
  // A magic-link session may not leave its test, so the header must not offer a
  // single destination that would end at the block screen.
  const scoped = !!user?.magicScope;
```

Заменить левую часть шапки (существующий `<Cluster gap={6}>` со ссылкой-логотипом и кластером из трёх
кнопок) на:

```tsx
          <Cluster gap={6}>
            {scoped ? (
              <Cluster gap={2}>
                <BookOpen size={24} color="var(--ou-accent-default)" />
                <Text variant="heading-s" weight="semibold">{t.navigation.testCenter}</Text>
              </Cluster>
            ) : (
              <Link href="/learner">
                <Cluster gap={2}>
                  <BookOpen size={24} color="var(--ou-accent-default)" />
                  <Text variant="heading-s" weight="semibold">{t.navigation.testCenter}</Text>
                </Cluster>
              </Link>
            )}
            {!scoped && (
              <Cluster gap={1}>
                <Link href="/">
                  <Button
                    variant={isHomeActive ? "secondary" : "ghost"}
                    size="s"
                    leadingIcon={<Home size={16} />}
                    data-testid="link-home"
                  >
                    {t.navigation.home}
                  </Button>
                </Link>
                <Link href="/learner">
                  <Button
                    variant={isTestsActive ? "secondary" : "ghost"}
                    size="s"
                    leadingIcon={<ClipboardList size={16} />}
                    data-testid="link-tests"
                  >
                    {t.navigation.tests}
                  </Button>
                </Link>
                <Link href="/learner/history">
                  <Button
                    variant={isHistoryActive ? "secondary" : "ghost"}
                    size="s"
                    leadingIcon={<History size={16} />}
                    data-testid="link-history"
                  >
                    {t.navigation.history}
                  </Button>
                </Link>
              </Cluster>
            )}
          </Cluster>
```

Правая часть шапки — переключатель темы, имя, выход — не трогается.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- client/src/pages/learner/__tests__/layout-scope.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/learner/layout.tsx client/src/pages/learner/__tests__/layout-scope.test.tsx
git commit -m "feat(access): шапка ученика без переходов, недоступных по ссылке"
```

---

### Task 12: Исчерпание попыток остаётся на стартовом экране

Сейчас `ATTEMPTS_EXHAUSTED` уводит на `/learner`, что в ограниченной сессии выбрасывает учащегося на форму
входа.
Стартовый экран уже умеет показывать исчерпание — `buildStartState` выставляет `canViewResults`, когда попытки
кончились, а завершённые есть. Значит достаточно остаться на нём.

**Files:**

- Modify: `client/src/pages/learner/take-test.tsx:1026-1036` (обычная ветка)
- Modify: `client/src/pages/learner/take-test.tsx:1158-1170` (адаптивная ветка)
- Modify: `client/src/pages/learner/take-test.tsx:820-854` (общий catch)
- Test: `client/src/pages/learner/__tests__/take-test.test.tsx` (дополняется)

- [ ] **Step 1: Write the failing test**

В `client/src/pages/learner/__tests__/take-test.test.tsx`, в `describe("<TakeTestPage /> start gates")`,
ЗАМЕНИТЬ существующий тест `"toasts and returns to the list when attempts are exhausted"` (строки 375-383) на:

```tsx
  it("folds exhausted attempts into the start context instead of navigating away", async () => {
    // The learner must keep access to their result: a magic-link session has no
    // test list to fall back to, so the exhausted state renders where they are.
    await renderToStart({ startAttempt: jsonRes({ code: "ATTEMPTS_EXHAUSTED" }, false, 403) });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() => expect(ctx().state.canViewResults).toBe(true));
    expect(ctx().state.canStart).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalledWith("/learner");
  });
```

Хелперы `renderToStart`, `jsonRes`, `ctx`, `navigateSpy` и идентификатор кнопки `ts-start-test` в этом файле
уже определены. Проверить, что фикстура `renderToStart` отдаёт `maxAttempts` и хотя бы одну завершённую
попытку: без завершённой попытки `buildStartState` даст `exhausted: true` вместо `canViewResults` — тогда
утверждение проверяет `ctx().state.exhausted`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- client/src/pages/learner/__tests__/take-test.test.tsx`
Expected: FAIL — вызывается `navigate("/learner")`.

- [ ] **Step 3: Write the implementation**

В `startStandardAttempt` заменить блок обработки на:

```tsx
      if (error.code === "ATTEMPTS_EXHAUSTED") {
        // Race: the attempts ran out between loading the start screen and this
        // click (another tab). Rethrow so the shared catch can fold the fact into
        // the start screen — a magic-link session has no test list to fall back to.
        throw new Error("ATTEMPTS_EXHAUSTED");
      }
```

Такой же блок поставить в `startAdaptiveAttempt` вместо его тоста с `navigate("/learner")`.

В общий `catch` функции `handleStartTest`, перед проверкой `RETAKE_COOLDOWN`, добавить:

```tsx
      if ((err as Error)?.message === "ATTEMPTS_EXHAUSTED") {
        // Show the exhausted state where the learner already is: buildStartState
        // renders «Мой результат» once completed >= max, so only the facts change.
        setTestMetadata((m) =>
          m
            ? { ...m, completedAttempts: m.maxAttempts ?? m.completedAttempts, hasInProgress: false }
            : m,
        );
        setPhase("start");
        return;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- client/src/pages/learner/__tests__/take-test.test.tsx`
Expected: PASS, включая ранее существовавшие тесты файла (проверить, что старый тест на
`ATTEMPTS_EXHAUSTED` обновлён под новое поведение и не ждёт редиректа).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/learner/take-test.tsx client/src/pages/learner/__tests__/take-test.test.tsx
git commit -m "fix(learner): исчерпание попыток показывается на стартовом экране, без ухода в кабинет"
```

---

### Task 13: Полный прогон и приёмка в браузере

Юнит-тестов здесь недостаточно: проверяется ровно тот сценарий, с которого началось обращение.

**Files:** изменений нет.

- [ ] **Step 1: Прогнать весь набор**

Run: `npm test`
Expected: PASS, покрытие не ниже порога 80 процентов. Если порог покраснел на файлах вне этой задачи —
остановиться и доложить, покрытие вне задачи не поднимать.

- [ ] **Step 2: Проверить типы и сборку**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 3: Поднять приложение**

Run: `npm run dev`
Ожидание: сервер на порту из `.env` (в dev это 8081). Учесть, что backend без auto-restart — после серверных
правок процесс перезапускается вручную.

- [ ] **Step 4: Выпустить ссылку и пройти по ней**

Назначить тест учащемуся так, чтобы ушло письмо; в dev письмо печатается в консоль, оттуда взять адрес
`/access/<token>`. Открыть его в чистом профиле браузера и убедиться:

- открывается стартовый экран назначенного теста;
- в шапке нет пунктов «Главная», «Тесты», «История», логотип не ведёт в список;
- тест проходится целиком до экрана результата.

- [ ] **Step 5: Проверить закрытую границу**

В том же браузере обрезать адрес до `/` и убедиться, что открылась форма входа, а не кабинет. Повторить для
`/learner`, `/learner/history` и `/author/tests`. Это исходный сценарий обращения.

- [ ] **Step 6: Проверить исчерпание попыток**

Взять тест с `maxAttempts = 1`, пройти его по ссылке, вернуться по той же ссылке. Ожидание: стартовый экран,
кнопка старта не предлагается, доступен «Мой результат», ссылка продолжает работать — успешное прохождение её
не гасит.

- [ ] **Step 7: Проверить снятие ограничения**

В том же браузере перейти на `/login`, войти по паролю тем же учащимся. Ожидание: кабинет открыт полностью,
навигация в шапке вернулась.

- [ ] **Step 8: Зафиксировать результат**

Собрать короткий отчёт о приёмке со скриншотами шагов 4-7 и сообщить пользователю. Отдельно отметить, что
этапы 3 и 4 плана `docs/plans/PLAN_MAGIC_LINK_SCOPE.md` остались невыполненными и почему.
