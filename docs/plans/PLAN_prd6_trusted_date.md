# PRD-6: доверенный источник даты кулдауна — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Сегодня» для retake-кулдауна в SCORM-пакете берётся из часов сервера LMS (HTTP-заголовок `Date`), а не с
машины ученика, поэтому перевод системной даты вперёд больше не снимает блокировку.

**Architecture:** Гейт пакета уже ходит на портал same-origin за SECID и за учебными записями. Запрос страницы
портала мемоизируется, из его ответа читается заголовок `Date`, из него — UTC-календарный день; при недоступности
заголовка откат на клиентские часы (текущее поведение). Общая математика (клэмп «сегодня» и обратный отсчёт)
переезжает в общий движок `shared/eligibility/engine.ts` с плайн-JS-твином, чтобы оба хоста считали одинаково.
Веб-хост уже решает по серверным часам — там убирается последнее клиентское чтение `new Date()`.

**Tech Stack:** TypeScript, vitest (jsdom), плайн-JS рантайм SCORM-пакета (ES5-стиль, без сборки), Express
(`scripts/scorm-player.mjs` — локальный стенд), React (веб-хост учащегося).

**Спека:** [docs/specs/prd-6/cooldown-trusted-date.md](../specs/prd-6/cooldown-trusted-date.md).

---

## Структура файлов

Изменяемые:

- `shared/eligibility/engine.ts` — общая математика: клэмп «сегодня» в `cooldownDecision`, новая `daysUntilDate`.
- `server/scorm/template/app/eligibility/engine.js` — плайн-JS-твин того же (golden-паритет).
- `server/scorm/template/app/eligibility/gate.js` — мемоизированный запрос портала, резолв «сегодня» из
  заголовка `Date`, асинхронный `buildContext`, диагностика источника даты.
- `server/services/retake-gate.ts` — `daysUntil` в результате `decideRetake`.
- `server/routes/attempts.ts` — `daysUntil` в блоке `retakeGate` стартового экрана.
- `client/src/pages/learner/take-test.tsx` — `daysUntil` приходит с сервера.
- `client/src/pages/learner/cooldown-format.ts` — удаляется `daysUntilIsoDate` (последнее чтение локальных часов).
- `scripts/scorm-player.mjs` — управляемые часы стенда (заголовок `Date`).

Тесты:

- `tests/eligibility-engine.test.ts` — поведение клэмпа и `daysUntilDate`.
- `tests/eligibility-engine-port.test.ts` — паритет TS и JS-твина.
- `tests/eligibility-gate-date.test.ts` — НОВЫЙ: резолв даты в гейте, деградация, мемоизация.
- `tests/eligibility-gate-blockwall.test.ts` — заглушка `fetch` (гейт стал ходить в сеть).
- `tests/retake-gate.test.ts` — `daysUntil` в решении сервера.
- `client/src/pages/learner/__tests__/cooldown-format.test.ts` — снятие тестов удалённой функции.
- `client/src/pages/learner/__tests__/take-test.test.tsx` — `daysUntil` доезжает из 403 в контекст экрана.

Команды: юнит-тесты гонять точечно через `node_modules/.bin/vitest run <файл>`; полный прогон — `npm test`
(порог покрытия 80%). Параллельно с `npm test` точечный vitest НЕ запускать (общий каталог coverage/.tmp).

---

## Task 0: Пре-флайт — origin фрейма курса

Блокирует Tasks 3-5 (SCORM). Tasks 1-2 от него не зависят и делаются в любом случае.

**Files:** нет (ручная проверка).

- [ ] **Шаг 1: Выполнить проверку на портале**

Открыть `https://university.rt.ru`, открыть любой курс, в консоли ВЕРХНЕГО фрейма выполнить:

```js
Array.from(document.querySelectorAll('iframe')).forEach((f) =>
  console.log(f.src ? new URL(f.src, location.href).origin : '(about:blank)', '|', f.src));
```

- [ ] **Шаг 2: Оценить результат**

Ожидание: в выводе `https://university.rt.ru`. Тогда пакет исполняется same-origin с порталом, Tasks 3-5
выполняются как написано.

Если появился ДРУГОЙ хост — остановиться и доложить: это означает, что существующий `webtutor_cooldown` (скрап
SECID + POST коллекции) на живом портале работать не может, и §4.2 основной спеки PRD-6 требует пересмотра.
Tasks 3-5 в этом случае не начинать.

---

## Task 1: Общая математика — клэмп «сегодня» и `daysUntilDate`

**Files:**

- Modify: `shared/eligibility/engine.ts`
- Modify: `server/scorm/template/app/eligibility/engine.js`
- Test: `tests/eligibility-engine.test.ts`, `tests/eligibility-engine-port.test.ts`

- [ ] **Шаг 1: Написать падающие тесты**

Добавить в конец `tests/eligibility-engine.test.ts`:

