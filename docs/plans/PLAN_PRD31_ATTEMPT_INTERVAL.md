# PRD-31: интервал между попытками и общая модель допуска — план реализации

> **Для агентных исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК — `superpowers:subagent-driven-development`
> (рекомендуется) либо `superpowers:executing-plans`. Шаги размечены чекбоксами (`- [ ]`).

**Цель:** ввести переключатель «Ограничение между попытками» (часы) и привести оба хоста к одной модели
допуска, где единица допуска — назначение.

**Архитектура:** назначение становится единицей допуска. Барьер A (кулдаун, дни) действует между
назначениями, барьер B (интервал, часы) — внутри назначения; они применяются в непересекающиеся моменты.
Решение принимает общий движок `shared/eligibility/engine.ts` с плоским JS-твином для пакета; хосты
поставляют только факты. Веб получает `attempts.assignment_id`, SCORM переносит вердикт барьера A за
`Initialize`, чтобы прочитать `suspend_data` и отличить новое назначение от повторного входа.

**Стек:** TypeScript, Zod, Drizzle ORM, Express, React 19, Vitest, плоский ES5-JS внутри SCORM-пакета.

**Спецификация:** [docs/specs/prd-31/attempt-interval.md](../specs/prd-31/attempt-interval.md)

---

## Правила работы в этом репозитории

Прочитать до первого шага, они меняют привычный порядок действий.

- **Полный прогон тестов запрещён без явного разрешения владельца.** В одной рабочей копии одновременно
  работают несколько сессий. Точечно: `npm test -- <путь>`. Команда `npx vitest run` в этом репозитории
  падает на `initConfig()` — только через `npm test`.
- **`npm run test:cov` запускается в одиночку** и только по отдельной команде.
- **Коммитить только по явному слову владельца.** Ветка-ствол — `feat/prd25-home-page`.
- **UI не реализуется без согласованного эскиза** в `docs/wireframes/approved/` (задача 16 — гейт для 17).
- **Разметка только на примитивах DS** (`@universityrt/ui-kit`), классы `ou-*` руками не пишутся.
- Комментарии в коде и JSDoc — на английском; текст в интерфейсе и документы — по-русски, без эмодзи.
- Серверные правки живой `npm run dev` не подхватывает (tsx без watch). Для проверки поднимать вторую
  копию: `PORT=8099 npm run dev`.

---

## Карта файлов

**Создаются:**

| Файл | Ответственность |
| --- | --- |
| `migrations/037_prd31_attempt_assignment.sql` | колонка `attempts.assignment_id` |
| `server/scorm/template/app/utils/trusted-now.js` | доверенное «сейчас» из заголовка `Date` портала |
| `tests/attempt-interval-engine.test.ts` | движок барьера B |
| `tests/retake-gate-assignment.test.ts` | веб-решение по модели назначения |
| `docs/wireframes/approved/prd31-attempt-interval.html` | эскиз Э0 панели «Повторное прохождение» |

**Изменяются:**

| Файл | Что меняется |
| --- | --- |
| `shared/eligibility/engine.ts` | `attemptIntervalDecision` + разбор ISO-момента |
| `server/scorm/template/app/eligibility/engine.js` | твин тех же функций |
| `tests/eligibility-engine-port.test.ts` | паритет новых функций |
| `shared/schema.ts` | `attemptInterval` в политике, `assignmentId` в `attempts` |
| `server/services/retake-gate.ts` | решение по модели §3 вместо одного барьера |
| `server/routes/attempts.ts` | оба маршрута старта, список ученика, результат |
| `server/services/home/assigned.ts` | `blockedUntil` из нового вердикта |
| `server/storage/assignments-repository.ts` | резолв текущего назначения |
| `server/storage.ts` | делегирование нового метода |
| `client/src/pages/learner/take-test.tsx` | показ момента открытия |
| `server/scorm/builders/test-json.ts` | запекание политики при барьере B без плагина |
| `server/scorm/template/app/eligibility/gate.js` | вердикт A за `Initialize`, вынос резолва времени |
| `server/scorm/template/app/utils/scorm/suspendAttempts.js` | `completedAt` из доверенного времени |
| `server/scorm/template/app/render/startPage.js` | барьер B на стартовом экране |
| `server/scorm/template/app/render/resultsPage.js` | «Пройти ещё раз» под барьером B |
| `client/src/features/tests/editor/sections/basic-settings-section.tsx` | вторая группа в `RetakePane` |
| `client/src/features/tests/editor/test-editor.mappers.ts` | чтение/запись `attemptInterval` |
| `scripts/scorm-player.mjs` | флаг времени с точностью до минут |

---

## Фаза 1. Общий движок

### Задача 1: `attemptIntervalDecision` в TypeScript

**Файлы:**

- Изменить: `shared/eligibility/engine.ts`
- Тест: `tests/attempt-interval-engine.test.ts` (создать)

- [ ] **Шаг 1: написать падающий тест**

Создать `tests/attempt-interval-engine.test.ts`:

```ts
/**
 * @module tests/attempt-interval-engine
 *
 * PRD-31 barrier B: absolute hour interval between attempts INSIDE one
 * assignment. Unlike the calendar-day cooldown (barrier A) this is wall-clock
 * arithmetic on ISO instants, so the tests pin the boundary to the millisecond.
 */
import { describe, it, expect } from "vitest";
import { attemptIntervalDecision, parseIsoInstant, formatIsoInstant } from "../shared/eligibility/engine";

describe("attemptIntervalDecision", () => {
  it("allows when there is no previous attempt", () => {
    expect(attemptIntervalDecision(null, "2026-08-01T10:00:00.000Z", 24)).toEqual({
      allowed: true,
      availableAt: null,
      msSince: null,
      effectiveNow: null,
    });
  });

  it("blocks strictly before the interval elapses", () => {
    const d = attemptIntervalDecision("2026-08-01T10:00:00.000Z", "2026-08-02T09:59:59.999Z", 24);
    expect(d.allowed).toBe(false);
    expect(d.availableAt).toBe("2026-08-02T10:00:00.000Z");
    expect(d.msSince).toBe(86399999);
  });

  it("allows exactly at the boundary", () => {
    const d = attemptIntervalDecision("2026-08-01T10:00:00.000Z", "2026-08-02T10:00:00.000Z", 24);
    expect(d.allowed).toBe(true);
    expect(d.availableAt).toBe("2026-08-02T10:00:00.000Z");
  });

  it("clamps a clock reported BEFORE the last attempt (FR-TD-05 analogue)", () => {
    const d = attemptIntervalDecision("2026-08-01T10:00:00.000Z", "2026-07-20T00:00:00.000Z", 24);
    expect(d.allowed).toBe(false);
    expect(d.effectiveNow).toBe("2026-08-01T10:00:00.000Z");
    expect(d.msSince).toBe(0);
  });

  it("treats an unparseable instant as no data (allowed)", () => {
    expect(attemptIntervalDecision("garbage", "2026-08-01T10:00:00.000Z", 24).allowed).toBe(true);
    expect(attemptIntervalDecision("2026-08-01T10:00:00.000Z", "garbage", 24).allowed).toBe(true);
  });

  it("parses and formats ISO instants round-trip", () => {
    expect(parseIsoInstant("2026-08-01T10:00:00.000Z")).toBe(1785578400000);
    expect(formatIsoInstant(1785578400000)).toBe("2026-08-01T10:00:00.000Z");
    expect(parseIsoInstant("")).toBeNull();
    expect(parseIsoInstant("garbage")).toBeNull();
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/attempt-interval-engine.test.ts`

Ожидание: FAIL, `attemptIntervalDecision is not a function` (импорт не существует).

- [ ] **Шаг 3: реализовать в `shared/eligibility/engine.ts`**

Дописать после `daysUntilDate` (перед `CORE_DEFAULT_RESULT`):

