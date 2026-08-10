# PRD-40: Период охлаждения по исходу попытки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a test author configure two different calendar-cooldown periods for barrier A
(PRD-6/PRD-31) — one applied when the learner's last attempt of the previous assignment was
PASSED, another when it was FAILED — behind an explicit, default-off switch, on both hosts
(web + SCORM), and remove the dead `suspend_data_cooldown` plugin along the way.

**Architecture:** A new pure resolver `resolveCooldownDays(policy, passed)` in the shared
eligibility engine (TS + its plain-JS SCORM twin) picks which configured number of days to feed
into the EXISTING, unchanged `cooldownDecision()` date math. Each host resolves `passed` from data
it already has (WebTutor record `state` for SCORM, `resultJson.overallPassed` for web) and passes
it through. `suspend_data_cooldown` — confirmed unused in production — is deleted rather than
extended.

**Tech Stack:** TypeScript (Zod schema, Vitest), plain ES5 JS (SCORM package runtime), React
(author UI), no DB migration (`retake_policy_json` is `jsonb`).

**Spec:** `docs/specs/prd-40/cooldown-by-outcome.md`

---

## Task 1: Schema — `cooldownByOutcome` + split fields

**Files:**

- Modify: `shared/schema.ts:333-368` (`retakePolicySchema`)
- Test: `tests/schema-prd6-retake.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/schema-prd6-retake.test.ts` (new `describe` block at the end of the file):

```ts
describe("retakePolicySchema — PRD-40 cooldownByOutcome", () => {
  it("defaults cooldownByOutcome to false and does not require the split fields", () => {
    const p = retakePolicySchema.parse({ enabled: true, cooldownPeriodDays: 30 });
    expect(p.cooldownByOutcome).toBe(false);
    expect(p.cooldownPeriodDaysPassed).toBeUndefined();
    expect(p.cooldownPeriodDaysFailed).toBeUndefined();
  });

  it("requires both split fields when cooldownByOutcome is on", () => {
    expect(() =>
      retakePolicySchema.parse({ enabled: true, cooldownByOutcome: true, cooldownPeriodDaysPassed: 90 }),
    ).toThrow();
    expect(() =>
      retakePolicySchema.parse({ enabled: true, cooldownByOutcome: true, cooldownPeriodDaysFailed: 7 }),
    ).toThrow();
  });

  it("accepts both split fields and does not require cooldownPeriodDays", () => {
    const p = retakePolicySchema.parse({
      enabled: true,
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
    });
    expect(p.cooldownPeriodDaysPassed).toBe(90);
    expect(p.cooldownPeriodDaysFailed).toBe(7);
    expect(p.cooldownPeriodDays).toBeUndefined();
  });

  it("rejects split fields out of [1, 3650]", () => {
    expect(() =>
      retakePolicySchema.parse({
        enabled: true,
        cooldownByOutcome: true,
        cooldownPeriodDaysPassed: 0,
        cooldownPeriodDaysFailed: 7,
      }),
    ).toThrow();
    expect(() =>
      retakePolicySchema.parse({
        enabled: true,
        cooldownByOutcome: true,
        cooldownPeriodDaysPassed: 90,
        cooldownPeriodDaysFailed: 4000,
      }),
    ).toThrow();
  });

  it("cooldownByOutcome off does not require the split fields even when true previously", () => {
    const p = retakePolicySchema.parse({
      enabled: true,
      cooldownByOutcome: false,
      cooldownPeriodDays: 30,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
    });
    expect(p.enabled).toBe(true);
    expect(p.cooldownPeriodDays).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/schema-prd6-retake.test.ts`
Expected: FAIL — `cooldownByOutcome` / `cooldownPeriodDaysPassed` / `cooldownPeriodDaysFailed` are
not recognized keys yet (the "requires both split fields" test fails because nothing enforces it;
the "accepts both" test fails because `p.cooldownByOutcome` is `undefined`, not `false`/`true`).

- [ ] **Step 3: Implement the schema change**

In `shared/schema.ts`, replace lines 333-368 (the whole `retakePolicySchema` definition) with:

```ts
/**
 * `tests.retake_policy_json`. Two INDEPENDENT barriers (PRD-31 §3), applied at
 * disjoint moments:
 *   - `enabled` + `cooldownPeriodDays` — barrier A, calendar days BETWEEN assignments;
 *   - `attemptInterval` — barrier B, wall-clock hours INSIDE one assignment.
 *
 * `cooldownPeriodDays` is optional at the type level and required only when barrier
 * A is on, so a test can carry barrier B alone without inventing a cooldown value
 * for a switch that is off. Legacy `cooldownDays` is accepted and normalized.
 *
 * PRD-40: `cooldownByOutcome` (default off) splits barrier A's single period into
 * two — `cooldownPeriodDaysPassed` / `cooldownPeriodDaysFailed` — chosen at runtime
 * by the outcome of the last attempt of the OTHER assignment that anchors the
 * decision (see `shared/eligibility/engine.ts` `resolveCooldownDays`). Off (the
 * default, and every existing test) keeps `cooldownPeriodDays` as the only period,
 * byte-identical to pre-PRD-40 behaviour.
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
      cooldownByOutcome: z.boolean().default(false),
      cooldownPeriodDaysPassed: z.number().int().min(1).max(3650).optional(),
      cooldownPeriodDaysFailed: z.number().int().min(1).max(3650).optional(),
      gateMode: z.literal("before_internal_start").default("before_internal_start"),
      eligibilityPlugin: eligibilityPluginRefSchema.nullish(),
      blockedPageId: z.string().optional(),
      attemptInterval: attemptIntervalSchema.nullish(),
    })
    .superRefine((v, ctx) => {
      if (v.enabled && v.cooldownByOutcome) {
        if (v.cooldownPeriodDaysPassed == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cooldownPeriodDaysPassed"],
            message: "cooldownPeriodDaysPassed обязателен при разделении кулдауна по исходу",
          });
        }
        if (v.cooldownPeriodDaysFailed == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cooldownPeriodDaysFailed"],
            message: "cooldownPeriodDaysFailed обязателен при разделении кулдауна по исходу",
          });
        }
      } else if (v.enabled && v.cooldownPeriodDays == null) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/schema-prd6-retake.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run check`
Expected: no new errors

```bash
git add shared/schema.ts tests/schema-prd6-retake.test.ts
git commit -m "feat(prd-40): cooldownByOutcome switch + split cooldown fields in retakePolicySchema"
```

---

## Task 2: `EligibilityContext.retakePolicy` — carry the new fields

**Files:**

- Modify: `shared/eligibility/types.ts:14`

- [ ] **Step 1: Implement**

In `shared/eligibility/types.ts`, replace line 14:

```ts
  retakePolicy: { cooldownPeriodDays: number };
```

with:

```ts
  retakePolicy: {
    cooldownPeriodDays?: number;
    cooldownByOutcome?: boolean;
    cooldownPeriodDaysPassed?: number;
    cooldownPeriodDaysFailed?: number;
  };
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: the 7 pre-existing errors from Task 1 (confined to
`basic-settings-section.coverage.test.tsx`, `basic-settings-section.test.tsx`,
`test-editor.mappers.ts`, owned by Task 10) are still present, PLUS 2 NEW errors in
`shared/eligibility/plugins.ts` (around the existing `cooldownResult` function, which still reads
`context.retakePolicy.cooldownPeriodDays` as a bare `number`). This is correct and expected: making
`cooldownPeriodDays` optional here is what Task 4 needs, and Task 4's Step 3.3 replaces
`cooldownResult` entirely (switching it to `resolveCooldownDays(context.retakePolicy, passed)`),
which resolves both new errors. Confirm the count is 9 total (7 old + 2 new, both in
`plugins.ts`) and that no OTHER file broke.

- [ ] **Step 3: Commit**

```bash
git add shared/eligibility/types.ts
git commit -m "feat(prd-40): EligibilityContext.retakePolicy carries the outcome-split fields"
```

---

## Task 3: `resolveCooldownDays` — shared resolver (TS + JS twin)

**Files:**

- Modify: `shared/eligibility/engine.ts` (add function, fix `buildRetakeState`)
- Modify: `server/scorm/template/app/eligibility/engine.js` (JS twin, same two changes)
- Test: `tests/eligibility-engine-port.test.ts`

- [ ] **Step 1: Write the failing parity test**

In `tests/eligibility-engine-port.test.ts`, add a new `it` inside the existing
`describe("eligibility engine — TS ↔ JS port parity", ...)` block, right after the
`"attemptIntervalDecision matches"` test (after line 97):

```ts
  it("resolveCooldownDays matches", () => {
    const cases: Array<[Record<string, unknown>, boolean | null]> = [
      [{ cooldownPeriodDays: 30 }, true],
      [{ cooldownPeriodDays: 30 }, false],
      [{ cooldownPeriodDays: 30 }, null],
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }, true],
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }, false],
      // Unknown outcome -> the LARGER of the two (conservative default).
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }, null],
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 7, cooldownPeriodDaysFailed: 90 }, null],
      // Only one split value configured (should not happen past schema validation,
      // but the resolver must not throw): falls back to the one present.
      [{ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90 }, null],
      [{ cooldownByOutcome: true, cooldownPeriodDaysFailed: 7 }, null],
      [{ cooldownByOutcome: true }, null],
    ];
    for (const [policy, passed] of cases) {
      expect(port.EligibilityEngine.resolveCooldownDays(policy, passed)).toEqual(
        tsEngine.resolveCooldownDays(policy as any, passed),
      );
    }
    // Concrete values, not just "both sides agree" (a both-undefined match proves nothing).
    expect(tsEngine.resolveCooldownDays({ cooldownPeriodDays: 30 }, true)).toBe(30);
    expect(
      tsEngine.resolveCooldownDays(
        { cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 },
        true,
      ),
    ).toBe(90);
    expect(
      tsEngine.resolveCooldownDays(
        { cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 },
        false,
      ),
    ).toBe(7);
    expect(
      tsEngine.resolveCooldownDays(
        { cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 },
        null,
      ),
    ).toBe(90);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/eligibility-engine-port.test.ts`
Expected: FAIL with `tsEngine.resolveCooldownDays is not a function`

- [ ] **Step 3: Implement in TypeScript**

In `shared/eligibility/engine.ts`, add after `attemptIntervalDecision` (after line 174, before the
`CORE_DEFAULT_RESULT` block):

```ts
/** The subset of `RetakePolicy` the resolver needs. */
export interface CooldownDaysPolicy {
  cooldownPeriodDays?: number;
  cooldownByOutcome?: boolean;
  cooldownPeriodDaysPassed?: number;
  cooldownPeriodDaysFailed?: number;
}