```ts
describe("cooldownDecision — недоверенные часы", () => {
  it("нормализует «сегодня» раньше даты последней попытки до самой попытки", () => {
    // Machine clock rolled back behind the last attempt: impossible state, so the
    // clock is not trusted and the cooldown runs its full length from the attempt.
    const rolledBack = cooldownDecision("2026-05-20", "2026-05-01", 30);
    expect(rolledBack.allowed).toBe(false);
    expect(rolledBack.daysSince).toBe(0);
    expect(rolledBack.availableDate).toBe("2026-06-19");
  });

  it("не трогает нормальный порядок дат", () => {
    expect(cooldownDecision("2026-05-20", "2026-06-19", 30)).toEqual({
      allowed: true,
      availableDate: "2026-06-19",
      daysSince: 30,
    });
  });
});

describe("daysUntilDate", () => {
  it("считает целые дни до будущей даты", () => {
    expect(daysUntilDate("2026-06-30", "2026-06-28")).toBe(2);
  });

  it("возвращает null для сегодня и прошлого", () => {
    expect(daysUntilDate("2026-06-30", "2026-06-30")).toBeNull();
    expect(daysUntilDate("2026-06-29", "2026-06-30")).toBeNull();
  });

  it("возвращает null для пустого и неразбираемого входа", () => {
    expect(daysUntilDate(null, "2026-06-30")).toBeNull();
    expect(daysUntilDate("garbage", "2026-06-30")).toBeNull();
    expect(daysUntilDate("2026-06-30", "garbage")).toBeNull();
  });
});
```

В шапке файла (строки 8-17) добавить `daysUntilDate` в существующий импорт; `cooldownDecision` там уже есть:

```ts
import {
  parseIsoDate,
  formatIsoDate,
  cooldownDecision,
  daysUntilDate,
  normalizeVerdict,
  applyFailPolicy,
  buildRetakeState,
  evaluateEligibility,
  CORE_DEFAULT_RESULT,
} from "../shared/eligibility/engine";
```

Добавить в `tests/eligibility-engine-port.test.ts` внутрь `describe("eligibility engine — TS ↔ JS port parity")`:

```ts
  it("cooldownDecision matches when the clock is rolled back", () => {
    const cases: Array<[string | null, string, number]> = [
      ["2026-05-20", "2026-05-01", 30],
      ["2026-05-20", "2026-05-20", 30],
    ];
    for (const [last, today, days] of cases) {
      expect(port.EligibilityEngine.cooldownDecision(last, today, days)).toEqual(
        tsEngine.cooldownDecision(last, today, days),
      );
    }
  });

  it("daysUntilDate matches", () => {
    const cases: Array<[string | null, string]> = [
      ["2026-06-30", "2026-06-28"],
      ["2026-06-30", "2026-06-30"],
      ["2026-06-29", "2026-06-30"],
      [null, "2026-06-30"],
      ["garbage", "2026-06-30"],
    ];
    for (const [iso, today] of cases) {
      expect(port.EligibilityEngine.daysUntilDate(iso, today)).toEqual(tsEngine.daysUntilDate(iso, today));
    }
  });
```

- [ ] **Шаг 2: Убедиться, что тесты падают**

```bash
node_modules/.bin/vitest run tests/eligibility-engine.test.ts tests/eligibility-engine-port.test.ts
```

Ожидание: FAIL — `daysUntilDate is not a function` / `is not exported`, и падение теста про откат часов.

- [ ] **Шаг 3: Реализовать в TS-движке**

В `shared/eligibility/engine.ts` заменить тело `cooldownDecision`:

```ts
export function cooldownDecision(
  lastAttemptDate: string | null,
  todayDate: string,
  cooldownPeriodDays: number,
): CooldownDecision {
  const parsedToday = parseIsoDate(todayDate);
  const last = lastAttemptDate ? parseIsoDate(lastAttemptDate) : null;
  if (last == null || parsedToday == null) {
    return { allowed: true, availableDate: null, daysSince: null };
  }
  // A "today" that precedes the last attempt is an impossible state, so the clock
  // that produced it cannot be trusted (a learner rolling the OS date back). Fall
  // back to the attempt date: the cooldown then runs its full length.
  const today = parsedToday < last ? last : parsedToday;
  const daysSince = today - last;
  return {
    allowed: daysSince >= cooldownPeriodDays,
    availableDate: formatIsoDate(last + cooldownPeriodDays),
    daysSince,
  };
}

/**
 * Whole days from `todayDate` to `iso` (UTC calendar granularity); null when either
 * date is absent/unparseable or the target is not in the future. Both hosts render
 * the optional «через N дн.» line from this, so they cannot disagree.
 */
export function daysUntilDate(iso: string | null | undefined, todayDate: string): number | null {
  const target = iso ? parseIsoDate(iso) : null;
  const today = parseIsoDate(todayDate);
  if (target == null || today == null) return null;
  const diff = target - today;
  return diff > 0 ? diff : null;
}
```

- [ ] **Шаг 4: Реализовать в JS-твине**

В `server/scorm/template/app/eligibility/engine.js` заменить `cooldownDecision` и добавить `daysUntilDate`:

```js
  function cooldownDecision(lastAttemptDate, todayDate, cooldownPeriodDays) {
    var parsedToday = parseIsoDate(todayDate);
    var last = lastAttemptDate ? parseIsoDate(lastAttemptDate) : null;
    if (last == null || parsedToday == null) {
      return { allowed: true, availableDate: null, daysSince: null };
    }
    // A "today" that precedes the last attempt is an impossible state: the clock is
    // not trusted (rolled-back OS date), so the cooldown runs from the attempt date.
    var today = parsedToday < last ? last : parsedToday;
    var daysSince = today - last;
    return {
      allowed: daysSince >= cooldownPeriodDays,
      availableDate: formatIsoDate(last + cooldownPeriodDays),
      daysSince: daysSince
    };
  }

  // Whole days from todayDate to iso (UTC calendar granularity), or null when either
  // date is absent/unparseable or the target is not in the future.
  function daysUntilDate(iso, todayDate) {
    var target = iso ? parseIsoDate(iso) : null;
    var today = parseIsoDate(todayDate);
    if (target == null || today == null) return null;
    var diff = target - today;
    return diff > 0 ? diff : null;
  }
```

И дополнить возвращаемый объект модуля: `daysUntilDate: daysUntilDate,` сразу после `cooldownDecision: cooldownDecision,`.

- [ ] **Шаг 5: Убедиться, что тесты проходят**

```bash
node_modules/.bin/vitest run tests/eligibility-engine.test.ts tests/eligibility-engine-port.test.ts tests/retake-gate.test.ts
```

Ожидание: PASS во всех трёх файлах.

- [ ] **Шаг 6: Коммит**

```bash
git add shared/eligibility/engine.ts server/scorm/template/app/eligibility/engine.js tests/eligibility-engine.test.ts tests/eligibility-engine-port.test.ts
git commit -m "feat(prd-6): клэмп недоверенного «сегодня» и общая daysUntilDate"
```

---

## Task 2: Веб-хост — обратный отсчёт считает сервер

**Files:**

- Modify: `server/services/retake-gate.ts`
- Modify: `server/routes/attempts.ts:167-170`
- Modify: `client/src/pages/learner/take-test.tsx`
- Modify: `client/src/pages/learner/cooldown-format.ts`
- Test: `tests/retake-gate.test.ts`, `client/src/pages/learner/__tests__/take-test.test.tsx`,
  `client/src/pages/learner/__tests__/cooldown-format.test.ts`

- [ ] **Шаг 1: Написать падающий тест сервера**

Добавить в конец `tests/retake-gate.test.ts`:

```ts
describe("decideRetake — daysUntil", () => {
  it("отдаёт обратный отсчёт по серверной дате, когда доступ закрыт", () => {
    const gate = decideRetake(
      { enabled: true, cooldownPeriodDays: 30 } as RetakePolicy,
      "2026-05-20",
      "2026-06-16",
    );
    expect(gate.allowed).toBe(false);
    expect(gate.availableDate).toBe("2026-06-19");
    expect(gate.daysUntil).toBe(3);
  });

  it("не отдаёт отсчёт, когда доступ открыт", () => {
    const gate = decideRetake(
      { enabled: true, cooldownPeriodDays: 30 } as RetakePolicy,
      "2026-05-20",
      "2026-06-19",
    );
    expect(gate.allowed).toBe(true);
    expect(gate.daysUntil ?? null).toBeNull();
  });
});
```

Если в файле уже есть импорты `decideRetake` и типа `RetakePolicy` — не дублировать.

- [ ] **Шаг 2: Убедиться, что тест падает**

```bash
node_modules/.bin/vitest run tests/retake-gate.test.ts
```

Ожидание: FAIL — `gate.daysUntil` равно `undefined`.

- [ ] **Шаг 3: Реализовать на сервере**

В `server/services/retake-gate.ts` поправить импорт и добавить поле:

```ts
import { cooldownDecision, daysUntilDate } from "@shared/eligibility/engine";
```

В интерфейс `RetakeGateResult` добавить:

```ts
  /** Whole days until `availableDate`, computed from the SERVER date; null when open. */
  daysUntil?: number | null;
```

В `decideRetake` вернуть его:

```ts
  return {
    allowed: decision.allowed,
    reason: decision.allowed ? undefined : "cooldown_active",
    cooldownPeriodDays,
    lastAttemptDate,
    availableDate: decision.availableDate,
    daysUntil: decision.allowed ? null : daysUntilDate(decision.availableDate, todayDate),
  };
```

В `server/routes/attempts.ts` заменить сборку `retakeGate` (строки 167-170):

```ts
        const retakeGate =
          gate.allowed
            ? null
            : {
                cooldownPeriodDays: gate.cooldownPeriodDays ?? null,
                availableDate: gate.availableDate ?? null,
                daysUntil: gate.daysUntil ?? null,
              };
```

- [ ] **Шаг 4: Убедиться, что тест сервера проходит**

```bash
node_modules/.bin/vitest run tests/retake-gate.test.ts
```

Ожидание: PASS.

- [ ] **Шаг 5: Написать падающий тест клиента**

