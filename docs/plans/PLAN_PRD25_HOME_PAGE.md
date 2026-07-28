# PRD-25 Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** заменить редирект по ролям на маршруте `/` единой адаптивной домашней страницей — личным
рабочим столом-навигатором, состав которого гейтится правами пользователя.

**Architecture:** контракт секций живёт в `shared/home/contract.ts` и импортируется обоими хостами.
Сервер собирает секции параллельно в `server/services/home/*` (по файлу на секцию), изолируя отказы,
и отдаёт их одним ответом `GET /api/home`. Клиент рендерит секции в двухколоночной раскладке на
примитивах дизайн-системы; выбор оболочки (авторская или учебная) делает тонкая обёртка маршрута.

**Tech Stack:** TypeScript, Express, Drizzle ORM (PostgreSQL), React 19 + Wouter + React Query,
`@universityrt/ui-kit`, Vitest + supertest, pglite для DAL-тестов.

---

## Нормативные документы

- Спецификация: [docs/specs/prd-25/home-page.md](../specs/prd-25/home-page.md).
- Права и роли: [docs/specs/access-control/role-model.md](../specs/access-control/role-model.md).
- Миграции: [drizzle/README.md](../../drizzle/README.md) — схема ведётся `drizzle-kit generate`,
  каталог `migrations/` легаси и деплоем не применяется.

## Roadmap (спецификация → задачи)

| Фаза спецификации | Задачи плана |
| --- | --- |
| Фаза 0. Эскизы | Task 0 |
| Фаза 1. Миграция и точки обновления | Task 1, Task 2 |
| Фаза 2. Серверный агрегатор | Task 3, Task 4, Task 5, Task 6, Task 7 |
| Фаза 3. Клиент | Task 8, Task 9, Task 10, Task 11 |
| Фаза 4. Приёмка | Task 12 |

## Структура файлов

**Создаются:**

- `shared/home/contract.ts` — типы ответа `GET /api/home`, общие для сервера и клиента.
- `server/services/home/assigned.ts` — секции «Мне назначено» и «Мои результаты».
- `server/services/home/my-tests.ts` — секция «Мои тесты» + состояние публикации по выборке.
- `server/services/home/my-topics.ts` — секция «Мои темы и вопросы».
- `server/services/home/people.ts` — секция «Люди и назначения».
- `server/services/home/summary.ts` — секция «Сводка».
- `server/services/home/materials.ts` — секция «Материалы».
- `server/services/home/quick-actions.ts` — секция «Быстрые действия».
- `server/services/home/attention.ts` — правила признаков внимания.
- `server/services/home/index.ts` — агрегатор `buildHome`.
- `server/routes/home.ts` — роут `GET /api/home`.
- `client/src/features/home/use-home.ts` — запрос данных.
- `client/src/features/home/sections/*.tsx` — по компоненту на секцию.
- `client/src/features/home/home-page.tsx` — раскладка страницы.
- `client/src/pages/home.tsx` — обёртка маршрута с выбором оболочки.
- `docs/wireframes/drafts/prd25-home.html` — эскиз.
- Тесты: `tests/home-attention.test.ts`, `tests/home-sections.test.ts`, `tests/routes.home.test.ts`,
  `client/src/features/home/__tests__/home-page.test.tsx`.

**Изменяются:**

- `shared/schema.ts` — колонка `topics.updated_at` + индекс + omit в `insertTopicSchema`.
- `server/storage/shared.ts` — помощник `touchTopics`.
- `server/storage/topics-repository.ts`, `server/storage/questions-repository.ts` — точки обновления.
- `server/storage/assignments-repository.ts`, `server/storage.ts` — метод `getAllAssignments`.
- `server/routes/index.ts` — монтирование роутера.
- `vendor/ui-kit/src/components/Layout.tsx` + обе копии `university-rt.css` — шаблон раскладки
  `main-aside` (в дизайн-системе такого примитива нет; локальный CSS вместо него запрещён).
- `client/src/App.tsx` — маршрут `/`, удаление `homePath`/`HomeRedirect`.
- `client/src/components/app-sidebar.tsx`, `client/src/pages/learner/layout.tsx` — пункт «Главная».
- `client/src/lib/i18n.ts` — строки главной.
- `tests/it/schema.sql` — регенерация после изменения схемы.

---

## Task 0: Эскиз главной и согласование

Эскиз обязателен до React-кода: UI без сверки с утверждённым эскизом не принимается.

**Files:**

- Create: `docs/wireframes/drafts/prd25-home.html`

- [ ] **Step 1: Взять за основу существующий эскиз-фрейм**

Открыть любой утверждённый эскиз из `docs/wireframes/approved/` и скопировать его каркас
(навбар с тоглами Dark/Compact/Аннотации, блоки `wf-notes` и `wf-mapping`). В холст класть только
реальный UI на классах дизайн-системы `ou-*` и `tb-components.css`; локальные `render-*` классы
запрещены.

- [ ] **Step 2: Нарисовать четыре состояния**

Один файл, переключатель профиля прав в навбаре: чистый учащийся, автор, менеджер, суперпользователь.
Для каждого — двухколоночная раскладка из раздела 6 спецификации, включая схлопывание в одну колонку,
когда правая пуста (профиль учащегося).

- [ ] **Step 3: Проверить эскиз на соответствие дизайн-системе**

```bash
npm run check:wireframes:ds
```

Ожидаемо: без нарушений по новому файлу.

- [ ] **Step 4: Согласовать эскиз и перенести в approved**

Показать эскиз, получить согласование, переместить файл в `docs/wireframes/approved/prd25-home.html`.
Без согласования к Task 8 не переходить.

- [ ] **Step 5: Commit**

```bash
git add docs/wireframes/approved/prd25-home.html
git commit -m "docs(prd-25): эскиз домашней страницы"
```

---

## Task 1: Колонка `topics.updated_at`

**Files:**

- Modify: `shared/schema.ts`
- Create: `drizzle/0002_prd25_topic_updated_at.sql` (генерируется)
- Modify: `tests/it/schema.sql` (регенерируется)

- [ ] **Step 1: Добавить колонку и индекс в схему**

В `shared/schema.ts`, таблица `topics`, после поля `code`:

```ts
  code: text("code"),
  // PRD-25 FR-20: time of the last change to the topic itself or to any of its
  // questions. Backs the «Мои темы и вопросы» home-page section, which orders by
  // recency. Touched by the topic and question repositories in the same
  // transaction as the mutation — see server/storage/shared.ts#touchTopics.
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // FR-27: hard uniqueness only WITHIN one owner; legacy unowned rows (owner
  // NULL) are excluded by the partial predicate, so they never collide.
  ownerNameIdx: uniqueIndex("topics_owner_name_normalized_idx")
    .on(table.ownerId, table.nameNormalized)
    .where(sql`owner_id IS NOT NULL`),
  // PRD-25: the home page reads the most recently touched topics first.
  updatedAtIdx: index("topics_updated_at_idx").on(table.updatedAt),
}));
```

- [ ] **Step 2: Исключить колонку из схемы вставки**

Там же, `insertTopicSchema` — колонка проставляется базой и репозиторием, а не приходит из запроса:

```ts
export const insertTopicSchema = createInsertSchema(topics).omit({ id: true, updatedAt: true }).extend({
```

- [ ] **Step 3: Сгенерировать миграцию**

```bash
node_modules/.bin/drizzle-kit generate --name=prd25_topic_updated_at
```

Ожидаемо: создан `drizzle/0002_prd25_topic_updated_at.sql`, в `drizzle/meta/_journal.json` появилась
запись `idx: 2`.

- [ ] **Step 4: Прочитать сгенерированный SQL**

Открыть `drizzle/0002_prd25_topic_updated_at.sql` и убедиться, что в нём ровно два действия:
`ALTER TABLE "topics" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;` и
`CREATE INDEX ... ON "topics" ("updated_at");`. Любой `DROP` в этом файле — стоп и разбор:
значит, схема разъехалась с базой и миграцию нельзя катить как есть.

- [ ] **Step 5: Применить миграцию к dev-базе**

Подключение брать из `.env` (dev-база — Docker на `localhost:55432`, не системный PostgreSQL).

```bash
node_modules/.bin/drizzle-kit migrate
```

- [ ] **Step 6: Регенерировать схему для интеграционных тестов**

Харнесс pglite строит базу из `tests/it/schema.sql`, а не из миграций, поэтому файл надо обновить:

```bash
npx drizzle-kit export --sql | grep -v '^DATABASE_URL:' > tests/it/schema.sql
```

- [ ] **Step 7: Type-check и прогон интеграционных тестов**

```bash
npm run check
npm run test:it
```

Ожидаемо: обе команды зелёные.

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts drizzle/ tests/it/schema.sql
git commit -m "feat(prd-25): колонка topics.updated_at и индекс по ней"
```

---

## Task 2: Точки обновления `topics.updated_at`

Обновление обязано происходить в той же транзакции, что и мутация, и покрывать мутации ВОПРОСОВ темы,
иначе порядок в секции «Мои темы» будет врать (риск R-4 спецификации).

**Files:**

- Modify: `server/storage/shared.ts`
- Modify: `server/storage/topics-repository.ts:84-92`
- Modify: `server/storage/questions-repository.ts:43-110`
- Create: `tests/it/topic-touch.it.test.ts`

- [ ] **Step 1: Написать падающий интеграционный тест**

Создать `tests/it/topic-touch.it.test.ts`. За образцом структуры (создание базы, доступ к `storage`)
смотреть соседний `tests/it/duplicate-topic.it.test.ts`.

```ts
/**
 * @module tests/it/topic-touch
 *
 * PRD-25 FR-20: every mutation of a topic or of ITS QUESTIONS must move
 * `topics.updated_at` forward, because the home page orders «Мои темы и вопросы»
 * by that column. Runs against the real DAL on pglite.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { makeTestDb } from "./db-harness";

describe("PRD-25: topics.updated_at is touched by content mutations", () => {
  let storage: Awaited<ReturnType<typeof makeTestDb>>["storage"];

  beforeAll(async () => {
    ({ storage } = await makeTestDb());
  });

  async function freshTopic() {
    const topic = await storage.createTopic({ name: `Тема ${Math.random()}`, folderId: null });
    // Push the stamp into the past so any touch is detectable.
    await storage.updateTopic(topic.id, { description: "seed" });
    return storage.getTopic(topic.id);
  }

  it("moves the stamp when the topic itself is edited", async () => {
    const before = await freshTopic();
    const stamp = before!.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await storage.updateTopic(before!.id, { name: "Переименована" });
    const after = await storage.getTopic(before!.id);
    expect(after!.updatedAt.getTime()).toBeGreaterThan(stamp);
  });

  it("moves the stamp when a question is created in the topic", async () => {
    const topic = await freshTopic();
    const stamp = topic!.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await storage.createQuestion({
      topicId: topic!.id, type: "single", prompt: "2+2?",
      dataJson: { options: ["3", "4"] }, correctJson: { index: 1 },
    });
    const after = await storage.getTopic(topic!.id);
    expect(after!.updatedAt.getTime()).toBeGreaterThan(stamp);
  });

  it("moves the stamp when a question is edited", async () => {
    const topic = await freshTopic();
    const q = await storage.createQuestion({
      topicId: topic!.id, type: "single", prompt: "2+2?",
      dataJson: { options: ["3", "4"] }, correctJson: { index: 1 },
    });
    const stamp = (await storage.getTopic(topic!.id))!.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await storage.updateQuestion(q.id, { prompt: "2+3?" });
    const after = await storage.getTopic(topic!.id);
    expect(after!.updatedAt.getTime()).toBeGreaterThan(stamp);
  });

  it("moves the stamp when a question is deleted", async () => {
    const topic = await freshTopic();
    const q = await storage.createQuestion({
      topicId: topic!.id, type: "single", prompt: "2+2?",
      dataJson: { options: ["3", "4"] }, correctJson: { index: 1 },
    });
    const stamp = (await storage.getTopic(topic!.id))!.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await storage.deleteQuestion(q.id);
    const after = await storage.getTopic(topic!.id);
    expect(after!.updatedAt.getTime()).toBeGreaterThan(stamp);
  });

  it("moves the stamp of every affected topic on a bulk delete", async () => {
    const a = await freshTopic();
    const b = await freshTopic();
    const qa = await storage.createQuestion({
      topicId: a!.id, type: "single", prompt: "a", dataJson: {}, correctJson: {},
    });
    const qb = await storage.createQuestion({
      topicId: b!.id, type: "single", prompt: "b", dataJson: {}, correctJson: {},
    });
    const stampA = (await storage.getTopic(a!.id))!.updatedAt.getTime();
    const stampB = (await storage.getTopic(b!.id))!.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await storage.deleteQuestionsBulk([qa.id, qb.id]);
    expect((await storage.getTopic(a!.id))!.updatedAt.getTime()).toBeGreaterThan(stampA);
    expect((await storage.getTopic(b!.id))!.updatedAt.getTime()).toBeGreaterThan(stampB);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

```bash
npx vitest run --config vitest.it.config.ts tests/it/topic-touch.it.test.ts
```

Ожидаемо: FAIL — штамп не двигается ни в одном сценарии, кроме, возможно, прямого `updateTopic`.

- [ ] **Step 3: Добавить помощник в `server/storage/shared.ts`**

```ts
import { inArray, sql } from "drizzle-orm";
import { topics } from "@shared/schema";

/**
 * PRD-25 FR-20: move `topics.updated_at` to now for the given topics. Accepts an
 * executor so callers can run it inside their own transaction — the stamp must
 * move atomically with the mutation that caused it, otherwise a rolled-back
 * write would leave a bogus recency in the home page ordering.
 *
 * @param executor Drizzle db handle or an open transaction.
 * @param topicIds Topic ids to touch; empty input is a no-op.
 */