```ts
/** Parse an ISO instant to epoch-ms; null for empty/unparseable input. */
export function parseIsoInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/** Format epoch-ms back to a canonical ISO instant (UTC, milliseconds). */
export function formatIsoInstant(ms: number): string {
  return new Date(ms).toISOString();
}

export interface AttemptIntervalDecision {
  allowed: boolean;
  /** Instant from which the next attempt is open; null when there is no prior attempt. */
  availableAt: string | null;
  /** Milliseconds elapsed since the previous attempt, after clock normalization. */
  msSince: number | null;
  /** "Now" AFTER normalizing an untrusted clock; null when an input was unusable. */
  effectiveNow: string | null;
}

/**
 * PRD-31 barrier B: minimum interval between attempts INSIDE one assignment.
 * Wall-clock hours, not calendar days — an author asking for 24 h means 24 h, and
 * the SCORM side has a real timestamp (`suspend_data.attempts[].completedAt`).
 *
 * No previous attempt (null/unparseable) => allowed, mirroring `cooldownDecision`.
 * A "now" that precedes the last attempt is impossible, so the clock that produced
 * it is not trusted and the interval runs its full length from the attempt instead
 * (same rule as FR-TD-05 for the calendar cooldown).
 */
export function attemptIntervalDecision(
  lastFinishedAt: string | null,
  nowIso: string,
  intervalHours: number,
): AttemptIntervalDecision {
  const reportedNow = parseIsoInstant(nowIso);
  const last = parseIsoInstant(lastFinishedAt);
  if (last == null || reportedNow == null) {
    return { allowed: true, availableAt: null, msSince: null, effectiveNow: null };
  }
  const now = Math.max(reportedNow, last);
  const msSince = now - last;
  return {
    allowed: msSince >= intervalHours * 3600000,
    availableAt: formatIsoInstant(last + intervalHours * 3600000),
    msSince,
    effectiveNow: formatIsoInstant(now),
  };
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/attempt-interval-engine.test.ts`

Ожидание: PASS, 6 тестов.

- [ ] **Шаг 5: проверить типы**

Выполнить: `npm run check`

Ожидание: без ошибок.

### Задача 2: твин в пакете и паритет

**Файлы:**

- Изменить: `server/scorm/template/app/eligibility/engine.js`
- Изменить: `tests/eligibility-engine-port.test.ts`

- [ ] **Шаг 1: дописать падающий сценарий паритета**

В `tests/eligibility-engine-port.test.ts` добавить новый `it` после блока `daysUntilDate matches`:

```ts
  it("attemptIntervalDecision matches", () => {
    const cases: Array<[string | null, string, number]> = [
      [null, "2026-08-01T10:00:00.000Z", 24],
      ["2026-08-01T10:00:00.000Z", "2026-08-02T09:59:59.999Z", 24],
      ["2026-08-01T10:00:00.000Z", "2026-08-02T10:00:00.000Z", 24],
      ["2026-08-01T10:00:00.000Z", "2026-07-20T00:00:00.000Z", 24],
      ["garbage", "2026-08-01T10:00:00.000Z", 24],
      ["2026-08-01T10:00:00.000Z", "garbage", 24],
      ["2026-08-01T10:00:00.000Z", "2026-08-01T12:00:00.000Z", 1],
    ];
    for (const [last, now, hours] of cases) {
      expect(port.EligibilityEngine.attemptIntervalDecision(last, now, hours)).toEqual(
        tsEngine.attemptIntervalDecision(last, now, hours),
      );
    }
  });
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/eligibility-engine-port.test.ts`

Ожидание: FAIL, `port.EligibilityEngine.attemptIntervalDecision is not a function`.

- [ ] **Шаг 3: реализовать твин**

В `server/scorm/template/app/eligibility/engine.js` дописать после `daysUntilDate`:

```js
  // PRD-31 barrier B — plain-JS twin of attemptIntervalDecision. Wall-clock hours
  // between attempts INSIDE one assignment. A "now" earlier than the last attempt
  // is an impossible state (rolled-back clock), so the interval runs its full
  // length from the attempt — same rule the calendar cooldown uses.
  function parseIsoInstant(value) {
    if (!value) return null;
    var t = Date.parse(String(value));
    return isFinite(t) ? t : null;
  }

  function formatIsoInstant(ms) {
    return new Date(ms).toISOString();
  }

  function attemptIntervalDecision(lastFinishedAt, nowIso, intervalHours) {
    var reportedNow = parseIsoInstant(nowIso);
    var last = parseIsoInstant(lastFinishedAt);
    if (last == null || reportedNow == null) {
      return { allowed: true, availableAt: null, msSince: null, effectiveNow: null };
    }
    var now = Math.max(reportedNow, last);
    var msSince = now - last;
    return {
      allowed: msSince >= intervalHours * 3600000,
      availableAt: formatIsoInstant(last + intervalHours * 3600000),
      msSince: msSince,
      effectiveNow: formatIsoInstant(now)
    };
  }
```

И расширить возвращаемый объект модуля:

```js
    parseIsoInstant: parseIsoInstant,
    formatIsoInstant: formatIsoInstant,
    attemptIntervalDecision: attemptIntervalDecision,
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/eligibility-engine-port.test.ts`

Ожидание: PASS.

---

## Фаза 2. Модель данных

### Задача 3: `attemptInterval` в схеме политики

**Файлы:**

- Изменить: `shared/schema.ts:305-325`
- Тест: `tests/schema-prd6-retake.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `tests/schema-prd6-retake.test.ts`:

```ts
describe("retakePolicySchema — PRD-31 attemptInterval", () => {
  it("accepts an interval-only policy without cooldownPeriodDays", () => {
    const parsed = retakePolicySchema.parse({
      enabled: false,
      attemptInterval: { enabled: true, hours: 24 },
    });
    expect(parsed.attemptInterval).toEqual({ enabled: true, hours: 24 });
    expect(parsed.cooldownPeriodDays).toBeUndefined();
  });

  it("still requires cooldownPeriodDays when the cooldown is enabled", () => {
    expect(() => retakePolicySchema.parse({ enabled: true })).toThrow();
  });

  it("requires hours when the interval is enabled", () => {
    expect(() =>
      retakePolicySchema.parse({ enabled: false, attemptInterval: { enabled: true } }),
    ).toThrow();
  });

  it("rejects an out-of-range interval", () => {
    for (const hours of [0, 8761, 1.5]) {
      expect(() =>
        retakePolicySchema.parse({ enabled: false, attemptInterval: { enabled: true, hours } }),
      ).toThrow();
    }
  });

  it("treats an absent attemptInterval as disabled", () => {
    const parsed = retakePolicySchema.parse({ enabled: true, cooldownPeriodDays: 30 });
    expect(parsed.attemptInterval ?? null).toBeNull();
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/schema-prd6-retake.test.ts`

Ожидание: FAIL — первый случай отвергается, потому что `cooldownPeriodDays` пока обязателен.

- [ ] **Шаг 3: реализовать схему**

В `shared/schema.ts` заменить блок `retakePolicySchema` на:

```ts
/** PRD-31 barrier B: minimum interval between attempts inside ONE assignment. */
export const attemptIntervalSchema = z.object({
  enabled: z.boolean().default(false),
  /** Whole wall-clock hours, 1..8760 (one year). Required when enabled. */
  hours: z.number().int().min(1).max(8760).optional(),
});

/**
 * `tests.retake_policy_json`. Two independent barriers (PRD-31 §3):
 *   - `enabled` + `cooldownPeriodDays` — barrier A, calendar days BETWEEN assignments;
 *   - `attemptInterval` — barrier B, wall-clock hours INSIDE one assignment.
 * `cooldownPeriodDays` is optional at the type level and required only when barrier
 * A is on, so a test can carry barrier B alone without inventing a cooldown value.
 * Legacy `cooldownDays` is accepted on input and normalized.
 */
export const retakePolicySchema = z.preprocess(
  (val) => {
    if (val && typeof val === "object") {
      const v = val as Record<string, unknown>;
      if (v.cooldownPeriodDays == null && typeof v.cooldownDays === "number") {
        return { ...v, cooldownPeriodDays: v.cooldownDays };
      }
    }
    return val;
  },
  z
    .object({
      enabled: z.boolean().default(false),
      cooldownPeriodDays: z.number().int().min(1).max(3650).optional(),
      gateMode: z.literal("before_internal_start").default("before_internal_start"),
      eligibilityPlugin: eligibilityPluginRefSchema.nullish(),
      blockedPageId: z.string().optional(),
      attemptInterval: attemptIntervalSchema.nullish(),
    })
    .superRefine((v, ctx) => {
      if (v.enabled && v.cooldownPeriodDays == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cooldownPeriodDays"],
          message: "cooldownPeriodDays обязателен при включённом кулдауне",
        });
      }
      if (v.attemptInterval?.enabled && v.attemptInterval.hours == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attemptInterval", "hours"],
          message: "Интервал в часах обязателен при включённом ограничении между попытками",
        });
      }
    }),
);

export type AttemptInterval = z.infer<typeof attemptIntervalSchema>;
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Выполнить: `npm test -- tests/schema-prd6-retake.test.ts`

Ожидание: PASS.

- [ ] **Шаг 5: проверить, что необязательность не сломала потребителей**

Выполнить: `npm run check`

Ожидание: ошибки в местах, где `cooldownPeriodDays` читается как `number`. Исправить их на
`policy.cooldownPeriodDays ?? 0` ТОЛЬКО там, где значение уже под защитой `enabled === true`;
в остальных местах — пробросить `number | undefined` дальше. Повторить `npm run check` до чистого прогона.