В `client/src/pages/learner/__tests__/take-test.test.tsx` заменить тест «folds a retake cooldown…» (строки 328-339):

```tsx
  it("folds a retake cooldown into the start context instead of navigating away", async () => {
    await renderToStart({
      startAttempt: jsonRes(
        { code: "RETAKE_COOLDOWN", cooldownPeriodDays: 7, availableDate: "2026-08-01", daysUntil: 3 },
        false,
        403,
      ),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() => expect(ctx().state.cooldown).toBeTruthy());
    // The countdown comes from the SERVER date, not from the browser clock.
    expect(ctx().state.cooldown.daysUntil).toBe(3);
    expect(navigateSpy).not.toHaveBeenCalledWith("/learner");
  });
```

- [ ] **Шаг 6: Убедиться, что тест клиента падает**

```bash
node_modules/.bin/vitest run client/src/pages/learner/__tests__/take-test.test.tsx
```

Ожидание: FAIL — `cooldown.daysUntil` не равно 3 (считается по часам jsdom).

- [ ] **Шаг 7: Реализовать на клиенте**

В `client/src/pages/learner/take-test.tsx`:

Строка 9 — убрать `daysUntilIsoDate` из импорта:

```tsx
import { fmtIsoDateHuman } from "./cooldown-format";
```

Строка 310 — расширить тип:

```tsx
    retakeGate: { cooldownPeriodDays: number | null; availableDate: string | null; daysUntil: number | null } | null;
```

Строка 706 — расширить тип разобранного 403:

```tsx
      const retake = (err as {
        retake?: { cooldownPeriodDays?: number; availableDate?: string | null; daysUntil?: number | null };
      }).retake;
```

Строки 719-722 — прокинуть поле:

```tsx
                  retakeGate: {
                    cooldownPeriodDays: retake?.cooldownPeriodDays ?? null,
                    availableDate: retake?.availableDate ?? null,
                    daysUntil: retake?.daysUntil ?? null,
                  },
```

Строки 2280-2285 — брать отсчёт с сервера:

```tsx
      cooldown: gate
        ? {
            availableDateHuman: fmtIsoDateHuman(gate.availableDate),
            daysUntil: gate.daysUntil,
          }
        : null,
```

Строки 919-922 — прокинуть поле в разбор ошибки (`error` здесь результат `res.json()`, то есть `any`, отдельного
типа для него нет):

```tsx
        const e = new Error("RETAKE_COOLDOWN") as Error & {
          retake?: { cooldownPeriodDays?: number; availableDate?: string | null; daysUntil?: number | null };
        };
        e.retake = {
          cooldownPeriodDays: error.cooldownPeriodDays,
          availableDate: error.availableDate,
          daysUntil: error.daysUntil,
        };
```

В `client/src/pages/learner/cooldown-format.ts` удалить функцию `daysUntilIsoDate` целиком и привести JSDoc
модуля к факту:

```ts
/**
 * @module client/src/pages/learner/cooldown-format
 *
 * PRD-19 Block F (FR-20): web-host date formatting for the retake cooldown card on
 * the start screen. The cooldown state renders ON the standard start page (no
 * separate block-wall), and the shared `buildStartState` consumes an
 * already-formatted date string — formatting is a host responsibility. The «через N
 * дн.» countdown is NOT computed here: it is resolved server-side and delivered in
 * `retakeGate.daysUntil`, so the web host reads no local clock (PRD-6 trusted-date).
 */
```

В `client/src/pages/learner/__tests__/cooldown-format.test.ts` удалить весь блок `describe("daysUntilIsoDate", …)`
(строки 30-52), убрать из импортов `daysUntilIsoDate`, `afterEach` и `vi`, и поправить JSDoc модуля так, чтобы он
описывал только форматирование даты.

- [ ] **Шаг 8: Убедиться, что тесты проходят**

```bash
node_modules/.bin/vitest run client/src/pages/learner/__tests__/take-test.test.tsx client/src/pages/learner/__tests__/cooldown-format.test.ts tests/retake-gate.test.ts
npm run check
```

Ожидание: PASS во всех файлах, `tsc` без ошибок.

- [ ] **Шаг 9: Коммит**

```bash
git add server/services/retake-gate.ts server/routes/attempts.ts client/src/pages/learner/take-test.tsx client/src/pages/learner/cooldown-format.ts tests/retake-gate.test.ts client/src/pages/learner/__tests__
git commit -m "feat(prd-6): обратный отсчёт кулдауна считает сервер, клиент не читает часы"
```

---

## Task 3: Гейт пакета — мемоизированный запрос портала

На штатной конфигурации (`shared/eligibility/registry.ts:79` — задан только `secidSource`) запрос к странице
портала один и сейчас; мемоизация нужна, чтобы резолвер даты ехал на нём же, а не добавлял свой. Второй запрос
возникает только там, где администратор задал `personIdSource` с тем же endpoint — тест ниже воспроизводит
именно такую конфигурацию.

**Files:**

- Modify: `server/scorm/template/app/eligibility/gate.js:77-105`
- Test: `tests/eligibility-gate-date.test.ts` (создать), `tests/eligibility-gate-blockwall.test.ts`