/**
 * PRD-40: which barrier-A period applies, given the outcome of the last attempt of
 * the OTHER assignment that anchors the cooldown decision. `!cooldownByOutcome`
 * (the default, and every pre-PRD-40 test) always returns `cooldownPeriodDays` —
 * byte-identical to the single-period behaviour. `passed === null` (outcome not
 * determined) is deliberately conservative: it resolves to the LARGER of the two
 * configured values, so an unrecognized LMS status can never shorten the wait
 * below what the author configured for either outcome.
 */
export function resolveCooldownDays(
  policy: CooldownDaysPolicy,
  passed: boolean | null,
): number | null {
  if (!policy.cooldownByOutcome) {
    return policy.cooldownPeriodDays ?? null;
  }
  const p = policy.cooldownPeriodDaysPassed;
  const f = policy.cooldownPeriodDaysFailed;
  if (passed === true) return p ?? f ?? null;
  if (passed === false) return f ?? p ?? null;
  if (p == null) return f ?? null;
  if (f == null) return p;
  return Math.max(p, f);
}
```

Then fix `buildRetakeState` (lines 216-236) to prefer the RESOLVED period the plugin already
computed (`result.data.cooldownPeriodDays`, set by `cooldownResult` in Task 4) over the raw
`ctx.cooldownPeriodDays` fallback, so the block-wall shows the number that actually decided the
verdict. Replace the `cooldownPeriodDays: ctx.cooldownPeriodDays,` line inside the returned object
with:

```ts
    cooldownPeriodDays:
      result.data && typeof result.data.cooldownPeriodDays === "number"
        ? result.data.cooldownPeriodDays
        : ctx.cooldownPeriodDays,
