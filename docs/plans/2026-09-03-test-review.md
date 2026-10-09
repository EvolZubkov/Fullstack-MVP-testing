# PRD-52. Согласование и приёмка теста экспертами — план реализации

> **Для исполнителя:** шаги помечены чекбоксами (`- [ ]`) для отметки по ходу работы. Спека —
> [docs/specs/prd-52/test-review.md](../specs/prd-52/test-review.md), номера FR ниже ссылаются на неё.

**Цель:** автор рассылает экспертам персональные ссылки на сокращённый плеер, эксперт проходит тест и
оставляет комментарии к конкретным местам, автор разбирает их в режиме рецензирования — отвечает,
переходит к объекту, правит и закрывает с исходом.

**Подход:** ничего нового не изобретаем. Доступ — третий уровень существующего гранта теста; ссылка —
существующий магик-токен с новым назначением; экран эксперта — существующий отладочный движок PRD-18 с
урезанным инспектором; полная выдача — второй hash-флаг рядом с уже работающим пином варианта;
переход по якорю — существующие ящики редакторов, положенные стеком.

**Технологии:** Express 5 + Drizzle + PostgreSQL на сервере, React 19 + `@skillum/ui-kit` на
клиенте, Vitest для тестов, framework-free JS в рантайме SCORM-пакета.

---

## Правила работы по этому плану

- **Полную сюиту не запускать** — она идёт около восьми минут и занимает машину. Во время работы
  только точечно: `npm test -- <путь>`. Полный прогон — по явному разрешению владельца.
- `npm run check` (tsc) после каждого этапа — обязателен и дёшев.
- `npm run lint:md` после правок документации.
- Коммит в конце каждой задачи, не реже. Трейлер `Co-Authored-By` не добавлять.
- Работа идёт в отдельной ветке, не в `main` (задача 0).
- Дев-БД общая для всех worktree: миграцию применять осознанно, `npm run db:migrate`.

## Карта файлов

**Создаются:**

| Файл | Ответственность |
| --- | --- |
| `drizzle/0025_prd52_review_comments.sql` | миграция: `purpose` в токенах, обнуляемый `assignment_id`, таблица комментариев |
| `server/middleware/review-scope.ts` | `requireReviewScope` — грант `review` или edit-scope |
| `server/storage/review-comments-repository.ts` | запросы к `test_review_comments` |
| `server/services/review-anchor.ts` | `contextLabel` и `pinnedContentHash` по якорю |
| `server/services/review-invite.ts` | выдача гранта `review` + ревью-токен поверх конвейера PRD-28 |
| `server/routes/review.ts` | API комментариев и ревью-сессии |
| `shared/review/anchor.ts` | тип якоря, резолвер «якорь — цель», общий для клиента и сервера |
| `client/src/features/tests/review/review-panel.tsx` | панель комментариев — один компонент на три входа |
| `client/src/features/tests/review/review-api.ts` | клиентские запросы |
| `client/src/features/tests/review/review-comment-form.tsx` | форма создания с выбором якоря |
| `client/src/features/tests/review/use-review-comments.ts` | загрузка, фильтр, счётчики |
| `client/src/pages/review/review-player-page.tsx` | экран эксперта `/review/tests/:testId` |
| `docs/wireframes/approved/prd52-*.html` | эскизы Э0 |

**Изменяются:**

| Файл | Что |
| --- | --- |
| `shared/schema.ts` | `review` в `accessLevel`, `purpose`/обнуляемый `assignmentId`, таблица и типы комментариев |
| `server/services/test-access.ts` | `canReviewTest` |
| `server/routes/index.ts` | монтирование `reviewRouter` |
| `server/middleware/magic-scope-rules.ts` | правила ревью-путей |
| `server/routes/access.ts` | редирект по `purpose` |
| `server/storage.ts` | делегирование в репозиторий комментариев |
| `server/scorm/assets/app.js` | hash-флаг полной выдачи, ветка в `generateVariant` |
| `server/scorm/debug-player/assets/inspector-compute.js` | уровень вопроса в адаптиве, гашение вердикта |
| `client/src/features/tests/editor/test-editor.tsx` | вкладка «Комментарии» |
| `client/src/features/tests/debug-player/debug-player-page.tsx` | вкладка «Комментарии», тумблер полной выдачи, баннер пересборки |
| `client/src/components/assign-test-dialog.tsx` | режим «Отправить на рецензирование» |
| `client/src/features/tests/list/tests-list.tsx` | счётчик открытых комментариев, пункт меню |
| `client/src/App.tsx` | маршрут `/review/tests/:testId` |
| `vendor/ui-kit/src/components/Drawer.tsx` | Escape закрывает только верхний ящик |

---

## Задача 0. Ветка

- [ ] **Шаг 1: создать ветку от актуального `main`**

```bash
git checkout -b feat/prd-52-test-review
git status --short
```

Ожидаемо: ветка создана, в рабочем каталоге остаются посторонние правки прошлых сессий — их не
трогать и в коммиты не включать. Добавлять только свои файлы поимённо, никогда `git add -A`.

---

## Э0. Эскизы (блокирует все UI-задачи)

В проекте действует жёсткое правило: интерфейс сначала рисуется эскизом и согласуется, и только потом
пишется React. Задачи Э3, Э5 и Э6 не начинаются, пока эскизы не одобрены владельцем.

### Задача 0.1: эскизы

**Файлы:**

- Создать: `docs/wireframes/approved/prd52-review-player.html`
- Создать: `docs/wireframes/approved/prd52-review-panel.html`
- Создать: `docs/wireframes/approved/prd52-invite-dialog.html`

- [ ] **Шаг 1: эскиз экрана эксперта**

Состояния на одном холсте: прогон с открытой вкладкой «Комментарии»; форма нового комментария к
текущему вопросу; вкладки «Результаты» и «Протокол»; «Результаты» в режиме полной выдачи с текстом
«не считается в режиме полной выдачи»; протокол адаптивного теста с колонкой уровня и пометкой
вопроса вне лестницы; экран отказа без гранта.

Канон берётся из уже согласованного `docs/wireframes/approved/prd18-debug-player.html`: та же
faux-chrome раскладка окна, тот же статусбар внутри стейджа, инспектор справа с самого верха.

- [ ] **Шаг 2: эскиз панели комментариев**

Состояния: лента веток с группировкой по разделам и вопросам; фильтр «только открытые»; ветка с
ответами; закрытие с выбором исхода и обязательным ответом при отклонении; пометка «изменено после
комментария»; комментарий с удалённым объектом; форма создания из ящика с выбором якоря; стек ящиков —
ящик вопроса поверх ящика теста; баннер «нужна пересборка» в отладчике.