- [ ] **Шаг 1: Заглушить `fetch` в существующем тесте гейта**

Гейт начинает ходить в сеть на каждом прогоне, поэтому в `tests/eligibility-gate-blockwall.test.ts` в блок
`beforeEach` (строки 85-87) добавить заглушку, чтобы тесты не зависели от окружения:

```ts
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  // The gate now reads the portal chrome (SECID + the Date header). Offline here:
  // every resolver degrades exactly as it does when the portal is unreachable.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});
```

- [ ] **Шаг 2: Создать тест мемоизации**

Создать `tests/eligibility-gate-date.test.ts`:

```ts
/**
 * @module tests/eligibility-gate-date
 *
 * PRD-6 trusted date. The gate must source "today" from the LMS clock (the portal
 * response's `Date` header) instead of the learner's machine, must degrade to the
 * machine clock when the header is unavailable, and must hit the portal chrome only
 * once per URL (SECID, person id and the date all read the SAME response).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const engineSrc = read("server/scorm/template/app/eligibility/engine.js");
const pluginsSrc = read("server/scorm/template/app/eligibility/plugins.js");
const gateSrc = read("server/scorm/template/app/eligibility/gate.js");

/** Build a fresh RetakeGate over the supplied runtime globals. */
function makeGate(state: Record<string, unknown>, SCORM: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "state",
    "SCORM",
    "escapeHtml",
    "loadDesignTemplate",
    `${engineSrc}\n${pluginsSrc}\n${gateSrc}\n;return RetakeGate;`,
  );
  return factory(state, SCORM, (s: unknown) => String(s == null ? "" : s), () => Promise.resolve(null));
}

/** Record every fetch and answer it: portal chrome (with/without Date) + collection. */
function stubFetch(opts: { dateHeader?: string | null; chrome?: string }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(String(url));
    const headers = { get: (k: string) => (String(k).toLowerCase() === "date" ? opts.dateHeader ?? null : null) };
    if (String(url).indexOf("extjs_json_collection_data") !== -1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers,
        json: () => Promise.resolve({ success: true, total: 0, results: [] }),
        text: () => Promise.resolve(""),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers,
      text: () => Promise.resolve(opts.chrome ?? ""),
    });
  });
  return calls;
}

async function flush() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

function suspendGate(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Курс",
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "suspend_data_cooldown", failPolicy: "failOpen" },
    },
    retakePlugin: { runtimeEntry: "suspendDataCooldown", config: {} },
    ...over,
  };
}

const SCORM_WITH_ATTEMPT = {
  getValue: (k: string) =>
    k === "cmi.suspend_data" ? JSON.stringify({ retake: { lastCompletedDate: "2026-05-20" } }) : "",
  init: () => {},
};

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PRD-6 gate — trusted date", () => {
  it("hits the portal chrome once even when SECID and person id are both configured", async () => {
    const calls = stubFetch({ dateHeader: "Sat, 30 May 2026 09:00:00 GMT", chrome: "secid=ABCDEF0123456789ABCDEF0123456789" });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_WITH_ATTEMPT);

    gate.run(
      suspendGate({
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
            personIdSource: { endpoint: "/", pattern: "cur_person_id=(\\d+)" },
          },
        },
      }),
      () => {},
    );
    await flush();

    expect(calls.filter((u) => u === "/")).toHaveLength(1);
  });
});
```

- [ ] **Шаг 3: Убедиться, что тест падает**

```bash
node_modules/.bin/vitest run tests/eligibility-gate-date.test.ts
```

Ожидание: FAIL — `expected length 1, received 2` (`resolveSecid` и `resolvePersonId` тянут «/» каждый сам).

- [ ] **Шаг 4: Реализовать мемоизацию**

В `server/scorm/template/app/eligibility/gate.js` заменить `resolveSecid` и `resolvePersonId` (строки 75-105) на:

```js
  // Memoized same-origin GET of the portal chrome. SECID, cur_person_id and the
  // trusted date all read the SAME response, so the gate touches the portal once per
  // URL instead of once per resolver. `no-store` keeps the Date header live: a cached
  // response would carry a stale server clock.
  var portalChrome = {};

  function fetchPortalChrome(url) {
    var key = url || '/';
    if (portalChrome[key]) return portalChrome[key];
    portalChrome[key] = fetch(key, { credentials: 'include', cache: 'no-store' })
      .then(function (r) {
        var dateHeader = '';
        try { dateHeader = (r.headers && r.headers.get && r.headers.get('Date')) || ''; } catch (e) { dateHeader = ''; }
        return r.text().then(function (text) {
          return { text: text || '', dateHeader: dateHeader };
        });
      })
      .catch(function () { return { text: '', dateHeader: '' }; });
    return portalChrome[key];
  }

  // Scrape the session SECID (32-hex) the collection POST requires. It is present in
  // the portal chrome; `secidSource.endpoint` (default "/") is fetched same-origin.
  function resolveSecid(config) {
    var src = config.secidSource || {};
    var pattern = src.pattern || '[A-F0-9]{32}';
    return fetchPortalChrome(src.endpoint || '/').then(function (page) {
      var m = new RegExp(pattern).exec(page.text || '');
      return m ? m[0] : '';
    });
  }

  // Resolve cur_person_id. WebTutor's collection query is scoped to the learner by
  // `cur_person_id`; it is not in SCORM (pre-Initialize) so it is scraped from the
  // portal chrome via `personIdSource.pattern`, with an optional config override.
  // NOTE: the live contract allows an EMPTY value (the endpoint is session-scoped),
  // so a miss here is not an error.
  function resolvePersonId(config) {
    if (config.personId) return Promise.resolve(String(config.personId));
    var src = config.personIdSource || {};
    if (!src.pattern) return Promise.resolve('');
    return fetchPortalChrome(src.endpoint || '/').then(function (page) {
      var m = new RegExp(src.pattern).exec(page.text || '');
      return m ? (m[1] || m[0]) : '';
    });
  }
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

```bash
node_modules/.bin/vitest run tests/eligibility-gate-date.test.ts tests/eligibility-gate-blockwall.test.ts
```

Ожидание: PASS в обоих файлах.

- [ ] **Шаг 6: Коммит**

```bash
git add server/scorm/template/app/eligibility/gate.js tests/eligibility-gate-date.test.ts tests/eligibility-gate-blockwall.test.ts
git commit -m "feat(prd-6): один мемоизированный запрос портала в retake-гейте"
```

---

## Task 4: Гейт пакета — «сегодня» из заголовка `Date`

**Files:**

- Modify: `server/scorm/template/app/eligibility/gate.js:39-59, 226-237, 406-409, 429-433`
- Test: `tests/eligibility-gate-date.test.ts`

- [ ] **Шаг 1: Написать падающие тесты**

Добавить в `tests/eligibility-gate-date.test.ts` внутрь `describe("PRD-6 gate — trusted date")`:

```ts
  it("uses the portal clock, so a machine clock rolled forward does not open the gate", async () => {
    vi.useFakeTimers();
    // Machine says 30.06.2026 (well past the 30-day cooldown); the portal says 30.05.2026.
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    stubFetch({ dateHeader: "Sat, 30 May 2026 09:00:00 GMT" });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_WITH_ATTEMPT);

    let started = false;
    gate.run(suspendGate(), () => { started = true; });
    await flush();

    expect((state.retake as any)?.todayDate).toBe("2026-05-30");
    expect((state.retake as any)?.allowed).toBe(false);
    expect(started).toBe(false);
  });

  it("degrades to the machine clock when the portal sends no Date header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    stubFetch({ dateHeader: null });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_WITH_ATTEMPT);

    let started = false;
    gate.run(suspendGate(), () => { started = true; });
    await flush();

    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
    expect((state.retake as any)?.allowed).toBe(true);
    expect(started).toBe(true);
  });

  it("degrades to the machine clock when the portal request fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_WITH_ATTEMPT);

    gate.run(suspendGate(), () => {});
    await flush();

    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
  });
```

- [ ] **Шаг 2: Убедиться, что тесты падают**

```bash
node_modules/.bin/vitest run tests/eligibility-gate-date.test.ts
```

Ожидание: FAIL в первом тесте — `todayDate` равно `2026-06-30` (гейт читает часы машины).

- [ ] **Шаг 3: Реализовать резолв даты**

В `server/scorm/template/app/eligibility/gate.js` заменить `todayIso` и `buildContext` (строки 39-59) на:

```js
  // NFR-TD-01: the date resolution has its own budget INSIDE the gate's 5 s, so a slow
  // portal can never hang the start — it just degrades to the machine clock.
  var DATE_TIMEOUT_MS = 2500;

  // UTC calendar day of an epoch-ms value. The whole cooldown math is UTC-calendar on
  // both hosts (the web server uses toIsoDateUTC), and taking the day in UTC keeps the
  // learner's TIME ZONE out of the decision — otherwise a TZ set to UTC+14 would hand
  // out "tomorrow" without touching the clock.
  function isoDayFromMs(ms) {
    return EligibilityEngine.formatIsoDate(Math.floor(ms / 86400000));
  }

  // Trusted "today" (PRD-6 trusted-date): the LMS clock, read from the `Date` response
  // header of the portal chrome the gate already fetches. Same-origin only, which is
  // exactly the environment webtutor_cooldown requires anyway. Any failure (no header,
  // cross-origin, HTTP error, timeout) degrades to the machine clock = legacy behaviour.
  function resolveToday(config) {
    var src = (config && config.secidSource) || {};
    var work = fetchPortalChrome(src.endpoint || '/').then(function (page) {
      return page.dateHeader ? Date.parse(page.dateHeader) : NaN;
    });
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve(NaN); }, DATE_TIMEOUT_MS);
    });
    return Promise.race([work, timeout])
      .catch(function () { return NaN; })
      .then(function (serverMs) {
        var clientMs = Date.now();
        var clientDay = isoDayFromMs(clientMs);
        if (!serverMs || !isFinite(serverMs)) {
          glog('date source: client (no usable Date header) | today:', clientDay);
          return clientDay;
        }
        var serverDay = isoDayFromMs(serverMs);
        glog('date source: network | server:', serverDay, '| client:', clientDay,
          '| skew sec:', Math.round((serverMs - clientMs) / 1000));
        return serverDay;
      });
  }

  function buildContext(td) {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    var config = td.retakePlugin.config || {};
    return resolveToday(config).then(function (todayDate) {
      return {
        test: { id: td.id || '', title: td.title || '' },
        retakePolicy: { cooldownPeriodDays: td.retakePolicy.cooldownPeriodDays },
        runtime: {
          todayDate: todayDate,
          timezone: tz,
          launchUrl: typeof location !== 'undefined' ? location.href : ''
        },
        lms: { scormVersion: '2004' },
        config: config
      };
    });
  }
