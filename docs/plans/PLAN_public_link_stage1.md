# План: публичная ссылка на тест, этап 1

> Для исполнителей: шаги размечены `- [ ]`. Спецификация:
> [docs/specs/public-link/spec.md](../specs/public-link/spec.md).

**Цель:** автор получает публичную ссылку на опубликованный тест; посетитель проходит тест без
входа и видит итоги по настройкам теста; ничего не сохраняется.

**Архитектура:** третий потребитель механики одноразового прогона
(`server/scorm/debug-player/`). Пакет собирается из опубликованного снимка с `telemetry: null`,
кешируется в памяти по `(testId, snapshotId)`, раздаётся под `/p/:token`. Токен хранится в
отдельной таблице `test_public_links`.

**Стек:** Express 5, Drizzle (PostgreSQL), JSZip, React 19 + `@skillum/ui-kit`, Vitest +
supertest. Новых зависимостей нет.

## Расклад по исполнителям

Критерий: дешёвая модель берёт задачу, если в ней нет неочевидных мест проекта.

| Блок | Задачи | Модель | Почему |
| --- | --- | --- | --- |
| A, сервер | 1, 2, 3 | Sonnet | миграции drizzle и маршруты с гейтами — места с известными граблями; один агент на все три задачи экономит повторное чтение контекста |
| B, клиент | 4 | Sonnet | компоненты ДС и соглашения `tests-list.tsx`; Haiku здесь чаще придумывает несуществующие классы `ou-*` |
| C, документация | 5 | Haiku | механические правки текста по готовым формулировкам |
| D, проверка | 6 | Opus (главная сессия) | ревью диффа и приёмка в браузере |

Блоки A, B и C идут параллельно: контракт API зафиксирован в спецификации. Агенты не коммитят;
коммит делает главная сессия после блока D. Работа ведётся в одном worktree, файлы блоков не
пересекаются.

## Карта файлов

| Файл | Что меняется |
| --- | --- |
| `shared/schema.ts` | таблица `testPublicLinks` |
| `drizzle/0058_*.sql` + `drizzle/meta/*` | миграция (генерируется) |
| `server/storage/tests-repository.ts`, `server/storage.ts` | три метода хранилища |
| `server/scorm/debug-player/session-store.ts` | вынести `unzipPackage` |
| `server/scorm/debug-player/public-package-cache.ts` | новый: кеш пакета |
| `server/routes/public-link.ts` | новый: API автора |
| `server/routes/public-play.ts` | новый: `/p/:token` |
| `server/routes/index.ts` | монтирование двух роутеров |
| `tests/public-link-routes.test.ts`, `tests/public-package-cache.test.ts` | новые тесты |
| `client/src/features/tests/list/public-link-modal.tsx` | новый: окно |
| `client/src/features/tests/list/tests-list.tsx` | пункт меню и монтирование окна |
| `client/src/features/tests/list/__tests__/public-link-modal.test.tsx` | новый тест |

## Задача 1. Таблица и хранилище (Sonnet, блок A)

- [ ] **Шаг 1.** В `shared/schema.ts` рядом с `testAccessGrants` добавить:

```ts
/**
 * Public link of a test (stage 1: at most one per test). Kept out of `tests` on purpose:
 * the test row is copied into publication snapshots and spread into `/api/learner/tests`,
 * so a token column there would leak to every learner of the test.
 */
export const testPublicLinks = pgTable("test_public_links", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 64 }).notNull(),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  testIdx: uniqueIndex("test_public_links_test_idx").on(table.testId),
  tokenIdx: uniqueIndex("test_public_links_token_idx").on(table.token),
}));

export type TestPublicLink = typeof testPublicLinks.$inferSelect;
```

- [ ] **Шаг 2.** Сгенерировать миграцию: `npx drizzle-kit generate --name test_public_links`.
  Ожидается `drizzle/0058_test_public_links.sql` с одним `CREATE TABLE`, FK и двумя
  уникальными индексами, плюс обновлённые `drizzle/meta/_journal.json` и снимок. Если в SQL
  попало что-то кроме этой таблицы, остановиться и сообщить: это дрейф схемы, а не наша правка.
  Применить: `npm run db:migrate`.