export async function touchTopics(
  executor: { update: typeof import("../db").db.update },
  topicIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(topicIds.filter(Boolean))];
  if (ids.length === 0) return;
  await executor.update(topics).set({ updatedAt: sql`now()` }).where(inArray(topics.id, ids));
}
```

- [ ] **Step 4: Обновить штамп при правке самой темы**

`server/storage/topics-repository.ts`, метод `updateTopic` — добавить поле в патч:

```ts
  async updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic | undefined> {
    // PRD-15 FR-27: a rename must refresh the normalized name too.
    const patch =
      typeof updates.name === "string"
        ? { ...updates, nameNormalized: normalizeTopicName(updates.name) }
        : updates;
    // PRD-25 FR-20: any edit of the topic moves its recency stamp.
    const [updated] = await db
      .update(topics)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(topics.id, id))
      .returning();
    return updated || undefined;
  }
```

Импорт `sql` в этом файле добавить в существующую строку: `import { eq, inArray, sql } from "drizzle-orm";`.

- [ ] **Step 5: Обновить штамп при мутациях вопросов**

`server/storage/questions-repository.ts` — импортировать помощник и вызвать его в пяти методах.
Для методов, где темы заранее не известны (`updateQuestion`, `deleteQuestion`, `deleteQuestionsBulk`),
темы читаются ДО мутации, потому что после удаления строк их уже не узнать.

```ts
import { touchTopics } from "./shared";

  async createQuestion(question: InsertQuestion): Promise<Question> {
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(questions).values(this.questionInsertValues(question)).returning();
      // PRD-25 FR-20: the topic's recency reflects changes to its questions.
      await touchTopics(tx, [created.topicId]);
      return created;
    });
  }

  async updateQuestion(id: string, updates: Partial<InsertQuestion>): Promise<Question | undefined> {
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(questions).set(updates).where(eq(questions.id, id)).returning();
      if (!updated) return undefined;
      await touchTopics(tx, [updated.topicId]);
      return updated;
    });
  }

  async deleteQuestion(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select({ topicId: questions.topicId }).from(questions).where(eq(questions.id, id));
      const result = await tx.delete(questions).where(eq(questions.id, id));
      if (!row) return false;
      await touchTopics(tx, [row.topicId]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  async deleteQuestionsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return db.transaction(async (tx) => {
      const rows = await tx.select({ topicId: questions.topicId }).from(questions).where(inArray(questions.id, ids));
      const result = await tx.delete(questions).where(inArray(questions.id, ids));
      await touchTopics(tx, rows.map((r) => r.topicId));
      return result.rowCount ?? 0;
    });
  }
```

Метод `duplicateQuestion` уже создаёт вопрос — добавить в него `await touchTopics(tx, [copy.topicId]);`
после вставки копии, сохранив существующую структуру метода.

- [ ] **Step 6: Проверить путь импорта из Excel**

```bash
grep -rn "createQuestion\|deleteQuestionsBulk\|updateQuestion" server/services/questions-import.ts
```

Убедиться, что импорт идёт через репозиторий, а не пишет в `questions` напрямую. Если найдётся прямая
запись в таблицу — добавить туда `touchTopics` тем же способом, иначе импорт не будет двигать штамп.

- [ ] **Step 7: Запустить тесты — зелёные**

```bash
npx vitest run --config vitest.it.config.ts tests/it/topic-touch.it.test.ts
npx vitest run tests/storage/questions-repository.test.ts tests/storage/topics-repository.test.ts
```

Ожидаемо: PASS. Если юнит-тесты репозиториев мокают `db` без `transaction`, дополнить мок так, чтобы
`db.transaction(cb)` вызывал `cb` с тем же моком.

- [ ] **Step 8: Type-check и commit**

```bash
npm run check
git add server/storage/ tests/it/topic-touch.it.test.ts
git commit -m "feat(prd-25): обновление topics.updated_at при мутациях темы и её вопросов"
```

---

## Task 3: Контракт ответа `GET /api/home`

**Files:**

- Create: `shared/home/contract.ts`

- [ ] **Step 1: Описать контракт**

```ts
/**
 * @module shared/home/contract
 *
 * PRD-25: the wire contract of `GET /api/home`. Both hosts import it — the server
 * builds this shape, the React page consumes it — so a section cannot drift
 * between them. Every section is OPTIONAL: an absent key means «the user has no
 * right to this section», a present `{ failed: true }` means «the source errored»
 * (FR-15), and a present payload with empty items means «nothing yet» (FR-17).
 */

/** Severity of an attention row; drives the tone of the DS tag. */
export type AttentionSeverity = "info" | "warning";

/** Machine-readable kind of an attention row (spec section 5). */
export type AttentionKind =
  | "attempt-in-progress"
  | "retake-available"
  | "test-empty-draft"
  | "test-edited-after-publish"
  | "test-pool-drift"
  | "topic-duplicates"
  | "assignment-not-started";

/** One actionable row of the «Требует внимания» section. */
export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  subtitle: string | null;
  href: string;
  action: string;
}

/** One button of the «Быстрые действия» section. */
export interface QuickAction {
  id: string;
  label: string;
  href: string;
}

/** A test the current user is assigned to take. */
export interface AssignedTestItem {
  testId: string;
  title: string;
  description: string | null;
  questionCount: number;
  completedAttempts: number;
  maxAttempts: number | null;
  inProgressAttemptId: string | null;
  /** Set when a cooldown blocks a new attempt (PRD-6); null = may start. */
  blockedUntil: string | null;
}

/** A finished attempt of the current user. */
export interface RecentResultItem {
  attemptId: string;
  testTitle: string;
  finishedAt: string;
  percent: number;
  passed: boolean | null;
}

/** Publication state of a test as shown on the home page. */
export type HomeTestStatus = "draft" | "published" | "published_with_changes" | "archived";

/** A test the current user owns or has been granted access to. */
export interface MyTestItem {
  testId: string;
  title: string;
  status: HomeTestStatus;
  sectionCount: number;
  questionCount: number;
  updatedAt: string;
  owned: boolean;
  /** Attention kinds raised for this test, so the card can badge itself. */
  flags: AttentionKind[];
  canEdit: boolean;
  canDebug: boolean;
  canExport: boolean;
}

/** A topic the current user owns or may use. */
export interface MyTopicItem {
  topicId: string;
  name: string;
  code: string | null;
  questionCount: number;
  updatedAt: string;
  owned: boolean;
}

/** A section that may be present, absent (no right) or failed (FR-15). */
export type HomeSection<T> = T | { failed: true };

/** The whole payload of `GET /api/home`. */
export interface HomePayload {
  attention?: HomeSection<AttentionItem[]>;
  quickActions?: HomeSection<QuickAction[]>;
  assigned?: HomeSection<{ items: AssignedTestItem[]; total: number }>;
  recentResults?: HomeSection<{ items: RecentResultItem[] }>;
  myTests?: HomeSection<{ items: MyTestItem[]; total: number }>;
  myTopics?: HomeSection<{ items: MyTopicItem[]; total: number }>;
  peopleAssignments?: HomeSection<{ activeAssignments: number; notStarted: number; newUsers7d: number }>;
  summary?: HomeSection<{ attempts30d: number; passRate: number; avgPercent: number; activeUsers: number }>;
  /** `activeTemplates` are NAMES: PRD-3 allows several templates in the `active` state at once. */
  materials?: HomeSection<{ activeTemplates: string[]; docs: Array<{ id: string; label: string; href: string }> }>;
}

/** Narrowing helper: did this section fail to load. */
export function sectionFailed<T>(section: HomeSection<T> | undefined): section is { failed: true } {
  return !!section && typeof section === "object" && (section as { failed?: boolean }).failed === true;
}