```

- [ ] **Шаг 4: Перевести `run` на асинхронный контекст**

Заменить функцию `run` целиком (строки 429-463) на версию, ждущую контекст. Внешний `.catch` теперь покрывает и
резолв даты (по построению он не бросает, но инвариант «учащийся не остаётся на пустом экране» сохраняется):

```js
  function run(td, onAllowedStart) {
    buildContext(td).then(function (ctx) {
      glog('gated. plugin:', td.retakePlugin.runtimeEntry,
        '| cooldownPeriodDays:', ctx.retakePolicy.cooldownPeriodDays,
        '| today:', ctx.runtime.todayDate);
      return evaluate(td, ctx).then(function (result) {
        var retake = EligibilityEngine.buildRetakeState(result, {
          todayDate: ctx.runtime.todayDate,
          cooldownPeriodDays: ctx.retakePolicy.cooldownPeriodDays
        });
        if (typeof state !== 'undefined' && state) state.retake = retake;
        if (typeof console !== 'undefined' && console.log) {
          console.log('PRD-6 retake gate:', result.allowed ? 'allowed' : 'blocked',
            '(' + (retake.reason || '') + (retake.availableDate ? ', available ' + retake.availableDate : '') + ')');
        }
        // buildRetakeState drops `data`, so the underlying error would otherwise be
        // lost even though the verdict was decided by failPolicy rather than by data.
        if (result.data && result.data.error) glog('decided by failPolicy. error was:', result.data.error);
        glog('lastAttemptDate:', (result.data && result.data.lastAttemptDate) || '(none)',
          '| availableDate:', retake.availableDate || '(none)');
        // PRD-19 FR-19: eligible => NO gate-shell. Hand straight to the normal
        // course (onAllowedStart = runCourse: Initialize + the standard start page),
        // so an elapsed-cooldown test is indistinguishable from an ordinary one.
        // FR-20: blocked => the cooldown state renders ON the standard start page
        // (pre-Initialize), not a separate wall — NFR-01/02 still hold.
        if (!result.allowed) renderCooldownStart(retake, td);
        else onAllowedStart();
      });
    }).catch(function (e) {
      // evaluate() already absorbs plugin errors via failPolicy, so reaching here
      // means the GATE itself broke (date resolve / state build / template render).
      // Previously this was an unhandled rejection: no log, and a learner left on a
      // blank #app.
      glog('GATE CRASHED after the verdict:', (e && e.stack) || e, '- starting the course (failOpen spirit)');
      try { onAllowedStart(); } catch (e2) { glog('course start also failed:', (e2 && e2.stack) || e2); }
    });
  }
```

- [ ] **Шаг 5: Убрать чтение часов из обратного отсчёта**

Заменить `daysUntilIso` (строки 226-237) на использование общей функции — удалить функцию целиком, а в
`renderCooldownStart` (строка 408) заменить вызов:

```js
          daysUntil: EligibilityEngine.daysUntilDate(retake.availableDate, retake.todayDate)
```

`retake.todayDate` приходит из `buildRetakeState`, то есть это уже доверенная дата.

- [ ] **Шаг 6: Убедиться, что тесты проходят**

```bash
node_modules/.bin/vitest run tests/eligibility-gate-date.test.ts tests/eligibility-gate-blockwall.test.ts tests/eligibility-engine-port.test.ts
```

Ожидание: PASS во всех трёх файлах.

- [ ] **Шаг 7: Коммит**

```bash
git add server/scorm/template/app/eligibility/gate.js tests/eligibility-gate-date.test.ts
git commit -m "feat(prd-6): «сегодня» в SCORM-гейте берётся из часов сервера LMS"
```

---

## Task 5: Стенд — управляемые часы сервера

Локальный мок WebTutor в плеере уже есть (SECID и коллекция учебных записей, строки 141-209). Не хватает одного:
возможности разойтись часами с машиной.

**Files:**

- Modify: `scripts/scorm-player.mjs:91-93`

- [ ] **Шаг 1: Добавить фиксированные часы**

Сразу после `const app = express();` (строка 91) вставить:

```js
// PRD-6 trusted-date acceptance: pin the server clock the gate reads. Node sets `Date`
// automatically from the host clock, so a run cannot otherwise exercise "LMS clock
// disagrees with the machine clock". `--server-date=2026-05-30` (or the env var) makes
// the stand answer with that date while the OS clock stays whatever the tester sets.
const SERVER_DATE =
  (process.argv.find((a) => a.startsWith("--server-date=")) || "").split("=")[1] ||
  process.env.SCORM_PLAYER_SERVER_DATE ||
  "";