- [ ] **Шаг 3: эскиз диалога рассылки**

Четыре вкладки по образцу назначения теста, отчёт прогона, выгрузка ссылок, предупреждение о том, что
эксперты видят комментарии друг друга.

- [ ] **Шаг 4: проверить эскизы гейтом и в браузере**

```bash
node scripts/check-wireframes-ds.mjs
```

Ожидаемо: по файлам `prd52-*` нарушений не больше, чем в канонe prd18 (две штуки в baseline).
Интерфейс собирать только из компонентов `ou-*`/`tb-*`; классы `wf-*` допустимы исключительно для
faux-chrome окна и JS-хуков.

- [ ] **Шаг 5: показать владельцу и получить согласование**

Гейт: без явного «согласовано» задачи Э3, Э5, Э6 не стартуют.

- [ ] **Шаг 6: коммит**

```bash
git add docs/wireframes/approved/prd52-review-player.html docs/wireframes/approved/prd52-review-panel.html docs/wireframes/approved/prd52-invite-dialog.html
git commit -m "docs(prd-52): эскизы экрана эксперта, панели комментариев и диалога рассылки"
```

---

## Э1. Доступ

### Задача 1.1: уровень гранта `review`

**Файлы:**

- Изменить: `shared/schema.ts:652` (enum `accessLevel`)
- Изменить: `server/services/test-access.ts`
- Тест: `tests/test-access.test.ts`

`access_level` в базе — обычный `text` без CHECK-ограничения (см. `drizzle/0000_baseline.sql:244`),
поэтому третье значение **не требует SQL-миграции**: меняется только enum в схеме Drizzle и Zod.

- [ ] **Шаг 1: написать падающий тест**

```ts
describe("canReviewTest", () => {
  it("даёт доступ по гранту review", async () => {
    vi.mocked(storage.getTestGrantForUser).mockResolvedValue({ accessLevel: "review" } as never);
    expect(await canReviewTest([ROLES.LEARNER], "u1", { id: "t1", ownerId: "other" })).toBe(true);
  });

  it("даёт доступ владельцу теста без гранта", async () => {
    vi.mocked(storage.getTestGrantForUser).mockResolvedValue(undefined as never);
    expect(await canReviewTest([ROLES.AUTHOR], "u1", { id: "t1", ownerId: "u1" })).toBe(true);
  });

  it("отказывает постороннему", async () => {
    vi.mocked(storage.getTestGrantForUser).mockResolvedValue(undefined as never);
    expect(await canReviewTest([ROLES.LEARNER], "u9", { id: "t1", ownerId: "u1" })).toBe(false);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- tests/test-access.test.ts
```

Ожидаемо: FAIL, `canReviewTest is not a function`.

- [ ] **Шаг 3: расширить enum и добавить резолвер**

В `shared/schema.ts`:

```ts
accessLevel: text("access_level", { enum: ["edit", "assign", "review"] }).notNull(),
```

В `server/services/test-access.ts`:

```ts
/**
 * Can review the test (PRD-52): the `review` grant, or anyone who may already
 * edit it. Deliberately role-agnostic — an external expert holds `learner`, so a
 * capability check here would lock out exactly the audience this is built for.
 */
export async function canReviewTest(
  roles: readonly Role[],
  userId: string,
  test: TestRef,
): Promise<boolean> {
  if (await canEditTest(roles, userId, test)) return true;
  const grant = await storage.getTestGrantForUser(test.id, userId);
  return grant?.accessLevel === "review";
}
```

- [ ] **Шаг 4: тест проходит**

```bash
npm test -- tests/test-access.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add shared/schema.ts server/services/test-access.ts tests/test-access.test.ts
git commit -m "feat(prd-52): уровень доступа review и резолвер canReviewTest"
```

### Задача 1.2: middleware `requireReviewScope`

**Файлы:**