### Задача 4: колонка `attempts.assignment_id`

**Файлы:**

- Изменить: `shared/schema.ts:545-575`
- Создать: `migrations/037_prd31_attempt_assignment.sql`

- [ ] **Шаг 1: добавить колонку в схему Drizzle**

В определение `attempts` после `snapshotId` дописать:

```ts
  /**
   * PRD-31 (FR-12): the assignment this attempt belongs to. The assignment is the
   * UNIT OF ACCESS: `maxAttempts` and barrier B are counted inside it, while the
   * cooldown (barrier A) gates the FIRST attempt of a new one. NULL = legacy row or
   * an attempt taken outside any assignment; all such rows form one implicit
   * assignment (FR-13). No FK on purpose — a deleted assignment simply stops being
   * "current", which is the intended meaning.
   */
  assignmentId: varchar("assignment_id", { length: 36 }),
```

Индекс НЕ добавляется. Каждый потребитель и так грузит попытки учащегося по тесту через существующий
`(user_id, test_id)` и делит их по назначению в памяти, поэтому третий индекс на самой быстрорастущей
таблице стоил бы записей и не купил бы ни одного чтения. Причину записать комментарием у колонки, иначе
следующий читатель добавит индекс «на всякий случай».

- [ ] **Шаг 2: написать миграцию**

Создать `migrations/037_prd31_attempt_assignment.sql`:

```sql
-- PRD-31 (2026-08-01): the assignment becomes the unit of access.
-- Adds `attempts.assignment_id` — the assignment an attempt was taken under.
--   * maxAttempts and the new hour interval (barrier B) are counted INSIDE an assignment;
--   * the calendar cooldown (barrier A) gates the FIRST attempt of a NEW assignment.
-- Existing rows keep NULL: the link cannot be reconstructed after the fact and must not be
-- guessed. All NULL rows behave as ONE implicit legacy assignment (spec FR-13).
-- No foreign key by design — a deleted assignment stops being "current", which is correct.
-- No index by design either: callers split the attempts of one (user, test) in memory.
--
-- The schema structure is the source of truth (applied via `drizzle-kit push`, npm run db:push).
-- This file documents the change and is safe to run directly: ADD COLUMN IF NOT EXISTS is idempotent.

BEGIN;

ALTER TABLE "attempts"
  ADD COLUMN IF NOT EXISTS "assignment_id" varchar(36);

COMMIT;
```

- [ ] **Шаг 3: применить схему к dev-базе**

Перед запуском открыть `.env` и убедиться, что `DATABASE_URL` указывает на dev-базу
(Docker, `localhost:55432`), а не на системный PostgreSQL.

Выполнить: `npm run db:push`

Ожидание: drizzle сообщает о добавлении одной колонки и одного индекса.

- [ ] **Шаг 4: проверить типы**

Выполнить: `npm run check`

Ожидание: без ошибок.

### Задача 5: резолв текущего назначения

**Файлы:**

- Изменить: `server/storage/assignments-repository.ts:97-126`
- Изменить: `server/storage.ts` (фасад `IStorage`)
- Тест: `tests/retake-gate-assignment.test.ts` (создать в задаче 6; здесь только код и типы)

- [ ] **Шаг 1: добавить метод в репозиторий**

В `server/storage/assignments-repository.ts` дописать после `getAssignedTestsForUser`:

```ts
  /**
   * PRD-31 (§5.3): the assignment a NEW attempt of `testId` belongs to — the most
   * recently made one applicable to the learner, personal or through a group.
   * Returns null when none applies: the learner then falls into the implicit
   * legacy bucket (`assignment_id IS NULL`), which the access rules treat as one
   * assignment of its own.
   */
  async getCurrentAssignmentId(userId: string, testId: string): Promise<string | null> {
    const groupIds = await this.getUserGroupIds(userId);
    const rows = await db
      .select({ id: testAssignments.id, assignedAt: testAssignments.assignedAt })
      .from(testAssignments)
      .where(
        and(
          eq(testAssignments.testId, testId),
          groupIds.length > 0
            ? or(eq(testAssignments.userId, userId), inArray(testAssignments.groupId, groupIds))
            : eq(testAssignments.userId, userId),
        ),
      );
    if (rows.length === 0) return null;
    // Latest assignment wins: re-assigning a test is exactly how an author hands out
    // a fresh set of attempts, so the newest row is the one in force.
    return rows.sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime())[0].id;
  }
```

Дополнить импорт drizzle: `import { eq, and, or, inArray, sql } from "drizzle-orm";`

- [ ] **Шаг 2: пробросить через фасад**

В `server/storage.ts` найти делегирование методов назначений и добавить рядом:

```ts
  getCurrentAssignmentId(userId: string, testId: string): Promise<string | null> {
    return this.assignments.getCurrentAssignmentId(userId, testId);
  }
```

В интерфейс `IStorage` добавить ту же сигнатуру с JSDoc-строкой:

```ts
  /** PRD-31 §5.3: assignment a new attempt belongs to; null = implicit legacy bucket. */
  getCurrentAssignmentId(userId: string, testId: string): Promise<string | null>;
```

- [ ] **Шаг 3: проверить типы**

Выполнить: `npm run check`

Ожидание: без ошибок.

---

## Фаза 3. Веб

### Задача 6: решение по модели назначения

**Файлы:**

- Изменить: `server/services/retake-gate.ts`
- Тест: `tests/retake-gate-assignment.test.ts` (создать)
- Тест: `tests/retake-gate.test.ts` (существующий — переписать под новую сигнатуру)

- [ ] **Шаг 1: написать падающий тест**

Создать `tests/retake-gate-assignment.test.ts`:

```ts
/**
 * @module tests/retake-gate-assignment
 *
 * PRD-31 §3: the assignment is the unit of access. Barrier A (calendar cooldown)
 * gates the FIRST attempt of an assignment and is measured against attempts of
 * OTHER assignments; barrier B (hour interval) gates every later attempt and is
 * measured against the previous attempt of the SAME assignment. They never apply
 * at the same moment.
 */
import { describe, it, expect } from "vitest";
import { decideRetake } from "../server/services/retake-gate";
import type { RetakePolicy } from "../shared/schema";

const NOW = new Date("2026-08-01T12:00:00.000Z");

const policy = (over: Partial<RetakePolicy> = {}): RetakePolicy =>
  ({
    enabled: true,
    cooldownPeriodDays: 30,
    gateMode: "before_internal_start",
    eligibilityPlugin: null,
    ...over,
  }) as RetakePolicy;

describe("decideRetake — assignment model", () => {
  it("is inert when neither barrier is enabled", () => {
    const r = decideRetake(policy({ enabled: false }), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-08-01T11:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("barrier A does NOT block a repeat inside the current assignment", () => {
    const r = decideRetake(policy(), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("barrier A blocks the FIRST attempt of a new assignment", () => {
    const r = decideRetake(policy(), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("cooldown");
    expect(r.availableDate).toBe("2026-08-30");
    expect(r.daysUntil).toBe(29);
  });

  it("barrier B blocks a repeat inside the assignment until the hours elapse", () => {
    const r = decideRetake(policy({ enabled: false, attemptInterval: { enabled: true, hours: 24 } }), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-08-01T06:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("attemptInterval");
    expect(r.availableAt).toBe("2026-08-02T06:00:00.000Z");
    expect(r.intervalHours).toBe(24);
  });

  it("barrier B opens once the interval has elapsed", () => {
    const r = decideRetake(policy({ enabled: false, attemptInterval: { enabled: true, hours: 24 } }), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-30T06:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("barrier B ignores attempts of OTHER assignments", () => {
    const r = decideRetake(policy({ enabled: false, attemptInterval: { enabled: true, hours: 24 } }), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-08-01T11:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("unfinished attempts move neither barrier", () => {
    const r = decideRetake(policy({ enabled: false, attemptInterval: { enabled: true, hours: 24 } }), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: "a1", finishedAt: null }],
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("the legacy NULL bucket behaves as one assignment", () => {
    const inside = decideRetake(policy({ enabled: false, attemptInterval: { enabled: true, hours: 24 } }), {
      currentAssignmentId: null,
      attempts: [{ assignmentId: null, finishedAt: new Date("2026-08-01T11:00:00.000Z") }],
      now: NOW,
    });
    expect(inside.allowed).toBe(false);
    expect(inside.blockedBy).toBe("attemptInterval");

    const acrossFromLegacy = decideRetake(policy(), {
      currentAssignmentId: "a1",
      attempts: [{ assignmentId: null, finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(acrossFromLegacy.blockedBy).toBe("cooldown");
  });
});

describe("countAttemptsInAssignment", () => {
  it("counts only finished attempts of the current assignment", async () => {
    const { countAttemptsInAssignment } = await import("../server/services/retake-gate");
    const attempts = [
      { assignmentId: "a1", finishedAt: new Date("2026-07-01T00:00:00.000Z") },
      { assignmentId: "a1", finishedAt: null },
      { assignmentId: "a2", finishedAt: new Date("2026-07-02T00:00:00.000Z") },
      { assignmentId: null, finishedAt: new Date("2026-07-03T00:00:00.000Z") },
    ];
    expect(countAttemptsInAssignment(attempts, "a1")).toBe(1);
    expect(countAttemptsInAssignment(attempts, null)).toBe(1);
    expect(countAttemptsInAssignment(attempts, "a3")).toBe(0);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/retake-gate-assignment.test.ts`