- [ ] **Шаг 3.** В `server/storage/tests-repository.ts` добавить методы (импорт
  `testPublicLinks` из `@shared/schema`):

```ts
  /** The public link of a test, if one is enabled. */
  async getTestPublicLink(testId: string): Promise<TestPublicLink | undefined> {
    const [row] = await db.select().from(testPublicLinks).where(eq(testPublicLinks.testId, testId));
    return row;
  }

  /** Resolve a public-link token to its link row. */
  async getTestPublicLinkByToken(token: string): Promise<TestPublicLink | undefined> {
    const [row] = await db.select().from(testPublicLinks).where(eq(testPublicLinks.token, token));
    return row;
  }

  /** Issue or rotate the test's public link: one row per test, the token is replaced. */
  async upsertTestPublicLink(testId: string, token: string, createdBy: string): Promise<TestPublicLink> {
    const [row] = await db.insert(testPublicLinks)
      .values({ id: randomUUID(), testId, token, createdBy })
      .onConflictDoUpdate({
        target: testPublicLinks.testId,
        set: { token, createdBy, createdAt: new Date() },
      })
      .returning();
    return row;
  }

  /** Disable the test's public link. */
  async deleteTestPublicLink(testId: string): Promise<void> {
    await db.delete(testPublicLinks).where(eq(testPublicLinks.testId, testId));
  }
```

- [ ] **Шаг 4.** В `server/storage.ts` объявить четыре метода в `IStorage` (рядом с
  `getTest`, строка ~302) и добавить делегирование в фасаде (рядом со строкой ~1094):
  `return this.testsRepo.<method>(...)`.
- [ ] **Шаг 5.** `npm run check` — без ошибок.

## Задача 2. Кеш пакета (Sonnet, блок A)

- [ ] **Шаг 1.** В `server/scorm/debug-player/session-store.ts` вынести распаковку и поиск
  точки входа в экспортируемую функцию и использовать её в `createDebugSession`:

```ts
/** Unzip a built package into a path -> bytes map and find its launch file. */
export async function unzipPackage(zipBuffer: Buffer): Promise<{ files: Map<string, Buffer>; launch: string }> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files = new Map<string, Buffer>();
  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      if (entry.dir) return;
      files.set(entry.name, await entry.async("nodebuffer"));
    }),
  );
  return { files, launch: detectLaunch(files) };
}
```

- [ ] **Шаг 2.** Написать падающий тест `tests/public-package-cache.test.ts`: мокаются
  `../server/scorm/build-export-data` (`buildScormExportData` возвращает `{ test: { title: "T" } }`),
  `../server/scorm-exporter` (`generateScormPackage` возвращает `Buffer`) и `unzipPackage`
  (возвращает `{ files: new Map([["index.html", Buffer.from("x")]]), launch: "index.html" }`).
  Проверки:
  1. два параллельных `getPublicPackage("t1", "s1")` вызывают сборку ОДИН раз;
  2. `getPublicPackage("t1", "s2")` собирает заново;
  3. сборка вызвана с `{ source: "export" }`, а пакет — с `telemetry: null`;
  4. упавшая сборка не остаётся в кеше: следующий вызов пробует снова.
- [ ] **Шаг 3.** `npm test -- tests/public-package-cache.test.ts` — FAIL (модуля нет).
- [ ] **Шаг 4.** Создать `server/scorm/debug-player/public-package-cache.ts`:

```ts
/**
 * @module server/scorm/debug-player/public-package-cache
 * @description Built packages served under a public test link. One package per published
 * snapshot is shared by every visitor: the package is read-only, the visitor's state lives
 * in their own browser (shim + localStorage), so building it per visitor would only burn CPU.
 */
import { buildScormExportData } from "../build-export-data";
import { generateScormPackage } from "../../scorm-exporter";
import { unzipPackage } from "./session-store";

/** An unpacked package ready to serve file by file. */
export interface PublicPackage {
  files: Map<string, Buffer>;
  launch: string;
}

/** How many snapshots stay cached at once; the oldest is dropped first. */
const MAX_ENTRIES = 20;

const cache = new Map<string, Promise<PublicPackage>>();

/**
 * The package of a test's published snapshot, built once per `(testId, snapshotId)`.
 * Concurrent callers share one in-flight build; a failed build is evicted so the next
 * request retries instead of serving the error forever.
 */
export function getPublicPackage(testId: string, snapshotId: string): Promise<PublicPackage> {
  const key = `${testId}:${snapshotId}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = (async () => {
    const data = await buildScormExportData(testId, { source: "export" });
    const buffer = await generateScormPackage({ ...data, telemetry: null });
    return unzipPackage(buffer);
  })();
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Test-only reset. */
export function __clearPublicPackages(): void {
  cache.clear();
}
```

- [ ] **Шаг 5.** Тест проходит; `npm test -- tests/debug-player-session-store.test.ts` тоже
  зелёный (рефакторинг `createDebugSession`).

## Задача 3. Маршруты (Sonnet, блок A)

- [ ] **Шаг 1.** Падающий тест `tests/public-link-routes.test.ts` по образцу
  `tests/debug-player-routes.test.ts` (те же моки `db`, `storage`, `logger`, сессия через
  `express-session`; дополнительно мокаются `publishedSnapshotOf` из
  `../server/services/test-snapshot` и `getPublicPackage`). Сценарии:
  1. `GET /api/tests/:id/public-link` без ссылки → `{ url: null, published: true }`;
  2. `POST` на неопубликованный тест → `409`;
  3. `POST` на опубликованный → `200`, `url` вида `http://127.0.0.1:<port>/p/<64 hex>`,
     `upsertTestPublicLink` вызван;
  4. `DELETE` → `deleteTestPublicLink` вызван;
  5. без права `tests.edit` (роль `learner`) → `403`;
  6. `GET /p/<неизвестный>` → `404` и HTML;
  7. `GET /p/<token>` при опубликованном тесте → `200`, HTML содержит
     `/p/<token>/shim.js` и `/p/<token>/play/index.html`, заголовки `Referrer-Policy: no-referrer`,
     `X-Robots-Tag: noindex`;
  8. `GET /p/<token>/play/index.html` → байты из пакета; `/play/missing.js` → `404`;
  9. ссылка есть, но тест снят с публикации (`publishedSnapshotOf` → `null`) → `404`.
- [ ] **Шаг 2.** `npm test -- tests/public-link-routes.test.ts` — FAIL.
- [ ] **Шаг 3.** Создать `server/routes/public-link.ts`:

```ts
/**
 * @module server/routes/public-link
 * @description Author API of the public test link (stage 1): read, issue/rotate, disable.
 * Gated like the debug player — whoever may edit the test may hand it out publicly.
 */
import { Router } from "express";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { publishedSnapshotOf } from "../services/test-snapshot";
import { logger } from "../logger";

const router = Router();
const gate = [requirePermission("tests.edit"), requireTestScope("edit")];

/** Absolute URL of a public link as the author should copy it. */
function linkUrl(req: import("express").Request, token: string): string {
  return `${req.protocol}://${req.get("host")}/p/${token}`;
}

router.get("/:id/public-link", ...gate, async (req, res) => {
  const [link, snapshot] = await Promise.all([
    storage.getTestPublicLink(req.params.id),
    publishedSnapshotOf(req.params.id),
  ]);
  res.json({ url: link ? linkUrl(req, link.token) : null, published: snapshot !== null });
});

router.post("/:id/public-link", ...gate, async (req, res) => {
  if (!(await publishedSnapshotOf(req.params.id))) {
    return res.status(409).json({ error: "Test is not published" });
  }
  const token = randomBytes(32).toString("hex");
  await storage.upsertTestPublicLink(req.params.id, token, req.session.userId!);
  logger.info(`Public link issued: test=${req.params.id} by user=${req.session.userId}`, "public-link");
  res.json({ url: linkUrl(req, token), published: true });
});

router.delete("/:id/public-link", ...gate, async (req, res) => {
  await storage.deleteTestPublicLink(req.params.id);
  logger.info(`Public link disabled: test=${req.params.id} by user=${req.session.userId}`, "public-link");
  res.json({ url: null, published: (await publishedSnapshotOf(req.params.id)) !== null });
});