```

- [ ] **Step 4: Implement the JS twin**

In `server/scorm/template/app/eligibility/engine.js`, add after `attemptIntervalDecision` (after
line 96, before `var CORE_DEFAULT_RESULT = {`):

```js
  // PRD-40: which barrier-A period applies, given the outcome of the last attempt
  // of the OTHER assignment. !cooldownByOutcome always returns cooldownPeriodDays
  // (byte-identical to the single-period behaviour). passed === null (outcome not
  // determined) resolves to the LARGER of the two configured values -- see the TS
  // twin (shared/eligibility/engine.ts resolveCooldownDays) for the full rationale.
  function resolveCooldownDays(policy, passed) {
    if (!policy.cooldownByOutcome) {
      return policy.cooldownPeriodDays != null ? policy.cooldownPeriodDays : null;
    }
    var p = policy.cooldownPeriodDaysPassed;
    var f = policy.cooldownPeriodDaysFailed;
    if (passed === true) return p != null ? p : (f != null ? f : null);
    if (passed === false) return f != null ? f : (p != null ? p : null);
    if (p == null) return f != null ? f : null;
    if (f == null) return p;
    return Math.max(p, f);
  }

```

And update `buildRetakeState` (lines 131-148) the same way — replace:

```js
      cooldownPeriodDays: ctx.cooldownPeriodDays,
```

with:

```js
      cooldownPeriodDays: (result.data && typeof result.data.cooldownPeriodDays === 'number')
        ? result.data.cooldownPeriodDays : ctx.cooldownPeriodDays,
```

Finally, add `resolveCooldownDays` to the module's returned object (in the `return { ... }` block
at the end of the IIFE):

```js
    resolveCooldownDays: resolveCooldownDays,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/eligibility-engine-port.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Typecheck and commit**

Run: `npm run check`
Expected: no errors

```bash
git add shared/eligibility/engine.ts server/scorm/template/app/eligibility/engine.js tests/eligibility-engine-port.test.ts
git commit -m "feat(prd-40): resolveCooldownDays resolver + buildRetakeState shows the resolved period"
```

---

## Task 4: WebTutor plugin — `passedStateIn` + outcome-aware decision

**Files:**

- Modify: `shared/eligibility/plugins.ts`
- Modify: `server/scorm/template/app/eligibility/plugins.js` (JS twin)
- Test: `tests/eligibility-engine-port.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/eligibility-engine-port.test.ts`, replace the `ctx` helper (lines 24-28) so it can carry
the outcome-split fields, and add a new outcome-aware filter + test. Replace:

```ts
const ctx = (days = 30, today = "2026-05-20"): EligibilityContext => ({
  test: { id: "t", title: "T" },
  retakePolicy: { cooldownPeriodDays: days },
  runtime: { todayDate: today },
});
```

with:

```ts
const ctx = (days = 30, today = "2026-05-20"): EligibilityContext => ({
  test: { id: "t", title: "T" },
  retakePolicy: { cooldownPeriodDays: days },
  runtime: { todayDate: today },
});

const outcomeCtx = (
  passedDays: number,
  failedDays: number,
  today = "2026-05-20",
): EligibilityContext => ({
  test: { id: "t", title: "T" },
  retakePolicy: { cooldownByOutcome: true, cooldownPeriodDaysPassed: passedDays, cooldownPeriodDaysFailed: failedDays },
  runtime: { todayDate: today },
});
```

Then add a new `it`, right after `"selectLastAttemptDate + webtutorCooldownDecide match"`
(after line 164):

```ts
  it("webtutorCooldownDecide resolves the period by outcome (passedStateIn)", () => {
    const outcomeFilter = { ...filter, passedStateIn: ["Пройден"], stateIn: ["Пройден", "Не пройден"] };
    // Last (latest-dated) matching record is "Пройден" -> the PASSED period (90) applies.
    const passedRecords = [
      { state: "Не пройден", progress: "60%", last_usage_date: "01.04.2026" },
      { state: "Пройден", progress: "100%", last_usage_date: "08.05.2026" },
    ];
    expect(port.EligibilityPlugins.webtutorCooldownDecide(passedRecords, outcomeFilter, outcomeCtx(90, 7))).toEqual(
      tsPlugins.webtutorCooldownDecide(passedRecords, outcomeFilter, outcomeCtx(90, 7)),
    );
    expect(
      tsPlugins.webtutorCooldownDecide(passedRecords, outcomeFilter, outcomeCtx(90, 7)).data?.cooldownPeriodDays,
    ).toBe(90);

    // Last matching record is "Не пройден" -> the FAILED period (7) applies.
    const failedRecords = [
      { state: "Пройден", progress: "100%", last_usage_date: "01.04.2026" },
      { state: "Не пройден", progress: "60%", last_usage_date: "08.05.2026" },
    ];
    expect(port.EligibilityPlugins.webtutorCooldownDecide(failedRecords, outcomeFilter, outcomeCtx(90, 7))).toEqual(
      tsPlugins.webtutorCooldownDecide(failedRecords, outcomeFilter, outcomeCtx(90, 7)),
    );
    expect(
      tsPlugins.webtutorCooldownDecide(failedRecords, outcomeFilter, outcomeCtx(90, 7)).data?.cooldownPeriodDays,
    ).toBe(7);

    // No passedStateIn configured -> outcome unknown -> the LARGER of the two.
    expect(
      tsPlugins.webtutorCooldownDecide(passedRecords, filter, outcomeCtx(90, 7)).data?.cooldownPeriodDays,
    ).toBe(90);
    expect(
      tsPlugins.webtutorCooldownDecide(failedRecords, filter, outcomeCtx(7, 90)).data?.cooldownPeriodDays,
    ).toBe(90);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/eligibility-engine-port.test.ts`
Expected: FAIL — `data?.cooldownPeriodDays` is `undefined` (the plugin still reads
`context.retakePolicy.cooldownPeriodDays` directly, which is `undefined` for an outcome-split
policy)

- [ ] **Step 3: Implement in TypeScript**

In `shared/eligibility/plugins.ts`:

1. Add `passedStateIn` to the filter interface. Replace the `nameField`/`excludeDateValues`
   fields' block (lines 44-56) — insert a new field right after `dateFormat` (line 43):

```ts
  dateFormat?: string;
  /**
   * PRD-40: subset of `stateIn` whose records count as a PASSED attempt (vs. a
   * finished-but-failed one). Absent -> the outcome of any selected record is
   * unknown (`passed: null`), which `resolveCooldownDays` treats conservatively.
   */
  passedStateIn?: string[];
```

1. Replace `selectLastAttemptDate` (lines 90-131) with a record-selecting core plus two thin
   wrappers — the exported date-only signature stays for backward compatibility:

```ts
/**
 * Select the latest FINISHED-attempt RECORD from WebTutor records by applying the
 * configurable filter (state/name/date). Returns the raw record or null — callers
 * derive whatever field they need (date via `selectLastAttemptDate`, outcome via
 * `recordPassed`).
 */
export function selectLastAttemptRecord(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
  courseName?: string,
): WebtutorRecord | null {
  const stateField = filter.stateField || "state";
  const progressField = filter.progressField || "progress";
  const fmt = filter.dateFormat || "dd.MM.yyyy";
  const excl = filter.excludeStateIn || [];
  const progRe = filter.progressCompletePattern ? new RegExp(filter.progressCompletePattern) : null;
  const wantName = filter.nameField && courseName ? normalizeName(courseName) : null;
  const sentinels = filter.excludeDateValues || [];
  let bestEpoch: number | null = null;
  let bestRec: WebtutorRecord | null = null;
  for (const rec of records || []) {
    if (!rec) continue;
    if (wantName) {
      const name = normalizeName(rec[filter.nameField as string] != null ? String(rec[filter.nameField as string]) : "");
      if (name !== wantName) continue;
    }
    const state = rec[stateField] != null ? String(rec[stateField]) : "";
    if (filter.stateIn && filter.stateIn.indexOf(state) === -1) continue;
    if (excl.indexOf(state) !== -1) continue;
    if (progRe) {
      const prog = rec[progressField] != null ? String(rec[progressField]) : "";
      if (!progRe.test(prog)) continue;
    }
    const raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : "";
    if (sentinels.some((s) => raw.indexOf(s) !== -1)) continue;
    const iso = parseFlexibleDate(raw, fmt);
    if (!iso) continue;
    const epoch = parseIsoDate(iso);
    if (epoch == null) continue;
    if (bestEpoch == null || epoch > bestEpoch) {
      bestEpoch = epoch;
      bestRec = rec;
    }
  }
  return bestRec;
}

/**
 * Select the latest FINISHED-attempt DATE from WebTutor records (PRD-6 §3.3).
 * Thin wrapper over `selectLastAttemptRecord` kept for backward compatibility with
 * existing callers/tests.
 */
export function selectLastAttemptDate(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
  courseName?: string,
): string | null {
  const rec = selectLastAttemptRecord(records, filter, courseName);
  if (!rec) return null;
  const raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : "";
  return parseFlexibleDate(raw, filter.dateFormat || "dd.MM.yyyy");
}

/**
 * PRD-40: was the given record a PASSED attempt? `null` when `passedStateIn` is
 * not configured (outcome not determinable from this filter) or `rec` is null.
 */
export function recordPassed(
  rec: WebtutorRecord | null,
  filter: WebtutorAttemptFilter,
): boolean | null {
  if (!rec || !filter.passedStateIn) return null;
  const stateField = filter.stateField || "state";
  const state = rec[stateField] != null ? String(rec[stateField]) : "";
  return filter.passedStateIn.indexOf(state) !== -1;
}
```

1. Replace `cooldownResult` (lines 133-157) to accept and use `passed`:

```ts
/** Build a normalized cooldown result from a resolved last-attempt date + outcome. */
function cooldownResult(
  lastAttemptDate: string | null,
  passed: boolean | null,
  context: EligibilityContext,
  source: string,
): EligibilityResult {
  const days = resolveCooldownDays(context.retakePolicy, passed);
  const today = context.runtime.todayDate;
  const dec = cooldownDecision(lastAttemptDate, today, days ?? 0);
  return {
    allowed: dec.allowed,
    reason: dec.allowed ? (lastAttemptDate ? "cooldown_passed" : "no_prior_attempt") : "cooldown_active",
    source,
    availableDate: dec.availableDate,
    data: {
      lastAttemptDate: lastAttemptDate ?? null,
      todayDate: today,
      effectiveToday: dec.effectiveToday,
      nextAllowedDate: dec.availableDate,
      cooldownPeriodDays: days,
    },
  };
}
```

(`days ?? 0` only matters when `cooldownByOutcome` is on but BOTH split fields are absent — a state
schema validation forbids, but the pure function must not throw on it; `cooldownDecision` with
`cooldownPeriodDays: 0` and no `lastAttemptDate` still returns `allowed: true`, matching "no prior
attempt" behaviour.)

1. Update the import line (line 17) to bring in `resolveCooldownDays`:

```ts
import { cooldownDecision, parseIsoDate, resolveCooldownDays } from "./engine";
```

1. Replace `webtutorCooldownDecide` (lines 165-172) to resolve + pass the record's outcome:

```ts
/**
 * `webtutor_cooldown` decision from already-fetched records (PRD-6 §3.6).
 * The runtime fetches `records` from WebTutor endpoints, then calls this.
 * `courseName` (the test title) scopes the selection to one course across all its
 * assignments when the filter declares a `nameField`. PRD-40: the outcome of the
 * SAME winning record (`recordPassed`) resolves which configured period applies.
 */
export function webtutorCooldownDecide(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
  context: EligibilityContext,
  courseName?: string,
): EligibilityResult {
  const rec = selectLastAttemptRecord(records, filter, courseName);
  const date = rec ? parseFlexibleDate(String(rec[filter.dateField] ?? ""), filter.dateFormat || "dd.MM.yyyy") : null;
  return cooldownResult(date, recordPassed(rec, filter), context, "webtutor_cooldown");
}
```

1. Delete `suspendDataCooldownDecide` (lines 178-183) — it is removed in Task 6, not here (keep
   this task scoped to `webtutor_cooldown`); leave it as-is for now, it still compiles (it will
   call the new 4-arg `cooldownResult` — fix its call site too, to keep the file compiling until
   Task 6 deletes it):

```ts
export function suspendDataCooldownDecide(
  lastCompletedDate: string | null,
  context: EligibilityContext,
): EligibilityResult {
  return cooldownResult(lastCompletedDate, null, context, "suspend_data_cooldown");
}
```

1. Fix `cooldownDecideFromDate` (lines 186-192) the same way:

```ts
/** Cooldown decision from an already-resolved last-attempt date, any source. */
export function cooldownDecideFromDate(
  lastAttemptDate: string | null,
  context: EligibilityContext,
  source: string,
): EligibilityResult {
  return cooldownResult(lastAttemptDate, null, context, source);
}
```

- [ ] **Step 4: Implement the JS twin**

In `server/scorm/template/app/eligibility/plugins.js`:

1. Replace `selectLastAttemptDate` (lines 23-61) with the record-core + two wrappers:

```js
  function selectLastAttemptRecord(records, filter, courseName) {
    var stateField = filter.stateField || 'state';
    var progressField = filter.progressField || 'progress';
    var fmt = filter.dateFormat || 'dd.MM.yyyy';
    var excl = filter.excludeStateIn || [];
    var progRe = filter.progressCompletePattern ? new RegExp(filter.progressCompletePattern) : null;
    var wantName = (filter.nameField && courseName) ? normalizeName(courseName) : null;
    var sentinels = filter.excludeDateValues || [];
    var bestEpoch = null;
    var bestRec = null;
    var list = records || [];
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (!rec) continue;
      if (wantName) {
        var nm = normalizeName(rec[filter.nameField] != null ? String(rec[filter.nameField]) : '');
        if (nm !== wantName) continue;
      }
      var st = rec[stateField] != null ? String(rec[stateField]) : '';
      if (filter.stateIn && filter.stateIn.indexOf(st) === -1) continue;
      if (excl.indexOf(st) !== -1) continue;
      if (progRe) {
        var prog = rec[progressField] != null ? String(rec[progressField]) : '';
        if (!progRe.test(prog)) continue;
      }
      var raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : '';
      var skip = false;
      for (var s = 0; s < sentinels.length; s++) { if (raw.indexOf(sentinels[s]) !== -1) { skip = true; break; } }
      if (skip) continue;
      var iso = parseFlexibleDate(raw, fmt);
      if (!iso) continue;
      var epoch = EligibilityEngine.parseIsoDate(iso);
      if (epoch == null) continue;
      if (bestEpoch == null || epoch > bestEpoch) { bestEpoch = epoch; bestRec = rec; }
    }
    return bestRec;
  }

  function selectLastAttemptDate(records, filter, courseName) {
    var rec = selectLastAttemptRecord(records, filter, courseName);
    if (!rec) return null;
    var raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : '';
    return parseFlexibleDate(raw, filter.dateFormat || 'dd.MM.yyyy');
  }

  // PRD-40: was the given record a PASSED attempt? null when passedStateIn is not
  // configured or rec is null (outcome not determinable).
  function recordPassed(rec, filter) {
    if (!rec || !filter.passedStateIn) return null;
    var stateField = filter.stateField || 'state';
    var state = rec[stateField] != null ? String(rec[stateField]) : '';
    return filter.passedStateIn.indexOf(state) !== -1;
  }
```

1. Replace `cooldownResult` (lines 63-82):

```js
  function cooldownResult(lastAttemptDate, passed, context, source) {
    var days = EligibilityEngine.resolveCooldownDays(context.retakePolicy, passed);
    var today = context.runtime.todayDate;
    var dec = EligibilityEngine.cooldownDecision(lastAttemptDate, today, days != null ? days : 0);
    return {
      allowed: dec.allowed,
      reason: dec.allowed ? (lastAttemptDate ? 'cooldown_passed' : 'no_prior_attempt') : 'cooldown_active',
      source: source,
      availableDate: dec.availableDate,
      data: {
        lastAttemptDate: lastAttemptDate != null ? lastAttemptDate : null,
        todayDate: today,
        effectiveToday: dec.effectiveToday,
        nextAllowedDate: dec.availableDate,
        cooldownPeriodDays: days
      }
    };
  }
```

1. Replace `webtutorCooldownDecide` (lines 84-86):

```js
  function webtutorCooldownDecide(records, filter, context, courseName) {
    var rec = selectLastAttemptRecord(records, filter, courseName);
    var date = rec ? parseFlexibleDate(String(rec[filter.dateField] != null ? rec[filter.dateField] : ''), filter.dateFormat || 'dd.MM.yyyy') : null;
    return cooldownResult(date, recordPassed(rec, filter), context, 'webtutor_cooldown');
  }
```

1. Fix `suspendDataCooldownDecide` and `cooldownDecideFromDate` (lines 88-94) call sites (still
   present until Task 6):

```js
  function suspendDataCooldownDecide(lastCompletedDate, context) {
    return cooldownResult(lastCompletedDate, null, context, 'suspend_data_cooldown');
  }

  function cooldownDecideFromDate(lastAttemptDate, context, source) {
    return cooldownResult(lastAttemptDate, null, context, source);
  }
```

1. Add `selectLastAttemptRecord` and `recordPassed` to the returned object (end of the IIFE):

```js
    selectLastAttemptRecord: selectLastAttemptRecord,
    recordPassed: recordPassed,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/eligibility-engine-port.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Typecheck and commit**

Run: `npm run check`
Expected: no errors

```bash
git add shared/eligibility/plugins.ts server/scorm/template/app/eligibility/plugins.js tests/eligibility-engine-port.test.ts
git commit -m "feat(prd-40): webtutor_cooldown resolves the period by attempt outcome (passedStateIn)"
```

---

## Task 5: Registry — seed `passedStateIn`, remove `suspend_data_cooldown`

**Files:**

- Modify: `shared/eligibility/registry.ts`

- [ ] **Step 1: Implement**

In `shared/eligibility/registry.ts`:

1. Add `passedStateIn: ["Пройден"]` to the `webtutor_catalog_default` config's `attemptFilter`
   (after the `stateIn` line, currently line 87):

```ts
            stateField: "state",
            stateIn: ["Пройден", "Не пройден"],
            // PRD-40: the subset of stateIn counted as a PASSED attempt — same text
            // the RT portal already reports, confirmed live (PRD-6 §3.6 header note).
            passedStateIn: ["Пройден"],
            dateField: "last_usage_date",
```

1. Delete the entire `suspend_data_cooldown` entry (lines 99-111, the second object in the
   `ELIGIBILITY_PLUGINS` array, including its trailing comma) — the array now has exactly one
   entry, `webtutor_cooldown`.

- [ ] **Step 2: Run the full eligibility test suite to check for breakage**

Run: `npm test -- tests/eligibility-engine-port.test.ts`
Expected: PASS (this file does not read the registry directly — it constructs filters/contexts by
hand — so it is unaffected by the registry edit; this step just confirms Task 4's work still holds)

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no errors. (Task 6 removes the last runtime reader of the removed entry's `runtimeEntry`
string; other consumers — the author UI route, `test-json.ts` — read the array generically and
tolerate one fewer entry with no type change.)

- [ ] **Step 4: Commit**

```bash
git add shared/eligibility/registry.ts
git commit -m "feat(prd-40): seed passedStateIn default, remove the unused suspend_data_cooldown plugin"
```

---

## Task 6: Remove `suspend_data_cooldown` from the SCORM gate runtime

**Files:**

- Modify: `server/scorm/template/app/eligibility/gate.js`
- Modify: `shared/eligibility/plugins.ts` (drop `suspendDataCooldownDecide`)
- Modify: `server/scorm/template/app/eligibility/plugins.js` (drop the JS twin)
- Modify: `tests/eligibility-plugins.test.ts` — NOT originally listed, but a real, unavoidable
  casualty of deleting `suspendDataCooldownDecide`: this file imports it directly and has its own
  `describe("suspendDataCooldownDecide", ...)` block (2 tests). `tsconfig.json` excludes
  `**/*.test.ts`, so `npm run check` never catches this — only running the actual test file does.
  Delete the dead import and the 2-test `describe` block, same treatment as the parity-test removal
  in Step 3 below.

- [ ] **Step 1: Remove the runtime branch in `gate.js`**

In `server/scorm/template/app/eligibility/gate.js`:

1. Delete the `suspendEvaluate` function (lines 204-218 — the whole function, from the comment
   `// suspend_data_cooldown adapter...` through its closing `}`).

2. In `runPlugin` (lines 220-225), replace:

```js
  function runPlugin(td, ctx) {
    var entry = td.retakePlugin.runtimeEntry;
    if (entry === 'webtutorCooldown') return webtutorEvaluate(ctx, td.retakePlugin.config || {});
    if (entry === 'suspendDataCooldown') return suspendEvaluate(ctx);
    return Promise.resolve(true); // unknown adapter => allow (core default spirit)
  }
```

with:

```js
  function runPlugin(td, ctx) {
    var entry = td.retakePlugin.runtimeEntry;
    if (entry === 'webtutorCooldown') return webtutorEvaluate(ctx, td.retakePlugin.config || {});
    return Promise.resolve(true); // unknown adapter => allow (core default spirit)
  }
```

1. Extend `buildContext` (lines 74-91) so the plugin's context carries the outcome-split fields.
   Replace the `retakePolicy` line inside the returned object:

```js
        retakePolicy: { cooldownPeriodDays: td.retakePolicy.cooldownPeriodDays },
```

with:

```js
        retakePolicy: {
          cooldownPeriodDays: td.retakePolicy.cooldownPeriodDays,
          cooldownByOutcome: td.retakePolicy.cooldownByOutcome,
          cooldownPeriodDaysPassed: td.retakePolicy.cooldownPeriodDaysPassed,
          cooldownPeriodDaysFailed: td.retakePolicy.cooldownPeriodDaysFailed
        },
```

- [ ] **Step 2: Remove `suspendDataCooldownDecide` from both plugin files**

In `shared/eligibility/plugins.ts`, delete the `suspendDataCooldownDecide` function added back in
Task 4 Step 3.6 (the export block):

```ts
export function suspendDataCooldownDecide(
  lastCompletedDate: string | null,
  context: EligibilityContext,
): EligibilityResult {
  return cooldownResult(lastCompletedDate, null, context, "suspend_data_cooldown");
}
```

In `server/scorm/template/app/eligibility/plugins.js`, delete the same function:

```js
  function suspendDataCooldownDecide(lastCompletedDate, context) {
    return cooldownResult(lastCompletedDate, null, context, 'suspend_data_cooldown');
  }
```

And remove `suspendDataCooldownDecide: suspendDataCooldownDecide,` from both files' exported
object literals (the TS file has no explicit export list — removing the function is enough; the JS
file's `return { ... }` block needs the line removed).

- [ ] **Step 3: Update the parity test file — drop the removed-plugin test, fix the `ctx` references**

In `tests/eligibility-engine-port.test.ts`, delete the entire
`it("suspendDataCooldownDecide matches", ...)` block (the test added in the original file, before
this plan's Task 4 changes — currently the block right after
`"selectLastAttemptDate + webtutorCooldownDecide match"` and its own new
`"webtutorCooldownDecide resolves the period by outcome"` sibling from Task 4).

- [ ] **Step 4: Run the parity test**

Run: `npm test -- tests/eligibility-engine-port.test.ts`
Expected: PASS

- [ ] **Step 5: Rewrite `tests/eligibility-gate-date.test.ts` off `suspendGate()`**

This file uses `suspendGate()`/`SCORM_WITH_ATTEMPT` (a `suspend_data_cooldown`-gated fixture) as a
lightweight vehicle to exercise the TRUSTED-DATE mechanism (portal clock vs. machine clock) —
nothing in these specific assertions is about the plugin itself, only about which clock the gate
trusts. Since the plugin no longer exists, every one of these scenarios must be re-expressed with
`webtutor_cooldown` + a stubbed collection response carrying one matching record.

Replace `SCORM_WITH_ATTEMPT` and `suspendGate()` (lines 94-116) with:

```ts
const SCORM_NO_SESSION = { getValue: () => "", init: () => {} };

/**
 * Gated test data driven by `webtutor_cooldown`: the collection stub below always
 * answers with ONE matching record dated 20.05.2026, so — like the removed
 * `suspend_data_cooldown` fixture it replaces — the verdict depends on ONE
 * remaining input: "today". 30-day cooldown => available 2026-06-19.
 */
function webtutorGate() {
  return {
    id: "t1",
    title: "Курс",
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
    },
    retakePlugin: {
      runtimeEntry: "webtutorCooldown",
      config: {
        collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
        secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
        attemptFilter: {
          stateField: "state",
          stateIn: ["Пройден", "Не пройден"],
          dateField: "last_usage_date",
          dateFormat: "dd.MM.yyyy",
        },
      },
    },
  };
}
```

Then update `stubFetch` (lines 55-79) to accept an optional `records` list for the collection
response, defaulting to one record dated 20.05.2026 (the equivalent of what `SCORM_WITH_ATTEMPT`
used to report), so every existing call site that does NOT pass `records` keeps behaving the same
as before this rewrite:

```ts
function stubFetch(opts: {
  dateHeader?: string | null;
  chrome?: string;
  ok?: boolean;
  status?: number;
  records?: Array<Record<string, unknown>>;
}) {
  const calls: string[] = [];
  const bodies: Array<{ url: string; body: unknown }> = [];
  const records = opts.records ?? [{ state: "Пройден", progress: "100%", last_usage_date: "20.05.2026" }];
  vi.stubGlobal("fetch", (url: string, init?: { body?: unknown }) => {
    calls.push(String(url));
    bodies.push({ url: String(url), body: init?.body });
    const headers = { get: (k: string) => (String(k).toLowerCase() === "date" ? opts.dateHeader ?? null : null) };
    if (String(url).indexOf("extjs_json_collection_data") !== -1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers,
        json: () => Promise.resolve({ success: true, total: records.length, results: records }),
        text: () => Promise.resolve(""),
      });
    }
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      headers,
      text: () => Promise.resolve(opts.chrome ?? "ABCDEF0123456789ABCDEF0123456789"),
    });
  });
  return { calls, bodies };
}
```

(Note the `text:` default for the portal-chrome branch changed from `opts.chrome ?? ""` to also
default to a valid 32-hex SECID — every `webtutorGate()`-based test needs SECID resolution to
succeed, and the tests that specifically test SECID absence already pass `chrome: ""` explicitly, so
this default only helps the newly-converted tests.)

Now replace each `SCORM_WITH_ATTEMPT` / `suspendGate()` usage in the file's `it()` blocks with
`SCORM_NO_SESSION` / `webtutorGate()`, and each bare `stubFetch({ ... })` call in those same blocks
gets no `records` override (keeps the default one-record answer, matching the old fixture). Every
occurrence at the line numbers reported by
`grep -n "suspendGate()\|SCORM_WITH_ATTEMPT" tests/eligibility-gate-date.test.ts` (originally lines
134, 175, 178, 191, 194, 217, 219, 235, 238, 258, 261, 275, 277, 292, 295, 310, 314, 340, 399, 425)
gets the same mechanical substitution:

- `SCORM_WITH_ATTEMPT` → `SCORM_NO_SESSION`
- `suspendGate()` → `webtutorGate()`

For the ONE test whose fetch stub is built inline without going through `stubFetch` (the first test
in the file, `"hits the portal chrome once..."`, lines 128-167) — that test already uses
`webtutor_cooldown` explicitly and does not reference `suspendGate`/`SCORM_WITH_ATTEMPT`; leave it
untouched.

- [ ] **Step 6: Run the trusted-date test file**

Run: `npm test -- tests/eligibility-gate-date.test.ts`
Expected: PASS — every scenario (memoization, portal-clock-wins, degrade-to-machine-clock on
missing/unparseable header, UTC day boundary, fetch-throws, HTTP-error-with/without-Date,
diagnostic logging, countdown-from-effectiveToday, GATE_TIMEOUT_MS budget) now runs over
`webtutor_cooldown` instead of the removed plugin, with the SAME assertions (the fixture swap does
not change WHAT is asserted, only which plugin produces the date).

If any assertion fails because a test independently checks console diagnostics that name
`suspend_data_cooldown` or `suspendDataCooldown` by string (e.g. the
`"names the date source and every fallback cause on the console"` test), update that specific
string expectation to `webtutor_cooldown` / `webtutorCooldown`.

- [ ] **Step 7: Rewrite `tests/eligibility-gate-blockwall.test.ts` off `suspend_data_cooldown`**

Replace `gatedTestData()` (lines 67-79) with a `webtutor_cooldown`-based default:

```ts
function gatedTestData(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Курс",
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
    },
    retakePlugin: {
      runtimeEntry: "webtutorCooldown",
      config: {
        collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
        secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
        attemptFilter: {
          stateField: "state",
          stateIn: ["Пройден", "Не пройден"],
          dateField: "last_usage_date",
          dateFormat: "dd.MM.yyyy",
        },
      },
    },
    ...over,
  };
}
```

This file's `beforeEach` (lines 88-93) stubs `fetch` to reject (offline) — that stays as the
DEFAULT (matching the "shows the error branch (failClosed)" test's expectation of a SECID failure),
so each of the THREE tests that need a successful cooldown decision (the first, second, and fourth
`it()` blocks) must stub `fetch` locally before calling `gate.run`. Add this helper near the top of
the file (after `escapeHtml`, before `flush`):

```ts
/** Stub a successful portal chrome (SECID) + collection response with one record. */
function stubWebtutorFetch(records: Array<Record<string, unknown>>) {
  vi.stubGlobal("fetch", (url: string) => {
    if (String(url).indexOf("extjs_json_collection_data") !== -1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ success: true, total: records.length, results: records }),
        text: () => Promise.resolve(""),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve("ABCDEF0123456789ABCDEF0123456789"),
    });
  });
}
```

Then in each of the three affected tests:

1. `"renders the template system.blocked layout (cooldown branch)..."` (lines 96-148): the SCORM
   stub's `getValue` no longer needs to report `suspend_data` (webtutor_cooldown doesn't read it
   pre-verdict) — simplify it to `getValue: () => ""`, and add
   `stubWebtutorFetch([{ state: "Пройден", progress: "100%", last_usage_date: "20.05.2026" }]);`
   as the first line inside the `try` block, before `const calls: string[] = [];`.

2. `"does NOT apply barrier A to a re-entry into the current assignment"` (lines 150-188): this test
   is about `alreadyPlayedThisRegistration` short-circuiting BEFORE the plugin ever runs (the
   `suspend_data` with `attemptsUsed: 1` is what matters, not which plugin is configured) — its
   `getValue` stays exactly as-is; no `stubWebtutorFetch` call is needed since the plugin never
   evaluates on this path. No change needed here beyond `gatedTestData()` now defaulting to
   `webtutor_cooldown` (already covered by the fixture edit above).

3. `"falls back to the built-in wall when the template has no system.blocked layout"`
   (lines 226-251): same treatment as case 1 — `getValue: () => ""` and
   `stubWebtutorFetch([{ state: "Пройден", progress: "100%", last_usage_date: "20.05.2026" }]);` as
   the first line inside the `try` block.

- [ ] **Step 8: Run the block-wall test file**

Run: `npm test -- tests/eligibility-gate-blockwall.test.ts`
Expected: PASS (all four tests)

- [ ] **Step 9: Full targeted run + typecheck**

Run: `npm test -- tests/eligibility-engine-port.test.ts tests/eligibility-gate-date.test.ts tests/eligibility-gate-blockwall.test.ts`
Expected: PASS

Run: `npm run check`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add server/scorm/template/app/eligibility/gate.js shared/eligibility/plugins.ts server/scorm/template/app/eligibility/plugins.js tests/eligibility-engine-port.test.ts tests/eligibility-gate-date.test.ts tests/eligibility-gate-blockwall.test.ts tests/eligibility-plugins.test.ts
git commit -m "refactor(prd-40): remove suspend_data_cooldown runtime, migrate its tests to webtutor_cooldown"
```