Ожидание: FAIL — `decideRetake` принимает три позиционных аргумента, а не объект фактов.

- [ ] **Шаг 3: переписать сервис**

Заменить содержимое `server/services/retake-gate.ts` на:

```ts
/**
 * @module server/services/retake-gate
 *
 * Server-side access decision for the web learner runtime (PRD-6 barrier A,
 * PRD-31 barrier B). The assignment is the unit of access (PRD-31 §3):
 *
 *   - inside the current assignment only barrier B applies — the hour interval
 *     since the PREVIOUS attempt of that same assignment;
 *   - on the first attempt of an assignment only barrier A applies — the calendar
 *     cooldown since the last attempt of ANY OTHER assignment.
 *
 * The two never fire at once, so a single `blockedBy` names the one in force. The
 * math itself is shared with the SCORM package (`@shared/eligibility/engine`), so
 * both hosts decide identically from identical facts; only the FACTS differ (here
 * the DB, there `suspend_data` plus the LMS records).
 *
 * Storage-free and unit-testable: the caller supplies the attempts and the clock.
 */

import {
  attemptIntervalDecision,
  cooldownDecision,
  daysUntilDate,
  formatIsoInstant,
} from "@shared/eligibility/engine";
import type { RetakePolicy } from "@shared/schema";

/** One attempt as the decision sees it. */
export interface AttemptFact {
  assignmentId: string | null;
  finishedAt: Date | string | null;
}

/** Everything the decision needs; the route loads it once and reuses it. */
export interface RetakeFacts {
  currentAssignmentId: string | null;
  attempts: AttemptFact[];
  now: Date;
}

/** Outcome of the access decision; spread into the 403 deny body when blocked. */
export interface RetakeGateResult {
  allowed: boolean;
  /** Which barrier is in force; absent when access is open. */
  blockedBy?: "cooldown" | "attemptInterval";
  reason?: string;
  cooldownPeriodDays?: number;
  intervalHours?: number;
  lastAttemptDate?: string | null;
  /** Calendar date (`YYYY-MM-DD`) barrier A opens on. */
  availableDate?: string | null;
  /** ISO instant barrier B opens at. */
  availableAt?: string | null;
  /** Whole days to `availableDate`; null when access is open or the barrier is B. */
  daysUntil?: number | null;
}

/** Format a Date to a calendar `YYYY-MM-DD` (UTC), matching the cooldown math. */
export function toIsoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Most recent completed-attempt date (`YYYY-MM-DD` UTC), or null when none. */
export function lastCompletedAttemptDate(
  finishedAts: Array<Date | string | null | undefined>,
): string | null {
  let max = 0;
  for (const f of finishedAts) {
    if (!f) continue;
    const t = new Date(f).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max > 0 ? toIsoDateUTC(new Date(max)) : null;
}

/** Latest finish instant among the given attempts, as an ISO string; null when none. */
function lastFinishedInstant(attempts: AttemptFact[]): string | null {
  let max = 0;
  for (const a of attempts) {
    if (!a.finishedAt) continue;
    const t = new Date(a.finishedAt).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max > 0 ? formatIsoInstant(max) : null;
}

/**
 * PRD-31 (FR-07): completed attempts of the CURRENT assignment — the number
 * `maxAttempts` is compared against. A new assignment hands out a fresh set.
 */
export function countAttemptsInAssignment(
  attempts: AttemptFact[],
  currentAssignmentId: string | null,
): number {
  return attempts.filter((a) => a.finishedAt != null && a.assignmentId === currentAssignmentId).length;
}

/**
 * Decides whether a new attempt is allowed. Inert (always allowed) unless at least
 * one barrier is enabled; barriers are independent (FR-03) and apply at disjoint
 * moments (§3).
 */
export function decideRetake(
  retakePolicy: RetakePolicy | null | undefined,
  facts: RetakeFacts,
): RetakeGateResult {
  const cooldownOn = retakePolicy?.enabled === true && retakePolicy.cooldownPeriodDays != null;
  const intervalOn = retakePolicy?.attemptInterval?.enabled === true && retakePolicy.attemptInterval.hours != null;
  if (!cooldownOn && !intervalOn) return { allowed: true };

  const inside = facts.attempts.filter(
    (a) => a.finishedAt != null && a.assignmentId === facts.currentAssignmentId,
  );

  if (inside.length > 0) {
    // Barrier B — a repeat inside the assignment. Barrier A is deliberately NOT
    // consulted here: it guards the boundary BETWEEN assignments, and applying it
    // inside would make it a between-attempts barrier again (§3).
    if (!intervalOn) return { allowed: true };
    const hours = retakePolicy!.attemptInterval!.hours as number;
    const last = lastFinishedInstant(inside);
    const d = attemptIntervalDecision(last, formatIsoInstant(facts.now.getTime()), hours);
    if (d.allowed) return { allowed: true };
    return {
      allowed: false,
      blockedBy: "attemptInterval",
      reason: "attempt_interval_active",
      intervalHours: hours,
      availableAt: d.availableAt,
      availableDate: null,
      daysUntil: null,
    };
  }

  // Barrier A — the first attempt of this assignment, measured against attempts of
  // every OTHER assignment (including the legacy NULL bucket).
  if (!cooldownOn) return { allowed: true };
  const outside = facts.attempts.filter(
    (a) => a.finishedAt != null && a.assignmentId !== facts.currentAssignmentId,
  );
  const cooldownPeriodDays = retakePolicy!.cooldownPeriodDays as number;
  const lastAttemptDate = lastCompletedAttemptDate(outside.map((a) => a.finishedAt));
  const decision = cooldownDecision(lastAttemptDate, toIsoDateUTC(facts.now), cooldownPeriodDays);
  if (decision.allowed) return { allowed: true };
  return {
    allowed: false,
    blockedBy: "cooldown",
    reason: "cooldown_active",
    cooldownPeriodDays,
    lastAttemptDate,
    availableDate: decision.availableDate,
    availableAt: null,
    daysUntil: daysUntilDate(decision.availableDate, decision.effectiveToday),
  };
}
```

- [ ] **Шаг 4: убедиться, что новый тест проходит**

Выполнить: `npm test -- tests/retake-gate-assignment.test.ts`

Ожидание: PASS, 9 тестов.

- [ ] **Шаг 5: привести существующий тест к новой сигнатуре**

Выполнить: `npm test -- tests/retake-gate.test.ts`

Ожидание: FAIL — старые вызовы `decideRetake(policy, "2026-05-08", "2026-06-01")`. Переписать каждый вызов
в новую форму, сохранив проверяемое поведение: дата последней попытки становится единственной попыткой с
`assignmentId: "old"`, а `currentAssignmentId` — `"new"`, что соответствует прежнему смыслу «кулдаун между
прохождениями». Прогнать снова до PASS.

### Задача 7: маршруты старта попытки

**Файлы:**

- Изменить: `server/routes/attempts.ts:292-313` (обычный старт)
- Изменить: `server/routes/attempts.ts:426-447` (адаптивный старт)
- Изменить: место создания строки попытки в обоих маршрутах
- Тест: `tests/routes.attempts.coverage.test.ts`

- [ ] **Шаг 1: заменить блок гейтов в обычном старте**