export default router;
```

  Обработчики обернуть в `try/catch` с `500 { error }` по образцу соседних роутеров.

- [ ] **Шаг 4.** Создать `server/routes/public-play.ts`:

```ts
/**
 * @module server/routes/public-play
 * @description Anonymous play of a test through its public link (stage 1). Nothing is
 * stored: no user, no attempt, no telemetry — the package is built with `telemetry: null`
 * and the visitor's progress lives in their browser (shim + localStorage).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { storage } from "../storage";
import { publishedSnapshotOf } from "../services/test-snapshot";
import { getPublicPackage, type PublicPackage } from "../scorm/debug-player/public-package-cache";
import { readShimJs } from "../scorm/debug-player/assets";
import { contentTypeFor } from "../scorm/debug-player/run-session";
import { logger } from "../logger";

const router = Router();

/** Tokens are 32 random bytes in hex; anything else is rejected without a DB lookup. */
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Name the package shows for an anonymous visitor (the shim's default is the preview's). */
const LEARNER_NAME = "Участник";

function noIndex(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
}

function notFoundPage(res: Response) {
  res.status(404).type("html").send(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Ссылка недействительна</title></head>' +
    '<body style="font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">' +
    "<p>Ссылка недействительна или тест больше не доступен.</p></body></html>",
  );
}

/** Resolve a token to the package of the test's CURRENT published snapshot, or null. */
async function resolve(token: string): Promise<{ testId: string; pkg: PublicPackage } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const link = await storage.getTestPublicLinkByToken(token);
  if (!link) return null;
  const snapshot = await publishedSnapshotOf(link.testId);
  if (!snapshot) return null;
  return { testId: link.testId, pkg: await getPublicPackage(link.testId, snapshot.id) };
}

router.use(noIndex);