---

## Task 7: Web host — outcome-aware barrier A in `decideRetake`

**Files:**

- Modify: `server/services/retake-gate.ts`
- Test: `tests/retake-gate-assignment.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/retake-gate-assignment.test.ts`, a new `describe` block at the end of the file
(after the closing `});` of `describe("countAttemptsInAssignment", ...)`):

```ts
describe("decideRetake — PRD-40 cooldownByOutcome", () => {
  const outcomePolicy = (passedDays: number, failedDays: number): RetakePolicy =>
    ({
      enabled: true,
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: passedDays,
      cooldownPeriodDaysFailed: failedDays,
      gateMode: "before_internal_start",
      eligibilityPlugin: null,
    }) as RetakePolicy;

  it("applies the PASSED period when the last attempt of the other assignment passed", () => {
    const r = decideRetake(outcomePolicy(90, 7), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z"), passed: true }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.cooldownPeriodDays).toBe(90);
    expect(r.availableDate).toBe("2026-10-29");
  });

  it("applies the FAILED period when the last attempt of the other assignment failed", () => {
    const r = decideRetake(outcomePolicy(90, 7), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z"), passed: false }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.cooldownPeriodDays).toBe(7);
    expect(r.availableDate).toBe("2026-08-07");
  });

  it("applies the LARGER period when the outcome is not recorded (passed omitted)", () => {
    const r = decideRetake(outcomePolicy(7, 90), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z") }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.cooldownPeriodDays).toBe(90);
  });

  it("picks the outcome of the LATEST outside attempt, not an earlier one", () => {
    const r = decideRetake(outcomePolicy(90, 7), {
      currentAssignmentId: "a3",
      attempts: [
        { assignmentId: "a1", finishedAt: new Date("2026-06-01T00:00:00.000Z"), passed: true },
        { assignmentId: "a2", finishedAt: new Date("2026-07-31T12:00:00.000Z"), passed: false },
      ],
      now: NOW,
    });
    expect(r.cooldownPeriodDays).toBe(7);
  });

  it("cooldownByOutcome off ignores passed and uses cooldownPeriodDays (unchanged behaviour)", () => {
    const r = decideRetake(policy(), {
      currentAssignmentId: "a2",
      attempts: [{ assignmentId: "a1", finishedAt: new Date("2026-07-31T12:00:00.000Z"), passed: false }],
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.cooldownPeriodDays).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/retake-gate-assignment.test.ts`
Expected: FAIL — TypeScript error (`passed` is not a known property of the attempt object literal)
and/or `r.cooldownPeriodDays` not matching (barrier A still always reads `cooldownPeriodDays`
directly)