/** Narrowing helper: is this section present and loaded. */
export function sectionData<T>(section: HomeSection<T> | undefined): T | null {
  if (!section || sectionFailed(section)) return null;
  return section as T;
}
```

- [ ] **Step 2: Type-check и commit**

```bash
npm run check
git add shared/home/contract.ts
git commit -m "feat(prd-25): контракт ответа /api/home"
```

---

## Task 4: Секции учащегося — «Мне назначено» и «Мои результаты»

Логика cooldown НЕ дублируется: используются те же чистые функции `decideRetake` и
`lastCompletedAttemptDate`, что и в `/api/learner/tests`. Существующий обработчик не трогаем — он
отдаёт более широкую форму для стартового экрана, и его рефакторинг не входит в задачу.

**Files:**

- Create: `server/services/home/assigned.ts`
- Create: `tests/home-sections.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
/**
 * PRD-25: home-page section builders. Storage is mocked — these tests pin the
 * shaping and ordering rules, not the DAL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAssignedTestsForUser: vi.fn(),
    getTestSections: vi.fn(),
    getAttemptsByUserAndTest: vi.fn(),
    getAttemptsByUser: vi.fn(),
    getTest: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { buildAssigned, buildRecentResults } from "../server/services/home/assigned";

const t1 = { id: "t1", title: "JS", description: null, maxAttempts: 2, retakePolicyJson: null };
const t2 = { id: "t2", title: "TS", description: null, maxAttempts: null, retakePolicyJson: null };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTestSections.mockResolvedValue([{ drawCount: 5 }]);
});

describe("buildAssigned", () => {
  it("puts a test with an in-progress attempt first", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([t1, t2]);
    storageMock.getAttemptsByUserAndTest.mockImplementation(async (_u: string, testId: string) =>
      testId === "t2" ? [{ id: "a2", finishedAt: null, variantJson: null }] : [],
    );

    const result = await buildAssigned("u1");

    expect(result.items[0].testId).toBe("t2");
    expect(result.items[0].inProgressAttemptId).toBe("a2");
    expect(result.total).toBe(2);
  });

  it("caps the list at four items but reports the true total", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([t1, t2, t1, t2, t1, t2]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);

    const result = await buildAssigned("u1");

    expect(result.items).toHaveLength(4);
    expect(result.total).toBe(6);
  });
});

describe("buildRecentResults", () => {
  it("returns the three most recent finished attempts, newest first", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([
      { id: "a1", testId: "t1", finishedAt: new Date("2026-01-01"), resultJson: { overallPercent: 50, overallPassed: false } },
      { id: "a2", testId: "t1", finishedAt: null, resultJson: null },
      { id: "a3", testId: "t1", finishedAt: new Date("2026-03-01"), resultJson: { overallPercent: 90, overallPassed: true } },
      { id: "a4", testId: "t1", finishedAt: new Date("2026-02-01"), resultJson: { overallPercent: 70, overallPassed: true } },
      { id: "a5", testId: "t1", finishedAt: new Date("2025-12-01"), resultJson: { overallPercent: 10, overallPassed: false } },
    ]);
    storageMock.getTest.mockResolvedValue({ id: "t1", title: "JS" });

    const result = await buildRecentResults("u1");

    expect(result.items.map((i) => i.attemptId)).toEqual(["a3", "a4", "a1"]);
    expect(result.items[0].percent).toBe(90);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npx vitest run tests/home-sections.test.ts
```

Ожидаемо: FAIL — «Failed to resolve import ../server/services/home/assigned».

- [ ] **Step 3: Реализовать сборщики**

```ts
/**
 * @module server/services/home/assigned
 *
 * PRD-25: the two learner-facing home sections — «Мне назначено» (FR-07) and
 * «Мои результаты» (FR-08). The cooldown decision reuses the SAME pure helpers as
 * `/api/learner/tests` (`decideRetake` / `lastCompletedAttemptDate`), so the home
 * page and the start screen can never disagree about whether a retake is open.
 */
import { storage } from "../../storage";
import { decideRetake, lastCompletedAttemptDate, toIsoDateUTC } from "../retake-gate";
import type { RetakePolicy, AttemptResult } from "@shared/schema";
import type { AssignedTestItem, RecentResultItem } from "@shared/home/contract";

/** How many assigned tests the section shows before «показать все» (FR-07). */
const ASSIGNED_LIMIT = 4;
/** How many finished attempts the results section shows (FR-08). */
const RESULTS_LIMIT = 3;

/**
 * Assigned tests for the learner, in-progress first, capped at {@link ASSIGNED_LIMIT}.
 * `total` reports the true assignment count so the UI can label the «показать все» link.
 */
export async function buildAssigned(userId: string): Promise<{ items: AssignedTestItem[]; total: number }> {
  const assigned = await storage.getAssignedTestsForUser(userId);

  const built = await Promise.all(
    assigned.map(async (test) => {
      const sections = await storage.getTestSections(test.id);
      const questionCount = sections.reduce((sum, s) => sum + (s.drawCount ?? 0), 0);
      const attempts = await storage.getAttemptsByUserAndTest(userId, test.id);
      const completed = attempts.filter((a) => a.finishedAt !== null);
      const inProgress = attempts.find((a) => a.finishedAt === null) ?? null;

      const gate = decideRetake(
        test.retakePolicyJson as RetakePolicy | null,
        lastCompletedAttemptDate(completed.map((a) => a.finishedAt)),
        toIsoDateUTC(new Date()),
      );

      const item: AssignedTestItem = {
        testId: test.id,
        title: test.title,
        description: test.description ?? null,
        questionCount,
        completedAttempts: completed.length,
        maxAttempts: test.maxAttempts ?? null,
        inProgressAttemptId: inProgress?.id ?? null,
        blockedUntil: gate.allowed ? null : gate.availableDate ?? null,
      };
      return item;
    }),
  );

  // In-progress first (FR-07); the rest keep the assignment order.
  const ordered = [
    ...built.filter((i) => i.inProgressAttemptId !== null),
    ...built.filter((i) => i.inProgressAttemptId === null),
  ];
  return { items: ordered.slice(0, ASSIGNED_LIMIT), total: ordered.length };
}

/** The learner's most recent finished attempts, newest first (FR-08). */
export async function buildRecentResults(userId: string): Promise<{ items: RecentResultItem[] }> {
  const attempts = await storage.getAttemptsByUser(userId);
  const finished = attempts
    .filter((a) => a.finishedAt !== null)
    .sort((a, b) => new Date(b.finishedAt as Date).getTime() - new Date(a.finishedAt as Date).getTime())
    .slice(0, RESULTS_LIMIT);

  const items = await Promise.all(
    finished.map(async (attempt) => {
      const test = attempt.testId ? await storage.getTest(attempt.testId) : undefined;
      const result = attempt.resultJson as AttemptResult | null;
      const item: RecentResultItem = {
        attemptId: attempt.id,
        testTitle: test?.title ?? "Тест удалён",
        finishedAt: new Date(attempt.finishedAt as Date).toISOString(),
        percent: typeof result?.overallPercent === "number" ? result.overallPercent : 0,
        passed: result?.overallPassed ?? null,
      };
      return item;
    }),
  );
  return { items };
}
```

- [ ] **Step 4: Запустить тесты — зелёные**

```bash
npx vitest run tests/home-sections.test.ts
```

Ожидаемо: PASS.

- [ ] **Step 5: Type-check и commit**

```bash
npm run check
git add server/services/home/assigned.ts tests/home-sections.test.ts
git commit -m "feat(prd-25): секции «Мне назначено» и «Мои результаты»"
```

---

## Task 5: Секции автора — «Мои тесты» и «Мои темы и вопросы»

Состояние публикации считается ТОЛЬКО по выборке до шести тестов (риск R-3 спецификации): проверка
по всему пулу линейна по числу тестов и выполнялась бы на каждый вход.

**Files:**

- Create: `server/services/home/my-tests.ts`
- Create: `server/services/home/my-topics.ts`
- Modify: `tests/home-sections.test.ts`

- [ ] **Step 1: Дописать падающие тесты в `tests/home-sections.test.ts`**

Добавить в блок `vi.hoisted` методы `getTests`, `getTopics`, `getQuestionsByTopic`,
`getTestSections`, замокать сервисы скоупа и снапшотов, затем добавить блоки:

```ts
vi.mock("../server/services/test-access", () => ({
  readableTestScope: vi.fn().mockResolvedValue({ all: true, ids: new Set() }),
}));
vi.mock("../server/services/topic-access", () => ({
  visibleTopicScope: vi.fn().mockResolvedValue({ all: true, ids: new Set() }),
}));
vi.mock("../server/services/test-snapshot", () => ({
  getPublicationState: vi.fn().mockResolvedValue({ state: "draft", editedAfterPublish: false, poolDrift: false }),
}));

import { buildMyTests } from "../server/services/home/my-tests";
import { buildMyTopics } from "../server/services/home/my-topics";

