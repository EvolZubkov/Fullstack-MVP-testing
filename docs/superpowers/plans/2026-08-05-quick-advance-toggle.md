# Быстрый переход к следующему вопросу — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent `quickAdvance` test setting so an author can choose, separately from
`allowReturnToUnanswered`, whether submitting an answer also advances to the next question in one click or needs a
separate «Далее» click.

**Architecture:** One new NOT NULL boolean column (`tests.quick_advance`), threaded through the existing PRD-19 plumbing
on both hosts. All the real decision logic lives in one function — `buildQuestionNav` in
`shared/template/question-nav.ts` — which both the web host and the SCORM runtime template already call; splitting its
`flexible` input into two orthogonal inputs (`flexible` for back/skip/review, a new `quickAdvance`-derived `twoStep` for
one-click-vs-two) is the entire behavioural change. Everything else is mechanical propagation of one new boolean field.

**Tech Stack:** TypeScript (Express + Drizzle ORM backend, React 19 frontend), hand-written plain-JS SCORM runtime,
Vitest, `drizzle-kit`.

**Spec:** `docs/specs/prd-43/quick-advance-toggle.md`

---

## Before you start

- Read `docs/specs/prd-43/quick-advance-toggle.md` in full — it has the "why" behind every decision below (all 4
  combinations required, mutex with `showCorrectAnswers`, migration rule, adaptive out of scope).
- This repo has multiple agent sessions working in the same working copy at once (see `CLAUDE.md`, "Concurrent
  sessions"). Before any `git add`, run `git status` and only stage the files this task touched — do not `git add -A`.
- Do NOT run `npm test` (full suite) or `npm run test:cov` without explicit user go-ahead. Use targeted runs (`npm test
  -- <path>`) throughout this plan; only the final task asks about a full run.
- Task 1's DB step only *generates* migration SQL (no live DB connection needed for `drizzle-kit generate`, only for
  `migrate`/`push`). Do NOT run `drizzle-kit migrate` against the shared dev DB as part of this plan without checking
  with the user first — it mutates a database other sessions may be using.

---

## Task 1: Schema + migration

**Files:**

- Modify: `shared/schema.ts:469-473`
- Create: `drizzle/00XX_prd43_quick_advance.sql` (generated, exact number TBD by `drizzle-kit`)
- Create: `drizzle/00XX_prd43_quick_advance_backfill.sql` (generated, custom)
- Modify: `drizzle/meta/_journal.json`, `drizzle/meta/00XX_snapshot.json` (generated)

- [ ] **Step 1: Add the column to the schema**

In `shared/schema.ts`, right after the `allowAnswerChange` column (line 473), add:

```ts
  // PRD-43: independent of allowReturnToUnanswered — whether submitting an answer
  // also advances to the next question in one click, or needs a separate «Далее»
  // click. Default false (today's two-step behaviour for a brand-new test); the
  // backfill migration sets EXISTING rows to `NOT allow_return_to_unanswered` so
  // no existing test's navigation changes after this ships.
  quickAdvance: boolean("quick_advance").notNull().default(false),
```

So the block reads:

```ts
  allowReturnToUnanswered: boolean("allow_return_to_unanswered").notNull().default(true),
  // PRD-19 (FR-04a): permit changing an already-submitted answer before section/test finish.
  // Default false. Depends on allowReturnToUnanswered=true and is mutually exclusive with
  // showCorrectAnswers (FR-04b) — enforced in the editor/service layer, not as a DB CHECK.
  allowAnswerChange: boolean("allow_answer_change").notNull().default(false),
  // PRD-43: independent of allowReturnToUnanswered — whether submitting an answer
  // also advances to the next question in one click, or needs a separate «Далее»
  // click. Default false (today's two-step behaviour for a brand-new test); the
  // backfill migration sets EXISTING rows to `NOT allow_return_to_unanswered` so
  // no existing test's navigation changes after this ships.
  quickAdvance: boolean("quick_advance").notNull().default(false),
  // PRD-19 (FR-05a): show the section-results screen (optional system node, sectioned tests).
  // Default true; not applicable to linear_flat (no sections) — ignored by the runtime there.
  showSectionResults: boolean("show_section_results").notNull().default(true),
```

- [ ] **Step 2: Generate the schema migration**

Run (from repo root; needs `DATABASE_URL` set per `.env` — `drizzle-kit generate` diffs against the local snapshot
files, it does not need a *live* connection, but the config throws if the env var is absent):

```bash
node_modules/.bin/drizzle-kit generate --name=prd43_quick_advance
```

Expected: a new `drizzle/00XX_prd43_quick_advance.sql` containing exactly:

```sql
ALTER TABLE "tests" ADD COLUMN "quick_advance" boolean DEFAULT false NOT NULL;
```

plus an updated `drizzle/meta/_journal.json` and a new `drizzle/meta/00XX_snapshot.json`. If the generated SQL contains
anything else (a DROP, a second unrelated column), STOP — it means `shared/schema.ts` had other uncommitted drift;
re-check `git diff shared/schema.ts` before proceeding.

- [ ] **Step 3: Generate the backfill data migration**

```bash
node_modules/.bin/drizzle-kit generate --custom --name=prd43_quick_advance_backfill
```

This creates an empty `drizzle/00XX_prd43_quick_advance_backfill.sql`. Fill it with:

```sql
UPDATE "tests" SET "quick_advance" = NOT "allow_return_to_unanswered";
```

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts drizzle/
git status
```

Confirm the staged list is exactly `shared/schema.ts` + the new/changed files under `drizzle/` (the journal, the new
snapshot, the two new `.sql` files) — nothing else, per the shared-working-copy caution above.

```bash
git commit -m "feat(prd-43): add tests.quick_advance column + backfill migration"
```

---

## Task 2: `buildQuestionNav` — the shared decision logic

This is the one function that actually changes behaviour. Both hosts call it, so this task alone (plus wiring the new
boolean through, Tasks 3-8) delivers the feature everywhere.

**Files:**

- Modify: `shared/template/question-nav.ts`
- Test: `shared/template/question-nav.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `shared/template/question-nav.test.ts` with:

```ts
/**
 * @module shared/template/question-nav.test
 * @description Состояние навигационной строки вопроса. Саму строку рисует МАКЕТ
 * шаблона (`question.html` → `.tb-scene__foot`), а хосты кладут в контекст только
 * эти данные — поэтому проверяется контракт полей, а не разметка.
 */
import { describe, it, expect } from "vitest";
import { buildQuestionNav, QUESTION_NAV_ACTIONS, type QuestionNavState } from "./question-nav";

// twoStep base: flexible, NOT quick — today's flexible two-click behaviour.
const flexible: QuestionNavState = {
  flexible: true,
  quickAdvance: false,
  committed: false,
  canPrev: true,
  answerReady: true,
  hasNext: true,
  showAccept: false,
  showReview: false,
};

describe("buildQuestionNav", () => {
  it("гибкий режим до фиксации: назад, пропустить и отправка ответа", () => {
    const nav = buildQuestionNav(flexible);
    expect(nav).toMatchObject({
      showBack: true,
      canPrev: true,
      showSkip: true,
      showReview: false,
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Отправить ответ",
      primaryEnabled: true,
    });
  });

  it("гасит отправку, пока ответ непригоден", () => {
    expect(buildQuestionNav({ ...flexible, answerReady: false }).primaryEnabled).toBe(false);
  });

  it("гасит «Назад» без доступного предыдущего вопроса", () => {
    expect(buildQuestionNav({ ...flexible, canPrev: false })).toMatchObject({ showBack: true, canPrev: false });
  });

  it("после фиксации — «Далее», без пропуска и без завершения теста", () => {
    const nav = buildQuestionNav({ ...flexible, committed: true });
    expect(nav).toMatchObject({
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("показывает «К обзору», когда в области есть пропущенные", () => {
    expect(buildQuestionNav({ ...flexible, showReview: true }).showReview).toBe(true);
  });

  it("строгий режим без быстрого перехода: только основная кнопка, без «Назад» и «Пропустить»", () => {
    expect(buildQuestionNav({ ...flexible, flexible: false })).toMatchObject({
      showBack: false,
      showSkip: false,
      showReview: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
    });
  });

  it("строгий режим: «Принять» при показе верного ответа, «Завершить тест» на последнем шаге", () => {
    expect(buildQuestionNav({ ...flexible, flexible: false, showAccept: true })).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Принять",
    });
    expect(buildQuestionNav({ ...flexible, flexible: false, hasNext: false })).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.finish,
      primaryLabel: "Завершить тест",
    });
  });

  // ─── PRD-43: quickAdvance × flexible — all 4 combinations ────────────────────

  it("строгий + быстрый переход (сегодняшнее строгое поведение): один клик «Далее» фиксирует и переходит", () => {
    const nav = buildQuestionNav({ ...flexible, flexible: false, quickAdvance: true });
    expect(nav).toMatchObject({
      showBack: false,
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("строгий + быстрый переход, последний вопрос: один клик «Завершить тест»", () => {
    expect(
      buildQuestionNav({ ...flexible, flexible: false, quickAdvance: true, hasNext: false }),
    ).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.finish,
      primaryLabel: "Завершить тест",
    });
  });

  it("строгий + БЕЗ быстрого перехода (новая комбинация): «Отправить ответ», затем отдельно «Далее»", () => {
    const beforeCommit = buildQuestionNav({ ...flexible, flexible: false, quickAdvance: false });
    expect(beforeCommit).toMatchObject({
      showBack: false,
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Отправить ответ",
    });
    const afterCommit = buildQuestionNav({
      ...flexible,
      flexible: false,
      quickAdvance: false,
      committed: true,
    });
    expect(afterCommit).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("гибкий + быстрый переход (новая комбинация): Назад/Пропустить остаются, но один клик «Далее» фиксирует и переходит", () => {
    const nav = buildQuestionNav({ ...flexible, flexible: true, quickAdvance: true });
    expect(nav).toMatchObject({
      showBack: true,
      showSkip: true,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("гибкий + быстрый переход, уже зафиксированный вопрос (возврат назад): просто «Далее», без повторной фиксации", () => {
    const nav = buildQuestionNav({ ...flexible, flexible: true, quickAdvance: true, committed: true });
    expect(nav).toMatchObject({
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("показ правильного ответа блокирует быстрый переход даже если quickAdvance=true (двухшаговая «Принять» → «Далее»)", () => {
    const nav = buildQuestionNav({
      ...flexible,
      flexible: false,
      quickAdvance: true,
      showAccept: true,
    });
    expect(nav).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Принять",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- shared/template/question-nav.test.ts
```

Expected: FAIL — `quickAdvance` does not exist on `QuestionNavState` (TS error surfaced by Vitest's esbuild transform as
a runtime `undefined` mismatch, or the new "PRD-43" test bodies fail their `toMatchObject` assertions) since
`buildQuestionNav` does not read it yet.

- [ ] **Step 3: Implement**

Replace the full contents of `shared/template/question-nav.ts` with:

```ts
/**
 * @module shared/template/question-nav
 *
 * Navigation STATE of the question screen — data, not markup.
 *
 * The row itself lives in the template's `question.html` (a `.tb-scene__foot`
 * footer, the same one the SCORM runtime used to build by hand), so the design is
 * where every other design decision is: in the template. Each host only resolves
 * the run state below and puts it in the render context as `state.nav`; the layout
 * decides which buttons exist, in what order and with what classes.
 *
 * That split is what makes the two hosts render one screen: a host cannot invent a
 * button any more, and a template author can restyle the row without touching
 * either runtime (PRD-12).
 */

/** Actions the footer buttons carry; the host binds each to its own handler. */
export const QUESTION_NAV_ACTIONS = {
  back: "answer-back",
  skip: "answer-skip",
  submit: "answer-submit",
  review: "answer-return",
  next: "answer-next",
  finish: "test-finish",
} as const;

/** Run state the row is built from — resolved by the host, not by this module. */
export interface QuestionNavState {
  /**
   * PRD-19 Block B: flexible mode (`allowReturnToUnanswered`) offers «Назад» +
   * «Пропустить» + «Отправить ответ»; strict-linear keeps one forward button.
   * Independent of {@link quickAdvance} (PRD-43) — flexible only decides whether
   * these three controls exist, not how many clicks fixing an answer takes.
   */
  flexible: boolean;
  /**
   * PRD-43: whether fixing the current answer and moving to the next question
   * happen in the SAME click (`true`) or need a separate «Далее» click after
   * (`false`). Independent of {@link flexible} — all 4 combinations are valid.
   * Has no effect when {@link showAccept} is set: showing the correctness
   * feedback always needs its own step before the learner moves on.
   */
  quickAdvance: boolean;
  /** The answer is fixed (committed, or its feedback is on screen). */
  committed: boolean;
  /** An accessible previous question exists (bounded by the section in sectional flows). */
  canPrev: boolean;
  /** The current answer is usable — the forward button's gate. */
  answerReady: boolean;
  /** A next step exists; otherwise the strict row finishes the test. */
  hasNext: boolean;
  /** Strict mode with «показывать верный ответ» before confirmation → «Принять». */
  showAccept: boolean;
  /** «К обзору» — skipped questions in scope, or the learner came FROM the обзор. */
  showReview: boolean;
}

/** What the layout binds against (`state.nav`). Booleans gate, strings print. */
export interface CtxQuestionNav {
  /** Render «← Назад» (flexible mode only). */
  showBack: boolean;
  /** Enable it — a previous accessible question exists. */
  canPrev: boolean;
  /** Render «Пропустить» (flexible, before fixation). */
  showSkip: boolean;
  /** Render «К обзору». */
  showReview: boolean;
  /** `data-action` of the primary button. */
  primaryAction: string;
  /** Its caption. */
  primaryLabel: string;
  /** Whether it is enabled (the answer gate). */
  primaryEnabled: boolean;
}

/**
 * Resolve the footer state for the current question.
 *
 * @param state See {@link QuestionNavState}.
 * @returns The `state.nav` block the question layout renders from.
 */
export function buildQuestionNav(state: QuestionNavState): CtxQuestionNav {
  const A = QUESTION_NAV_ACTIONS;

  // PRD-43: showing the correctness feedback always needs its own step before
  // advancing, regardless of quickAdvance — the learner has to be able to SEE it.
  const twoStep = state.showAccept || !state.quickAdvance;

  if (state.committed) {
    // Already fixed (either just now, or the learner navigated back to an
    // answered question) — the only thing left to do is move on. Flexible mode
    // never finishes the test straight from here (FR-16): «Далее» walks on and
    // завершение happens on the обзор. Strict mode finishes directly.
    const primary = !state.flexible && !state.hasNext
      ? { primaryAction: A.finish, primaryLabel: "Завершить тест" }
      : { primaryAction: A.next, primaryLabel: "Далее" };
    return {
      showBack: state.flexible,
      canPrev: state.flexible && state.canPrev,
      showSkip: false,
      showReview: state.flexible && state.showReview,
      primaryEnabled: true,
      ...primary,
    };
  }

  if (twoStep) {
    // Not yet committed, and fixing needs its own step: «Отправить ответ» / «Принять».
    const primary = state.showAccept
      ? { primaryAction: A.submit, primaryLabel: "Принять" }
      : { primaryAction: A.submit, primaryLabel: "Отправить ответ" };
    return {
      showBack: state.flexible,
      canPrev: state.flexible && state.canPrev,
      showSkip: state.flexible,
      showReview: state.flexible && state.showReview,
      primaryEnabled: state.answerReady,
      ...primary,
    };
  }

  // Not committed, quickAdvance ON, no feedback to show: one click fixes AND
  // advances. In flexible mode this is still «Далее» (обзор owns finishing,
  // FR-16); in strict mode it finishes directly when there's no next question.
  const primary = !state.flexible && !state.hasNext
    ? { primaryAction: A.finish, primaryLabel: "Завершить тест" }
    : { primaryAction: A.next, primaryLabel: "Далее" };
  return {
    showBack: state.flexible,
    canPrev: state.flexible && state.canPrev,
    showSkip: state.flexible,
    showReview: state.flexible && state.showReview,
    primaryEnabled: state.answerReady,
    ...primary,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- shared/template/question-nav.test.ts
```

Expected: PASS, all cases including the 6 new PRD-43 ones.

- [ ] **Step 5: Commit**

```bash
git add shared/template/question-nav.ts shared/template/question-nav.test.ts
git commit -m "feat(prd-43): split quickAdvance from flexible in buildQuestionNav"
```

---

## Task 3: Server plumbing — settings service, routes, SCORM export data

Pure propagation of one new boolean field through the existing PRD-19 pipes. No new logic.

**Files:**

- Modify: `server/services/test-settings.ts:184` (type), `:280` (create default)
- Modify: `server/routes/tests.ts:92` (zod), `:601`/`:658` (POST), `:959`/`:1019` (PUT)
- Modify: `server/routes/attempts.ts:73-77` (`prd19RuntimeSettings`)
- Modify: `server/scorm/builders/test-json.ts:194-196`

- [ ] **Step 1: `TestPayload` type + create default**

In `server/services/test-settings.ts`, in the `TestPayload` interface, right after `allowAnswerChange?: boolean;` (line
184), add:

```ts
  allowAnswerChange?: boolean;
  // PRD-43: independent of allowReturnToUnanswered.
  quickAdvance?: boolean;
  showSectionResults?: boolean;
```

In the `create()` method's insert values, right after the `allowAnswerChange` line (line 280), add:

```ts
        allowReturnToUnanswered: payload.test.allowReturnToUnanswered ?? true,
        allowAnswerChange: payload.test.allowAnswerChange ?? false,
        // PRD-43: new test — matches today's two-step default (consistent with
        // allowReturnToUnanswered defaulting to true, i.e. flexible-two-step).
        quickAdvance: payload.test.quickAdvance ?? false,
        showSectionResults: payload.test.showSectionResults ?? true,
```

`save()` (the update path) needs NO change — it spreads `payload.test` directly into the `UPDATE ... SET` patch
(`server/services/test-settings.ts:374`), so any `quickAdvance` present in the typed payload flows through automatically
once the type above allows it.

- [ ] **Step 2: zod body schema + route handlers**

In `server/routes/tests.ts`, in `testBodyBaseSchema`, right after `allowAnswerChange: z.boolean().optional(),` (line
93), add:

```ts
  allowReturnToUnanswered: z.boolean().optional(),
  allowAnswerChange: z.boolean().optional(),
  // PRD-43: independent of allowReturnToUnanswered.
  quickAdvance: z.boolean().optional(),
  showSectionResults: z.boolean().optional(),
```

In the `POST /api/tests` handler, add `quickAdvance,` to BOTH the destructure (right after `allowAnswerChange,` at line
602) and the `testSettingsService.create` call's object literal (right after `allowAnswerChange,` at line 659).

In the `PUT /api/tests/:id` handler, add `quickAdvance,` to BOTH the destructure (right after `allowAnswerChange,` at
line 960) and the `testSettingsService.save` call's object literal (right after `allowAnswerChange,` at line 1020).

- [ ] **Step 3: attempt start/resume runtime settings**

In `server/routes/attempts.ts`, in `prd19RuntimeSettings(test)` (line 73), add `quickAdvance` right after
`allowAnswerChange`:

```ts
function prd19RuntimeSettings(test: Test) {
  return {
    allowReturnToUnanswered: test.allowReturnToUnanswered ?? true,
    allowAnswerChange: test.allowAnswerChange ?? false,
    // PRD-43: independent of allowReturnToUnanswered.
    quickAdvance: test.quickAdvance ?? false,
    showSectionResults: test.showSectionResults ?? true,
```

- [ ] **Step 4: SCORM `TEST_DATA` bake**