app.use((_req, res, next) => {
  if (SERVER_DATE) {
    const ts = Date.parse(SERVER_DATE.length === 10 ? `${SERVER_DATE}T12:00:00Z` : SERVER_DATE);
    if (Number.isFinite(ts)) res.setHeader("Date", new Date(ts).toUTCString());
  }
  next();
});
```

- [ ] **Шаг 2: Показать режим при старте**

Заменить лог в `app.listen` (строки 211-214):

```js
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SCORM player on http://localhost:${PORT}  (serving zips from ${OUT_DIR})`);
  if (SERVER_DATE) {
    // eslint-disable-next-line no-console
    console.log(`  fixed server clock (PRD-6 trusted date): ${SERVER_DATE}`);
  }
});
```

- [ ] **Шаг 3: Проверить руками**

```bash
node scripts/scorm-player.mjs --server-date=2026-05-30
```

В другом терминале:

```bash
curl -s -D - -o /dev/null http://localhost:5050/
```

Ожидание: в заголовках `Date: Sat, 30 May 2026 12:00:00 GMT`. Остановить плеер.

- [ ] **Шаг 4: Коммит**

```bash
git add scripts/scorm-player.mjs
git commit -m "feat(prd-6): управляемые часы сервера в локальном SCORM-плеере"
```

---

## Task 6: Приёмка на стенде и закрытие спеки

**Files:**

- Modify: `docs/specs/prd-6/cooldown-trusted-date.md`

- [ ] **Шаг 1: Собрать пакет и поднять стенд**

```bash
npm run scorm:template
node scripts/scorm-player.mjs --server-date=2026-05-30
```

Открыть `http://localhost:5050`, загрузить собранный пакет из `out/`, в панели мока PRD-6 выставить дату
последней попытки `2026-05-20` и статус `Не пройден`, применить.

- [ ] **Шаг 2: Основной сценарий защиты**

Перевести системную дату машины на `2026-07-30` (заведомо за горизонтом 30-дневного кулдауна), перезапустить
пакет в плеере.

Ожидание: экран кулдауна, старт заблокирован; в консоли строка
`[PRD-6 gate] date source: network | server: 2026-05-30 | client: 2026-07-30 | skew sec: …`.

- [ ] **Шаг 3: Обратный сценарий**

Не меняя системную дату, перезапустить плеер с `--server-date=2026-06-25` и перезапустить пакет.

Ожидание: старт разрешён, кулдаун истёк по часам сервера; в консоли `date source: network | server: 2026-06-25`.

- [ ] **Шаг 4: Сценарий деградации**

Остановить плеер и запустить без флага (`node scripts/scorm-player.mjs`), в панели мока оставить ту же дату,
перезапустить пакет.

Ожидание: гейт работает по часам стенда (они же машины), в консоли `date source: network` с датой машины.
Вернуть системную дату машины в актуальное состояние.

- [ ] **Шаг 5: Полный прогон тестов**

```bash
npm test
npm run check
```

Ожидание: PASS, покрытие не ниже порога 80%, `tsc` без ошибок.

- [ ] **Шаг 6: Отметить приёмку в спеке**

В `docs/specs/prd-6/cooldown-trusted-date.md` в раздел «10. Проверка и приёмка» дописать строку с датой
фактического прогона и результатом по каждому из трёх сценариев Шагов 2-4.

- [ ] **Шаг 7: Коммит**

```bash
git add docs/specs/prd-6/cooldown-trusted-date.md
git commit -m "docs(prd-6): приёмка доверенной даты кулдауна на локальном стенде"
```

---

## Соответствие требованиям спеки

| Требование | Где закрывается |
| --- | --- |
| FR-TD-01 | Task 4, шаг 3 (`resolveToday`) |
| FR-TD-02 | Task 4, шаг 3 (ветки деградации) + тесты Task 4, шаг 1 |
| FR-TD-03 | Task 4, шаг 3 (`isoDayFromMs`, UTC) |
| FR-TD-04 | Task 3 (`fetchPortalChrome` + тест мемоизации) |
| FR-TD-05 | Task 1 (клэмп в обоих твинах) |
| FR-TD-06 | Task 2 (`daysUntil` с сервера, удаление `daysUntilIsoDate`) |
| NFR-TD-01 | Task 4, шаг 3 (`DATE_TIMEOUT_MS`) |
| NFR-TD-02 | Task 4, шаг 3 (`glog` источника и расхождения) |
| §8 открытый риск | Task 0 (пре-флайт, блокирует Tasks 3-5) |
| §9 стенд | Task 5 (мок уже существует, добавляются только часы) |
| §10 приёмка | Task 6 |