describe("buildMyTests", () => {
  it("orders by updatedAt desc and caps at six", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`, title: `T${i}`, ownerId: "u1", status: "draft",
      updatedAt: new Date(2026, 0, i + 1),
    }));
    storageMock.getTests.mockResolvedValue(many);
    storageMock.getTestSections.mockResolvedValue([{ drawCount: 3 }]);

    const result = await buildMyTests("u1", ["author"]);

    expect(result.items).toHaveLength(6);
    expect(result.items[0].testId).toBe("t7");
    expect(result.total).toBe(8);
  });

  it("marks a test the user does not own as not owned", async () => {
    storageMock.getTests.mockResolvedValue([
      { id: "t1", title: "T", ownerId: "someone-else", status: "draft", updatedAt: new Date() },
    ]);
    storageMock.getTestSections.mockResolvedValue([]);

    const result = await buildMyTests("u1", ["author"]);

    expect(result.items[0].owned).toBe(false);
  });
});

describe("buildMyTopics", () => {
  it("orders by updatedAt desc, caps at six and counts questions", async () => {
    storageMock.getTopics.mockResolvedValue([
      { id: "a", name: "A", code: null, ownerId: "u1", updatedAt: new Date(2026, 0, 1) },
      { id: "b", name: "B", code: "bee", ownerId: "u2", updatedAt: new Date(2026, 0, 5) },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([{ id: "q1" }, { id: "q2" }]);

    const result = await buildMyTopics("u1", ["author"]);

    expect(result.items.map((i) => i.topicId)).toEqual(["b", "a"]);
    expect(result.items[0].questionCount).toBe(2);
    expect(result.items[0].owned).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npx vitest run tests/home-sections.test.ts
```

Ожидаемо: FAIL по неразрешённым импортам двух новых модулей.

- [ ] **Step 3: Реализовать `server/services/home/my-tests.ts`**

```ts
/**
 * @module server/services/home/my-tests
 *
 * PRD-25 FR-09: the «Мои тесты» home section. Visibility comes from the SAME
 * scope service the tests list uses (`readableTestScope`) — the home page never
 * defines its own notion of who may see what (FR-16).
 *
 * Publication state is resolved ONLY for the tests that made it into the capped
 * window. `getPublicationState` is a per-test query; running it across the whole
 * pool on every landing would be linear in the number of tests (spec risk R-3).
 */
import { storage } from "../../storage";
import { readableTestScope } from "../test-access";
import { getPublicationState } from "../test-snapshot";
import { hasPermission } from "@shared/access";
import type { Role } from "@shared/access";
import type { AttentionKind, HomeTestStatus, MyTestItem } from "@shared/home/contract";

/** How many tests the section shows before «показать все» (FR-09). */
const TESTS_LIMIT = 6;

export async function buildMyTests(
  userId: string,
  roles: readonly Role[],
): Promise<{ items: MyTestItem[]; total: number }> {
  const scope = await readableTestScope(roles, userId);
  const all = await storage.getTests();
  const visible = scope.all ? all : all.filter((t) => scope.ids.has(t.id));

  const window = [...visible]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, TESTS_LIMIT);

  const canEdit = hasPermission(roles, "tests.edit");
  const canDebug = hasPermission(roles, "tests.export.scorm");
  const canPublish = hasPermission(roles, "tests.publish");

  const items = await Promise.all(
    window.map(async (test) => {
      const sections = await storage.getTestSections(test.id);
      const publication = await getPublicationState(test.id);

      const flags: AttentionKind[] = [];
      const questionCount = sections.reduce((sum, s) => sum + (s.drawCount ?? 0), 0);
      if (test.status === "draft" && questionCount === 0) flags.push("test-empty-draft");
      if (canPublish && publication.editedAfterPublish) flags.push("test-edited-after-publish");
      if (canPublish && publication.poolDrift) flags.push("test-pool-drift");

      const item: MyTestItem = {
        testId: test.id,
        title: test.title,
        status: publication.state as HomeTestStatus,
        sectionCount: sections.length,
        questionCount,
        updatedAt: new Date(test.updatedAt).toISOString(),
        owned: test.ownerId === userId,
        flags,
        canEdit,
        canDebug,
        canExport: canDebug,
      };
      return item;
    }),
  );

  // Tests needing action float to the top of the already recency-ordered window.
  const ordered = [...items.filter((i) => i.flags.length > 0), ...items.filter((i) => i.flags.length === 0)];
  return { items: ordered, total: visible.length };
}
```

- [ ] **Step 4: Реализовать `server/services/home/my-topics.ts`**

```ts
/**
 * @module server/services/home/my-topics
 *
 * PRD-25 FR-10: the «Мои темы и вопросы» home section. Ordering is by
 * `topics.updated_at`, the column introduced for exactly this purpose — it moves
 * both when the topic is edited and when any of its questions changes, so the
 * section really answers «где я работал последним».
 */
import { storage } from "../../storage";
import { visibleTopicScope } from "../topic-access";
import type { Role } from "@shared/access";
import type { MyTopicItem } from "@shared/home/contract";

/** How many topics the section shows before «показать все» (FR-10). */
const TOPICS_LIMIT = 6;

export async function buildMyTopics(
  userId: string,
  roles: readonly Role[],
): Promise<{ items: MyTopicItem[]; total: number }> {
  const scope = await visibleTopicScope(roles, userId);
  const all = await storage.getTopics();
  const visible = scope.all ? all : all.filter((t) => scope.ids.has(t.id));

  const window = [...visible]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, TOPICS_LIMIT);

  const items = await Promise.all(
    window.map(async (topic) => {
      const questions = await storage.getQuestionsByTopic(topic.id);
      const item: MyTopicItem = {
        topicId: topic.id,
        name: topic.name,
        code: topic.code ?? null,
        questionCount: questions.length,
        updatedAt: new Date(topic.updatedAt).toISOString(),
        owned: topic.ownerId === userId,
      };
      return item;
    }),
  );
  return { items, total: visible.length };
}
```

- [ ] **Step 5: Запустить тесты — зелёные**

```bash
npx vitest run tests/home-sections.test.ts
```

Ожидаемо: PASS.

- [ ] **Step 6: Type-check и commit**

```bash
npm run check
git add server/services/home/ tests/home-sections.test.ts
git commit -m "feat(prd-25): секции «Мои тесты» и «Мои темы и вопросы»"
```

---

## Task 6: Признаки внимания, быстрые действия и малые секции

**Files:**

- Create: `server/services/home/attention.ts`
- Create: `server/services/home/quick-actions.ts`
- Create: `server/services/home/people.ts`
- Create: `server/services/home/summary.ts`
- Create: `server/services/home/materials.ts`
- Create: `tests/home-attention.test.ts`
- Modify: `server/storage/assignments-repository.ts`, `server/storage.ts` — `getAllAssignments`

- [ ] **Step 1: Написать падающий тест правил внимания**

```ts
/**
 * PRD-25 section 5: attention rules. Pure shaping over already-built section
 * data — no storage, no network, so the rules can be pinned exactly.
 */
import { describe, it, expect } from "vitest";
import { buildAttention } from "../server/services/home/attention";
import type { AssignedTestItem, MyTestItem } from "@shared/home/contract";

const assigned = (over: Partial<AssignedTestItem> = {}): AssignedTestItem => ({
  testId: "t1", title: "JS", description: null, questionCount: 5,
  completedAttempts: 0, maxAttempts: null, inProgressAttemptId: null, blockedUntil: null, ...over,
});

const myTest = (over: Partial<MyTestItem> = {}): MyTestItem => ({
  testId: "t1", title: "JS", status: "draft", sectionCount: 1, questionCount: 0,
  updatedAt: "2026-01-01T00:00:00.000Z", owned: true, flags: [],
  canEdit: true, canDebug: true, canExport: true, ...over,
});

describe("buildAttention", () => {
  it("raises an in-progress attempt with a resume link", () => {
    const rows = buildAttention({ assigned: [assigned({ inProgressAttemptId: "a1" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("attempt-in-progress");
    expect(rows[0].href).toBe("/learner/test/t1");
  });

  it("does not raise a retake row while the cooldown is still closed", () => {
    const rows = buildAttention({ assigned: [assigned({ blockedUntil: "2030-01-01", completedAttempts: 1 })] });
    expect(rows).toHaveLength(0);
  });

  it("raises a retake row once the cooldown is open and attempts remain", () => {
    const rows = buildAttention({ assigned: [assigned({ blockedUntil: null, completedAttempts: 1, maxAttempts: 3 })] });
    expect(rows.map((r) => r.kind)).toEqual(["retake-available"]);
  });

  it("does not raise a retake row when attempts are exhausted", () => {
    const rows = buildAttention({ assigned: [assigned({ completedAttempts: 3, maxAttempts: 3 })] });
    expect(rows).toHaveLength(0);
  });

  it("turns test flags into rows with the editor link", () => {
    const rows = buildAttention({ myTests: [myTest({ flags: ["test-empty-draft"] })] });
    expect(rows[0].kind).toBe("test-empty-draft");
    expect(rows[0].href).toBe("/author/tests");
  });

  it("raises one row per duplicate topic group", () => {
    const rows = buildAttention({ duplicateTopicGroups: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("topic-duplicates");
    expect(rows[0].subtitle).toContain("3");
  });

  it("returns an empty list when nothing needs attention", () => {
    expect(buildAttention({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npx vitest run tests/home-attention.test.ts
```

Ожидаемо: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `server/services/home/attention.ts`**

```ts
/**
 * @module server/services/home/attention
 *
 * PRD-25 section 5: the rules behind «Требует внимания». This module derives rows
 * from data the other section builders already produced — it computes nothing on
 * its own, so a rule can never disagree with the card it points at. Callers pass
 * only what the user is allowed to see, which is what keeps the section gated.
 */
import type { AssignedTestItem, AttentionItem, MyTestItem } from "@shared/home/contract";

/** Inputs, all optional: an absent key means «that section is not visible». */
export interface AttentionInput {
  assigned?: AssignedTestItem[];
  myTests?: MyTestItem[];
  duplicateTopicGroups?: number;
  assignmentsNotStarted?: number;
}

/** Human-readable label per test flag. */
const TEST_FLAG_TEXT: Record<string, { title: string; action: string; severity: "info" | "warning" }> = {
  "test-empty-draft": { title: "Черновик без вопросов", action: "Открыть редактор", severity: "info" },
  "test-edited-after-publish": { title: "Изменён после публикации", action: "Опубликовать заново", severity: "warning" },
  "test-pool-drift": { title: "Пул вопросов разошёлся со снапшотом", action: "Посмотреть расхождения", severity: "warning" },
};

/**
 * Build the attention rows. Returns an empty array when nothing applies — the UI
 * then drops the section entirely (FR-05).
 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const rows: AttentionItem[] = [];

  for (const test of input.assigned ?? []) {
    if (test.inProgressAttemptId) {
      rows.push({
        id: `attempt-in-progress:${test.testId}`,
        kind: "attempt-in-progress",
        severity: "info",
        title: "Незавершённая попытка",
        subtitle: test.title,
        href: `/learner/test/${test.testId}`,
        action: "Продолжить",
      });
      continue;
    }
    // A retake is worth surfacing only when the cooldown is open AND the learner
    // still has attempts left — otherwise the row would offer a dead action.
    const attemptsLeft = test.maxAttempts === null || test.completedAttempts < test.maxAttempts;
    if (test.blockedUntil === null && test.completedAttempts > 0 && attemptsLeft) {
      rows.push({
        id: `retake-available:${test.testId}`,
        kind: "retake-available",
        severity: "info",
        title: "Доступна новая попытка",
        subtitle: test.title,
        href: `/learner/test/${test.testId}`,
        action: "Пройти снова",
      });
    }
  }

  for (const test of input.myTests ?? []) {
    for (const flag of test.flags) {
      const text = TEST_FLAG_TEXT[flag];
      if (!text) continue;
      rows.push({
        id: `${flag}:${test.testId}`,
        kind: flag,
        severity: text.severity,
        title: text.title,
        subtitle: test.title,
        href: "/author/tests",
        action: text.action,
      });
    }
  }

  if ((input.duplicateTopicGroups ?? 0) > 0) {
    rows.push({
      id: "topic-duplicates",
      kind: "topic-duplicates",
      severity: "info",
      title: "Найдены темы с одинаковыми названиями",
      subtitle: `Групп совпадений: ${input.duplicateTopicGroups}`,
      href: "/author/content",
      action: "Открыть отчёт",
    });
  }

  if ((input.assignmentsNotStarted ?? 0) > 0) {
    rows.push({
      id: "assignment-not-started",
      kind: "assignment-not-started",
      severity: "info",
      title: "Назначения без единой начатой попытки",
      subtitle: `Назначений: ${input.assignmentsNotStarted}`,
      href: "/author/tests",
      action: "Открыть назначения",
    });
  }

  // Warnings first — a drifted published test outranks a nudge.
  return [...rows.filter((r) => r.severity === "warning"), ...rows.filter((r) => r.severity === "info")];
}
```

- [ ] **Step 4: Реализовать `server/services/home/quick-actions.ts`**

```ts
/**
 * @module server/services/home/quick-actions
 *
 * PRD-25 FR-06: the quick-action buttons, filtered by capability. Every action
 * must land on a screen where the create form is reachable in one step; the list
 * is deliberately short — five buttons is the cap the spec sets.
 */
import { hasPermission } from "@shared/access";
import type { Capability, Role } from "@shared/access";
import type { QuickAction } from "@shared/home/contract";

const CANDIDATES: Array<QuickAction & { perm: Capability }> = [
  { id: "test-create", label: "Создать тест", href: "/author/tests", perm: "tests.create" },
  { id: "content-add", label: "Добавить тему или вопрос", href: "/author/content", perm: "topics.manage" },
  { id: "import", label: "Импорт из Excel", href: "/author/import", perm: "questions.importExport" },
  { id: "assign", label: "Назначить тест", href: "/author/tests", perm: "assignments.manage" },
  { id: "user-create", label: "Добавить пользователя", href: "/author/users", perm: "users.create" },
];

export function buildQuickActions(roles: readonly Role[]): QuickAction[] {
  return CANDIDATES.filter((a) => hasPermission(roles, a.perm)).map(({ perm: _perm, ...action }) => action);
}
```

- [ ] **Step 5a: Добавить в DAL чтение всех назначений**

`IStorage` умеет читать назначения по тесту, по пользователю и по группе, но не все сразу, а секции
нужен именно общий счётчик. Метод добавляется по образцу уже существующего `getAllAttempts`.

В `server/storage/assignments-repository.ts`:

```ts
  /** PRD-25 FR-11: every assignment, for the home-page counters. */
  async getAllAssignments(): Promise<TestAssignment[]> {
    return db.select().from(testAssignments);
  }
```

В `server/storage.ts` — объявление в интерфейсе `IStorage` рядом с остальными методами назначений:

```ts
  getAllAssignments(): Promise<TestAssignment[]>;
```

и делегирование в классе-фасаде:

```ts
  getAllAssignments(): Promise<TestAssignment[]> {
    return this.assignmentsRepo.getAllAssignments();
  }
```

- [ ] **Step 5b: Реализовать `server/services/home/people.ts`**

Таблица `test_assignments` не имеет колонки состояния: назначение либо существует, либо удалено.
«Активным» считается назначение без просроченного `dueDate`. Счётчик «не начали» считается только по
персональным назначениям — у групповых `userId` равен `NULL`, и раскрытие групп в состав пользователей
дало бы запрос на группу на каждый вход ради счётчика.

```ts
/**
 * @module server/services/home/people
 *
 * PRD-25 FR-11: the «Люди и назначения» counters. Deliberately counters and not a
 * list — the manager's working surface is the users screen; the home page only
 * tells them whether anything is stalled.
 *
 * `test_assignments` has no state column (an assignment exists or is deleted), so
 * «active» means «not past its due date». «Not started» counts PERSONAL
 * assignments only: a group assignment carries a NULL `userId`, and expanding
 * groups into members would cost a query per group on every landing.
 */
import { storage } from "../../storage";

/** Window for «new users», in days. */
const NEW_USER_WINDOW_DAYS = 7;

export async function buildPeople(): Promise<{ activeAssignments: number; notStarted: number; newUsers7d: number }> {
  const assignments = await storage.getAllAssignments();
  const now = Date.now();
  const active = assignments.filter((a) => a.dueDate === null || new Date(a.dueDate).getTime() >= now);

  const personal = active.filter((a) => a.userId !== null);
  const started = await Promise.all(
    personal.map(async (a) => (await storage.getAttemptsByUserAndTest(a.userId!, a.testId)).length > 0),
  );
  const notStarted = started.filter((hasAttempt) => !hasAttempt).length;

  const cutoff = now - NEW_USER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const users = await storage.getUsers();
  const newUsers7d = users.filter((u) => new Date(u.createdAt).getTime() >= cutoff).length;

  return { activeAssignments: active.length, notStarted, newUsers7d };
}
```

- [ ] **Step 6: Реализовать `server/services/home/summary.ts`**

```ts
/**
 * @module server/services/home/summary
 *
 * PRD-25 FR-12: four numbers over the last 30 days. No charts and no trends — the
 * home page must not become a second analytics screen (spec risk R-1). Scope is
 * the same as the analytics section uses, so the numbers match that screen.
 */
import { storage } from "../../storage";
import { readableTestScope } from "../test-access";
import type { Role } from "@shared/access";
import type { AttemptResult } from "@shared/schema";

/** Reporting window, in days. */
const WINDOW_DAYS = 30;

export async function buildSummary(
  userId: string,
  roles: readonly Role[],
): Promise<{ attempts30d: number; passRate: number; avgPercent: number; activeUsers: number }> {
  const scope = await readableTestScope(roles, userId);
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const all = await storage.getAllAttempts();
  const relevant = all.filter((a) => {
    if (a.finishedAt === null) return false;
    if (new Date(a.finishedAt).getTime() < cutoff) return false;
    return scope.all || (a.testId !== null && scope.ids.has(a.testId));
  });

  if (relevant.length === 0) {
    return { attempts30d: 0, passRate: 0, avgPercent: 0, activeUsers: 0 };
  }

  let passed = 0;
  let percentSum = 0;
  const users = new Set<string>();
  for (const attempt of relevant) {
    const result = attempt.resultJson as AttemptResult | null;
    if (result?.overallPassed) passed += 1;
    percentSum += typeof result?.overallPercent === "number" ? result.overallPercent : 0;
    if (attempt.userId) users.add(attempt.userId);
  }

  return {
    attempts30d: relevant.length,
    passRate: Math.round((passed / relevant.length) * 100),
    avgPercent: Math.round(percentSum / relevant.length),
    activeUsers: users.size,
  };
}
```

- [ ] **Step 7: Реализовать `server/services/home/materials.ts`**

```ts
/**
 * @module server/services/home/materials
 *
 * PRD-25 FR-13: the active design template plus the документация links. The
 * lowest-priority section — it exists so an administrator does not have to
 * remember where the guide lives.
 *
 * Templates are not part of `IStorage`: the templates routers read the table
 * directly, and this module follows that established pattern rather than adding a
 * one-off DAL method.
 *
 * The table carries TWO flags: `is_active` is the author-facing visibility flag,
 * `status` is the PRD-3 lifecycle FSM. The lifecycle state is the meaningful one
 * here, and several templates may be `active` at once — hence a list, not a single
 * «active template».
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { templates } from "@shared/schema";

export async function buildMaterials(): Promise<{
  activeTemplates: string[];
  docs: Array<{ id: string; label: string; href: string }>;
}> {
  const rows = await db.select({ name: templates.name }).from(templates).where(eq(templates.status, "active"));
  return {
    activeTemplates: rows.map((r) => r.name),
    // Document ids are the ones `/api/admin/templates/docs/:doc` accepts.
    docs: [
      { id: "guide", label: "Руководство по разработке шаблонов", href: "/api/admin/templates/docs/guide" },
      { id: "spec", label: "Спецификация платформы шаблонов", href: "/api/admin/templates/docs/spec" },
    ],
  };
}
```

- [ ] **Step 8: Запустить тесты — зелёные**

```bash
npx vitest run tests/home-attention.test.ts tests/home-sections.test.ts
npm run check
```

Ожидаемо: PASS и чистый type-check.

- [ ] **Step 9: Commit**

```bash
git add server/services/home/ tests/home-attention.test.ts
git commit -m "feat(prd-25): правила внимания, быстрые действия и малые секции главной"
```

---

## Task 7: Агрегатор и роут `GET /api/home`

**Files:**

- Create: `server/services/home/index.ts`
- Create: `server/routes/home.ts`
- Modify: `server/routes/index.ts:22-74`
- Create: `tests/routes.home.test.ts`

- [ ] **Step 1: Написать падающий route-тест**

```ts
/**
 * PRD-25: GET /api/home — capability gating, failure isolation, «no sections».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { rolesMock, storageMock, sectionsMock } = vi.hoisted(() => ({
  rolesMock: { getEffectiveRoles: vi.fn() },
  storageMock: { getUser: vi.fn().mockResolvedValue({ id: "u1", emailHash: "x" }) },
  sectionsMock: {
    buildAssigned: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    buildRecentResults: vi.fn().mockResolvedValue({ items: [] }),
    buildMyTests: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    buildMyTopics: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    buildPeople: vi.fn().mockResolvedValue({ activeAssignments: 0, notStarted: 0, newUsers7d: 0 }),
    buildSummary: vi.fn().mockResolvedValue({ attempts30d: 0, passRate: 0, avgPercent: 0, activeUsers: 0 }),
    buildMaterials: vi.fn().mockResolvedValue({ activeTemplate: null, docs: [] }),
  },
}));

vi.mock("../server/services/access", () => rolesMock);
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/home/assigned", () => ({
  buildAssigned: sectionsMock.buildAssigned,
  buildRecentResults: sectionsMock.buildRecentResults,
}));
vi.mock("../server/services/home/my-tests", () => ({ buildMyTests: sectionsMock.buildMyTests }));
vi.mock("../server/services/home/my-topics", () => ({ buildMyTopics: sectionsMock.buildMyTopics }));
vi.mock("../server/services/home/people", () => ({ buildPeople: sectionsMock.buildPeople }));
vi.mock("../server/services/home/summary", () => ({ buildSummary: sectionsMock.buildSummary }));
vi.mock("../server/services/home/materials", () => ({ buildMaterials: sectionsMock.buildMaterials }));
vi.mock("../server/services/topic-access", () => ({ duplicateNameGroups: vi.fn().mockResolvedValue([]) }));

import homeRouter from "../server/routes/home";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/home", homeRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks drops the hoisted resolved values — restore what every case needs.
  storageMock.getUser.mockResolvedValue({ id: "u1", emailHash: "x" });
  sectionsMock.buildAssigned.mockResolvedValue({ items: [], total: 0 });
  sectionsMock.buildRecentResults.mockResolvedValue({ items: [] });
  sectionsMock.buildMyTests.mockResolvedValue({ items: [], total: 0 });
  sectionsMock.buildMyTopics.mockResolvedValue({ items: [], total: 0 });
  sectionsMock.buildPeople.mockResolvedValue({ activeAssignments: 0, notStarted: 0, newUsers7d: 0 });
  sectionsMock.buildSummary.mockResolvedValue({ attempts30d: 0, passRate: 0, avgPercent: 0, activeUsers: 0 });
  sectionsMock.buildMaterials.mockResolvedValue({ activeTemplates: [], docs: [] });
});

describe("GET /api/home", () => {
  it("gives a pure learner only the learner sections", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["learner"]);

    const res = await request(makeApp()).get("/api/home").set("x-test-user", "u1");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("assigned");
    expect(res.body).toHaveProperty("recentResults");
    expect(res.body).not.toHaveProperty("myTests");
    expect(res.body).not.toHaveProperty("myTopics");
    expect(res.body).not.toHaveProperty("summary");
    expect(sectionsMock.buildMyTests).not.toHaveBeenCalled();
  });

  it("gives an author the content sections", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["author"]);

    const res = await request(makeApp()).get("/api/home").set("x-test-user", "u1");

    expect(res.body).toHaveProperty("myTests");
    expect(res.body).toHaveProperty("myTopics");
    expect(res.body).toHaveProperty("quickActions");
  });

  it("isolates a failing section instead of failing the whole response", async () => {
    rolesMock.getEffectiveRoles.mockResolvedValue(["author"]);
    sectionsMock.buildMyTopics.mockRejectedValue(new Error("boom"));

    const res = await request(makeApp()).get("/api/home").set("x-test-user", "u1");

    expect(res.status).toBe(200);
    expect(res.body.myTopics).toEqual({ failed: true });
    expect(res.body.myTests).toEqual({ items: [], total: 0 });
  });

  it("rejects an anonymous request", async () => {
    const res = await request(makeApp()).get("/api/home");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npx vitest run tests/routes.home.test.ts
```

Ожидаемо: FAIL — роутер не найден.

- [ ] **Step 3: Реализовать агрегатор**

```ts
/**
 * @module server/services/home/index
 *
 * PRD-25: assembles the home payload. Two invariants live here and nowhere else.
 *
 * 1. Gating (FR-02): a section builder is not even CALLED unless the user holds
 *    its capability, so an absent key in the payload is proof of absent right —
 *    not merely a hidden card.
 * 2. Failure isolation (FR-15): each section is awaited independently; a thrown
 *    builder becomes `{ failed: true }` for that key and leaves the rest intact.
 */
import { hasPermission } from "@shared/access";
import type { Capability, Role } from "@shared/access";
import type { HomePayload } from "@shared/home/contract";
import { buildAssigned, buildRecentResults } from "./assigned";
import { buildMyTests } from "./my-tests";
import { buildMyTopics } from "./my-topics";
import { buildPeople } from "./people";
import { buildSummary } from "./summary";
import { buildMaterials } from "./materials";
import { buildQuickActions } from "./quick-actions";
import { buildAttention } from "./attention";
import { duplicateNameGroups } from "../topic-access";
import { logger } from "../../logger";

/** Run a section builder, turning any failure into the `{ failed: true }` marker. */
async function guard<T>(name: string, build: () => Promise<T>): Promise<T | { failed: true }> {
  try {
    return await build();
  } catch (error) {
    logger.error(`home section ${name} failed: ` + (error as Error).message);
    return { failed: true };
  }
}

/**
 * Build the whole payload for one user.
 *
 * @param userId Current session user.
 * @param roles Effective roles (stored roles plus the runtime superadmin flag).
 */
export async function buildHome(userId: string, roles: readonly Role[]): Promise<HomePayload> {
  const can = (cap: Capability) => hasPermission(roles, cap);
  const payload: HomePayload = {};

  const jobs: Array<Promise<void>> = [];

  if (can("attempts.self.read")) {
    jobs.push(
      guard("assigned", () => buildAssigned(userId)).then((v) => {
        payload.assigned = v;
      }),
      guard("recentResults", () => buildRecentResults(userId)).then((v) => {
        payload.recentResults = v;
      }),
    );
  }
  if (can("tests.read")) {
    jobs.push(
      guard("myTests", () => buildMyTests(userId, roles)).then((v) => {
        payload.myTests = v;
      }),
    );
  }
  if (can("topics.manage")) {
    jobs.push(
      guard("myTopics", () => buildMyTopics(userId, roles)).then((v) => {
        payload.myTopics = v;
      }),
    );
  }
  if (can("users.read") || can("groups.manage") || can("assignments.manage")) {
    jobs.push(
      guard("peopleAssignments", () => buildPeople()).then((v) => {
        payload.peopleAssignments = v;
      }),
    );
  }
  if (can("analytics.read")) {
    jobs.push(
      guard("summary", () => buildSummary(userId, roles)).then((v) => {
        payload.summary = v;
      }),
    );
  }
  if (can("adminTemplates.manage")) {
    jobs.push(
      guard("materials", () => buildMaterials()).then((v) => {
        payload.materials = v;
      }),
    );
  }

  await Promise.all(jobs);

  const quickActions = buildQuickActions(roles);
  if (quickActions.length > 0) payload.quickActions = quickActions;

  // Attention is derived from what the user can already see, so it needs no gate
  // of its own — an invisible section contributes no rows.
  const duplicates = can("topics.manage")
    ? await guard("duplicates", () => duplicateNameGroups())
    : [];
  const attention = buildAttention({
    assigned: payload.assigned && !("failed" in payload.assigned) ? payload.assigned.items : undefined,
    myTests: payload.myTests && !("failed" in payload.myTests) ? payload.myTests.items : undefined,
    duplicateTopicGroups: Array.isArray(duplicates) ? duplicates.length : 0,
    assignmentsNotStarted:
      payload.peopleAssignments && !("failed" in payload.peopleAssignments)
        ? payload.peopleAssignments.notStarted
        : 0,
  });
  if (attention.length > 0) payload.attention = attention;

  return payload;
}
```

- [ ] **Step 4: Реализовать роут**

```ts
/**
 * @module server/routes/home
 *
 * PRD-25 FR-14: `GET /api/home` — the single request that backs the home page.
 * The route itself is thin: authenticate, resolve effective roles, delegate to
 * the aggregator. Section-level gating lives in the aggregator, because the same
 * gating decides whether a builder runs at all.
 */
import { Router, type Request, type Response } from "express";
import { getEffectiveRoles } from "../services/access";
import { storage } from "../storage";
import { buildHome } from "../services/home/index";
import { logger } from "../logger";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    // `getEffectiveRoles` needs the user record, not the id: the superadmin flag
    // is derived from the email hash, never stored in `user_roles`.
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const roles = await getEffectiveRoles(user);
    res.json(await buildHome(userId, roles));
  } catch (error) {
    logger.error("Get home error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to build home" });
  }
});

export default router;
```

- [ ] **Step 5: Смонтировать роутер**

В `server/routes/index.ts` добавить импорт `import homeRouter from "./home";`, добавить `homeRouter`
в блок `export {}` и запись в `routerConfig`:

```ts
  { path: "/api/home", router: homeRouter },
```

- [ ] **Step 6: Запустить тесты — зелёные**

```bash
npx vitest run tests/routes.home.test.ts
npm run check
```

Ожидаемо: PASS и чистый type-check.

- [ ] **Step 7: Проверить ответ вживую**

Перезапустить dev-сервер (бэкенд не перезапускается сам), войти в приложение и выполнить запрос
из браузерной консоли:

```js
await (await fetch("/api/home", { credentials: "include" })).json()
```

Ожидаемо: объект с секциями, соответствующими правам вошедшего пользователя.

- [ ] **Step 8: Commit**

```bash
git add server/services/home/index.ts server/routes/home.ts server/routes/index.ts tests/routes.home.test.ts
git commit -m "feat(prd-25): агрегатор и роут GET /api/home"
```

---

## Task 8: Клиент — запрос данных и компоненты секций

Реализовывать строго по согласованному эскизу `docs/wireframes/approved/prd25-home.html`. Раскладка,
типографика и отступы — только примитивами дизайн-системы; сырые классы и локальные `render-*`
запрещены. Если нужного примитива нет — улучшать `vendor/ui-kit` по согласованию, а не писать шим.

**Files:**

- Create: `client/src/features/home/use-home.ts`
- Create: `client/src/features/home/sections/attention-panel.tsx`
- Create: `client/src/features/home/sections/quick-actions.tsx`
- Create: `client/src/features/home/sections/assigned-tests-section.tsx`
- Create: `client/src/features/home/sections/recent-results-section.tsx`
- Create: `client/src/features/home/sections/my-tests-section.tsx`
- Create: `client/src/features/home/sections/my-topics-section.tsx`
- Create: `client/src/features/home/sections/people-section.tsx`
- Create: `client/src/features/home/sections/summary-strip.tsx`
- Create: `client/src/features/home/sections/materials-section.tsx`

- [ ] **Step 1: Реализовать запрос данных**

```ts
/**
 * @module features/home/use-home
 *
 * PRD-25 FR-14/FR-21: one request for the whole home page, refreshed when the
 * user comes back to the tab — the same freshness contract the learner test list
 * already uses, so a finished attempt does not linger as «в процессе».
 */
import { useQuery } from "@tanstack/react-query";
import type { HomePayload } from "@shared/home/contract";

export function useHome() {
  return useQuery<HomePayload>({
    queryKey: ["/api/home"],
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 2: Реализовать панель внимания**

```tsx
/**
 * @module features/home/sections/attention-panel
 *
 * PRD-25 FR-05: actionable rows. The section renders nothing at all when there is
 * nothing to act on — an always-present empty «всё в порядке» box would train the
 * user to ignore the spot where real problems appear.
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Stack, Tag, Text } from "@universityrt/ui-kit";
import type { AttentionItem } from "@shared/home/contract";

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card data-testid="home-attention">
      <CardHeader title="Требует внимания" />
      <CardBody>
        <Stack gap={3}>
          {items.map((item) => (
            <Stack gap={1} key={item.id}>
              <Tag tone={item.severity === "warning" ? "warning" : "info"}>{item.title}</Tag>
              {item.subtitle ? (
                <Text variant="body-s" tone="muted">{item.subtitle}</Text>
              ) : null}
              <Link href={item.href}>
                <Button variant="ghost" size="s">{item.action}</Button>
              </Link>
            </Stack>
          ))}
        </Stack>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 3: Реализовать быстрые действия**

```tsx
/**
 * @module features/home/sections/quick-actions
 *
 * PRD-25 FR-06: capability-filtered shortcuts. The server already removed the
 * actions the user may not perform, so this component never re-checks rights.
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Stack } from "@universityrt/ui-kit";
import type { QuickAction } from "@shared/home/contract";

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <Card data-testid="home-quick-actions">
      <CardHeader title="Быстрые действия" />
      <CardBody>
        <Stack gap={2}>
          {actions.map((action) => (
            <Link href={action.href} key={action.id}>
              <Button variant="secondary" size="s">{action.label}</Button>
            </Link>
          ))}
        </Stack>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 4: Реализовать секцию «Мне назначено»**

```tsx
/**
 * @module features/home/sections/assigned-tests-section
 *
 * PRD-25 FR-07: assigned tests, in-progress first. A test whose cooldown is still
 * closed shows the date instead of an enabled button — the same state the start
 * screen renders, so the two never contradict each other.
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Cluster, EmptyState, Grid, Stack, Text } from "@universityrt/ui-kit";
import type { AssignedTestItem } from "@shared/home/contract";

export function AssignedTestsSection({ items, total }: { items: AssignedTestItem[]; total: number }) {
  return (
    <Card data-testid="home-assigned">
      <CardHeader title="Мне назначено" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState title="Тестов пока не назначено" description="Как только вам назначат тест, он появится здесь." />
        ) : (
          <Stack gap={4}>
            <Grid minItem="md" gap={2}>
              {items.map((item) => (
                <Card key={item.testId} data-testid={`home-assigned-${item.testId}`}>
                  <CardHeader title={item.title} subtitle={item.description || undefined} />
                  <CardBody>
                    <Stack gap={2}>
                      <Text variant="body-s" tone="muted">
                        {`Вопросов: ${item.questionCount}`}
                        {item.maxAttempts !== null
                          ? ` · попытки: ${item.completedAttempts} из ${item.maxAttempts}`
                          : ""}
                      </Text>
                      {item.blockedUntil ? (
                        <Text variant="body-s" tone="muted">{`Новая попытка будет доступна ${item.blockedUntil}`}</Text>
                      ) : (
                        <Link href={`/learner/test/${item.testId}`}>
                          <Button size="s">{item.inProgressAttemptId ? "Продолжить" : "Начать"}</Button>
                        </Link>
                      )}
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </Grid>
            {total > items.length ? (
              <Cluster justify="end">
                <Link href="/learner"><Button variant="ghost" size="s">{`Все мои тесты (${total})`}</Button></Link>
              </Cluster>
            ) : null}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 5: Реализовать секцию «Мои результаты»**

```tsx
/**
 * @module features/home/sections/recent-results-section
 *
 * PRD-25 FR-08: the last three finished attempts, newest first.
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Cluster, EmptyState, Stack, Tag, Text } from "@universityrt/ui-kit";
import type { RecentResultItem } from "@shared/home/contract";

export function RecentResultsSection({ items }: { items: RecentResultItem[] }) {
  return (
    <Card data-testid="home-results">
      <CardHeader title="Мои результаты" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState title="Пройденных тестов пока нет" description="Здесь появятся результаты завершённых попыток." />
        ) : (
          <Stack gap={3}>
            {items.map((item) => (
              <Cluster justify="between" gap={3} key={item.attemptId}>
                <Stack gap={0}>
                  <Text weight="medium">{item.testTitle}</Text>
                  <Text variant="caption" tone="subtle">
                    {new Date(item.finishedAt).toLocaleDateString("ru-RU")}
                  </Text>
                </Stack>
                <Cluster gap={2}>
                  <Text variant="body-s">{`${item.percent}%`}</Text>
                  {item.passed === null ? null : (
                    <Tag tone={item.passed ? "success" : "danger"}>{item.passed ? "Зачёт" : "Незачёт"}</Tag>
                  )}
                  <Link href={`/learner/result/${item.attemptId}`}>
                    <Button variant="ghost" size="s">Открыть</Button>
                  </Link>
                </Cluster>
              </Cluster>
            ))}
            <Cluster justify="end">
              <Link href="/learner/history"><Button variant="ghost" size="s">Вся история</Button></Link>
            </Cluster>
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 6: Реализовать секцию «Мои тесты»**

```tsx
/**
 * @module features/home/sections/my-tests-section
 *
 * PRD-25 FR-09: recently touched tests with their publication state. Action
 * buttons mirror the rights the server resolved — the card never offers an export
 * to a user who may not export.
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Cluster, EmptyState, Grid, Stack, Tag, Text } from "@universityrt/ui-kit";
import type { HomeTestStatus, MyTestItem } from "@shared/home/contract";

const STATUS_LABEL: Record<HomeTestStatus, { label: string; tone: "neutral" | "success" | "warning" }> = {
  draft: { label: "Черновик", tone: "neutral" },
  published: { label: "Опубликован", tone: "success" },
  published_with_changes: { label: "Изменён после публикации", tone: "warning" },
  archived: { label: "В архиве", tone: "neutral" },
};

export function MyTestsSection({ items, total }: { items: MyTestItem[]; total: number }) {
  return (
    <Card data-testid="home-my-tests">
      <CardHeader title="Мои тесты" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            title="Тестов пока нет"
            description="Создайте первый тест — он появится здесь."
            action={<Link href="/author/tests"><Button size="s">Создать тест</Button></Link>}
          />
        ) : (
          <Stack gap={4}>
            <Grid minItem="md" gap={2}>
              {items.map((item) => {
                const status = STATUS_LABEL[item.status];
                return (
                  <Card key={item.testId} data-testid={`home-test-${item.testId}`}>
                    <CardHeader title={item.title} />
                    <CardBody>
                      <Stack gap={2}>
                        <Cluster gap={2}>
                          <Tag tone={status.tone}>{status.label}</Tag>
                          {item.owned ? null : <Tag tone="info">Доступ выдан</Tag>}
                        </Cluster>
                        <Text variant="body-s" tone="muted">
                          {`Разделов: ${item.sectionCount} · вопросов: ${item.questionCount}`}
                        </Text>
                        <Cluster gap={2}>
                          {item.canEdit ? (
                            <Link href="/author/tests"><Button variant="ghost" size="s">Открыть</Button></Link>
                          ) : null}
                          {item.canDebug ? (
                            <Link href={`/author/tests/${item.testId}/debug`}>
                              <Button variant="ghost" size="s">Тестовый прогон</Button>
                            </Link>
                          ) : null}
                        </Cluster>
                      </Stack>
                    </CardBody>
                  </Card>
                );
              })}
            </Grid>
            {total > items.length ? (
              <Cluster justify="end">
                <Link href="/author/tests"><Button variant="ghost" size="s">{`Все тесты (${total})`}</Button></Link>
              </Cluster>
            ) : null}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 7: Реализовать секцию «Мои темы и вопросы»**

```tsx
/**
 * @module features/home/sections/my-topics-section
 *
 * PRD-25 FR-10: recently touched topics. Recency comes from `topics.updated_at`,
 * which moves on question edits too — so a topic the user has only been filling
 * with questions still floats to the top.
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Cluster, EmptyState, Stack, Tag, Text } from "@universityrt/ui-kit";
import type { MyTopicItem } from "@shared/home/contract";

export function MyTopicsSection({ items, total }: { items: MyTopicItem[]; total: number }) {
  return (
    <Card data-testid="home-my-topics">
      <CardHeader title="Мои темы и вопросы" />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            title="Тем пока нет"
            description="Создайте первую тему и наполните её вопросами."
            action={<Link href="/author/content"><Button size="s">Перейти к темам</Button></Link>}
          />
        ) : (
          <Stack gap={3}>
            {items.map((item) => (
              <Cluster justify="between" gap={3} key={item.topicId}>
                <Stack gap={0}>
                  <Cluster gap={2}>
                    <Text weight="medium">{item.name}</Text>
                    {item.code ? <Tag tone="neutral">{item.code}</Tag> : null}
                    {item.owned ? null : <Tag tone="info">Доступ выдан</Tag>}
                  </Cluster>
                  <Text variant="caption" tone="subtle">{`Вопросов: ${item.questionCount}`}</Text>
                </Stack>
                <Link href="/author/content"><Button variant="ghost" size="s">Открыть</Button></Link>
              </Cluster>
            ))}
            {total > items.length ? (
              <Cluster justify="end">
                <Link href="/author/content"><Button variant="ghost" size="s">{`Все темы (${total})`}</Button></Link>
              </Cluster>
            ) : null}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 8: Реализовать оставшиеся три секции**

```tsx
/**
 * @module features/home/sections/people-section
 *
 * PRD-25 FR-11: counters for the manager — is anything stalled.
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Cluster, Stack, Text } from "@universityrt/ui-kit";

export function PeopleSection({
  data,
}: {
  data: { activeAssignments: number; notStarted: number; newUsers7d: number };
}) {
  return (
    <Card data-testid="home-people">
      <CardHeader title="Люди и назначения" />
      <CardBody>
        <Stack gap={2}>
          <Text variant="body-s">{`Активных назначений: ${data.activeAssignments}`}</Text>
          <Text variant="body-s">{`Не начали: ${data.notStarted}`}</Text>
          <Text variant="body-s">{`Новых пользователей за неделю: ${data.newUsers7d}`}</Text>
          <Cluster justify="end">
            <Link href="/author/users"><Button variant="ghost" size="s">Открыть пользователей</Button></Link>
          </Cluster>
        </Stack>
      </CardBody>
    </Card>
  );
}
```

```tsx
/**
 * @module features/home/sections/summary-strip
 *
 * PRD-25 FR-12: four numbers, no charts. Trends belong to the analytics screen —
 * duplicating them here was rejected explicitly (spec risk R-1).
 */
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, Cluster, Stack, Text } from "@universityrt/ui-kit";

export function SummaryStrip({
  data,
}: {
  data: { attempts30d: number; passRate: number; avgPercent: number; activeUsers: number };
}) {
  return (
    <Card data-testid="home-summary">
      <CardHeader title="Сводка за 30 дней" />
      <CardBody>
        <Stack gap={2}>
          <Text variant="body-s">{`Попыток: ${data.attempts30d}`}</Text>
          <Text variant="body-s">{`Доля сдачи: ${data.passRate}%`}</Text>
          <Text variant="body-s">{`Средний процент: ${data.avgPercent}`}</Text>
          <Text variant="body-s">{`Активных пользователей: ${data.activeUsers}`}</Text>
          <Cluster justify="end">
            <Link href="/author/analytics"><Button variant="ghost" size="s">Подробнее</Button></Link>
          </Cluster>
        </Stack>
      </CardBody>
    </Card>
  );
}
```

```tsx
/**
 * @module features/home/sections/materials-section
 *
 * PRD-25 FR-13: active template and documentation links. Documentation is served
 * by the API, so these are plain anchors, not SPA routes.
 */
import { Card, CardBody, CardHeader, Stack, Text } from "@universityrt/ui-kit";

export function MaterialsSection({
  data,
}: {
  data: { activeTemplates: string[]; docs: Array<{ id: string; label: string; href: string }> };
}) {
  return (
    <Card data-testid="home-materials">
      <CardHeader title="Материалы" />
      <CardBody>
        <Stack gap={2}>
          <Text variant="body-s" tone="muted">
            {data.activeTemplates.length > 0
              ? `Активные шаблоны: ${data.activeTemplates.join(", ")}`
              : "Активных шаблонов нет"}
          </Text>
          {data.docs.map((doc) => (
            <a href={doc.href} key={doc.id} className="ou-link">{doc.label}</a>
          ))}
        </Stack>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 9: Type-check и commit**

```bash
npm run check
git add client/src/features/home/
git commit -m "feat(prd-25): компоненты секций главной страницы"
```

---

## Task 9: Клиент — раскладка страницы

**Files:**

- Create: `client/src/features/home/home-page.tsx`
- Create: `client/src/features/home/__tests__/home-page.test.tsx`
- Modify: `vendor/ui-kit/src/components/Layout.tsx:113-141` — шаблон `main-aside`
- Modify: `vendor/ui-kit/css/university-rt.css`, `client/src/styles/vendor/university-rt.css` — обе копии

- [ ] **Step 1: Написать падающий тест страницы**

```tsx
/**
 * PRD-25: the home page renders exactly the sections the payload carries, and
 * nothing else. The learner case is the important one — an author section leaking
 * into a learner's page is the failure this test exists to catch.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HomePayload } from "@shared/home/contract";

const { useHomeMock } = vi.hoisted(() => ({ useHomeMock: vi.fn() }));
vi.mock("../use-home", () => ({ useHome: useHomeMock }));

import { HomePage } from "../home-page";

function withPayload(data: HomePayload) {
  useHomeMock.mockReturnValue({ data, isLoading: false });
}

describe("HomePage", () => {
  it("renders only learner sections for a learner payload", () => {
    withPayload({ assigned: { items: [], total: 0 }, recentResults: { items: [] } });
    render(<HomePage />);
    expect(screen.getByTestId("home-assigned")).toBeInTheDocument();
    expect(screen.getByTestId("home-results")).toBeInTheDocument();
    expect(screen.queryByTestId("home-my-tests")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-summary")).not.toBeInTheDocument();
  });

  it("renders a failed section as a retry state without dropping the rest", () => {
    withPayload({ myTests: { failed: true }, myTopics: { items: [], total: 0 } });
    render(<HomePage />);
    expect(screen.getByTestId("home-section-error-myTests")).toBeInTheDocument();
    expect(screen.getByTestId("home-my-topics")).toBeInTheDocument();
  });

  it("shows the no-access state when the payload has no sections", () => {
    withPayload({});
    render(<HomePage />);
    expect(screen.getByTestId("home-no-sections")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

```bash
npx vitest run client/src/features/home/__tests__/home-page.test.tsx
```

Ожидаемо: FAIL — модуль страницы не найден.

- [ ] **Step 3: Реализовать страницу**

```tsx
/**
 * @module features/home/home-page
 *
 * PRD-25: the two-column home layout (spec section 6). The left column carries
 * the user's objects, the right one carries what is urgent plus the shortcuts.
 * When the right column resolves to nothing — the pure-learner profile — the page
 * collapses to a single full-width column rather than leaving a dead gutter.
 */
import { Box, Card, CardBody, EmptyState, Grid, Stack, Text } from "@universityrt/ui-kit";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { sectionData, sectionFailed } from "@shared/home/contract";
import { useHome } from "./use-home";
import { AttentionPanel } from "./sections/attention-panel";
import { QuickActions } from "./sections/quick-actions";
import { AssignedTestsSection } from "./sections/assigned-tests-section";
import { RecentResultsSection } from "./sections/recent-results-section";
import { MyTestsSection } from "./sections/my-tests-section";
import { MyTopicsSection } from "./sections/my-topics-section";
import { PeopleSection } from "./sections/people-section";
import { SummaryStrip } from "./sections/summary-strip";
import { MaterialsSection } from "./sections/materials-section";

/** Placeholder shown in place of a section whose source errored (FR-15). */
function SectionError({ name }: { name: string }) {
  return (
    <Card data-testid={`home-section-error-${name}`}>
      <CardBody>
        <Text variant="body-s" tone="muted">Не удалось загрузить раздел. Обновите страницу.</Text>
      </CardBody>
    </Card>
  );
}

export function HomePage() {
  const { data, isLoading } = useHome();

  if (isLoading || !data) {
    return <LoadingState message="Загрузка…" />;
  }

  const assigned = sectionData(data.assigned);
  const results = sectionData(data.recentResults);
  const myTests = sectionData(data.myTests);
  const myTopics = sectionData(data.myTopics);
  const people = sectionData(data.peopleAssignments);
  const summary = sectionData(data.summary);
  const materials = sectionData(data.materials);
  const attention = sectionData(data.attention);
  const quickActions = sectionData(data.quickActions);

  const left = [
    data.assigned ? (sectionFailed(data.assigned) ? <SectionError name="assigned" key="assigned" />
      : <AssignedTestsSection items={assigned!.items} total={assigned!.total} key="assigned" />) : null,
    data.recentResults ? (sectionFailed(data.recentResults) ? <SectionError name="recentResults" key="results" />
      : <RecentResultsSection items={results!.items} key="results" />) : null,
    data.myTests ? (sectionFailed(data.myTests) ? <SectionError name="myTests" key="myTests" />
      : <MyTestsSection items={myTests!.items} total={myTests!.total} key="myTests" />) : null,
    data.myTopics ? (sectionFailed(data.myTopics) ? <SectionError name="myTopics" key="myTopics" />
      : <MyTopicsSection items={myTopics!.items} total={myTopics!.total} key="myTopics" />) : null,
    data.peopleAssignments ? (sectionFailed(data.peopleAssignments) ? <SectionError name="people" key="people" />
      : <PeopleSection data={people!} key="people" />) : null,
  ].filter(Boolean);

  const right = [
    attention && attention.length > 0 ? <AttentionPanel items={attention} key="attention" /> : null,
    quickActions && quickActions.length > 0 ? <QuickActions actions={quickActions} key="quick" /> : null,
    data.summary ? (sectionFailed(data.summary) ? <SectionError name="summary" key="summary" />
      : <SummaryStrip data={summary!} key="summary" />) : null,
    data.materials ? (sectionFailed(data.materials) ? <SectionError name="materials" key="materials" />
      : <MaterialsSection data={materials!} key="materials" />) : null,
  ].filter(Boolean);

  if (left.length === 0 && right.length === 0) {
    return (
      <Box padX={6} padY={8} data-testid="home-no-sections">
        <EmptyState
          title="Нет доступных разделов"
          description="Вашей учётной записи не назначено ни одной роли. Обратитесь к администратору."
        />
      </Box>
    );
  }

  return (
    <Box padX={6} padY={8}>
      <PageHeader title="Главная" description="Что происходит и что можно продолжить" />
      {right.length === 0 ? (
        <Stack gap={4}>{left}</Stack>
      ) : (
        <Grid template="main-aside" gap={4}>
          <Stack gap={4}>{left}</Stack>
          <Stack gap={4}>{right}</Stack>
        </Grid>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Добавить в ui-kit шаблон раскладки `main-aside`**

Использованный выше `template="main-aside"` в дизайн-системе ПОКА НЕТ: `Grid` умеет фиксированное
число колонок (`cols`), авто-подбор (`minItem`) и один именованный шаблон (`label-control`), но не
асимметричную пару «широкая основная колонка + узкая боковая». Инлайн-стиль и локальный CSS-класс для
раскладки запрещены, поэтому примитив добавляется в ui-kit — ровно по образцу уже существующего
именованного шаблона. Правка `vendor/ui-kit` требует согласования: показать диф до продолжения.

`vendor/ui-kit/src/components/Layout.tsx`, тип пропа `template`:

```ts
  /**
   * Named column template.
   * `label-control` = flexible label + fixed control column (center-aligned).
   * `main-aside` = wide main column + narrow aside; collapses to one column on narrow viewports.
   */
  template?: 'label-control' | 'main-aside';
```

CSS-правило добавляется рядом с `.ou-lgrid--label-control`:

```css
.ou-lgrid--main-aside { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; }
@media (max-width: 63.99rem) { .ou-lgrid--main-aside { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 5: Внести CSS в ОБЕ копии таблицы стилей**

Файл `university-rt.css` существует в двух рабочих копиях: `vendor/ui-kit/css/university-rt.css` —
источник, `client/src/styles/vendor/university-rt.css` — та, что реально грузится приложением. Правка
только в одну даёт «в сторибуке работает, в приложении нет». Проверить, что правило попало в обе:

```bash
grep -rn "ou-lgrid--main-aside" vendor/ui-kit/css/university-rt.css client/src/styles/vendor/university-rt.css
```

Ожидаемо: по совпадению в каждом файле.

- [ ] **Step 6: Запустить тесты — зелёные**

```bash
npx vitest run client/src/features/home/__tests__/home-page.test.tsx
npm run check
```

Ожидаемо: PASS и чистый type-check.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/home/ vendor/ui-kit/ client/src/styles/vendor/university-rt.css
git commit -m "feat(prd-25): раскладка домашней страницы и шаблон main-aside в ui-kit"
```

---

## Task 10: Маршрут `/` и выбор оболочки

**Files:**

- Create: `client/src/pages/home.tsx`
- Modify: `client/src/App.tsx:10-99`, `client/src/App.tsx:104`

- [ ] **Step 1: Реализовать обёртку маршрута**

```tsx
/**
 * @module pages/home
 *
 * PRD-25 FR-03: the home page is ONE page rendered in one of two shells. A profile
 * holding any author- or manager-side capability gets the author shell with the
 * sidebar; a pure learner stays in the learner shell, because rebuilding the
 * learner area around a sidebar is out of this PRD's scope (D-5).
 */
import { AuthorLayout } from "@/pages/author/layout";
import { LearnerLayout } from "@/pages/learner/layout";
import { HomePage } from "@/features/home/home-page";
import { useAuth } from "@/lib/auth";
import type { Capability } from "@shared/access";

/** Capabilities that place a user in the author-side shell. */
const AUTHOR_AREA: Capability[] = [
  "tests.read",
  "topics.manage",
  "users.read",
  "groups.manage",
  "analytics.read",
  "adminTemplates.manage",
  "questions.importExport",
  "logs.read",
];

export default function HomeRoute() {
  const { can } = useAuth();
  const Shell = AUTHOR_AREA.some((cap) => can(cap)) ? AuthorLayout : LearnerLayout;
  return (
    <Shell>
      <HomePage />
    </Shell>
  );
}
```

- [ ] **Step 2: Заменить редирект маршрутом**

В `client/src/App.tsx` удалить функции `homePath` и `HomeRedirect`, добавить импорт
`import HomeRoute from "@/pages/home";` и заменить маршрут:

```tsx
      <Route path="/">
        <ProtectedRoute>
          <HomeRoute />
        </ProtectedRoute>
      </Route>
```

- [ ] **Step 3: Упростить защиту маршрутов**

В `ProtectedRoute` ветку отказа заменить: теперь у любого аутентифицированного пользователя есть куда
приземлиться, поэтому экран «нет доступа» на месте `/` рисует сама главная (FR-18/FR-19).

```tsx
  // PRD-13: доступ к маршруту по праву (capability), а не по жёсткой роли.
  // PRD-25 FR-19: отказ ведёт на главную — она сама покажет «нет доступа», если
  // пользователю недоступна ни одна секция, поэтому петли редиректов больше нет.
  if (requiredPermission && !can(requiredPermission)) {
    return location === "/" ? <NoAccessPage /> : <Redirect to="/" />;
  }
```

- [ ] **Step 4: Проверить, что `NoAccessPage` ещё используется**

```bash
grep -rn "NoAccessPage" client/src/
```

Если импорт остался неиспользованным — удалить его, иначе `npm run check` покажет ошибку.

- [ ] **Step 5: Прогнать затронутые тесты**

```bash
npx vitest run client/src/pages/__tests__/no-access.test.tsx client/src/features/home/
npm run check
```

Ожидаемо: PASS. Если существующий тест проверял редирект по ролям — обновить его под новое поведение,
а не удалять.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/pages/home.tsx
git commit -m "feat(prd-25): маршрут / рендерит главную вместо редиректа по ролям"
```

---

## Task 11: Пункт «Главная» в обеих навигациях

**Files:**

- Modify: `client/src/lib/i18n.ts:249-263`
- Modify: `client/src/components/app-sidebar.tsx:41-50`
- Modify: `client/src/pages/learner/layout.tsx:21-56`

- [ ] **Step 1: Добавить строку в словарь**

В `client/src/lib/i18n.ts`, блок `navigation`, первой строкой:

```ts
  navigation: {
    home: "Главная",
    topics: "Темы",
```

- [ ] **Step 2: Добавить пункт в боковое меню**

`client/src/components/app-sidebar.tsx`: импортировать иконку `Home` из `lucide-react`, а `NAV`
дополнить первым элементом. Пункт «Главная» доступен всем, поэтому гейтится правом `auth.self`,
которое есть у каждого аутентифицированного пользователя:

```ts
const NAV: NavEntry[] = [
  // PRD-25: точка входа доступна любому аутентифицированному пользователю.
  { id: "home", href: "/", label: t.navigation.home, icon: Home, perm: "auth.self" },
  // PRD-16: «Темы» и «Вопросы» объединены в единый раздел «Темы и вопросы».
  { id: "content", href: "/author/content", label: t.navigation.topicsAndQuestions, icon: FolderTree, perm: "topics.manage" },
```

- [ ] **Step 3: Починить подсветку активного пункта**

Текущее правило `location.startsWith(n.href)` при `href === "/"` совпадёт с любым маршрутом. Заменить
вычисление активного пункта на точное совпадение для корня:

```ts
  const activeId = allowed.find((n) => (n.href === "/" ? location === "/" : location.startsWith(n.href)))?.id;
```

- [ ] **Step 4: Добавить пункт в учебную шапку**

`client/src/pages/learner/layout.tsx`: импортировать иконку `Home`, добавить `const isHomeActive = location === "/";`
и вставить кнопку перед «Тестами»:

```tsx
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
```

- [ ] **Step 5: Прогнать тесты и type-check**

```bash
npm run check
npx vitest run client/src/
```

Ожидаемо: зелено. Порог покрытия поднимать не требуется; если он покраснел из-за нового кода —
дописать тесты на новый код, не трогая чужие модули.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/i18n.ts client/src/components/app-sidebar.tsx client/src/pages/learner/layout.tsx
git commit -m "feat(prd-25): пункт «Главная» в авторской и учебной навигации"
```

---

## Task 12: Приёмка в реальном браузере

Юнит-тестов и jsdom для фронтенда недостаточно: приёмка обязана проходить в реальном браузере.

**Files:**

- Modify: `docs/specs/prd-25/home-page.md` (отметка о приёмке)

- [ ] **Step 1: Подготовить четыре учётные записи**

В dev-базе завести или назначить роли так, чтобы существовали: чистый учащийся, автор, менеджер,
суперпользователь. Учащемуся назначить минимум два теста, один из которых начат и не завершён.

- [ ] **Step 2: Пройти сценарии под каждым профилем**

Для каждого профиля проверить и снять скриншот:

1. Состав секций совпадает с таблицей раздела 2 спецификации.
2. У чистого учащегося НЕТ ни одной авторской секции и правая колонка отсутствует.
3. Незавершённая попытка стоит первой в «Мне назначено» и в «Требует внимания».
4. Кнопка «Продолжить» открывает именно ту попытку.
5. Ссылки «показать все» ведут в соответствующие разделы.
6. Пункт «Главная» подсвечен только на `/`.

- [ ] **Step 3: Сверить с эскизом**

Открыть `docs/wireframes/approved/prd25-home.html` рядом со скриншотами и сверить каждую деталь:
порядок секций, отступы, тональность меток, поведение при пустой правой колонке. Расхождение —
дефект реализации, а не повод править эскиз.

- [ ] **Step 4: Проверить деградацию секции**

Временно уронить один сборщик (например, бросить исключение в `buildMyTopics`), перезапустить dev,
убедиться, что страница живёт и показывает состояние ошибки только для этой секции. Вернуть код.

- [ ] **Step 5: Полный прогон тестов**

```bash
npm run check
npm test
npm run test:it
npm run lint:md
```

Ожидаемо: всё зелёное. Vitest не запускать параллельно в двух процессах — общий каталог покрытия
приводит к ложным падениям.

- [ ] **Step 6: Отметить приёмку и закоммитить**

В `docs/specs/prd-25/home-page.md` в шапке сменить статус на «РЕАЛИЗОВАНО, приёмка пройдена» с датой.

```bash
git add docs/specs/prd-25/home-page.md
git commit -m "docs(prd-25): отметка о приёмке домашней страницы"
```

---

## Проверка плана против спецификации

| Требование | Задача |
| --- | --- |
| FR-01, FR-19 | Task 10 |
| FR-02 | Task 7 |
| FR-03 | Task 10 |
| FR-04 | Task 11 |
| FR-05 | Task 6 |
| FR-06 | Task 6 |
| FR-07, FR-08 | Task 4 |
| FR-09 | Task 5 |
| FR-10 | Task 5 |
| FR-11, FR-12, FR-13 | Task 6 |
| FR-14 | Task 7 |
| FR-15 | Task 7, Task 9 |
| FR-16 | Task 5, Task 6 |
| FR-17 | Task 8 |
| FR-18 | Task 9 |
| FR-20 | Task 1, Task 2 |
| FR-21 | Task 8 |
| Раскладка (раздел 6) | Task 0, Task 9 |
| Риск R-3 (стоимость агрегата) | Task 5 |
| Риск R-4 (пропущенная точка обновления) | Task 2 |