In `server/scorm/builders/test-json.ts`, right after the `allowAnswerChange` line (line 195), add:

```ts
    allowReturnToUnanswered: data.test.allowReturnToUnanswered ?? true,
    allowAnswerChange: data.test.allowAnswerChange ?? false,
    // PRD-43: independent of allowReturnToUnanswered.
    quickAdvance: data.test.quickAdvance ?? false,
    showSectionResults: data.test.showSectionResults ?? true,
```

- [ ] **Step 5: Typecheck**

```bash
npm run check
```

Expected: no errors (this task only widens object shapes that already flow untyped values through `Record<string,
unknown>`-ish zod/payload boundaries).

- [ ] **Step 6: Commit**

```bash
git add server/services/test-settings.ts server/routes/tests.ts server/routes/attempts.ts server/scorm/builders/test-json.ts
git commit -m "feat(prd-43): propagate quickAdvance through settings service, routes, SCORM export data"
```

---

## Task 4: SCORM runtime wiring

The SCORM runtime's `next()` (`server/scorm/template/app/actions/answers.js:325-345`) already idempotently marks the
current question `'answered'` and advances, unconditionally, every time the `answer-next` action fires
(`server/scorm/template/app/render/mainRender.js:506`: `'answer-next': function () { if (typeof next === 'function')
next(); }`). It does not need to change — `buildQuestionNav` already decides whether `answer-next` or `answer-submit` (→
`confirmAnswer()`, fixes only) is the button the learner sees. The ONLY SCORM-side change is threading `quickAdvance`
into the `buildQuestionNav` call.

**Files:**

- Modify: `server/scorm/template/app/render/mainRender.js:481-489`

- [ ] **Step 1: Pass `quickAdvance` into the nav-state call**

In `buildQuestionNavState` (`server/scorm/template/app/render/mainRender.js`), change:

```js
    return window.TBTemplate.buildQuestionNav({
        flexible: !!TEST_DATA.allowReturnToUnanswered,
        committed: committed,
        canPrev: prevIdx >= 0,
        answerReady: submitReady,
        hasNext: hasNext,
        showAccept: !!TEST_DATA.showCorrectAnswers && !state.feedbackShown,
        showReview: hasSkippedInScope() || !!state.fromReview
    });
```

to:

```js
    return window.TBTemplate.buildQuestionNav({
        flexible: !!TEST_DATA.allowReturnToUnanswered,
        // PRD-43: independent of `flexible` — see shared/template/question-nav.ts.
        quickAdvance: !!TEST_DATA.quickAdvance,
        committed: committed,
        canPrev: prevIdx >= 0,
        answerReady: submitReady,
        hasNext: hasNext,
        showAccept: !!TEST_DATA.showCorrectAnswers && !state.feedbackShown,
        showReview: hasSkippedInScope() || !!state.fromReview
    });
```

- [ ] **Step 2: Manual acceptance (no automated SCORM-side test — see note below)**