```ts
    // Attempt gates (PRD-6 barrier A + PRD-31 barrier B) and the attempt counter,
    // all scoped to the CURRENT ASSIGNMENT — the unit of access (PRD-31 §3). Load
    // the user's attempts once and reuse for every check.
    const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
    const barriersOn =
      retakePolicy?.enabled === true || retakePolicy?.attemptInterval?.enabled === true;
    const currentAssignmentId = await storage.getCurrentAssignmentId(req.session.userId!, test.id);
    if (barriersOn || test.maxAttempts !== null) {
      const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
      const facts = {
        currentAssignmentId,
        attempts: userAttempts.map((a) => ({ assignmentId: a.assignmentId, finishedAt: a.finishedAt })),
        now: new Date(),
      };

      const gate = decideRetake(retakePolicy, facts);
      if (!gate.allowed) {
        const code = gate.blockedBy === "attemptInterval" ? "ATTEMPT_INTERVAL" : "RETAKE_COOLDOWN";
        const error = gate.blockedBy === "attemptInterval" ? "Attempt interval active" : "Retake cooldown active";
        return res.status(403).json({ error, code, ...gate });
      }

      // FR-07: the limit is per assignment, so a re-assignment hands out a fresh set.
      if (test.maxAttempts !== null && countAttemptsInAssignment(facts.attempts, currentAssignmentId) >= test.maxAttempts) {
        return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
      }
    }
```

Импорт в шапке файла заменить на:

```ts
import { decideRetake, countAttemptsInAssignment, lastCompletedAttemptDate, toIsoDateUTC } from "../services/retake-gate";
```

- [ ] **Шаг 2: то же для адаптивного старта**

Повторить тот же блок в `/tests/:testId/attempts/start-adaptive`, дословно — обе ветки обязаны решать
одинаково, расхождение здесь и породило исходный дефект.

- [ ] **Шаг 3: записывать назначение в строку попытки**

В обоих маршрутах в объект создаваемой попытки добавить поле:

```ts
      // PRD-31 (FR-12): pin the attempt to the assignment it was taken under.
      assignmentId: currentAssignmentId,
```

- [ ] **Шаг 4: прогнать тесты маршрутов**

Выполнить: `npm test -- tests/routes.attempts.coverage.test.ts`

Ожидание: FAIL на моках хранилища — в них нет `getCurrentAssignmentId`. Дописать в мок
`getCurrentAssignmentId: async () => null` и привести ожидания счётчика попыток к назначению. Прогнать до PASS.

### Задача 8: список тестов ученика и стартовый экран

**Файлы:**

- Изменить: `server/routes/attempts.ts:218-270`
- Изменить: `client/src/pages/learner/take-test.tsx:2481-2486`, `:271-277`

- [ ] **Шаг 1: заменить расчёт `retakeGate` в списке**

```ts
        // PRD-19 Block F (FR-19/20) + PRD-31: resolve the access decision up front so
        // the START screen renders the blocked state (moment + disabled button + prior
        // summary) on the standard start page. Facts are scoped to the current
        // assignment — the unit of access.
        const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
        const currentAssignmentId = await storage.getCurrentAssignmentId(req.session.userId!, test.id);
        const gate = decideRetake(retakePolicy, {
          currentAssignmentId,
          attempts: attempts.map((a) => ({ assignmentId: a.assignmentId, finishedAt: a.finishedAt })),
          now: new Date(),
        });
        const retakeGate = gate.allowed
          ? null
          : {
              blockedBy: gate.blockedBy ?? null,
              cooldownPeriodDays: gate.cooldownPeriodDays ?? null,
              intervalHours: gate.intervalHours ?? null,
              availableDate: gate.availableDate ?? null,
              availableAt: gate.availableAt ?? null,
              daysUntil: gate.daysUntil ?? null,
            };
```

Ниже, где считается `completedAttempts` для `priorResult` и для стартового экрана, заменить подсчёт на
`countAttemptsInAssignment(...)` с тем же `currentAssignmentId`, а `maxAttempts` оставить как есть.

- [ ] **Шаг 2: расширить клиентское состояние**

В `take-test.tsx` в типе `RetakeGateState` и в `mapTestToMetadata` добавить два поля:

```ts
type RetakeGateState = {
  blockedBy: "cooldown" | "attemptInterval" | null;
  cooldownPeriodDays: number | null;
  intervalHours: number | null;
  availableDate: string | null;
  availableAt: string | null;
  daysUntil: number | null;
};
```

```ts
    retakeGate: test.retakeGate
      ? {
          blockedBy: test.retakeGate.blockedBy ?? null,
          cooldownPeriodDays: test.retakeGate.cooldownPeriodDays ?? null,
          intervalHours: test.retakeGate.intervalHours ?? null,
          availableDate: test.retakeGate.availableDate ?? null,
          availableAt: test.retakeGate.availableAt ?? null,
          daysUntil: test.retakeGate.daysUntil ?? null,
        }
      : null,
```

- [ ] **Шаг 3: показать момент открытия**

В `client/src/pages/learner/cooldown-format.ts` дописать:

```ts
/**
 * PRD-31: human form of the instant barrier B opens at — «01.08.2026 в 14:30».
 * Rendered in the LEARNER's local zone on purpose: unlike the calendar cooldown,
 * an hour interval is meaningless in UTC to the person reading it. The DECISION
 * still belongs to the server; this only formats the instant the server sent.
 */
export function fmtIsoInstantHuman(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date} в ${time}`;
}
```

В месте сборки `cooldown` для `buildStartState` заменить на:

```ts
      cooldown: gate
        ? {
            availableDateHuman:
              gate.blockedBy === "attemptInterval"
                ? fmtIsoInstantHuman(gate.availableAt)
                : fmtIsoDateHuman(gate.availableDate),
            daysUntil: gate.daysUntil,
          }
        : null,
```

Импорт дополнить: `import { fmtIsoDateHuman, fmtIsoInstantHuman } from "./cooldown-format";`

Контракт `CtxStartCooldown` не меняется — макеты шаблонов править не нужно.

- [ ] **Шаг 4: прогнать тесты экрана**

Выполнить: `npm test -- client/src/pages/learner/__tests__/take-test.test.tsx`

Ожидание: PASS (при падении — дописать новые поля в фикстуры ответа).

### Задача 9: домашняя страница и экран результата

**Файлы:**

- Изменить: `server/services/home/assigned.ts:50-71`
- Изменить: `server/routes/attempts.ts:1227-1230`, `:1373-1379`
- Тест: `tests/home-sections.test.ts`

- [ ] **Шаг 1: перевести `assigned.ts` на новый вердикт**

```ts
      const currentAssignmentId = await storage.getCurrentAssignmentId(userId, test.id);
      const gate = decideRetake(test.retakePolicyJson as RetakePolicy | null, {
        currentAssignmentId,
        attempts: attempts.map((a) => ({ assignmentId: a.assignmentId, finishedAt: a.finishedAt })),
        now: new Date(),
      });
```

и заполнение поля:

```ts
        // PRD-31: barrier B opens at an INSTANT, barrier A at a date. The home card
        // shows a date either way, so the instant is trimmed to its calendar day.
        blockedUntil: gate.allowed
          ? null
          : (gate.availableDate ?? (gate.availableAt ? gate.availableAt.slice(0, 10) : null)),
        completedAttempts: countAttemptsInAssignment(
          attempts.map((a) => ({ assignmentId: a.assignmentId, finishedAt: a.finishedAt })),
          currentAssignmentId,
        ),
```

Импорт дополнить `countAttemptsInAssignment`.

- [ ] **Шаг 2: экран результата считает попытки внутри назначения**

В обработчике `GET /attempts/:attemptId/result` заменить подсчёт:

```ts
    const currentAssignmentId = await storage.getCurrentAssignmentId(req.session.userId!, attempt.testId);
    const completedAttempts = countAttemptsInAssignment(
      userAttempts.map((a) => ({ assignmentId: a.assignmentId, finishedAt: a.finishedAt })),
      currentAssignmentId,
    );