- [ ] **Step 3: Implement**

In `server/services/retake-gate.ts`:

1. Add `passed` to `AttemptFact` (lines 31-35), as an OPTIONAL field so every existing caller/test
   literal without it keeps compiling unchanged:

```ts
/** One attempt as the decision sees it. */
export interface AttemptFact {
  assignmentId: string | null;
  finishedAt: Date | string | null;
  /** PRD-40: outcome of this attempt, when known. Absent/null = outcome undetermined. */
  passed?: boolean | null;
}
```

1. Add the import of `resolveCooldownDays` (line 23-28 import block):

```ts
import {
  attemptIntervalDecision,
  cooldownDecision,
  daysUntilDate,
  formatIsoInstant,
  resolveCooldownDays,
} from "@shared/eligibility/engine";
```

1. Replace `lastCompletedAttemptDate` (lines 69-80) — keep it (still used elsewhere, e.g.
   `resultsPage`-adjacent code may rely on it) but add a sibling that also returns the outcome. Add
   right after it:

```ts
/** Most recent completed attempt (date + outcome), or null when none. */
function lastCompletedAttempt(
  attempts: AttemptFact[],
): { finishedAt: Date; passed: boolean | null } | null {
  let best: { finishedAt: Date; passed: boolean | null } | null = null;
  for (const a of attempts) {
    if (!a.finishedAt) continue;
    const t = new Date(a.finishedAt);
    if (!Number.isFinite(t.getTime())) continue;
    if (!best || t.getTime() > best.finishedAt.getTime()) {
      best = { finishedAt: t, passed: a.passed ?? null };
    }
  }
  return best;
}
```