router.get("/:token", async (req, res) => {
  try {
    const found = await resolve(req.params.token);
    if (!found) return notFoundPage(res);
    const base = `/p/${req.params.token}`;
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Тест</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>
<script src="${base}/shim.js"></script>
<script>
  window.__scorm.restore("tb-public-${req.params.token}");
  var cmi = window.__scorm.getCmi();
  cmi["cmi.learner_name"] = cmi["cmi.core.student_name"] = ${JSON.stringify(LEARNER_NAME)};
  cmi["cmi.learner_id"] = cmi["cmi.core.student_id"] = "public";
</script>
</head><body><iframe src="${base}/play/${found.pkg.launch}" title="Тест" allow="fullscreen"></iframe></body></html>`);
  } catch (error) {
    logger.error("Public link page error: " + (error as Error).message, "public-link");
    res.status(500).type("html").send("Ошибка. Попробуйте позже.");
  }
});

router.get("/:token/shim.js", (_req, res) => {
  res.type("text/javascript; charset=utf-8").send(readShimJs());
});

router.get("/:token/play{/*splat}", async (req, res) => {
  try {
    const found = await resolve(req.params.token);
    if (!found) return res.status(404).send("Not found");
    const splat = (req.params as Record<string, unknown>).splat;
    const rel = decodeURIComponent(Array.isArray(splat) ? splat.join("/") : String(splat || "")) || found.pkg.launch;
    const buf = found.pkg.files.get(rel);
    if (!buf) return res.status(404).send("Not found");
    res.setHeader("Content-Type", contentTypeFor(rel));
    res.send(buf);
  } catch (error) {
    logger.error("Public link file error: " + (error as Error).message, "public-link");
    res.status(500).send("Error");
  }
});

export default router;
```

  Проверить, что `window.__scorm.getCmi()` возвращает живой объект (в `shim.js` это так:
  `getCmi: function () { return cmi; }`), иначе имя участника не применится.

- [ ] **Шаг 5.** В `server/routes/index.ts` импортировать оба роутера и добавить в
  `routerConfig`:

```ts
  { path: "/p", router: publicPlayRouter }, // public test link — anonymous, no session needed
  { path: "/api/tests", router: publicLinkRouter }, // public test link: author API
```

  Строку `/p` поставить рядом с `/access`.

- [ ] **Шаг 6.** Прогнать — PASS, затем `npm run check` — без ошибок:

```bash
npm test -- tests/public-link-routes.test.ts tests/public-package-cache.test.ts tests/debug-player-routes.test.ts
```

## Задача 4. Окно в списке тестов (Sonnet, блок B)

Контракт API — из спецификации. Перед правкой свериться со справочником ДС и с соседним
`NewFolderModal` в `tests-list.tsx` (`ModalDialog` с `footer`, `Button variant/size`).
Значки — только `lucide-react`.

- [ ] **Шаг 1.** Падающий тест
  `client/src/features/tests/list/__tests__/public-link-modal.test.tsx` (мок `fetch`):
  1. без ссылки показан текст «Ссылка выключена» и кнопка «Включить»; клик шлёт
     `POST /api/tests/t1/public-link`, после ответа видна ссылка;
  2. со ссылкой видны поле только для чтения с адресом, «Копировать»
     (вызывает `navigator.clipboard.writeText` с адресом), «Выпустить новую» (POST),
     «Выключить» (DELETE);
  3. ответ `published: false` без ссылки: «Включить» недоступна, пояснение
     «Ссылку можно выпустить только для опубликованного теста».
- [ ] **Шаг 2.** Создать `client/src/features/tests/list/public-link-modal.tsx`: компонент
  `PublicLinkModal({ test: { id, title } | null, onClose })`. Данные — `useQuery` по ключу
  `["/api/tests", id, "public-link"]`, мутации — `apiRequest` из `@/lib/queryClient` с
  `queryClient.setQueryData` по ответу. Тексты: заголовок «Публичная ссылка»; под адресом
  «Кто угодно с этой ссылкой может пройти тест. Прохождения не сохраняются.»; после
  копирования — `toast` «Ссылка скопирована». JSDoc модуля на английском.
- [ ] **Шаг 3.** В `tests-list.tsx`: состояние
  `const [publicLinkTest, setPublicLinkTest] = useState<{ id: string; title: string } | null>(null);`
  рядом с `accessTest` (строка ~366); пункт меню после «Общий доступ» (строка ~1038), видимый при
  `can("tests.edit") && test.status === "published"`, значок `Link` из `lucide-react`,
  `data-testid={\`menu-public-link-${test.id}\`}`; монтирование
  `<PublicLinkModal test={publicLinkTest} onClose={() => setPublicLinkTest(null)} />` рядом с
  `TestAccessPanel` (строка ~923).
- [ ] **Шаг 4.** Прогнать — PASS, затем `npm run check`:

```bash
npm test -- client/src/features/tests/list/__tests__/public-link-modal.test.tsx \
  client/src/features/tests/list/__tests__/tests-list.test.tsx
```

## Задача 5. Документация (Haiku, блок C)

- [ ] `CLAUDE.md`, раздел Key Backend Components: в перечень роутеров добавить
  `public-link` (API автора) и `public-play` (`/p/:token`, анонимный прогон без записи), одной
  фразой каждый; в раздел Database — `test_public_links` (миграция `0058`, токен вне `tests`,
  чтобы не попасть в снимки и `/api/learner/tests`).
- [ ] Руководство автора в `docs/guides/` (найти файл про назначение теста): короткий раздел
  «Публичная ссылка» — где пункт меню, что прохождения не сохраняются, что ссылка работает только
  для опубликованного теста, что «Выпустить новую» отключает старую.
- [ ] `docs/reports/ANALYSIS_*.md`: новая строка «Публичная ссылка на тест (без входа, без записи
  результатов)» на нашей стороне; данные конкурентов не трогать.
- [ ] Прогнать `npx markdownlint-cli2` по изменённым `.md`; эмодзи не использовать.

## Задача 6. Проверка и приёмка (главная сессия)

- [ ] Ревью диффа блоков A–C.
- [ ] Целевые тесты из задач 2–4 и `npm run check` (полный прогон — только с разрешения
  владельца).
- [ ] Приёмка в браузере (Playwright): опубликованный тест → «Публичная ссылка» → «Включить» →
  открыть ссылку в чистом контексте без cookie → пройти → экран итогов по настройкам теста →
  обновить страницу посреди прохождения (продолжение) → «Выпустить новую» → старая ссылка
  даёт «Ссылка недействительна» → «Выключить» → новая тоже недействительна. Проверить в базе:
  в `attempts` и `scorm_attempts` не появилось строк.
- [ ] Коммит без трейлера `Co-Authored-By`.