```

- [ ] **Шаг 3: прогнать тесты**

Выполнить: `npm test -- tests/home-sections.test.ts`

Ожидание: PASS (в моке хранилища дописать `getCurrentAssignmentId`).

---

## Фаза 4. SCORM

### Задача 10: доверенное «сейчас» отдельным модулем

**Файлы:**

- Создать: `server/scorm/template/app/utils/trusted-now.js`
- Изменить: `server/scorm/template/app/eligibility/gate.js:51-121, 156-196`
- Изменить: `server/scorm/index.ts` (список склеиваемых ассетов — добавить новый файл ДО `gate.js`)

- [ ] **Шаг 1: создать модуль**

```js
// app/utils/trusted-now.js
// PRD-6 trusted date / PRD-31 barrier B: "now" taken from the LMS clock — the
// `Date` response header of the portal chrome — instead of the learner's machine.
// Extracted from gate.js because BOTH barriers need it now: the calendar cooldown
// (a day) and the hour interval (a full instant), and the interval is trivially
// bypassed by moving the system clock if it reads the local one.
//
// Same-origin is the expected mode (confirmed 2026-08-01: the course frame and the
// portal share an origin). Degradation to the machine clock — i.e. the legacy
// behaviour — happens when the header is MISSING or UNPARSEABLE, when the request
// REJECTS, or when the sub-budget TIMES OUT. An HTTP error carrying a valid `Date`
// is deliberately NOT a fallback: the portal stamps the header whatever the status.
var TrustedNow = (function () {
  var DATE_TIMEOUT_MS = 2500; // NFR-02, inside the gate's own 5 s budget
  var TIMEOUT = { timedOut: true };
  var chrome = {};

  function glog() {
    if (typeof console === 'undefined' || !console.log) return;
    var args = ['[PRD-31 time]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  // Memoized same-origin GET. SECID, cur_person_id and the trusted clock all read
  // the SAME response, so the portal is touched once per URL. `no-store` keeps the
  // Date header live: a cached response would carry a stale server clock.
  function fetchPortalChrome(url) {
    var key = url || '/';
    if (Object.prototype.hasOwnProperty.call(chrome, key)) return chrome[key];
    chrome[key] = (function () {
      // `fetch` may be missing or throw synchronously (hostile shim, ancient runtime).
      try { return fetch(key, { credentials: 'include', cache: 'no-store' }); }
      catch (e) { return Promise.reject(e); }
    })()
      .then(function (r) {
        var dateHeader = '';
        try { dateHeader = (r.headers && r.headers.get && r.headers.get('Date')) || ''; } catch (e) { dateHeader = ''; }
        return r.text().then(function (text) {
          return { text: text || '', dateHeader: dateHeader, failed: !r.ok, status: r.status || 0 };
        });
      })
      .catch(function (e) { return { text: '', dateHeader: '', failed: true, status: 0, error: e }; });
    return chrome[key];
  }

  function reset() { chrome = {}; }

  function fallbackCause(page) {
    if (page === TIMEOUT) return 'timeout after ' + DATE_TIMEOUT_MS + ' ms';
    if (page && page.dateHeader) return 'unparseable-header: "' + page.dateHeader + '"';
    if (page && page.failed) {
      return 'request-failed' + (page.status ? ': HTTP ' + page.status : '') +
        (page.error && page.error.message ? ': ' + page.error.message : '');
    }
    return 'no-header';
  }

  // Resolves epoch-ms of the portal clock, or the machine clock on any degradation.
  function resolveNowMs(endpoint) {
    var work = fetchPortalChrome(endpoint || '/');
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve(TIMEOUT); }, DATE_TIMEOUT_MS);
    });
    return Promise.race([work, timeout])
      .catch(function (e) { return { dateHeader: '', failed: true, status: 0, error: e }; })
      .then(function (page) {
        var clientMs = Date.now();
        var header = (page && page.dateHeader) || '';
        var serverMs = header ? Date.parse(header) : NaN;
        if (!serverMs || !isFinite(serverMs)) {
          glog('source: client (' + fallbackCause(page) + ') | client:', new Date(clientMs).toUTCString());
          return clientMs;
        }
        glog('source: network | server:', header, '| client:', new Date(clientMs).toUTCString(),
          '| skew sec:', Math.round((serverMs - clientMs) / 1000));
        return serverMs;
      });
  }

  return {
    DATE_TIMEOUT_MS: DATE_TIMEOUT_MS,
    fetchPortalChrome: fetchPortalChrome,
    resolveNowMs: resolveNowMs,
    reset: reset
  };
})();
```

- [ ] **Шаг 2: подключить модуль к сборке пакета**

В `server/scorm/index.ts` найти массив склеиваемых файлов рантайма и добавить
`app/utils/trusted-now.js` ПЕРЕД `app/eligibility/gate.js` — порядок важен, склейка плоская.

- [ ] **Шаг 3: перевести gate.js на общий модуль**

В `gate.js` удалить локальные `DATE_TIMEOUT_MS`, `DATE_TIMEOUT`, `fallbackCause`, `fetchPortalChrome`,
`portalChrome`, тело `resolveToday`, и заменить их на:

```js
  // Trusted "today" (PRD-6) now comes from the shared TrustedNow module, which the
  // PRD-31 interval barrier also uses — one GET of the portal chrome per launch.
  function resolveToday(config) {
    var src = (config && config.secidSource) || {};
    return TrustedNow.resolveNowMs(src.endpoint || '/').then(function (ms) {
      return isoDayFromMs(ms);
    });
  }
```

Все обращения `fetchPortalChrome(...)` в `resolveSecid`/`resolvePersonId` заменить на
`TrustedNow.fetchPortalChrome(...)`, а сброс кэша в `run` — на `TrustedNow.reset()`.

- [ ] **Шаг 4: прогнать тесты гейта**

Выполнить: `npm test -- tests/eligibility-gate-date.test.ts tests/eligibility-gate-blockwall.test.ts`

Ожидание: PASS. Если тест собирает рантайм по списку файлов — дописать в него `trusted-now.js`.

### Задача 11: метка завершения попытки по доверенному времени

**Файлы:**

- Изменить: `server/scorm/template/app/utils/scorm/suspendAttempts.js:121-155`

- [ ] **Шаг 1: закешировать доверенное время на запуск**

В начало `suspendAttempts.js` добавить:

```js
// PRD-31: the interval between attempts is decided against the PORTAL clock, so the
// attempt's completion instant must come from the same source — otherwise moving the
// system clock forward once would both open the barrier and poison the stored mark.
// Resolved once per launch and cached; `completedAtSource` records which clock won,
// so a package that degraded to the machine clock is diagnosable from suspend_data.
var trustedNowMs = null;
var trustedNowSource = 'client';

function primeTrustedNow() {
  if (typeof TrustedNow === 'undefined') return Promise.resolve();
  var startedAt = Date.now();
  return TrustedNow.resolveNowMs('/').then(function (ms) {
    trustedNowMs = ms;
    // A network-resolved clock differs from the local one by more than the request
    // took only when it really is the server's; equal values mean the fallback ran.
    trustedNowSource = Math.abs(ms - Date.now()) > (Date.now() - startedAt) ? 'network' : 'client';
  }).catch(function () { /* degrade silently: nowIso() falls back to the machine clock */ });
}

// Monotonic offset from the primed instant, so a long session still reports a
// sensible completion time without re-fetching the portal on every attempt.
var primedAt = Date.now();

function nowIso() {
  if (trustedNowMs == null) return new Date().toISOString();
  return new Date(trustedNowMs + (Date.now() - primedAt)).toISOString();
}
```

- [ ] **Шаг 2: использовать его в записи попытки**

В `saveAttemptResult` заменить строку `completedAt: new Date().toISOString(),` на:

```js
    completedAt: nowIso(),
    completedAtSource: trustedNowSource,
```

В `setAttemptsUsed` заменить `s.lastUpdated = new Date().toISOString();` на `s.lastUpdated = nowIso();`.

- [ ] **Шаг 3: вызвать прайм при старте курса**

В `server/scorm/template/app/bootstrap/main.js` перед запуском курса добавить вызов
`primeTrustedNow()` в цепочку инициализации, не блокируя ею старт дольше `TrustedNow.DATE_TIMEOUT_MS`.

- [ ] **Шаг 4: собрать пакет и убедиться, что он валиден**

Выполнить: `npm run scorm:template`

Ожидание: пакет собран в `out/` без ошибок.

### Задача 12: барьеры на экранах пакета

**Файлы:**

- Изменить: `server/scorm/template/app/render/startPage.js:57-102`
- Изменить: `server/scorm/template/app/render/resultsPage.js:200-205`
- Изменить: `server/scorm/template/app/render/adaptiveRender.js:377-380`

- [ ] **Шаг 1: добавить общий признак в `suspendAttempts.js`**

Функция живёт рядом с `getLastAttempt`/`nowIso`, которыми пользуется, а не в экране: её вызывают ТРИ разных
рендерера, и рантайм склеивается плоско, поэтому объявление в одном экране читалось бы как его частная
деталь.

```js
/**
 * PRD-31 barrier B: is a new attempt open inside THIS assignment? Reads the previous
 * attempt's instant from suspend_data (available post-Initialize, which is where all
 * of this runs) and compares it against the trusted clock. Absent policy => open, so
 * a package without the barrier behaves exactly as before.
 */