- Создать: `server/middleware/review-scope.ts`
- Тест: `tests/review-scope-middleware.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Проверяются четыре ветки: 401 без `req.effectiveRoles`, 404 на отсутствующем тесте, 403 без гранта,
`next()` при гранте `review`.

```ts
it("отказывает 403 без гранта", async () => {
  vi.mocked(storage.getTest).mockResolvedValue({ id: "t1", ownerId: "other" } as never);
  vi.mocked(canReviewTest).mockResolvedValue(false);
  const res = mockRes();
  await requireReviewScope("testId")(mockReq({ testId: "t1" }), res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- tests/review-scope-middleware.test.ts
```

- [ ] **Шаг 3: реализовать middleware**

Слепок с `requireTestScope` (`server/middleware/test-scope.ts:29-67`), но единственное действие и
свой резолвер:

```ts
export function requireReviewScope(paramName = "id") {
  return async function (req: Request, res: Response, next: NextFunction) {
    const roles = req.effectiveRoles;
    const user = req.currentUser;
    if (!roles || !user) return res.status(401).json({ error: "Unauthorized" });
    try {
      const test = await storage.getTest(req.params[paramName]);
      if (!test) return res.status(404).json({ error: "Test not found" });
      if (!(await canReviewTest(roles, user.id, test))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    } catch {
      return res.status(500).json({ error: "Authorization error" });
    }
  };
}
```

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- tests/review-scope-middleware.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/middleware/review-scope.ts tests/review-scope-middleware.test.ts
git commit -m "feat(prd-52): middleware requireReviewScope"
```

### Задача 1.3: миграция 0025

**Файлы:**

- Создать: `drizzle/0025_prd52_review_comments.sql`
- Изменить: `shared/schema.ts`

- [ ] **Шаг 1: описать таблицу и правки токенов в схеме Drizzle**

```ts
export const testReviewComments = pgTable("test_review_comments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  authorId: varchar("author_id", { length: 36 }).notNull(),
  parentId: varchar("parent_id", { length: 36 }),
  body: text("body").notNull(),
  anchorKind: text("anchor_kind", {
    enum: ["question", "content-page", "topic", "start", "results", "test"],
  }).notNull(),
  questionId: varchar("question_id", { length: 36 }),
  topicId: varchar("topic_id", { length: 36 }),
  contentPageId: varchar("content_page_id", { length: 36 }),
  contextLabel: text("context_label"),
  pinnedContentHash: text("pinned_content_hash"),
  status: text("status", { enum: ["open", "accepted", "rejected"] }),
  resolvedBy: varchar("resolved_by", { length: 36 }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  testIdx: index("test_review_comments_test_idx").on(table.testId),
  questionIdx: index("test_review_comments_test_question_idx").on(table.testId, table.questionId),
  parentIdx: index("test_review_comments_parent_idx").on(table.parentId),
}));
```

В `assignmentAccessTokens`: `assignmentId` теряет `.notNull()`, добавляется

```ts
purpose: text("purpose", { enum: ["attempt", "review"] }).notNull().default("attempt"),
```

Там же — `insertTestReviewCommentSchema`, типы `TestReviewComment` и `InsertTestReviewComment` рядом с
соседними по файлу.

- [ ] **Шаг 2: сгенерировать миграцию**

```bash
npx drizzle-kit generate
```

Ожидаемо: создан `drizzle/0025_*.sql` с `CREATE TABLE test_review_comments`, тремя индексами,
`ALTER TABLE assignment_access_tokens ADD COLUMN purpose` и `ALTER COLUMN assignment_id DROP NOT NULL`.
Файл переименовать в `0025_prd52_review_comments.sql` вместе с записью в `drizzle/meta/_journal.json`.

- [ ] **Шаг 3: применить к дев-базе**

```bash
npm run db:migrate
```

Ожидаемо: миграция применена. Если журнал разошёлся с базой — не пересобирать уже применённый файл,
Drizzle сверяет его по хешу.

- [ ] **Шаг 4: проверить, что схема и база сошлись**

```bash
npx drizzle-kit generate
```

Ожидаемо: `No schema changes, nothing to migrate`.

- [ ] **Шаг 5: коммит**

```bash
git add shared/schema.ts drizzle/0025_prd52_review_comments.sql drizzle/meta
git commit -m "feat(prd-52): миграция 0025 — комментарии и назначение токена"
```

### Задача 1.4: ревью-ссылка

**Файлы:**

- Изменить: `server/routes/access.ts:87`
- Изменить: `server/middleware/magic-scope-rules.ts:41-65`
- Тест: `tests/routes.access.test.ts`, `tests/magic-scope-rules.test.ts`

- [ ] **Шаг 1: написать падающие тесты**

```ts
it("ревью-токен ведёт на экран эксперта", async () => {
  vi.mocked(storage.getAssignmentAccessToken).mockResolvedValue({
    userId: "u1", testId: "t1", assignmentId: null, purpose: "review",
    expiresAt: new Date(Date.now() + 6e4), revokedAt: null,
  } as never);
  const res = await request(app).get("/access/" + "a".repeat(40));
  expect(res.headers.location).toBe("/review/tests/t1");
});

it("ревью-сессия видит комментарии своего теста и не видит чужого", () => {
  expect(matchMagicScopeRule("GET", "/api/tests/t1/review/comments")?.rule.bind).toBe("test");
  expect(matchMagicScopeRule("POST", "/api/tests/t1/review/comments")?.rule.bind).toBe("test");
  expect(matchMagicScopeRule("GET", "/api/tests/t1/review/session")).toBeTruthy();
  expect(matchMagicScopeRule("GET", "/api/tests/t1/export/scorm")).toBeNull();
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/routes.access.test.ts tests/magic-scope-rules.test.ts
```

- [ ] **Шаг 3: реализовать**

В `server/routes/access.ts` вместо безусловного редиректа:

```ts
const target = record.purpose === "review"
  ? `/review/tests/${record.testId}`
  : `/learner/test/${record.testId}`;
res.redirect(target);
```

В `MAGIC_SCOPE_RULES` — блок ревью-путей, каждый с `bind: "test"`:

```ts
// PRD-52: ревью-сессия эксперта. Всё привязано к тесту ссылки; отладочные и
// экспортные маршруты сюда сознательно не входят.
{ method: "POST", pattern: "/api/tests/:testId/review/session", bind: "test" },
{ method: "GET", pattern: "/api/tests/:testId/review/play/:token", bind: "test" },
{ method: "GET", pattern: "/api/tests/:testId/review/shim.js", bind: "test" },
{ method: "GET", pattern: "/api/tests/:testId/review/inspector-compute.js", bind: "test" },
{ method: "GET", pattern: "/api/tests/:testId/review/comments", bind: "test" },
{ method: "POST", pattern: "/api/tests/:testId/review/comments", bind: "test" },
```

Раздача файлов пакета берёт splat-форму так же, как отладчик: `/review/play/:token{/*splat}`.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- tests/routes.access.test.ts tests/magic-scope-rules.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/routes/access.ts server/middleware/magic-scope-rules.ts tests/routes.access.test.ts tests/magic-scope-rules.test.ts
git commit -m "feat(prd-52): вход по ревью-ссылке и её область действия"
```

---

## Э2. Комментарии на сервере

### Задача 2.1: якорь — общий контракт

**Файлы:**

- Создать: `shared/review/anchor.ts`
- Тест: `tests/review-anchor.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
it("вопрос ведёт в редактор вопроса", () => {
  expect(resolveAnchorTarget({ kind: "question", questionId: "q1", topicId: "t1" }))
    .toEqual({ target: "question-editor", questionId: "q1" });
});

it("тест в целом ведёт в ящик теста", () => {
  expect(resolveAnchorTarget({ kind: "test" })).toEqual({ target: "test-editor", tab: "basic" });
});

it("итоги ведут во вкладку оформления", () => {
  expect(resolveAnchorTarget({ kind: "results" })).toEqual({ target: "test-editor", tab: "design" });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- tests/review-anchor.test.ts
```

- [ ] **Шаг 3: реализовать тип и резолвер**

```ts
export type ReviewAnchorKind = "question" | "content-page" | "topic" | "start" | "results" | "test";

export interface ReviewAnchor {
  kind: ReviewAnchorKind;
  questionId?: string;
  topicId?: string;
  contentPageId?: string;
}

export type AnchorTarget =
  | { target: "question-editor"; questionId: string }
  | { target: "content-page-editor"; contentPageId: string }
  | { target: "test-editor"; tab: "basic" | "structure" | "design"; topicId?: string };

export function resolveAnchorTarget(anchor: ReviewAnchor): AnchorTarget {
  switch (anchor.kind) {
    case "question":
      return { target: "question-editor", questionId: anchor.questionId! };
    case "content-page":
      return { target: "content-page-editor", contentPageId: anchor.contentPageId! };
    case "topic":
      return { target: "test-editor", tab: "structure", topicId: anchor.topicId };
    case "start":
    case "results":
      return { target: "test-editor", tab: "design" };
    case "test":
      return { target: "test-editor", tab: "basic" };
  }
}
```

Функция чистая и живёт в `shared/`, потому что её зовут три потребителя: панель в ящике, панель в
отладчике и разбор ссылки `?review=<id>`. Второй копии быть не должно.

- [ ] **Шаг 4: тест проходит**

```bash
npm test -- tests/review-anchor.test.ts
```

- [ ] **Шаг 5: коммит**

```bash
git add shared/review/anchor.ts tests/review-anchor.test.ts
git commit -m "feat(prd-52): общий контракт якоря комментария"
```

### Задача 2.2: снимок контекста и пин хеша

**Файлы:**

- Создать: `server/services/review-anchor.ts`
- Тест: `tests/review-anchor-service.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
it("собирает ярлык вопроса из темы и формулировки", async () => {
  const snap = await describeAnchor("t1", { kind: "question", questionId: "q1", topicId: "tp1" });
  expect(snap.contextLabel).toBe("Раздел «IPTV» · Вопрос «Что такое multicast»");
  expect(snap.pinnedContentHash).toHaveLength(64);
});

it("хеш меняется вслед за формулировкой", async () => {
  const before = await describeAnchor("t1", { kind: "question", questionId: "q1" });
  vi.mocked(storage.getQuestion).mockResolvedValue({ ...question, prompt: "иначе" } as never);
  const after = await describeAnchor("t1", { kind: "question", questionId: "q1" });
  expect(after.pinnedContentHash).not.toBe(before.pinnedContentHash);
});

it("длинная формулировка обрезается в ярлыке", async () => {
  const snap = await describeAnchor("t1", { kind: "question", questionId: "qLong" });
  expect(snap.contextLabel.length).toBeLessThanOrEqual(160);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/review-anchor-service.test.ts
```

- [ ] **Шаг 3: реализовать**

`describeAnchor(testId, anchor)` возвращает `{ contextLabel, pinnedContentHash }`. Хеш —
`createHash("sha256")` по стабильной сериализации содержимого якоря: для вопроса это формулировка,
данные вариантов, ключ и обратная связь; для страницы контента — заголовок и тело; для темы — имя;
для экранов и теста в целом хеш не считается (`null`).

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- tests/review-anchor-service.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/services/review-anchor.ts tests/review-anchor-service.test.ts
git commit -m "feat(prd-52): снимок контекста и пин содержимого якоря"
```

### Задача 2.3: репозиторий комментариев

**Файлы:**

- Создать: `server/storage/review-comments-repository.ts`
- Изменить: `server/storage.ts`
- Тест: `tests/it/review-comments-repository.it.test.ts` (интеграционный, pglite)

- [ ] **Шаг 1: написать падающий тест**

```ts
it("отдаёт ветки теста с ответами", async () => {
  const root = await repo.createComment({ testId, authorId: "u1", body: "криво", anchorKind: "question", questionId: "q1" });
  await repo.createComment({ testId, authorId: "u2", body: "поправил", parentId: root.id, anchorKind: "question", questionId: "q1" });
  const threads = await repo.listThreads(testId);
  expect(threads).toHaveLength(1);
  expect(threads[0].replies).toHaveLength(1);
  expect(threads[0].status).toBe("open");
});

it("закрытие пишет исход, автора и время", async () => {
  const root = await repo.createComment({ testId, authorId: "u1", body: "x", anchorKind: "test" });
  await repo.resolveComment(root.id, { status: "rejected", resolvedBy: "u9" });
  const [thread] = await repo.listThreads(testId);
  expect(thread.status).toBe("rejected");
  expect(thread.resolvedBy).toBe("u9");
  expect(thread.resolvedAt).toBeInstanceOf(Date);
});

it("считает открытые ветки по тесту", async () => {
  expect(await repo.countOpen(testId)).toBe(1);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm run test:it -- tests/it/review-comments-repository.it.test.ts
```

- [ ] **Шаг 3: реализовать репозиторий**

Методы: `listThreads(testId)` (корни с вложенными ответами, отсортированы по `createdAt`),
`getComment(id)`, `createComment(input)`, `updateBody(id, body)`, `deleteComment(id)`,
`resolveComment(id, {status, resolvedBy})`, `reopenComment(id)`, `countOpen(testId)`,
`countOpenByTests(testIds)` для списка тестов.

Запись идёт через белый список колонок, как в соседних репозиториях; делегирование добавляется в
`server/storage.ts` рядом с прочими доменами.

- [ ] **Шаг 4: тесты проходят**

```bash
npm run test:it -- tests/it/review-comments-repository.it.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/storage/review-comments-repository.ts server/storage.ts tests/it/review-comments-repository.it.test.ts
git commit -m "feat(prd-52): репозиторий комментариев"
```

### Задача 2.4: API комментариев и правила жизненного цикла

**Файлы:**

- Создать: `server/routes/review.ts`
- Изменить: `server/routes/index.ts:68` (рядом с `debugPlayerRouter`)
- Тест: `tests/review-routes.test.ts`

Маршруты, все под `requireReviewScope("id")`, кроме закрытия и переоткрытия — те под
`requireTestScope("edit")`:

| Метод | Путь | Смысл |
| --- | --- | --- |
| GET | `/api/tests/:id/review/comments` | ветки теста |
| POST | `/api/tests/:id/review/comments` | новый комментарий или ответ |
| PATCH | `/api/tests/:id/review/comments/:commentId` | правка своего текста |
| DELETE | `/api/tests/:id/review/comments/:commentId` | удаление своего без ответов |
| POST | `/api/tests/:id/review/comments/:commentId/resolve` | закрытие с исходом |
| POST | `/api/tests/:id/review/comments/:commentId/reopen` | переоткрытие |

- [ ] **Шаг 1: написать падающие тесты**

```ts
it("отклонение без ответа не проходит", async () => {
  const res = await agent.post(`/api/tests/${testId}/review/comments/${rootId}/resolve`)
    .send({ status: "rejected" });
  expect(res.status).toBe(422);
  expect(res.body.error).toMatch(/ответ/i);
});

it("отклонение с ответом закрывает ветку", async () => {
  await agent.post(`/api/tests/${testId}/review/comments`).send({ parentId: rootId, body: "не согласен, оставляем" });
  const res = await agent.post(`/api/tests/${testId}/review/comments/${rootId}/resolve`).send({ status: "rejected" });
  expect(res.status).toBe(200);
});

it("эксперт не может закрыть ветку", async () => {
  const res = await expertAgent.post(`/api/tests/${testId}/review/comments/${rootId}/resolve`)
    .send({ status: "accepted" });
  expect(res.status).toBe(403);
});

it("чужой комментарий не удаляется владельцем теста", async () => {
  const res = await ownerAgent.delete(`/api/tests/${testId}/review/comments/${expertCommentId}`);
  expect(res.status).toBe(403);
});

it("свой комментарий не удаляется после ответа", async () => {
  const res = await expertAgent.delete(`/api/tests/${testId}/review/comments/${answeredId}`);
  expect(res.status).toBe(409);
});

it("создание подставляет ярлык и хеш по якорю", async () => {
  const res = await expertAgent.post(`/api/tests/${testId}/review/comments`)
    .send({ body: "криво", anchor: { kind: "question", questionId: "q1" } });
  expect(res.body.contextLabel).toContain("Вопрос");
  expect(res.body.pinnedContentHash).toBeTruthy();
});

it("ветка помечается изменённой после правки вопроса", async () => {
  await editQuestionPrompt("q1", "новая формулировка");
  const res = await ownerAgent.get(`/api/tests/${testId}/review/comments`);
  expect(res.body[0].stale).toBe(true);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/review-routes.test.ts
```

- [ ] **Шаг 3: реализовать роутер**

Правила, которые роутер обязан держать (FR-21 — FR-26):

- ответ — это `parentId` на корне; ответ на ответ отвергается (422);
- `status` ставится только на корне;
- `resolve` со `status: "rejected"` проверяет, что в ветке есть хотя бы один ответ, иначе 422;
- `DELETE` разрешён только автору комментария и только пока ответов нет (409), чужое — 403;
- `GET` считает `stale` сравнением текущего хеша якоря с `pinnedContentHash` и отдаёт его полем
  ответа, не сохраняя в базу;
- удалённый объект якоря даёт `orphaned: true` и гасит переход на клиенте.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- tests/review-routes.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/routes/review.ts server/routes/index.ts tests/review-routes.test.ts
git commit -m "feat(prd-52): API комментариев с исходом и пометкой устаревания"
```

---

## Э3. Экран эксперта

Стартует только после согласования эскизов Э0.

### Задача 3.1: ревью-сессия на сервере

**Файлы:**

- Изменить: `server/routes/review.ts`
- Тест: `tests/review-routes.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
it("собирает пакет без телеметрии и не пишет попыток", async () => {
  const res = await expertAgent.post(`/api/tests/${testId}/review/session`);
  expect(res.status).toBe(200);
  expect(res.body.playUrl).toContain("/review/play/");
  expect(generateScormPackage).toHaveBeenCalledWith(expect.objectContaining({ telemetry: null }));
  expect(storage.createAttempt).not.toHaveBeenCalled();
});

it("посторонний получает 403", async () => {
  const res = await strangerAgent.post(`/api/tests/${testId}/review/session`);
  expect(res.status).toBe(403);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- tests/review-routes.test.ts
```

- [ ] **Шаг 3: реализовать**

Пять маршрутов, повторяющих отладчик (`server/routes/debug-player.ts`), но под
`requireReviewScope`: `POST /review/session`, `GET /review/play/:token{/*splat}`,
`DELETE /review/session/:token`, `GET /review/shim.js`, `GET /review/inspector-compute.js`.
Сборка — тот же `buildScormExportData(id, { source: "debug" })` и `generateScormPackage` с
`telemetry: null`, стор — тот же `session-store`.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- tests/review-routes.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/routes/review.ts tests/review-routes.test.ts
git commit -m "feat(prd-52): ревью-сессия — сборка живого пакета под грантом review"
```

### Задача 3.2: окно эксперта

**Файлы:**

- Создать: `client/src/pages/review/review-player-page.tsx`
- Изменить: `client/src/App.tsx`
- Тест: `client/src/pages/review/__tests__/review-player-page.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

```tsx
it("показывает ровно три вкладки", async () => {
  render(<ReviewPlayerPage />);
  await screen.findByRole("tab", { name: "Комментарии" });
  expect(screen.getAllByRole("tab").map((t) => t.textContent))
    .toEqual(["Комментарии", "Результаты", "Протокол"]);
});

it("эталон выключен при открытии", async () => {
  render(<ReviewPlayerPage />);
  expect(await screen.findByRole("switch", { name: /Эталон/ })).not.toBeChecked();
});

it("без гранта показывает экран отказа", async () => {
  mockSession({ status: "forbidden" });
  render(<ReviewPlayerPage />);
  expect(await screen.findByText(/нет доступа/i)).toBeInTheDocument();
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/pages/review/__tests__/review-player-page.test.tsx
```

- [ ] **Шаг 3: реализовать страницу**

Раскладка и состав — строго по согласованному эскизу `prd52-review-player.html`. Переиспользуются
`use-debug-session` (с базовым путём `review` вместо `debug`), панели `ScorePanel` и протокола из
`debug-player-page.tsx` — их выносим в общий модуль, а не копируем. Маршрут в `App.tsx` —
`/review/tests/:testId`, без авторской оболочки, как у `/author/tests/:testId/debug`.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- client/src/pages/review/__tests__/review-player-page.test.tsx
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add client/src/pages/review client/src/App.tsx
git commit -m "feat(prd-52): окно эксперта с тремя вкладками"
```

---

## Э4. Полная выдача

### Задача 4.1: hash-флаг и ветка выдачи

**Файлы:**

- Изменить: `server/scorm/assets/app.js:151-230`
- Тест: `tests/prd52-full-draw.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
it("без хеша выдача обычная", () => {
  const win = { location: { hash: "" } };
  expect(tbDebugFullDraw(win)).toBe(false);
});

it("мусор в хеше не включает режим", () => {
  expect(tbDebugFullDraw({ location: { hash: "#tbfa=нет" } })).toBe(false);
});

it("флаг включает полную выдачу", () => {
  expect(tbDebugFullDraw({ location: { hash: "#tbfa=1" } })).toBe(true);
});

it("в режиме полной выдачи тема отдаёт весь банк", () => {
  const variant = runGenerateVariant({ hash: "#tbfa=1", drawCount: 3, bankSize: 12 });
  expect(variant.sections[0].questionIds).toHaveLength(12);
});

it("тема-вариант отдаёт весь банк, а не объединение форм", () => {
  const variant = runGenerateVariant({ hash: "#tbfa=1", formSetSizes: [3, 4], bankSize: 12 });
  expect(variant.sections[0].questionIds).toHaveLength(12);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/prd52-full-draw.test.ts
```

- [ ] **Шаг 3: реализовать**

Хелпер рядом с `tbDebugForcedForms` (`server/scorm/assets/app.js:151`):

```js
// PRD-52 review: deliver the WHOLE topic bank instead of the configured draw.
// Inert in production — WebTutor launches the package without a hash.
// `win` is injectable so the unit test can pass a fake window; production calls
// it with no argument, exactly like tbDebugForcedForms.
function tbDebugFullDraw(win) {
  try {
    var w = win || (typeof window !== 'undefined' ? window : null);
    var h = (w && w.location && w.location.hash) || '';
    return /(?:^#|[#&])tbfa=1(?:&|$)/.test(h);
  } catch (e) { return false; }
}
```

В `generateVariant()` ветка полной выдачи стоит ПЕРВОЙ, до разбора `formSet` и `drawBlueprint`: берёт
`available` целиком, порядок — по `effectiveSectionOrder`, `deliveredFormId` остаётся `null`.

- [ ] **Шаг 4: тесты проходят и пакет собирается**

```bash
npm test -- tests/prd52-full-draw.test.ts
npm run scorm:sample
```

- [ ] **Шаг 5: коммит**

```bash
git add server/scorm/assets/app.js tests/prd52-full-draw.test.ts
git commit -m "feat(prd-52): режим полной выдачи в рантайме пакета"
```

### Задача 4.2: уровень вопроса и гашение вердикта

**Файлы:**

- Изменить: `server/scorm/debug-player/assets/inspector-compute.js`
- Тест: `tests/prd52-inspector-full-draw.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
it("уровень вопроса берётся из диапазонов сложности темы", () => {
  const rows = TB.buildProtocolRows(pkgWithAdaptiveBank);
  expect(rows[0].levelName).toBe("Базовый");
});

it("вопрос вне лестницы помечен", () => {
  const rows = TB.buildProtocolRows(pkgWithOrphanQuestion);
  expect(rows.find((r) => r.questionId === "qOrphan")?.levelName).toBe(null);
  expect(rows.find((r) => r.questionId === "qOrphan")?.outsideLevels).toBe(true);
});

it("в режиме полной выдачи вердикт не считается", () => {
  const score = TB.buildScore(pkgFullDraw);
  expect(score.suppressed).toBe(true);
  expect(score.verdict).toBe(null);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/prd52-inspector-full-draw.test.ts
```

- [ ] **Шаг 3: реализовать**

В `buildProtocolRows` добавить `levelName` и `outsideLevels`: сопоставить `question.difficulty` с
`adaptiveTopics[].levels[].minDifficulty/maxDifficulty` темы вопроса; ни одного попадания —
`levelName: null`, `outsideLevels: true`. В `buildScore` — флаг `suppressed`, когда прогон идёт в
режиме полной выдачи; при нём `verdict`, `percent` и порог не считаются.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- tests/prd52-inspector-full-draw.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/scorm/debug-player/assets/inspector-compute.js tests/prd52-inspector-full-draw.test.ts
git commit -m "feat(prd-52): уровень вопроса в протоколе и гашение вердикта"
```

### Задача 4.3: тумблер в окне эксперта и в отладчике

**Файлы:**

- Изменить: `client/src/pages/review/review-player-page.tsx`
- Изменить: `client/src/features/tests/debug-player/debug-player-page.tsx`
- Тест: оба файла тестов страниц

- [ ] **Шаг 1: написать падающий тест**

```tsx
it("тумблер выключен по умолчанию и включение перестраивает прогон", async () => {
  render(<ReviewPlayerPage />);
  const toggle = await screen.findByRole("switch", { name: /Все вопросы темы/ });
  expect(toggle).not.toBeChecked();
  await userEvent.click(toggle);
  expect(screen.getByTitle("stage")).toHaveAttribute("src", expect.stringContaining("tbfa=1"));
});

it("после старта тумблер недоступен", async () => {
  mockSnapshot({ draw: { started: true } });
  render(<ReviewPlayerPage />);
  expect(await screen.findByRole("switch", { name: /Все вопросы темы/ })).toBeDisabled();
});

it("на вкладке Результаты вместо балла — пояснение", async () => {
  mockSnapshot({ scoreVM: { suppressed: true } });
  render(<ReviewPlayerPage />);
  expect(await screen.findByText("не считается в режиме полной выдачи")).toBeInTheDocument();
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/pages/review client/src/features/tests/debug-player
```

- [ ] **Шаг 3: реализовать**

Тумблер дописывает `tbfa=1` в hash `playUrl` и зовёт `reset()` — ровно так, как это уже сделано у
пина варианта на вкладке «Выдача». Доступен, пока `DrawVM.started` ложно.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- client/src/pages/review client/src/features/tests/debug-player
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add client/src/pages/review client/src/features/tests/debug-player
git commit -m "feat(prd-52): тумблер полной выдачи в окнах прогона"
```

---

## Э5. Панель у автора

Стартует только после согласования эскизов Э0.

### Задача 5.1: стек ящиков в ui-kit

**Файлы:**

- Изменить: `vendor/ui-kit/src/components/Drawer.tsx:51`
- Тест: `vendor/ui-kit/src/components/__tests__/drawer-stack.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

```tsx
it("Escape закрывает только верхний ящик", async () => {
  const onCloseOuter = vi.fn();
  const onCloseInner = vi.fn();
  render(
    <>
      <Drawer open onClose={onCloseOuter}>внешний</Drawer>
      <Drawer open onClose={onCloseInner}>внутренний</Drawer>
    </>,
  );
  await userEvent.keyboard("{Escape}");
  expect(onCloseInner).toHaveBeenCalledTimes(1);
  expect(onCloseOuter).not.toHaveBeenCalled();
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npm test -- vendor/ui-kit/src/components/__tests__/drawer-stack.test.tsx
```

Ожидаемо: FAIL — вызваны оба обработчика.

- [ ] **Шаг 3: реализовать стек**

Модульный список открытых ящиков: при монтировании открытый ящик встаёт в конец, при размонтировании
уходит; обработчик Escape срабатывает, только если ящик — последний в списке. Правка общая, не под
PRD-52: вложенные ящики понадобятся и дальше.

- [ ] **Шаг 4: тесты проходят, регрессия одиночного ящика цела**

```bash
npm test -- vendor/ui-kit/src/components
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add vendor/ui-kit/src/components/Drawer.tsx vendor/ui-kit/src/components/__tests__/drawer-stack.test.tsx
git commit -m "fix(ui-kit): Escape закрывает только верхний ящик стека"
```

### Задача 5.2: панель комментариев

**Файлы:**

- Создать: `client/src/features/tests/review/review-api.ts`
- Создать: `client/src/features/tests/review/use-review-comments.ts`
- Создать: `client/src/features/tests/review/review-panel.tsx`
- Создать: `client/src/features/tests/review/review-comment-form.tsx`
- Тест: `client/src/features/tests/review/__tests__/review-panel.test.tsx`

- [ ] **Шаг 1: написать падающие тесты**

```tsx
it("группирует ветки по разделам и вопросам", async () => {
  render(<ReviewPanel testId="t1" />);
  expect(await screen.findByText("Раздел «IPTV»")).toBeInTheDocument();
});

it("фильтр оставляет только открытые", async () => {
  render(<ReviewPanel testId="t1" />);
  await userEvent.click(screen.getByRole("switch", { name: /только открытые/i }));
  expect(screen.queryByText("учтено")).not.toBeInTheDocument();
});

it("отклонение требует ответа", async () => {
  render(<ReviewPanel testId="t1" canResolve />);
  await userEvent.click(await screen.findByRole("button", { name: "Отклонить" }));
  expect(screen.getByRole("button", { name: "Отклонить комментарий" })).toBeDisabled();
});

it("показывает пометку изменённого вопроса", async () => {
  mockThreads([{ id: "c1", stale: true, anchorKind: "question" }]);
  render(<ReviewPanel testId="t1" />);
  expect(await screen.findByText("изменено после комментария")).toBeInTheDocument();
});

it("удалённый объект гасит переход", async () => {
  mockThreads([{ id: "c1", orphaned: true, anchorKind: "question" }]);
  render(<ReviewPanel testId="t1" />);
  expect(await screen.findByRole("button", { name: "Перейти" })).toBeDisabled();
});

it("автор создаёт комментарий с выбором якоря", async () => {
  render(<ReviewPanel testId="t1" mode="editor" />);
  await userEvent.click(screen.getByRole("button", { name: "Добавить комментарий" }));
  expect(screen.getByLabelText("Место")).toHaveValue("test");
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/features/tests/review
```

- [ ] **Шаг 3: реализовать**

Верстка — строго по согласованному эскизу `prd52-review-panel.html`, только компоненты `ou-*`/`tb-*`,
никаких классов `wf-*` в продовом коде. Панель принимает режим: `player` (якорь берётся с текущего
экрана) и `editor` (якорь выбирается явно, по умолчанию «тест в целом»).

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- client/src/features/tests/review
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/review
git commit -m "feat(prd-52): панель комментариев"
```

### Задача 5.3: вкладка в ящике редактора теста

**Файлы:**

- Изменить: `client/src/features/tests/editor/test-editor.tsx`
- Тест: `client/src/features/tests/editor/__tests__/test-editor.review-tab.test.tsx`

- [ ] **Шаг 1: написать падающие тесты**

```tsx
it("вкладка показывает счётчик открытых", async () => {
  render(<TestEditor testId="t1" open />);
  expect(await screen.findByRole("tab", { name: /Комментарии 3/ })).toBeInTheDocument();
});

it("переход по якорю открывает ящик вопроса поверх", async () => {
  render(<TestEditor testId="t1" open />);
  await userEvent.click(await screen.findByRole("tab", { name: /Комментарии/ }));
  await userEvent.click(screen.getByRole("button", { name: "Перейти" }));
  expect(screen.getByRole("dialog", { name: /Вопрос/ })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: /Тест/ })).toBeInTheDocument();
});

it("закрытие ящика вопроса возвращает на ту же вкладку", async () => {
  render(<TestEditor testId="t1" open />);
  await userEvent.click(await screen.findByRole("tab", { name: /Комментарии/ }));
  await userEvent.click(screen.getByRole("button", { name: "Перейти" }));
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("tab", { name: /Комментарии/ })).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/features/tests/editor/__tests__/test-editor.review-tab.test.tsx
```

- [ ] **Шаг 3: реализовать**

Вкладка «Комментарии» рядом с существующими, внутри — `ReviewPanel` в режиме `editor`. Переход зовёт
`resolveAnchorTarget` и монтирует `QuestionEditorDrawer` поверх; после `onSaved` вкладка и позиция
списка сохраняются, потому что ящик теста не размонтируется.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- client/src/features/tests/editor
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/editor
git commit -m "feat(prd-52): вкладка «Комментарии» в ящике редактора теста"
```

### Задача 5.4: вкладка в отладчике и баннер пересборки

**Файлы:**

- Изменить: `client/src/features/tests/debug-player/debug-player-page.tsx:32-39`
- Тест: `client/src/features/tests/debug-player/__tests__/debug-player-page.test.tsx`

- [ ] **Шаг 1: написать падающие тесты**

```tsx
it("вкладок стало восемь, «Комментарии» среди них", async () => {
  render(<DebugPlayerPage />);
  expect((await screen.findAllByRole("tab")).map((t) => t.textContent)).toContain("Комментарии");
});

it("правка вопроса не перезагружает стейдж и показывает баннер", async () => {
  render(<DebugPlayerPage />);
  const src = screen.getByTitle("stage").getAttribute("src");
  await openAnchorAndSave();
  expect(screen.getByTitle("stage")).toHaveAttribute("src", src);
  expect(screen.getByText(/нужна пересборка/i)).toBeInTheDocument();
});

it("пересборка предупреждает, что прогон начнётся сначала", async () => {
  render(<DebugPlayerPage />);
  await userEvent.click(screen.getByRole("button", { name: "Пересобрать" }));
  expect(screen.getByText(/прогон начнётся сначала/i)).toBeInTheDocument();
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/features/tests/debug-player
```

- [ ] **Шаг 3: реализовать**

Добавить `{ id: "review", label: "Комментарии" }` в `TABS`, внутри — `ReviewPanel` в режиме `player`.
Ящик правки монтируется в окне отладчика; `runKey` при этом не трогать — иначе стейдж перезагрузится
и прогон потеряется. Баннер поднимается по `onSaved` и гаснет после «Пересобрать».

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- client/src/features/tests/debug-player
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/debug-player
git commit -m "feat(prd-52): «Комментарии» в отладчике и предупреждение о пересборке"
```

### Задача 5.5: счётчик в списке тестов и ссылка `?review=<id>`

**Файлы:**

- Изменить: `client/src/features/tests/list/tests-list.tsx`
- Тест: `client/src/features/tests/list/__tests__/tests-list.review.test.tsx`

- [ ] **Шаг 1: написать падающие тесты**

```tsx
it("показывает счётчик открытых комментариев", async () => {
  render(<TestsList />);
  expect(await screen.findByLabelText("Открытых комментариев: 3")).toBeInTheDocument();
});

it("ссылка ?review открывает ящик на вкладке комментариев с раскрытой веткой", async () => {
  renderAt("/author/tests?test=t1&review=c1");
  expect(await screen.findByRole("tab", { name: /Комментарии/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("thread-c1")).toHaveAttribute("data-expanded", "true");
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/features/tests/list
```

- [ ] **Шаг 3: реализовать**

Счётчик приходит вместе со списком тестов (`countOpenByTests`), чтобы не делать запрос на карточку.
Разбор `?review=<id>` открывает ящик нужного теста, включает вкладку и раскрывает ветку.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- client/src/features/tests/list
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/list server/routes/tests.ts
git commit -m "feat(prd-52): счётчик комментариев в списке и адресная ссылка на ветку"
```

---

## Э6. Рассылка

Стартует только после согласования эскизов Э0.

### Задача 6.1: выдача гранта и ревью-токена

**Файлы:**

- Создать: `server/services/review-invite.ts`
- Изменить: `server/routes/review.ts`
- Тест: `tests/review-invite.test.ts`

- [ ] **Шаг 1: написать падающие тесты**

```ts
it("создаёт грант review и токен с назначением review", async () => {
  await inviteReviewers(testId, [{ email: "expert@x.test" }], { invitedBy: "u1" });
  expect(storage.createTestGrant).toHaveBeenCalledWith(
    expect.objectContaining({ testId, accessLevel: "review" }),
  );
  expect(storage.createAssignmentAccessToken).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: "review", assignmentId: null }),
  );
});

it("не создаёт назначения на прохождение", async () => {
  await inviteReviewers(testId, [{ email: "expert@x.test" }], { invitedBy: "u1" });
  expect(storage.createAssignment).not.toHaveBeenCalled();
});

it("повторное приглашение того же человека не плодит грантов", async () => {
  await inviteReviewers(testId, [{ email: "expert@x.test" }], { invitedBy: "u1" });
  await inviteReviewers(testId, [{ email: "expert@x.test" }], { invitedBy: "u1" });
  expect(storage.createTestGrant).toHaveBeenCalledTimes(1);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- tests/review-invite.test.ts
```

- [ ] **Шаг 3: реализовать**

Сервис повторяет конвейер PRD-28 (`participants-invite.ts`): классификация строк, заведение внешних
учёток, отчёт прогона. Отличие только в финальном действии — грант `review` вместо назначения и токен
с `purpose: "review"`. Разбор книги и отправка письма переиспользуются, не копируются.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- tests/review-invite.test.ts
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add server/services/review-invite.ts server/routes/review.ts tests/review-invite.test.ts
git commit -m "feat(prd-52): приглашение экспертов грантом review"
```

### Задача 6.2: диалог «Отправить на рецензирование»

**Файлы:**

- Изменить: `client/src/components/assign-test-dialog.tsx`
- Изменить: `client/src/features/tests/list/tests-list.tsx` (пункт меню)
- Тест: `client/src/features/tests/assign/__tests__/review-invite-dialog.test.tsx`

- [ ] **Шаг 1: написать падающие тесты**

```tsx
it("в режиме согласования четыре вкладки и предупреждение о видимости", async () => {
  render(<AssignTestDialog testId="t1" mode="review" open />);
  expect(await screen.findByText(/эксперты видят комментарии друг друга/i)).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(4);
});

it("отправка зовёт ревью-конвейер, а не назначение", async () => {
  render(<AssignTestDialog testId="t1" mode="review" open />);
  await inviteOne("expert@x.test");
  expect(fetchMock).toHaveBeenCalledWith("/api/tests/t1/review/invite", expect.anything());
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
npm test -- client/src/features/tests/assign
```

- [ ] **Шаг 3: реализовать**

Диалог получает режим `assign | review`; в режиме `review` меняются заголовок, конечная точка и текст
предупреждения. Вкладки, разбор файла, отчёт и выгрузка ссылок остаются общими. Пункт меню
«Отправить на рецензирование» встаёт рядом с «Тестовый прогон» и гейтится правом выдачи грантов.

- [ ] **Шаг 4: тесты проходят**

```bash
npm test -- client/src/features/tests/assign client/src/features/tests/list
npm run check
```

- [ ] **Шаг 5: коммит**

```bash
git add client/src/components/assign-test-dialog.tsx client/src/features/tests/list client/src/features/tests/assign
git commit -m "feat(prd-52): диалог отправки теста на согласование"
```

---

## Э7. Доки и приёмка

### Задача 7.1: документация

**Файлы:**

- Изменить: `docs/specs/prd-52/test-review.md` (раздел состояния)
- Изменить: `CLAUDE.md` (таблицы, маршруты, роутеры)
- Изменить: `docs/ROADMAP.md`

- [ ] **Шаг 1: описать состояние трека в спеке**
- [ ] **Шаг 2: дописать в `CLAUDE.md` таблицу `test_review_comments`, роутер `review` и уровень гранта**
- [ ] **Шаг 3: отметить PRD-52 в ROADMAP**
- [ ] **Шаг 4: проверить разметку**

```bash
npm run lint:md
```

Ожидаемо: 0 нарушений.

- [ ] **Шаг 5: коммит**

```bash
git add docs CLAUDE.md
git commit -m "docs(prd-52): состояние трека, схема и маршруты"
```

### Задача 7.2: приёмка в браузере

Принимается только живьём, в браузере: скриншот на каждый пункт, по критериям раздела 12 спеки.

- [ ] **Шаг 1: поднять второй экземпляр**

```bash
PORT=8099 npm run dev
```

- [ ] **Шаг 2: пройти все 14 критериев приёмки из спеки**

Отдельно проверить то, что не ловится юнит-тестами: внешний эксперт по ссылке не открывает другой
тест (403 `MAGIC_SCOPE`); прогон эксперта не оставил ни строки в `attempts` и в аналитике; Escape в
ящике вопроса не закрывает ящик теста; прогон в отладчике остался на том же вопросе после правки.

- [ ] **Шаг 3: полный прогон сюиты — по разрешению владельца**

```bash
npm test
npm run check
```

- [ ] **Шаг 4: приложить скриншоты и отчёт о приёмке к спеке**
- [ ] **Шаг 5: коммит**

```bash
git add docs/specs/prd-52
git commit -m "docs(prd-52): отчёт о приёмке"
```

---

## Покрытие требований спеки

| Требования | Задача |
| --- | --- |
| FR-01, FR-02 | 1.1, 1.2 |
| FR-03, FR-04, FR-05 | 1.3, 1.4 |
| FR-06, FR-07 | 6.1, 6.2 |
| FR-08, FR-09, FR-10 | 3.1, 3.2 |
| FR-11, FR-12, FR-13 | 4.1, 4.3 |
| FR-14, FR-15, FR-16, FR-17 | 4.2, 4.3 |
| FR-18, FR-18a, FR-18b | 2.2, 2.4, 5.2 |
| FR-19, FR-20 | 2.2, 2.4 |
| FR-21 — FR-26 | 2.4, 5.2 |
| FR-27, FR-28 | 5.2, 5.3, 5.4 |
| FR-29 | 5.1 |
| FR-30, FR-31 | 5.4 |
| FR-32 | 5.5 |