1. The top-of-function guard needs fixing FIRST, for a reason specific to this task: with
   `cooldownByOutcome: true` and no `cooldownPeriodDays`, the existing `cooldownDays` local (line
   114) resolves to `undefined` even though barrier A IS configured (via the split fields) — so the
   OLD guard (`if (cooldownDays == null && intervalHours == null) return { allowed: true };`) would
   wrongly treat an outcome-split policy with no interval barrier as fully inert. Replace lines
   114-117:

```ts
  const cooldownDays = retakePolicy?.enabled === true ? retakePolicy.cooldownPeriodDays : undefined;
  const cooldownConfigured =
    retakePolicy?.enabled === true && (cooldownDays != null || retakePolicy.cooldownByOutcome === true);
  const intervalHours =
    retakePolicy?.attemptInterval?.enabled === true ? retakePolicy.attemptInterval.hours : undefined;
  if (!cooldownConfigured && intervalHours == null) return { allowed: true };
```

1. In `decideRetake` (lines 110-160), replace the barrier-A branch (the last block of the
   function, from the `// The FIRST attempt of this assignment` comment on line 143 through the end):

```ts
  // The FIRST attempt of this assignment: barrier A only, measured against attempts
  // of every OTHER assignment (the legacy NULL bucket counts as one of them).
  if (!cooldownConfigured) return { allowed: true };
  const outside = finished.filter((a) => a.assignmentId !== facts.currentAssignmentId);
  const lastOutside = lastCompletedAttempt(outside);
  const lastAttemptDate = lastOutside ? toIsoDateUTC(lastOutside.finishedAt) : null;
  const resolvedDays = resolveCooldownDays(
    { cooldownPeriodDays: cooldownDays, ...(retakePolicy ?? {}) },
    lastOutside?.passed ?? null,
  );
  if (resolvedDays == null) return { allowed: true };
  const decision = cooldownDecision(lastAttemptDate, toIsoDateUTC(facts.now), resolvedDays);
  if (decision.allowed) return { allowed: true };
  return {
    allowed: false,
    blockedBy: "cooldown",
    reason: "cooldown_active",
    cooldownPeriodDays: resolvedDays,
    lastAttemptDate,
    availableDate: decision.availableDate,
    availableAt: null,
    daysUntil: daysUntilDate(decision.availableDate, decision.effectiveToday),
  };
```

   (`{ cooldownPeriodDays: cooldownDays, ...(retakePolicy ?? {}) }` — spreading AFTER the explicit
   `cooldownPeriodDays` key means `retakePolicy.cooldownPeriodDays` — the SAME value `cooldownDays`
   was already read from at the top of the function — naturally wins if present; `?? {}` keeps the
   spread type-safe against `retakePolicy: RetakePolicy | null | undefined` without an unsafe cast,
   even though `cooldownConfigured` guarantees `retakePolicy` is non-null whenever this line runs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/retake-gate-assignment.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Run the sibling retake-gate test file too (regression check)**

Run: `npm test -- tests/retake-gate.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck and commit**

Run: `npm run check`
Expected: no errors

```bash
git add server/services/retake-gate.ts tests/retake-gate-assignment.test.ts
git commit -m "feat(prd-40): web barrier A resolves the cooldown period by last attempt's outcome"
```

---

## Task 8: Wire `passed` into the 4 `AttemptFact` construction sites

**Files:**

- Modify: `server/routes/attempts.ts:239-242,348-351,535-538`
- Modify: `server/services/home/assigned.ts:58-61`

- [ ] **Step 1: Implement**

In `server/routes/attempts.ts`, apply the SAME edit at all three locations — replace:

```ts
        const attemptFacts = userAttempts.map((a) => ({
          assignmentId: a.assignmentId,
          finishedAt: a.finishedAt,
        }));
```

(at line ~239, inside the `assignedTests.map` handler) with:

```ts
        const attemptFacts = userAttempts.map((a) => ({
          assignmentId: a.assignmentId,
          finishedAt: a.finishedAt,
          // PRD-40: outcome of THIS attempt, for barrier A's outcome-split cooldown.
          passed: (a.resultJson as AttemptResult | null)?.overallPassed ?? null,
        }));
```

and replace the two identical occurrences (currently at lines 348-351 and 535-538 — both already
commented "Deliberately identical... must stay word-for-word the same"):

```ts
      const attemptFacts = userAttempts.map((a) => ({
        assignmentId: a.assignmentId,
        finishedAt: a.finishedAt,
      }));
```

with:

```ts
      const attemptFacts = userAttempts.map((a) => ({
        assignmentId: a.assignmentId,
        finishedAt: a.finishedAt,
        // PRD-40: outcome of THIS attempt, for barrier A's outcome-split cooldown.
        passed: (a.resultJson as AttemptResult | null)?.overallPassed ?? null,
      }));
```

In `server/services/home/assigned.ts`, replace (lines 58-61):

```ts
      const attemptFacts = attempts.map((a) => ({
        assignmentId: a.assignmentId,
        finishedAt: a.finishedAt,
      }));
```

with:

```ts
      const attemptFacts = attempts.map((a) => ({
        assignmentId: a.assignmentId,
        finishedAt: a.finishedAt,
        // PRD-40: outcome of THIS attempt, for barrier A's outcome-split cooldown.
        passed: (a.resultJson as AttemptResult | null)?.overallPassed ?? null,
      }));
```

(`AttemptResult` is already imported in both files — confirmed: `server/routes/attempts.ts` line 55,
`server/services/home/assigned.ts` line 11.)

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors

- [ ] **Step 3: Run the route-level regression tests**

Run: `npm test -- tests/routes.attempts-tests.test.ts`
Expected: PASS (no behavioural change for tests without `cooldownByOutcome`: `passed` is only
consulted when `resolveCooldownDays` sees `cooldownByOutcome === true`, per Task 7)

- [ ] **Step 4: Commit**

```bash
git add server/routes/attempts.ts server/services/home/assigned.ts
git commit -m "feat(prd-40): thread attempt outcome into AttemptFact at every construction site"
```

---

## Task 9: SCORM export — bake the new fields into `TEST_DATA`

**Files:**

- Modify: `server/scorm/builders/test-json.ts:344-353`
- Test: `tests/scorm-attempt-interval-bundling.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/scorm-attempt-interval-bundling.test.ts` already has the exact fixture this needs: a
`bake(retakePolicyJson)` helper (calls `buildTestJson` and returns the parsed
`{ retakePolicy?, retakePlugin? }`) and a `cooldownPolicy` constant. Add a new test at the end of
the `describe("SCORM bake — access barriers", ...)` block (after the last `it`, before its closing
`});`):

```ts
  it("bakes cooldownByOutcome + the split periods (PRD-40)", () => {
    const baked = bake({
      enabled: true,
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
      gateMode: "before_internal_start",
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
    } as unknown as RetakePolicy);
    expect(baked.retakePolicy).toMatchObject({
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
    });
    expect(baked.retakePolicy?.cooldownPeriodDays).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/scorm-attempt-interval-bundling.test.ts`
Expected: FAIL — `baked.retakePolicy?.cooldownByOutcome` is `undefined`

- [ ] **Step 3: Implement**

In `server/scorm/builders/test-json.ts`, replace lines 344-353:

```ts
    test.retakePolicy = {
      // `enabled` stays the COOLDOWN's switch: RetakeGate.isGated reads it, and an
      // interval-only test must not look gated to the pre-Initialize gate.
      enabled: rp.enabled === true && !!gatePlugin,
      cooldownPeriodDays: rp.cooldownPeriodDays,
      gateMode: rp.gateMode,
      eligibilityPlugin: gatePlugin ? rp.eligibilityPlugin : null,
      blockedPageId: rp.blockedPageId ?? null,
      ...(intervalOn ? { attemptInterval: rp.attemptInterval } : {}),
    };
```

with:

```ts
    test.retakePolicy = {
      // `enabled` stays the COOLDOWN's switch: RetakeGate.isGated reads it, and an
      // interval-only test must not look gated to the pre-Initialize gate.
      enabled: rp.enabled === true && !!gatePlugin,
      cooldownPeriodDays: rp.cooldownPeriodDays,
      // PRD-40: outcome-split cooldown. Baked unconditionally like cooldownPeriodDays
      // above — JSON.stringify drops the `undefined` ones for a non-split policy, so
      // this does not affect the byte-identical-export guarantee (FR-02/FR-14).
      cooldownByOutcome: rp.cooldownByOutcome,
      cooldownPeriodDaysPassed: rp.cooldownPeriodDaysPassed,
      cooldownPeriodDaysFailed: rp.cooldownPeriodDaysFailed,
      gateMode: rp.gateMode,
      eligibilityPlugin: gatePlugin ? rp.eligibilityPlugin : null,
      blockedPageId: rp.blockedPageId ?? null,
      ...(intervalOn ? { attemptInterval: rp.attemptInterval } : {}),
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/scorm-builders.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

Run: `npm run check`
Expected: no errors

```bash
git add server/scorm/builders/test-json.ts tests/scorm-builders.test.ts
git commit -m "feat(prd-40): bake cooldownByOutcome + split periods into the SCORM TEST_DATA"
```

---

## Task 10: Author UI — toggle + split fields, drop the best-effort banner

**Files:**

- Modify: `client/src/features/tests/editor/sections/basic-settings-section.tsx:606-850` (`RetakePane`)
- Modify: `client/src/features/tests/editor/test-editor.mappers.ts:825-905`
- Test: `client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx`
- Test: `client/src/features/tests/editor/sections/__tests__/basic-settings-section.coverage.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `basic-settings-section.test.tsx`, inside the existing
`describe("<SettingsSection /> — Повторное прохождение pane (PRD-6)", ...)` block:

1. Replace the `"shows the best-effort warning for the suspend_data plugin"` test (lines 885-890)
   — it tests a banner this task removes — with nothing (delete it).

2. Add these new tests right after `"renders cooldown / plugin / failPolicy and no warning for
   webtutor"` (after line 883, before the deleted test used to sit):

```ts
  it("shows the outcome-split switch off by default, only the single field visible", () => {
    renderRetake(enabledPolicy());
    expect(screen.getByTestId("settings-retake-outcome-switch")).toBeInTheDocument();
    expect(screen.getByTestId("settings-retake-cooldown-input")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-retake-cooldown-passed-input")).toBeNull();
    expect(screen.queryByTestId("settings-retake-cooldown-failed-input")).toBeNull();
  });

  it("turning the outcome-split switch on swaps the single field for two", () => {
    const updateModel = vi.fn();
    const model = enabledPolicy();
    renderRetake(model, updateModel);
    fireEvent.click(screen.getByTestId("settings-retake-outcome-switch"));
    const next = runUpdater(updateModel, model);
    expect(next.retakePolicy.cooldownByOutcome).toBe(true);
  });

  it("renders both split fields once the switch is on, seeded from defaults", () => {
    renderRetake(
      enabledPolicy({ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }),
    );
    expect(screen.queryByTestId("settings-retake-cooldown-input")).toBeNull();
    const passedInput = screen.getByTestId("settings-retake-cooldown-passed-input") as HTMLInputElement;
    const failedInput = screen.getByTestId("settings-retake-cooldown-failed-input") as HTMLInputElement;
    expect(passedInput.value).toBe("90");
    expect(failedInput.value).toBe("7");
  });

  it("edits the passed/failed periods independently and clamps into [1, 3650]", () => {
    const updateModel = vi.fn();
    const model = enabledPolicy({
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
    });
    renderRetake(model, updateModel);
    fireEvent.change(screen.getByTestId("settings-retake-cooldown-passed-input"), { target: { value: "5000" } });
    expect(runUpdater(updateModel, model).retakePolicy.cooldownPeriodDaysPassed).toBe(3650);
    fireEvent.change(screen.getByTestId("settings-retake-cooldown-failed-input"), { target: { value: "0" } });
    expect(runUpdater(updateModel, model, 1).retakePolicy.cooldownPeriodDaysFailed).toBe(1);
  });
```

Task 1 added `cooldownByOutcome` to `RetakePolicy` via a Zod `.default(false)` field, which makes
it REQUIRED (not optional) in the schema's inferred output TYPE — the same way the pre-existing
`enabled`/`gateMode` fields are required despite also carrying a `.default()`. Two local test
helpers in this file hand-build a `RetakePolicy`-typed object literal (bypassing `.parse()`, which
is what normally fills defaults) and now fail to typecheck without this field. Fix both as part of
this step:

1. `enabledPolicy()` (lines 848-857) — add `cooldownByOutcome: false` to its base object, right
   after `cooldownPeriodDays: 30`:

```ts
  const enabledPolicy = (over: Partial<TestEditorModel["retakePolicy"]> = {}) => ({
    ...baseModel(),
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 30,
      cooldownByOutcome: false,
      gateMode: "before_internal_start" as const,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" as const },
      ...over,
    },
  });
```

- [ ] **Step 1b: Run typecheck to confirm this specific helper is fixed**

Run: `npm run check`
Expected: the 4 errors previously reported at
`basic-settings-section.test.tsx:878,887,895,897` are gone; the 2 errors in
`test-editor.mappers.ts:821,892` (fixed in Step 4 of this task) and the 1 error in
`basic-settings-section.coverage.test.tsx:460` (fixed below) may still be present at this point —
that is expected mid-task.

In `basic-settings-section.coverage.test.tsx`, replace the
`"selecting the suspend_data plugin updates the key and shows the best-effort warning"` test
(lines 488-498) and its `plugins` fixture (lines 450-455) — the fixture's second entry existed only
to exercise the now-removed banner. Also fix `enabledModel()` (lines 457-468) the same way as
`enabledPolicy()` above — add `cooldownByOutcome: false` to its base object, right after
`cooldownPeriodDays: 30`. Replace all three (the `plugins` fixture, the deleted test, and
`enabledModel()`):

```ts
  const plugins = {
    plugins: [
      { key: "webtutor_cooldown", name: "WebTutor", version: "1", description: "", bestEffort: false, configs: [] },
      { key: "suspend_data_cooldown", name: "Suspend data", version: "1", description: "", bestEffort: true, configs: [] },
    ],
  };
```

with:

```ts
  const plugins = {
    plugins: [
      { key: "webtutor_cooldown", name: "WebTutor", version: "1", description: "", bestEffort: false, configs: [] },
    ],
  };
```

and delete the `"selecting the suspend_data plugin updates the key and shows the best-effort
warning"` test entirely (no replacement — plugin selection with a single option is already
implicitly covered by `"updates the cooldown period from the number input"` rendering the plugin
select; a dedicated multi-option selection test is out of scope now that the registry has one
plugin, matching the design decision to leave the select as-is without adding new coverage for it).

Also replace `enabledModel()` (lines 457-468):

```ts
  function enabledModel(over: Partial<TestEditorModel["retakePolicy"]> = {}) {
    return baseModel({
      id: "test-1",
      retakePolicy: {
        enabled: true,
        cooldownPeriodDays: 30,
        gateMode: "before_internal_start",
        eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
        ...over,
      },
    });
  }
```

with:

```ts
  function enabledModel(over: Partial<TestEditorModel["retakePolicy"]> = {}) {
    return baseModel({
      id: "test-1",
      retakePolicy: {
        enabled: true,
        cooldownPeriodDays: 30,
        cooldownByOutcome: false,
        gateMode: "before_internal_start",
        eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
        ...over,
      },
    });
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx client/src/features/tests/editor/sections/__tests__/basic-settings-section.coverage.test.tsx`
Expected: FAIL — `settings-retake-outcome-switch` / `settings-retake-cooldown-passed-input` /
`settings-retake-cooldown-failed-input` do not exist yet

- [ ] **Step 3: Implement the component**

In `client/src/features/tests/editor/sections/basic-settings-section.tsx`, inside `RetakePane`:

1. Add a `setOutcome` helper next to the existing `setPolicy`/`setInterval`/`setPlugin` helpers
   (after `setPolicy`, around line 649):

```ts
  // PRD-40: outcome-split cooldown. Independent toggle inside the SAME cooldown
  // group (unlike attemptInterval, this does not stand on its own without `enabled`).
  const cooldownByOutcome = policy.cooldownByOutcome === true;
```

1. Replace the single cooldown `NumberInput` block (lines 713-731) with a switch-guarded pair —
   the switch sits right after it, the two split fields replace the single field when on:

```tsx
          {!cooldownByOutcome && (
            <div className="ou-formfield">
              <NumberInput
                id="settings-retake-cooldown"
                size="m"
                label="Период охлаждения, календарных дней"
                hint="От 1 до 3650 дней."
                value={policy.cooldownPeriodDays ?? 30}
                min={1}
                max={3650}
                data-testid="settings-retake-cooldown-input"
                onChange={(next) =>
                  setPolicy({ cooldownPeriodDays: Math.min(3650, Math.max(1, next || 1)) })
                }
              />
            </div>
          )}

          <label className="ou-switch-field">
            <Switch
              size="m"
              checked={cooldownByOutcome}
              aria-label="Разделять период по результату попытки"
              onChange={(e) => setPolicy({ cooldownByOutcome: e.target.checked })}
              data-testid="settings-retake-outcome-switch"
            />
            <span className="ou-switch-field__text">
              <span className="ou-switch-field__label">Разделять период по результату попытки</span>
              <span className="ou-switch-field__desc">
                {cooldownByOutcome
                  ? "Разный период охлаждения в зависимости от того, пройден тест или нет."
                  : "Выключено — один период охлаждения для любого исхода."}
              </span>
            </span>
          </label>

          {cooldownByOutcome && (
            <>
              <div className="ou-formfield">
                <NumberInput
                  id="settings-retake-cooldown-passed"
                  size="m"
                  label="При успешном прохождении, дней"
                  hint="От 1 до 3650 дней."
                  value={policy.cooldownPeriodDaysPassed ?? 30}
                  min={1}
                  max={3650}
                  data-testid="settings-retake-cooldown-passed-input"
                  onChange={(next) =>
                    setPolicy({ cooldownPeriodDaysPassed: Math.min(3650, Math.max(1, next || 1)) })
                  }
                />
              </div>
              <div className="ou-formfield">
                <NumberInput
                  id="settings-retake-cooldown-failed"
                  size="m"
                  label="При неуспешном прохождении, дней"
                  hint="От 1 до 3650 дней."
                  value={policy.cooldownPeriodDaysFailed ?? 30}
                  min={1}
                  max={3650}
                  data-testid="settings-retake-cooldown-failed-input"
                  onChange={(next) =>
                    setPolicy({ cooldownPeriodDaysFailed: Math.min(3650, Math.max(1, next || 1)) })
                  }
                />
              </div>
            </>
          )}
```

1. Remove the best-effort banner. Delete the `isBestEffort` computation (lines 644-645):

```ts
  const isBestEffort =
    selectedPlugin?.bestEffort ?? currentKey === "suspend_data_cooldown";
```

and delete its JSX block (lines 746-753):

```tsx
          {isBestEffort && (
            <Banner
              tone="warning"
              size="sm"
              description="Надёжно работает только в пределах одной регистрации курса в LMS. Для строгого ограничения между новыми попытками используйте проверку через WebTutor."
              data-testid="settings-retake-besteffort-warning"
            />
          )}
```

   (`selectedPlugin` itself — computed at line 643 — stays; it is still used by the
   `currentKey === "webtutor_cooldown"` name-matching Banner right below the deleted block. If
   `selectedPlugin` becomes otherwise unused after this deletion, remove it too — check with a
   search for `selectedPlugin` after this edit; it is NOT otherwise referenced, so remove line 643
   (`const selectedPlugin = plugins.find((p) => p.key === currentKey);`) as well.)

1. Update the JSDoc comment above `RetakePane` (lines 618-629) to mention the new control (the
   `NumberInput` line already documents `cooldownPeriodDays` — extend it):

```ts
/**
 * «Повторное прохождение» pane (PRD-6, wireframe `prd6-retake-policy.html`).
 * Binds `model.retakePolicy`:
 *   - Switch        → `enabled` (off = legacy behaviour, FR-02)
 *   - NumberInput   → `cooldownPeriodDays` (1–3650 calendar days), OR — when the
 *     PRD-40 `cooldownByOutcome` switch is on — two NumberInputs bound to
 *     `cooldownPeriodDaysPassed` / `cooldownPeriodDaysFailed` instead
 *   - Select        → `eligibilityPlugin.key` (active registry; one config per
 *                     plugin auto-resolved server-side in Phase 1)
 *   - SegmentedControl → `eligibilityPlugin.failPolicy` (failOpen / failClosed)
 *
 * The plugin list is global; we query it by `model.id` (the test scope is only
 * for auth). PRD-40 removed the second (best-effort) plugin, so the registry now
 * has exactly one entry — the select is kept for forward compatibility rather than
 * simplified away.
 */
```

- [ ] **Step 4: Implement the mapper**

In `client/src/features/tests/editor/test-editor.mappers.ts`:

1. Update `defaultRetakePolicy()` (lines 825-833) to include the new default:

```ts
export function defaultRetakePolicy(): RetakePolicy {
  return {
    enabled: false,
    cooldownPeriodDays: 30,
    cooldownByOutcome: false,
    gateMode: "before_internal_start",
    eligibilityPlugin: null,
    attemptInterval: null,
  };
}
```

1. In `readRetakePolicyFromApi` (lines 862-905), add reading of the three new fields. After the
   `cooldownRaw` block (lines 867-872), add:

```ts
  const cooldownByOutcome = r.cooldownByOutcome === true;
  const cooldownPassedRaw = typeof r.cooldownPeriodDaysPassed === "number" ? r.cooldownPeriodDaysPassed : 30;
  const cooldownFailedRaw = typeof r.cooldownPeriodDaysFailed === "number" ? r.cooldownPeriodDaysFailed : 30;
```

Then update the returned object (lines 897-904) to include them:

```ts
  return {
    enabled: r.enabled === true,
    cooldownPeriodDays: clampCooldown(cooldownRaw),
    cooldownByOutcome,
    cooldownPeriodDaysPassed: clampCooldown(cooldownPassedRaw),
    cooldownPeriodDaysFailed: clampCooldown(cooldownFailedRaw),
    gateMode: "before_internal_start",
    eligibilityPlugin,
    attemptInterval,
    ...(typeof r.blockedPageId === "string" ? { blockedPageId: r.blockedPageId } : {}),
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx client/src/features/tests/editor/sections/__tests__/basic-settings-section.coverage.test.tsx`
Expected: PASS

Run: `npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts`
Expected: PASS (regression check — these files exercise `readRetakePolicyFromApi`/
`defaultRetakePolicy` for the pre-existing fields; confirm nothing there hard-asserts the exact
shape of the returned object in a way the new keys would break, e.g. `toEqual` instead of
`toMatchObject`. If a `toEqual` assertion breaks because it no longer matches the now-larger
object, update that assertion to include the three new default keys.)

- [ ] **Step 6: Typecheck and commit**

Run: `npm run check`
Expected: no errors

```bash
git add client/src/features/tests/editor/sections/basic-settings-section.tsx client/src/features/tests/editor/test-editor.mappers.ts client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx client/src/features/tests/editor/sections/__tests__/basic-settings-section.coverage.test.tsx
git commit -m "feat(prd-40): author UI — outcome-split cooldown switch + fields, drop best-effort banner"
```

---

## Task 11: Docs — PRD-6 spec cleanup + CHANGELOG

**Files:**

- Modify: `docs/specs/prd-6/retake-cooldown-gate.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the PRD-6 spec**

In `docs/specs/prd-6/retake-cooldown-gate.md`:

1. In §3.5 "Plugin registry" (around line 210-235), remove the `suspend_data_cooldown` entry from
   the example JSON array (keep `webtutor_cooldown` and `custom`), and add a note after the
   example:

```markdown
> Начиная с [PRD-40](../prd-40/cooldown-by-outcome.md) (2026-08-04) `suspend_data_cooldown` удалён
> из реестра: в проде им не пользовался ни один тест, и добавлять ему разделение кулдауна по
> исходу означало бы поддерживать код, которым никто не пользуется. `webtutor_cooldown` — теперь
> единственный сидированный плагин.
```

1. Replace §4.6 "`suspend_data` как источник" (the whole section, its heading through its closing
   paragraph) with:

```markdown
### 4.6 `suspend_data` как источник (удалено)

Плагин `suspend_data_cooldown`, ранее описанный здесь как best-effort источник даты внутри одной
SCORM registration, удалён [PRD-40](../prd-40/cooldown-by-outcome.md) (2026-08-04) — в проде им не
пользовался ни один тест. Best-effort различение внутри одной регистрации по-прежнему покрыто
`alreadyPlayedThisRegistration` (§9.1) — оно не зависело от этого плагина.
```

1. In §11 "Решённые вопросы", the row about `suspend_data` reliability stays (it is still true
   historically), but add one more row:

```markdown
| Остаётся ли `suspend_data_cooldown` после PRD-40? | Нет, удалён целиком (реестр, рантайм, панель автора) — не использовался ни одним тестом в проде |
```

- [ ] **Step 2: Add the CHANGELOG entry**

Read the top of `CHANGELOG.md` first to match its exact current format:

Run: `head -30 CHANGELOG.md`

Add a new entry at the top (under the most recent existing heading, following whatever
heading/list format that read reveals — typically a dated or versioned section with a bullet list).
The bullet content:

```markdown
- PRD-40: период охлаждения между назначениями (барьер A) можно разделить на два значения —
  для успешного и неуспешного исхода последней попытки предыдущего назначения — за явным
  переключателем «Разделять период по результату попытки» (по умолчанию выключен). Плагин
  `suspend_data_cooldown` удалён из реестра eligibility-плагинов как неиспользуемый.
```

- [ ] **Step 3: Verify markdown lint (per CLAUDE.md — no emoji, markdownlint-clean)**

Run: `npx markdownlint docs/specs/prd-6/retake-cooldown-gate.md CHANGELOG.md docs/specs/prd-40/cooldown-by-outcome.md`
Expected: no errors (fix any reported issues — commonly heading-level or trailing-whitespace)

- [ ] **Step 4: Commit**

```bash
git add docs/specs/prd-6/retake-cooldown-gate.md CHANGELOG.md
git commit -m "docs(prd-40): retire suspend_data_cooldown from PRD-6 spec, changelog entry"
```

---

## Task 12: Full targeted regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run every test file this plan touched, together**

Run:

```bash
npm test -- tests/schema-prd6-retake.test.ts tests/eligibility-engine-port.test.ts tests/eligibility-gate-date.test.ts tests/eligibility-gate-blockwall.test.ts tests/retake-gate-assignment.test.ts tests/retake-gate.test.ts tests/routes.attempts-tests.test.ts tests/scorm-builders.test.ts client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx client/src/features/tests/editor/sections/__tests__/basic-settings-section.coverage.test.tsx client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts client/src/features/tests/editor/__tests__/test-editor.mappers.branches.test.ts
```

Expected: all PASS

- [ ] **Step 2: Full typecheck**

Run: `npm run check`
Expected: no errors

- [ ] **Step 3: Report, do not run the full suite or coverage on your own initiative**

Per `CLAUDE.md` ("Concurrent sessions"): do NOT run `npm test` (full) or `npm run test:cov` without
explicit go-ahead from the user — this working copy is shared with other concurrent sessions.
Report the targeted results above and ask before any full run.

No commit in this task — it is a verification checkpoint, not a code change.