function attemptIntervalState() {
  var policy = TEST_DATA.retakePolicy && TEST_DATA.retakePolicy.attemptInterval;
  if (!policy || policy.enabled !== true || !policy.hours) return { allowed: true, availableAt: null };
  var last = getLastAttempt();
  var d = EligibilityEngine.attemptIntervalDecision(
    last ? last.completedAt : null,
    nowIso(),
    policy.hours
  );
  return { allowed: d.allowed, availableAt: d.availableAt };
}
```

Там же, рядом, объявить форматтер момента — пакету недоступен клиентский `cooldown-format.ts`:

```js
// «01.08.2026 в 14:30» — the instant barrier B opens at, in the learner's zone.
// The DECISION is made on the portal clock; only the display is localized.
function fmtInstantHuman(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  function p(n) { return n < 10 ? '0' + n : String(n); }
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() +
    ' в ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
```

Затем в `startPage.js` в `buildScormStartContext` заменить строку `var canStartNew = hasAttemptsLeft();` на:

```js
  var interval = attemptIntervalState();
  var canStartNew = hasAttemptsLeft() && interval.allowed;
```

и добавить в объект, передаваемый в `TB.buildStartState`, поле:

```js
    cooldown: interval.allowed ? null : {
      availableDateHuman: fmtInstantHuman(interval.availableAt),
      daysUntil: null
    },
```

- [ ] **Шаг 2: закрыть «Пройти ещё раз» на экране результатов**

НЕ трогать `attemptsExhausted` в `resultsPage.js`. Этот флаг управляет терминальным LMS-хаком: при исчерпании
попыток курс принудительно закрывается как «пройден» с пометкой в `cmi.comments_from_learner`. Временный
барьер туда сливать нельзя — учащегося, которому надо подождать сутки, закрыло бы навсегда.

Настоящая точка — сборка навигации результатов. В `viewResults.js` в `buildResultsNav` дополнить условие:

```js
    canRetry: !results.passed &&
      (typeof hasAttemptsLeft === 'function') && hasAttemptsLeft() &&
      (typeof attemptIntervalState !== 'function' || attemptIntervalState().allowed),
```

В `adaptiveRender.js` — `var canRetry = hasAttemptsLeft() && intervalOpen;`, а заодно заменить
`canRetry: (!hasLimit) || canRetry` и `showFinish: (!hasLimit) || (!canRetry)` на `canRetry: canRetry` и
`showFinish: !canRetry`: дизъюнкция с `!hasLimit` была избыточной (`hasAttemptsLeft()` и так истинна без
лимита) и с появлением барьера стала неверной — тест без лимита предлагал бы повтор сквозь закрытый интервал.

- [ ] **Шаг 3: собрать пакет**

Выполнить: `npm run scorm:template`

Ожидание: сборка проходит.

### Задача 13: вердикт барьера A за `Initialize`

**Файлы:**

- Изменить: `server/scorm/template/app/eligibility/gate.js:528-572`
- Изменить: `server/scorm/template/app/bootstrap/main.js`

- [ ] **Шаг 1: перестроить `run`**

Заменить начало `run(td, onAllowedStart)` так, чтобы сессия открывалась ДО вердикта, а
`suspend_data` решал, применять ли барьер A:

```js
  // PRD-31 §7.2 / PRD-6 §9.1: the verdict of barrier A moves AFTER Initialize.
  // Reason: before Initialize `suspend_data` is unreadable (SCORM 2004 returns error
  // 122), so the package cannot tell a NEW assignment from a re-entry into the
  // current one — and the LMS grid carries no identifier that would (refuted by
  // probes 2026-07-16 and 2026-08-01). Since the record turns finished after the
  // FIRST attempt, the old placement blocked a learner INSIDE their own assignment
  // with attempts left. Opening the session costs nothing that matters: a blocked
  // launch writes no `cmi.*` and is closed immediately by Terminate, so it never
  // becomes a completed record — which is what NFR-01 actually protects.
  function run(td, onAllowedStart) {
    TrustedNow.reset();
    var startedAt = monotonicNow();
    if (typeof SCORM !== 'undefined' && SCORM.init) SCORM.init();
    // Re-entry into the CURRENT assignment: barrier A does not apply (§3), the
    // package proceeds and the start screen enforces barrier B.
    if (getAttemptsUsed() > 0 || hasCompletedAttempts()) {
      glog('re-entry into the current assignment (suspend_data carries attempts) — barrier A skipped');
      onAllowedStart();
      return;
    }
    buildContext(td).then(function (ctx) {
```

Остальная часть цепочки не меняется до ветки блокировки, где перед отрисовкой добавить закрытие сессии:

```js
        if (!result.allowed) {
          // No cmi.* was written on this path; close the session at once so the
          // launch cannot be mistaken for an attempt.
          try { if (typeof SCORM !== 'undefined' && SCORM.terminate) SCORM.terminate(); }
          catch (e) { glog('terminate after block failed:', (e && e.message) || e); }
          renderCooldownStart(retake, td);
        } else onAllowedStart();
```

- [ ] **Шаг 2: не инициализировать сессию дважды**

В `onAllowedStart` (`runCourse`) убедиться, что повторный `SCORM.init()` не выполняется: обёртка
`server/scorm/assets/runtime.js` хранит флаг `initialized`, но вызывает `Initialize` безусловно. Добавить в
`runtime.js` в начало `init`:

```js
      if (initialized) { log('Initialize: already initialized, skipped'); return true; }
```

- [ ] **Шаг 3: прогнать тесты гейта и приёмку кулдауна**

Выполнить: `npm test -- tests/eligibility-gate-blockwall.test.ts tests/scorm-retake-acceptance.test.ts`

Ожидание: FAIL на утверждениях «Initialize не вызывался» — переписать их под §9.1: проверять, что не
записан ни один `cmi.*` и что после блокировки вызван `Terminate`. Прогнать до PASS.

### Задача 14: запекание политики без плагина

**Файлы:**

- Изменить: `server/scorm/builders/test-json.ts:261-282`
- Тест: `tests/scorm-telemetry-bundling.test.ts`

- [ ] **Шаг 1: разделить условия**

```ts
  // PRD-6: retake gate policy + resolved plugin runtime/config. PRD-31 splits the
  // condition: the GATE and its plugin are still baked only for barrier A, but the
  // interval barrier needs the policy in TEST_DATA with no plugin at all. Packages
  // with neither barrier stay byte-identical (FR-14).
  const rp = data.test.retakePolicyJson as RetakePolicy | null | undefined;
  const gateOn = !!(rp && rp.enabled && rp.eligibilityPlugin?.key);
  const intervalOn = rp?.attemptInterval?.enabled === true && rp.attemptInterval.hours != null;
  if (gateOn || intervalOn) {
    test.retakePolicy = {
      enabled: !!(rp && rp.enabled),
      ...(rp?.cooldownPeriodDays != null ? { cooldownPeriodDays: rp.cooldownPeriodDays } : {}),
      gateMode: rp!.gateMode,
      eligibilityPlugin: gateOn ? rp!.eligibilityPlugin : null,
      blockedPageId: rp!.blockedPageId ?? null,
      ...(intervalOn ? { attemptInterval: rp!.attemptInterval } : {}),
    };
  }
  if (gateOn) {
    const plugin = findEligibilityPlugin(rp!.eligibilityPlugin!.key);
    if (plugin) {
      const cfg = findEligibilityConfig(rp!.eligibilityPlugin!.key, rp!.eligibilityPlugin!.configId);
      test.retakePlugin = {
        key: plugin.key,
        runtimeEntry: plugin.runtimeEntry,
        bestEffort: plugin.bestEffort,
        config: cfg?.config ?? {},
      };
    }
  }
```

- [ ] **Шаг 2: тест на неизменность пакета без барьеров**

Дописать в `tests/scorm-telemetry-bundling.test.ts`:

```ts
  it("PRD-31: a test with NEITHER barrier carries no retakePolicy in TEST_DATA", () => {
    const json = buildTestJson(exportDataWithPolicy(null));
    expect(json.retakePolicy).toBeUndefined();
    expect(json.retakePlugin).toBeUndefined();
  });

  it("PRD-31: interval-only bakes the policy WITHOUT a plugin", () => {
    const json = buildTestJson(
      exportDataWithPolicy({
        enabled: false,
        gateMode: "before_internal_start",
        eligibilityPlugin: null,
        attemptInterval: { enabled: true, hours: 24 },
      }),
    );
    expect(json.retakePolicy.attemptInterval).toEqual({ enabled: true, hours: 24 });
    expect(json.retakePolicy.eligibilityPlugin).toBeNull();
    expect(json.retakePlugin).toBeUndefined();
  });
```

Хелпер `exportDataWithPolicy(policy)` — это существующая фикстура сборки `ExportData` из того же файла с
подставленным `test.retakePolicyJson`. Найти в файле фикстуру, которой уже пользуются тесты телеметрии, и
добавить ей один параметр вместо создания второй параллельной фикстуры.

- [ ] **Шаг 3: прогнать**

Выполнить: `npm test -- tests/scorm-telemetry-bundling.test.ts`

Ожидание: PASS.

---

## Фаза 5. Авторский интерфейс

### Задача 15: эскиз Э0

**Файлы:**

- Создать: `docs/wireframes/approved/prd31-attempt-interval.html`

- [ ] **Шаг 1: собрать эскиз**

Взять за основу существующий `docs/wireframes/approved/prd6-retake-policy.html` и добавить МИНИМАЛЬНУЮ
дельту — вторую группу под существующей: переключатель «Ограничение между попытками», числовое поле
«Интервал, часов» и поясняющую строку, разводящую два барьера. Правила эскизов репозитория: только
эскизный фрейм, интерфейс — на примитивах DS, локальные render-классы запрещены, пояснения выносятся в
`wf-notes` / `wf-mapping`, а не в холст.

- [ ] **Шаг 2: снять скриншот**

Поднять `chrome-headless-shell.exe` и `http.server` ИЗ КОРНЯ репозитория, снять скриншот эскиза, копию
положить в `.playwright-mcp/`. Временные файлы в корне репозитория запрещены.

- [ ] **Шаг 3: согласовать эскиз с владельцем**

Показать скриншот и дождаться явного «согласовано». **Без этого задача 16 не начинается.**

### Задача 16: панель настройки

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/basic-settings-section.tsx:603-700`
- Изменить: `client/src/features/tests/editor/test-editor.mappers.ts:800-860`
- Тест: `client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

```tsx
  it("PRD-31: enabling the interval seeds 24 hours and shows the field", async () => {
    const model = { ...baseModel(), retakePolicy: defaultRetakePolicy() };
    const updateModel = vi.fn();
    render(<SettingsSection model={model} updateModel={updateModel} fieldErrors={{}} />);
    await userEvent.click(screen.getByTestId("settings-retake-rail-item"));
    await userEvent.click(screen.getByTestId("settings-attempt-interval-switch"));
    const patch = updateModel.mock.calls.at(-1)![0](model);
    expect(patch.retakePolicy.attemptInterval).toEqual({ enabled: true, hours: 24 });
  });
```

Идентификаторы существующих элементов уточнить по файлу теста; `settings-retake-switch` уже используется.

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx`

Ожидание: FAIL — элемент `settings-attempt-interval-switch` не найден.

- [ ] **Шаг 3: реализовать группу в `RetakePane`**

Разметку взять из согласованного эскиза дословно. Привязка:

```tsx
  const interval = policy.attemptInterval ?? null;
  const intervalOn = interval?.enabled === true;

  const setInterval = (patch: Partial<AttemptInterval>) =>
    updateModel((m) => ({
      ...m,
      retakePolicy: {
        ...m.retakePolicy,
        attemptInterval: { enabled: intervalOn, hours: interval?.hours ?? 24, ...patch },
      },
    }));
```

Переключатель ставит `{ enabled: checked, hours: interval?.hours ?? 24 }`, числовое поле — `hours` с
зажимом в `[1, 8760]`. Компоненты берутся из `@universityrt/ui-kit` импортом React-компонентов; классы
`ou-*` руками не пишутся.

- [ ] **Шаг 4: научить маппер читать и писать ветку**

В `test-editor.mappers.ts` в `defaultRetakePolicy()` добавить `attemptInterval: null`, в
`readRetakePolicyFromApi` — чтение ветки с зажимом:

```ts
/** Clamp an interval value into the schema-valid `[1, 8760]` integer range. */
function clampIntervalHours(value: number): number {
  return Math.min(8760, Math.max(1, Math.round(value)));
}
```

```ts
  const intervalRaw = isPlainObject(r.attemptInterval) ? (r.attemptInterval as Record<string, unknown>) : null;
  const attemptInterval =
    intervalRaw && intervalRaw.enabled === true
      ? { enabled: true, hours: clampIntervalHours(typeof intervalRaw.hours === "number" ? intervalRaw.hours : 24) }
      : null;
```

и вернуть поле в собираемой политике.

- [ ] **Шаг 5: прогнать тесты редактора**

Выполнить: `npm test -- client/src/features/tests/editor`

Ожидание: PASS.

---

## Фаза 6. Приёмка

### Задача 17: стенд с разводимыми часами

**Файлы:**

- Изменить: `scripts/scorm-player.mjs`

- [ ] **Шаг 1: расширить флаг времени**

Существующий `--server-date=` задаёт только дату. Добавить приём полного момента
(`--server-date=2026-08-01T14:30:00Z`) и переменную окружения `SCORM_PLAYER_SERVER_DATE` в том же формате;
заголовок `Date` ответов стенда проставлять из него, а при отсутствии — из системных часов.

- [ ] **Шаг 2: проверить, что стенд отдаёт нужный заголовок**

Выполнить: `npm run scorm:player -- --server-date=2026-08-01T14:30:00Z`

Ожидание: в ответах стенда заголовок `Date` соответствует заданному моменту.

### Задача 18: приёмка пакета в браузере

- [ ] **Шаг 1: собрать пакет с обоими барьерами**

Взять `scripts/_build-cooldown-scorm.ts` за образец и собрать пакет с политикой
`{ enabled: true, cooldownPeriodDays: 30, attemptInterval: { enabled: true, hours: 24 } }` и
`maxAttempts: 3`.

- [ ] **Шаг 2: прогнать четыре сценария**

Под живым Chromium через CDP (playwright в этом репозитории не используется), стенд с пиненными часами:

| Сценарий | Часы стенда | Ожидание |
| --- | --- | --- |
| Первая попытка нового назначения, кулдаун не истёк | попытка 9 дней назад | старт заблокирован, `cmi.*` пуст, вызван `Terminate` |
| Повтор внутри назначения, интервал не истёк | попытка 2 часа назад | стартовый экран, кнопка неактивна, показан момент открытия |
| Повтор внутри назначения, интервал истёк | попытка 30 часов назад | старт разрешён, `Initialize` прошёл |
| Часы стенда и машины разведены | стенд назад на сутки | вердикт принят по часам стенда |

- [ ] **Шаг 3: записать результат в спеку**

Дописать в `docs/specs/prd-31/attempt-interval.md` раздел с таблицей фактического результата приёмки, по
образцу §10.1 спеки доверенной даты.

### Задача 19: приёмка веба в браузере

- [ ] **Шаг 1: поднять вторую копию сервера**

Выполнить: `PORT=8099 npm run dev`

- [ ] **Шаг 2: проверить сценарии в реальном браузере**

Юнит-тестов и jsdom для фронтенда недостаточно — приёмка только в живом браузере:

- повтор внутри назначения при включённом интервале: кнопка неактивна, показан момент с временем;
- тот же тест с истёкшим интервалом: старт открыт;
- новое назначение при активном кулдауне: заблокировано, показана дата;
- новое назначение сбрасывает счётчик попыток: `maxAttempts` считается заново.

- [ ] **Шаг 3: сверить каждую деталь с DS**

Проверить отступы, типографику и состояние кнопки по справочнику DS, а не «на глаз».

### Задача 20: документы

**Файлы:**

- Изменить: `CHANGELOG.md`
- Изменить: `docs/ROADMAP.md:119`
- Изменить: `docs/specs/prd-31/attempt-interval.md`

- [ ] **Шаг 1: записать смену поведения в CHANGELOG**

Отдельным пунктом: кулдаун в вебе больше не блокирует повтор внутри назначения, `maxAttempts` считается
внутри назначения, компенсирующей миграции нет.

- [ ] **Шаг 2: обновить строку ROADMAP**

Заменить «код не начат» на фактический статус и перечислить закрытые фазы.

- [ ] **Шаг 3: закрыть критерии приёмки в спеке**

Проставить `[x]` там, где приёмка пройдена, оставив незакрытые пункты видимыми.

- [ ] **Шаг 4: проверить документы линтером**

Выполнить: `npx markdownlint-cli2 "docs/**/*.md" "CHANGELOG.md"`

Ожидание: 0 замечаний.

---

## Порядок и зависимости

```text
Задача 1 -> 2                     общий движок, ни от чего не зависит
Задача 3, 4, 5                    модель данных; 5 зависит от 4
Задача 6 -> 7 -> 8 -> 9           веб; 6 зависит от 1 и 3
Задача 10 -> 11 -> 12 -> 13 -> 14 SCORM; 12 зависит от 2 и 11
Задача 15 -> 16                   интерфейс; 16 НЕ начинать без согласованного эскиза
Задача 17 -> 18, 19               приёмка; после фаз 3-5
Задача 20                         последняя
```

Фазы 3 (веб) и 4 (SCORM) независимы между собой и могут идти параллельно после фазы 2.

## Чего в этом плане нет

Осознанно, по разделу «Вне охвата» спецификации: отдельный экран блокировки для барьера B, перенос
настроек повторного прохождения в книгу Excel, ограничение возобновления незавершённой попытки,
компенсирующая миграция для тестов с уже включённым кулдауном и восстановление принадлежности старых
попыток к назначениям.