This one-line change has no new pure logic of its own to unit-test on the SCORM side (the decision logic is
`buildQuestionNav`, already covered by Task 2's Vitest suite; `next()`/`confirmAnswer()` are unchanged). Verify it
end-to-end once the client editor UI (Task 6) can actually set `quickAdvance` on a test:

```bash
npm run scorm:sample
npm run scorm:player
```

Open the local player, confirm a sample test's footer behaves per the combination baked into it. Full 4-combination
walkthrough happens in Task 9 (final verification), once the editor toggle exists to produce all 4 combinations.

- [ ] **Step 3: Commit**

```bash
git add server/scorm/template/app/render/mainRender.js
git commit -m "feat(prd-43): thread quickAdvance into the SCORM runtime's nav-state builder"
```

---

## Task 5: Editor model — types + mappers

**Files:**

- Modify: `client/src/features/tests/editor/test-editor.types.ts:448-460` (runtime model), `:528-539` (save payload)
- Modify: `client/src/features/tests/editor/test-editor.mappers.ts:89-97` (API-shape type), `:935-947` (new-test
  default), `:1033-1049` (load from API), `:1116-1125` (save payload)
- Test: `client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts` (existing reference suite — extend it)

- [ ] **Step 1: Write the failing mapper tests**

Find `client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts` and add a new `describe` block (mirroring
however the existing suite tests `allowReturnToUnanswered`/`allowAnswerChange` round-tripping — search that file for
`allowAnswerChange` to match the existing style/imports exactly before adding). Add:

```ts
describe("quickAdvance (PRD-43)", () => {
  it("emptyEditorModel defaults quickAdvance to false", () => {
    const model = emptyEditorModel({ folderId: null });
    expect(model.runtime.quickAdvance).toBe(false);
  });

  it("apiToEditorModel reads an explicit quickAdvance verbatim", () => {
    const model = apiToEditorModel({ quickAdvance: true, allowReturnToUnanswered: true });
    expect(model.runtime.quickAdvance).toBe(true);
  });

  it("apiToEditorModel falls back to NOT allowReturnToUnanswered when quickAdvance is absent", () => {
    expect(apiToEditorModel({ allowReturnToUnanswered: true }).runtime.quickAdvance).toBe(false);
    expect(apiToEditorModel({ allowReturnToUnanswered: false }).runtime.quickAdvance).toBe(true);
    expect(apiToEditorModel({}).runtime.quickAdvance).toBe(true);
  });

  it("editorModelToPayload round-trips quickAdvance", () => {
    const model = emptyEditorModel({ folderId: null });
    model.runtime.quickAdvance = true;
    expect(editorModelToPayload(model).quickAdvance).toBe(true);
  });
});
```

(Adjust the import list at the top of the test file if `apiToEditorModel`, `editorModelToPayload`, or `emptyEditorModel`
are not already imported there — they are used by the existing suite for the sibling PRD-19 fields, so they should
already be in scope.)

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts
```

Expected: FAIL — `runtime.quickAdvance` is `undefined`, not `false`/`true`.

- [ ] **Step 3: Add the field to the types**

In `client/src/features/tests/editor/test-editor.types.ts`, in the `runtime` block of the main model type (around line
448), change:

```ts
    allowReturnToUnanswered: boolean; // FR-01
    allowAnswerChange: boolean; // FR-04a (зависит от возврата; взаимоискл. с showCorrectAnswers)
    showSectionResults: boolean; // FR-05a (секционные)
```

to:

```ts
    allowReturnToUnanswered: boolean; // FR-01
    allowAnswerChange: boolean; // FR-04a (зависит от возврата; взаимоискл. с showCorrectAnswers)
    // PRD-43: НЕЗАВИСИМ от allowReturnToUnanswered; взаимоискл. с showCorrectAnswers (гасится в UI).
    quickAdvance: boolean;
    showSectionResults: boolean; // FR-05a (секционные)
```

In the save-payload type (around line 528-539), change:

```ts
  allowReturnToUnanswered: boolean;
  allowAnswerChange: boolean;
  showSectionResults: boolean;
```

to:

```ts
  allowReturnToUnanswered: boolean;
  allowAnswerChange: boolean;
  // PRD-43: независим от allowReturnToUnanswered.
  quickAdvance: boolean;
  showSectionResults: boolean;
```

- [ ] **Step 4: Add the field to the mappers**

In `client/src/features/tests/editor/test-editor.mappers.ts`, in the API-shape input type (around line 89-93), change:

```ts
  // PRD-19 (Блок A)
  allowReturnToUnanswered?: boolean | null;
  allowAnswerChange?: boolean | null;
  showSectionResults?: boolean | null;
```

to:

```ts
  // PRD-19 (Блок A)
  allowReturnToUnanswered?: boolean | null;
  allowAnswerChange?: boolean | null;
  // PRD-43: независим от allowReturnToUnanswered.
  quickAdvance?: boolean | null;
  showSectionResults?: boolean | null;
```

In `emptyEditorModel` (around line 939-941), change:

```ts
      // PRD-19 (Блок A): новый тест — возврат ВКЛ по умолчанию (FR-01).
      allowReturnToUnanswered: true,
      allowAnswerChange: false,
      showSectionResults: true,
```

to:

```ts
      // PRD-19 (Блок A): новый тест — возврат ВКЛ по умолчанию (FR-01).
      allowReturnToUnanswered: true,
      allowAnswerChange: false,
      // PRD-43: новый тест — как сегодняшнее двухшаговое поведение (ВКЛ возврата
      // + ВЫКЛ быстрого перехода).
      quickAdvance: false,
      showSectionResults: true,
```

In `apiToEditorModel` (around line 1041-1046, the "load existing test" branch), change:

```ts
      allowReturnToUnanswered:
        typeof src.allowReturnToUnanswered === "boolean" ? src.allowReturnToUnanswered : false,
      allowAnswerChange:
        typeof src.allowAnswerChange === "boolean" ? src.allowAnswerChange : false,
      showSectionResults:
        typeof src.showSectionResults === "boolean" ? src.showSectionResults : true,
```

to:

```ts
      allowReturnToUnanswered:
        typeof src.allowReturnToUnanswered === "boolean" ? src.allowReturnToUnanswered : false,
      allowAnswerChange:
        typeof src.allowAnswerChange === "boolean" ? src.allowAnswerChange : false,
      // PRD-43: поля нет в ответе (тест до PRD-43) → как сегодняшнее поведение
      // ДЛЯ ЭТОГО КОНКРЕТНОГО allowReturnToUnanswered — то же правило, что и у
      // backfill-миграции (drizzle/00XX_prd43_quick_advance_backfill.sql).
      quickAdvance:
        typeof src.quickAdvance === "boolean"
          ? src.quickAdvance
          : !(typeof src.allowReturnToUnanswered === "boolean" ? src.allowReturnToUnanswered : false),
      showSectionResults:
        typeof src.showSectionResults === "boolean" ? src.showSectionResults : true,
```

In `editorModelToPayload` (around line 1119-1121, the save-payload builder), change:

```ts
    allowReturnToUnanswered: model.runtime.allowReturnToUnanswered,
    allowAnswerChange: model.runtime.allowAnswerChange,
    showSectionResults: model.runtime.showSectionResults,
```

to:

```ts
    allowReturnToUnanswered: model.runtime.allowReturnToUnanswered,
    allowAnswerChange: model.runtime.allowAnswerChange,
    quickAdvance: model.runtime.quickAdvance,
    showSectionResults: model.runtime.showSectionResults,
```

- [ ] **Step 5: Run to verify it passes**

```bash
npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run check
```

Expected: errors, one per fixture in this package that builds a full `TestEditorModel` literal without `quickAdvance`
and is NOT using an `as TestEditorModel` cast (the cast bypasses the missing-property check). This is expected — Task 7
fixes every one of them. Do not fix them here; just confirm the errors are all "Property 'quickAdvance' is missing" in
`client/src/features/tests/editor/**`, nothing else.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/tests/editor/test-editor.types.ts client/src/features/tests/editor/test-editor.mappers.ts client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts
git commit -m "feat(prd-43): add quickAdvance to the editor model and its API mappers"
```

---

## Task 6: Editor UI — the new toggle

**Files:**

- Modify: `client/src/features/tests/editor/sections/basic-settings-section.tsx:961-1016` (`PassRulesPane`)
- Test: `client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx`

- [ ] **Step 1: Update the test fixture and write the failing tests**

In `client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx`, add `quickAdvance: false` to
the `baseModel()` factory's `runtime` object (line 56 — see Task 7, this exact file is also in that task's mechanical
patch list, so if Task 7 runs first this is already done; if this task runs first, do it now):

```tsx
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, quickAdvance: false, showSectionResults: true, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false },
```

Then add a new test (find the existing tests for `settings-allow-change-checkbox` in this file and place the new one
right after, matching that style):

```tsx
  it("быстрый переход независим от возврата к неотвеченным и не блокируется им", async () => {
    const updateModel = vi.fn();
    render(
      <PassRulesPane
        model={baseModel({ runtime: { ...baseModel().runtime, allowReturnToUnanswered: false, quickAdvance: false } })}
        updateModel={updateModel}
      />,
    );
    const toggle = screen.getByTestId("settings-quick-advance-checkbox");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    const updated = runUpdater(updateModel, baseModel({ runtime: { ...baseModel().runtime, allowReturnToUnanswered: false, quickAdvance: false } }));
    expect(updated.runtime.quickAdvance).toBe(true);
    // allowReturnToUnanswered must be untouched by toggling quickAdvance.
    expect(updated.runtime.allowReturnToUnanswered).toBe(false);
  });

  it("быстрый переход заблокирован при включённом показе правильного ответа", () => {
    render(
      <PassRulesPane
        model={baseModel({ runtime: { ...baseModel().runtime, showCorrectAnswers: true, quickAdvance: true } })}
        updateModel={vi.fn()}
      />,
    );
    const toggle = screen.getByTestId("settings-quick-advance-checkbox");
    expect(toggle).toBeDisabled();
  });
```

(Match whatever import/render helper names — `render`, `screen`, `fireEvent`, `vi`, `runUpdater`, `PassRulesPane` — the
existing tests in this file already use; do not introduce new ones.)

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx
```

Expected: FAIL — `getByTestId("settings-quick-advance-checkbox")` finds nothing.

- [ ] **Step 3: Implement the toggle**

In `client/src/features/tests/editor/sections/basic-settings-section.tsx`, in `PassRulesPane` (line 961), add a
`quickAdvanceDisabled` alongside the existing `changeDisabled`:

```tsx
  // PRD-19 (FR-04b): «изменение ответа» зависит от возврата ВКЛ и взаимоисключается с показом
  // правильных ответов (раздел «Ограничения»). showSectionResults — только для секционных.
  const changeDisabled =
    !model.runtime.allowReturnToUnanswered || model.runtime.showCorrectAnswers;
  // PRD-43: НЕ зависит от allowReturnToUnanswered (все 4 комбинации допустимы) —
  // блокируется только показом правильного ответа, который всегда требует
  // отдельного шага перед переходом дальше.
  const quickAdvanceDisabled = model.runtime.showCorrectAnswers;
  const showSectionResultsApplicable =
    model.flowMode !== "linear_flat" && model.sections.length > 0;
```

Then, right after the «Позволить изменять ответ» `<div className="ou-formfield">` block (after line 1016, before the
`showSectionResultsApplicable` block), insert a third:

```tsx
      <div className="ou-formfield">
        <Switch
          label="Переходить к следующему вопросу сразу после ответа"
          description="Без отдельного нажатия «Далее»: ответ фиксируется и сразу открывается следующий вопрос."
          checked={model.runtime.quickAdvance && !quickAdvanceDisabled}
          disabled={quickAdvanceDisabled}
          onChange={(e) => {
            const checked = e.target.checked;
            updateModel((m) => ({
              ...m,
              runtime: { ...m.runtime, quickAdvance: checked },
            }));
          }}
          data-testid="settings-quick-advance-checkbox"
        />
        {quickAdvanceDisabled && (
          <Banner
            tone="warning"
            size="sm"
            description="Недоступно при показе правильности ответа: нужно увидеть фидбек перед переходом."
          />
        )}
      </div>
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/tests/editor/sections/basic-settings-section.tsx client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx
git commit -m "feat(prd-43): add the independent quick-advance toggle to the test editor"
```

---

## Task 7: Fixture patch — every other editor test that builds a full model

Adding a required field to `TestEditorModel["runtime"]` (Task 5) breaks every test fixture in this package that builds a
complete, directly-typed `TestEditorModel` literal without it. All of them share one of two exact substrings (confirmed
by grepping the whole `client/src/features/tests/editor` tree before writing this plan):

- `allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true,` (or the two `false`-variant lines
  below), same-line or spread across 3 own-lines with matching indentation.

**Files (regex-patched, no manual editing needed):**

- `client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx` (2 occurrences — skip if Task 6
  already patched line 56; the script is idempotent-safe to re-run)
- `client/src/features/tests/editor/sections/__tests__/basic-settings-section.coverage.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/result-variables-domain-valence.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/result-variables-empty.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/result-variables-section.branches.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/result-variables-section.coverage.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/scales-contributions.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/scales-matrix-cell.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/scoring-section.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx` (2 occurrences)
- `client/src/features/tests/editor/sections/__tests__/start-pages-section.coverage.test.tsx` (2 occurrences)
- `client/src/features/tests/editor/sections/__tests__/topics-structure-section.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/topics-structure-section.coverage.test.tsx`
- `client/src/features/tests/editor/sections/__tests__/topics-structure-question-order.test.tsx`
- `client/src/features/tests/editor/__tests__/test-editor.question-order.test.ts`
- `client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts` (2 occurrences; uses `as
  TestEditorModel` so `npm run check` would NOT flag these, but they get the field for correctness/consistency too)

- [ ] **Step 1: Run the scripted patch**

```bash
node -e '
const fs = require("fs");
const files = [
  "client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/basic-settings-section.coverage.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/result-variables-domain-valence.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/result-variables-empty.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/result-variables-section.branches.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/result-variables-section.coverage.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/scales-contributions.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/scales-matrix-cell.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/scoring-section.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/start-pages-section.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/start-pages-section.coverage.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/topics-structure-section.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/topics-structure-section.coverage.test.tsx",
  "client/src/features/tests/editor/sections/__tests__/topics-structure-question-order.test.tsx",
  "client/src/features/tests/editor/__tests__/test-editor.question-order.test.ts",
  "client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts",
];
const re = /(allowReturnToUnanswered:\s*(?:true|false),)(\s*)(allowAnswerChange:\s*(?:true|false),)(\s*)(showSectionResults:\s*(?:true|false),)/g;
let total = 0;
for (const f of files) {
  const before = fs.readFileSync(f, "utf8");
  const after = before.replace(re, (m, p1, sep1, p2, sep2, p3) => {
    total++;
    return `${p1}${sep1}${p2}${sep2}${p3}${sep2}quickAdvance: false,`;
  });
  if (after !== before) fs.writeFileSync(f, after);
}
console.log("patched occurrences:", total);
'
```

Expected output: `patched occurrences: 19` (2 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 2 + 2 + 1 + 1 + 1 + 1 + 2 — recount
against the file list above; if the number differs, `git diff` every listed file and confirm each occurrence got exactly
one `quickAdvance: false,` inserted, no more).

- [ ] **Step 2: Typecheck — confirm the PRD-43-caused errors are gone**

```bash
npm run check
```

Expected: no errors. If any remain, they are `quickAdvance`-missing errors in a fixture this task's file list missed —
find it with:

```bash
npm run check 2>&1 | grep -i quickAdvance
```

and hand-add `quickAdvance: false,` next to that fixture's `showSectionResults` line, matching the surrounding style.

- [ ] **Step 3: Run the affected test files**

```bash
npm test -- client/src/features/tests/editor
```

Expected: PASS (this task only added a field with a value equal to every fixture's implicit prior behaviour — `false`,
matching today's two-step default — so no existing assertion should change).

- [ ] **Step 4: Commit**

```bash
git add client/src/features/tests/editor
git status
```

Confirm only files from the list above (plus Task 6's `basic-settings-section.tsx`/`.test.tsx` if not already committed)
are staged.

```bash
git commit -m "test(prd-43): add quickAdvance to every editor test fixture that builds a full model"
```

---

## Task 8: Web learner runtime — `take-test.tsx`

**Files:**

- Modify: `client/src/pages/learner/take-test.tsx:598-608` (navSettings type + init), `:1030-1035` (resume),
  `:1187-1192` (start), `:3012-3020` (questionNav construction), `:3022-3034` (onNavAction)
- Test: `client/src/pages/learner/__tests__/take-test.test.tsx`

- [ ] **Step 1: `navSettings` type + defaults**

Change the `navSettings` state declaration (line 598-608) from:

```tsx
  const [navSettings, setNavSettings] = useState<{
    allowReturnToUnanswered: boolean;
    allowAnswerChange: boolean;
    showSectionResults: boolean;
    answerCommitScope: "test" | "section";
  }>({
    allowReturnToUnanswered: false,
    allowAnswerChange: false,
    showSectionResults: true,
    answerCommitScope: "test",
  });
```

to:

```tsx
  const [navSettings, setNavSettings] = useState<{
    allowReturnToUnanswered: boolean;
    allowAnswerChange: boolean;
    // PRD-43: independent of allowReturnToUnanswered.
    quickAdvance: boolean;
    showSectionResults: boolean;
    answerCommitScope: "test" | "section";
  }>({
    allowReturnToUnanswered: false,
    allowAnswerChange: false,
    quickAdvance: true,
    showSectionResults: true,
    answerCommitScope: "test",
  });
```

(The `true` initial default here matches today's actual strict-mode behaviour BEFORE the real attempt-start/resume
response arrives and overwrites it — this initial value is a placeholder shown for a single render, same role the
existing `allowReturnToUnanswered: false` placeholder already plays.)

- [ ] **Step 2: resume response mapping**

Change (line ~1030-1035):

```tsx
      setNavSettings({
        allowReturnToUnanswered: data.attempt.allowReturnToUnanswered ?? false,
        allowAnswerChange: data.attempt.allowAnswerChange ?? false,
        showSectionResults: data.attempt.showSectionResults ?? true,
        answerCommitScope: data.attempt.answerCommitScope ?? "test",
      });
```

to:

```tsx
      setNavSettings({
        allowReturnToUnanswered: data.attempt.allowReturnToUnanswered ?? false,
        allowAnswerChange: data.attempt.allowAnswerChange ?? false,
        // PRD-43: same fallback rule as the DB backfill migration — derive from
        // allowReturnToUnanswered when the server response omits the field.
        quickAdvance:
          typeof data.attempt.quickAdvance === "boolean"
            ? data.attempt.quickAdvance
            : !(data.attempt.allowReturnToUnanswered ?? false),
        showSectionResults: data.attempt.showSectionResults ?? true,
        answerCommitScope: data.attempt.answerCommitScope ?? "test",
      });
```

- [ ] **Step 3: start response mapping**

Change (line ~1187-1192):

```tsx
    setNavSettings({
      allowReturnToUnanswered: data.allowReturnToUnanswered ?? false,
      allowAnswerChange: data.allowAnswerChange ?? false,
      showSectionResults: data.showSectionResults ?? true,
      answerCommitScope: data.answerCommitScope ?? "test",
    });
```

to:

```tsx
    setNavSettings({
      allowReturnToUnanswered: data.allowReturnToUnanswered ?? false,
      allowAnswerChange: data.allowAnswerChange ?? false,
      // PRD-43: same fallback rule as the DB backfill migration — derive from
      // allowReturnToUnanswered when the server response omits the field.
      quickAdvance:
        typeof data.quickAdvance === "boolean"
          ? data.quickAdvance
          : !(data.allowReturnToUnanswered ?? false),
      showSectionResults: data.showSectionResults ?? true,
      answerCommitScope: data.answerCommitScope ?? "test",
    });
```

- [ ] **Step 4: `questionNav` construction (standard question screen only — NOT the adaptive block)**

Change (line ~3012-3020):

```tsx
    const questionNav: QuestionNavState = {
      flexible: navSettings.allowReturnToUnanswered,
      committed: standardFeedbackShown || committedCurrent,
      canPrev: prevIdx !== null,
      answerReady: !isSubmitting && (!submitModeCurrent || answerReady),
      hasNext: !isLastQuestion,
      showAccept: showCorrectAnswers && submitModeCurrent,
      showReview: hasSkipped,
    };
```

to:

```tsx
    const questionNav: QuestionNavState = {
      flexible: navSettings.allowReturnToUnanswered,
      // PRD-43: independent of `flexible`.
      quickAdvance: navSettings.quickAdvance,
      committed: standardFeedbackShown || committedCurrent,
      canPrev: prevIdx !== null,
      answerReady: !isSubmitting && (!submitModeCurrent || answerReady),
      hasNext: !isLastQuestion,
      showAccept: showCorrectAnswers && submitModeCurrent,
      showReview: hasSkipped,
    };
```

- [ ] **Step 5: route the `answer-next` action between the two existing handlers**

Change `onNavAction` (line ~3022-3034):

```tsx
    const onNavAction = (action: string) => {
      if (action === QUESTION_NAV_ACTIONS.back) return goBack();
      if (action === QUESTION_NAV_ACTIONS.skip) return handleSkip();
      if (action === QUESTION_NAV_ACTIONS.review) {
        setReviewFromButton(true);
        setShowReview(true);
        return;
      }
      if (action === QUESTION_NAV_ACTIONS.submit) return handleStandardConfirm();
      if (action === QUESTION_NAV_ACTIONS.finish) return void handleSubmit();
      // «Далее» — walk on past a committed answer (the layout's primary action).
      if (action === QUESTION_NAV_ACTIONS.next) return handleStandardContinue();
    };
```

to:

```tsx
    const onNavAction = (action: string) => {
      if (action === QUESTION_NAV_ACTIONS.back) return goBack();
      if (action === QUESTION_NAV_ACTIONS.skip) return handleSkip();
      if (action === QUESTION_NAV_ACTIONS.review) {
        setReviewFromButton(true);
        setShowReview(true);
        return;
      }
      if (action === QUESTION_NAV_ACTIONS.submit) return handleStandardConfirm();
      if (action === QUESTION_NAV_ACTIONS.finish) return void handleSubmit();
      // «Далее»: already committed (fixed earlier, or the learner navigated back to
      // an answered question) → just walk on (handleStandardContinue). Not yet
      // committed (PRD-43 quickAdvance) → fix AND walk on in the same click
      // (handleNext) — mirrors the SCORM runtime's next(), which does both
      // unconditionally every time.
      if (action === QUESTION_NAV_ACTIONS.next) {
        return committedCurrent ? handleStandardContinue() : handleNext();
      }
    };
```

- [ ] **Step 6: Run existing tests to confirm no regression**

```bash
npm test -- client/src/pages/learner/__tests__/take-test.test.tsx client/src/pages/learner/__tests__/take-test-extra.coverage.test.tsx
```

Expected: PASS, unchanged — every existing fixture either doesn't set `quickAdvance` (falls back to
`!allowReturnToUnanswered`, matching today's actual behaviour exactly) or is in the `flexible flow` describe block
(`allowReturnToUnanswered: true`, no `quickAdvance` override → falls back to `false`, i.e. today's two-step flexible
behaviour, unchanged).

- [ ] **Step 7: Write the new failing tests for the 2 new combinations**

In `client/src/pages/learner/__tests__/take-test.test.tsx`, find the end of the existing `describe("<TakeTestPage />
flexible flow", ...)` block — it currently ends with the `"skips a question and exposes the «К обзору» обзор entry"`
test, followed by a lone `});` that closes the describe block (around line 598-599). Replace that single closing `});`
with the following — it closes the existing describe block with one new `it` appended, then opens a second, new, sibling
describe block with its own `it`:

```tsx
  it("PRD-43: flexible + quickAdvance — one click fixes the answer and advances, Назад/Пропустить still show", async () => {
    await renderToStart({
      startAttempt: jsonRes(
        standardAttempt({ allowReturnToUnanswered: true, allowAnswerChange: true, quickAdvance: true, answerCommitScope: "test" }),
      ),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    // Skip/Back still available even though the primary click is single-step now.
    expect(screen.getByText("Пропустить")).toBeInTheDocument();

    // Q1: one click on «Далее» both fixes the answer and advances — no
    // intermediate «Отправить ответ» step.
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    expect(screen.queryByText("Отправить ответ")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("Далее"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );

    // Q2 (last): same one click reaches the обзор (flexible mode never finishes
    // straight from a committed question, FR-16).
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Далее"));
    await screen.findByTestId("ts-finish-review");
  });
});

describe("<TakeTestPage /> strict flow without quick advance (PRD-43)", () => {
  it("two-step footer with NO Назад/Пропустить: «Отправить ответ» then «Далее»", async () => {
    await renderToStart({
      startAttempt: jsonRes(
        standardAttempt({ allowReturnToUnanswered: false, quickAdvance: false, answerCommitScope: "test" }),
      ),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    expect(screen.queryByText("Пропустить")).not.toBeInTheDocument();
    expect(screen.queryByText("← Назад")).not.toBeInTheDocument();

    // Q1: two clicks — «Отправить ответ» fixes, «Далее» (separate) advances.
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );

    // Q2 (last): same two-click shape, ending in «Завершить тест».
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Завершить тест"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });
});
```

- [ ] **Step 8: Run to verify the new tests fail, then implement is already done in Steps 1-5 — run again to verify they
      pass**

```bash
npm test -- client/src/pages/learner/__tests__/take-test.test.tsx
```

First run (before Steps 1-5, if doing true red-green — otherwise since Steps 1-5 already landed the implementation, this
is just the pass-verification run): PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/learner/take-test.tsx client/src/pages/learner/__tests__/take-test.test.tsx
git commit -m "feat(prd-43): wire quickAdvance into the web learner runtime + tests"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full typecheck**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 2: Targeted test run across every file this plan touched**

```bash
npm test -- shared/template/question-nav.test.ts client/src/features/tests/editor client/src/pages/learner/__tests__/take-test.test.tsx client/src/pages/learner/__tests__/take-test-extra.coverage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: SCORM acceptance — all 4 combinations**

`scripts/scorm/generate-sample-scorm.ts` builds its `ExportData` from an in-memory
`const test = {...}` object (line 175) — no DB involved — so the fastest way to walk all 4
combinations locally is to temporarily override two fields there, rebuild, and check the
player, once per combination:

```bash
# In scripts/scorm/generate-sample-scorm.ts, temporarily add to the `const test = {...}`
# object (near the existing `showCorrectAnswers: true` at line 186):
#   allowReturnToUnanswered: <true|false>,
#   quickAdvance: <true|false>,
npm run scorm:sample
npm run scorm:player
```

Open the local player (`:5050`), answer the first question, and confirm the footer matches
the spec's §3.2 table for whichever combination is currently set:

| `allowReturnToUnanswered` | `quickAdvance` | Expect |
| --- | --- | --- |
| false | true | one click: answer → «Далее» → next question immediately (today's default, unchanged) |
| false | false | two clicks: «Отправить ответ» fixes, «Далее» (separate) advances; no «← Назад»/«Пропустить» (NEW) |
| true | false | two clicks, «← Назад»/«Пропустить»/«К обзору» present (today's default, unchanged) |
| true | true | one click fixes AND advances, «← Назад»/«Пропустить»/«К обзору» still present (NEW) |

Revert the temporary override in `generate-sample-scorm.ts` after the walkthrough (`git diff`
should be empty for that file before Task 9's final commit/PR).

- [ ] **Step 4: Confirm adaptive mode is untouched**

```bash
git diff --stat main -- client/src/pages/learner/take-test.tsx | cat
```

Read the diff of this file specifically: confirm every hunk falls inside the "standard" question
render block (`navSettings`, the `questionNav` construction, `onNavAction` around line 3012-3034)
and none inside the adaptive block (`adaptiveNav`/`onAdaptiveNavAction`, ~line 2680-2721). No
separate test run is needed for this — the spec's "adaptive doesn't regress" criterion holds by
construction as long as this diff check passes, since nothing in this plan touches
`server/scorm/template/app/render/adaptiveRender.js` either.

- [ ] **Step 5: Ask before a full suite / coverage run**

Per `CLAUDE.md` ("Concurrent sessions"): do not run `npm test` (full) or `npm run test:cov` without asking the user
first, since other sessions may be using this working copy concurrently. If the user wants full-suite confirmation
before merging, ask before running either.

- [ ] **Step 6: Update the spec's status line**

In `docs/specs/prd-43/quick-advance-toggle.md`, change:

```markdown
**Статус:** Требования согласованы 2026-08-05, реализация не начата
```

to:

```markdown
**Статус:** Реализовано <актуальная дата>, не влито в main / влито в main (уточнить у пользователя перед коммитом какая формулировка верна)
```

Commit this alongside whatever final task lands, or as its own small commit — ask the user which they prefer before
committing, since it documents a state transition they may want to review first.

---

## Self-review notes (for whoever executes this plan)

- Every task after Task 1 depends on Task 2 (`buildQuestionNav`'s new `quickAdvance` field existing) — do not reorder
  Tasks 3-8 ahead of Task 2, though Tasks 3, 4, 5+6+7, and 8 are otherwise independent of each other and could be
  parallelized across subagents if using `subagent-driven-development`.
- Task 7's regex-patch count (`19`) is a best-effort tally from the research done while writing this plan (2026-08-05) —
  if the repo has drifted since (another session added a new editor test file with the same fixture pattern), the `npm
  run check` step in Task 7 Step 2 is the actual source of truth, not the count.
- Adaptive mode (`client/src/pages/learner/take-test.tsx` around the `adaptiveNav`/`onAdaptiveNavAction` block, and
  `server/scorm/template/app/render/adaptiveRender.js`) is deliberately untouched — see spec §3.4.
