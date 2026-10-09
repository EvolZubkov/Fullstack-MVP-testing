# PRD-36: компактность состояния прогона в SCORM-пакете

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Требования:** [спека PRD-36 v1.1](../specs/prd-36/run-state-compactness.md) — FR-01 - FR-24,
NFR-01 - NFR-05, §4.6 (кодировка), §6 (бюджет и порядок жертв), §7 (миграция), §8 (три дефекта),
§11 (13 критериев приёмки). Трекер: [#38](https://github.com/vvlad1973/Fullstack-MVP-testing/issues/38).

**Ветка:** `prd-36-run-state-compactness` (от локального `main`, НЕ от `origin/main`).

**Goal:** состояние прогона в `cmi.suspend_data` перестаёт хранить всё, что выводится из запечённого
`TEST_DATA`, перестаёт расти с числом попыток и укладывается в бюджет 4096 символов — при неизменном
поведении экранов, отчёта в LMS и обоих барьеров допуска.

**Architecture:** появляется ОДИН новый модуль рантайма `app/utils/scorm/runState.js` (глобал
`TBRunState`, по образцу `TBQType`): в нём чистые функции кодирования рядов, сборка сводки попытки,
выбор лучшей, приведение старого формата и контроль бюджета. `suspendAttempts.js` и
`sessionRecovery.js` худеют до чтения/записи через `TBRunState` и остаются единственными, кто
трогает `SCORM.getValue('cmi.suspend_data')`. Потребители (стартовый экран, экран итогов, «Мой
результат», PDF, гейт, инспектор PRD-18) переходят с чтения сохранённого содержимого на разворот
позиций по `TEST_DATA`. Веб-хост не затрагивается: `suspend_data` существует только в пакете.

**Tech Stack:** плоский ES5-рантайм пакета (`server/scorm/template/app/**`, без модулей и внешних
зависимостей), сборка пакета `server/scorm/index.ts` (`joinJsParts`), Vitest через `npm test -- <путь>`,
port-паттерн тестов рантайма (`tests/*-port.test.ts`: чтение исходника + `new Function` с инжектом
глобалов), отладочный плеер PRD-18, локальные инструменты `npm run scorm:template` / `npm run scorm:player`.

---

## Решения, которые исполнитель не пересматривает

1. **Кодировка рядов принята владельцем 2026-08-15** (§4.6 спеки). Без неё контрольный тест не
   влезает в 4096 примерно в полтора раза. Ряд — одна строка, элемент адресуется позицией.
2. **Перемешивание вариантов хранится КАРТОЙ-строкой.** Зерно ГПСЧ рассмотрено и отклонено:
   карта стоит около 300 символов на 60 вопросов, не требует детерминированного генератора
   в рантайме и читается глазами в отладочном плеере.
3. **Правило «в LMS уезжает лучшая попытка» НЕ меняется** (FR-08, §12 спеки). Менять правило
   оценки заодно с оптимизацией хранения нельзя — это отдельный продуктовый вопрос.
4. **Массив `attempts[]` уходит целиком** (FR-03). Ни один экран не показывает историю попыток;
   архив ведут LMS и телеметрия `scorm_attempts`.
5. **Сборка сводки — одна точка на весь рантайм** (FR-22). Сегодня `saveAttemptResult` вызывается
   из пяти мест; после правки все пять зовут одну функцию, а не собирают запись каждый по-своему.
6. **Старое состояние читается, но НЕ пишется** (FR-12). Формат 1 приводится к формату 2 при первом
   запуске; обратной записи нет.
7. **Адаптивные попытки детализацию не хранят** — как и сегодня (§10 спеки, строка «Адаптивный режим»).
   Поведение сохраняется, новых возможностей адаптиву эта работа не добавляет.
8. **Задача 1 идёт первой и не пропускается.** Она фиксирует СЕГОДНЯШНЕЕ поведение тестами до того,
   как формат поменяется; иначе регрессию в четырёх механизмах ловить нечем.

---

## Файловая карта

| Файл | Ответственность |
| --- | --- |
| `server/scorm/template/app/utils/scorm/runState.js` (создать) | Глобал `TBRunState`: кодек рядов, отпечаток состава, сводка попытки, выбор лучшей, бюджет, миграция |
| `server/scorm/index.ts` (правка) | Подключение `runState.js` в бандл ДО `suspendAttempts.js` |
| `server/scorm/template/app/utils/scorm/suspendAttempts.js` (правка) | Чтение/запись состояния v2, счётчик, якорь таймера, барьер PRD-31, единая точка сохранения попытки |
| `server/scorm/template/app/utils/scorm/sessionRecovery.js` (правка) | Прогон в работе на позициях: выдача, ответы, статусы, перемешивание, `formId` |
| `server/scorm/template/app/render/resultsPage.js` (правка) | Interactions лучшей попытки из позиций и статусов вместо подмены `flatQuestions` |
| `server/scorm/template/app/render/startPage.js` (правка) | Стартовый экран и «продолжить» по сводке и позициям |
| `server/scorm/template/app/render/viewResults.js` (правка) | «Мой результат» разворачивает сводку по `TEST_DATA` |
| `server/scorm/template/app/utils/pdfExport.js` (правка) | Число попыток из счётчика |
| `server/scorm/template/app/eligibility/gate.js` (правка) | Признак повторного входа по состоянию v2 и v1 |
| `server/scorm/assets/app.js` (правка) | `generateVariant` пинит позиции выдачи в `state` |
| `server/scorm/debug-player/assets/inspector-compute.js` (правка) | Протокол прошлой попытки из позиций, доля бюджета, отметки жертв |
| `tests/run-state-codec.test.ts` (создать) | Кодек рядов и отпечаток |
| `tests/run-state-store.test.ts` (создать) | Чтение/запись/бюджет/жертвы/три исхода чтения |
| `tests/run-state-migration.test.ts` (создать) | Приведение формата 1 к формату 2 |
| `tests/run-state-consumers.test.ts` (создать) | Потребители: interactions, стартовый экран, «Мой результат», гейт |
| `tests/run-state-budget.test.ts` (создать) | Контрольный тест 60/10/5/5/11 в 4096 символов |
| `tests/scorm-session-recovery.test.ts` (переписать) | Восстановление прогона на ИСХОДНИКАХ рантайма вместо реплики логики на TypeScript |

---

## Формат состояния версии 2 (нормативная памятка исполнителю)

```json
{
  "v": 2,
  "fp": "10:6,6,6,6,6,6,6,6,6,6:11",
  "attemptsUsed": 3,
  "best": {
    "n": 2, "at": "2026-08-15T10:22:03.000Z", "src": "portal",
    "pc": 78.5, "c": 47, "q": 60, "e": 47, "p": 60, "ok": true,
    "t": [{ "s": 0, "c": 5, "q": 6, "e": 5, "p": 6, "pc": 83.3, "ok": true, "f": "form-a", "r": 70 }],
    "bd": [{ "k": 3, "i": 6, "a": 6, "e": 4, "p": 6, "pp": 66.7, "pu": 66.7 }],
    "rv": { "risk": 12 }, "sv": { "E": 7 },
    "d": { "dl": "0.0,0.3,1.2", "an": "3,03,2031", "st": "aau" }
  },
  "last": 0,
  "currentSession": {
    "at": "2026-08-15T10:05:00.000Z", "i": 12,
    "dl": "0.0,0.3,1.2", "an": "3,03,2031", "st": "aau", "sh": "2031,10,012",
    "f": { "t1": "form-a" }, "fm": "linear_flat", "rt": {}, "sr": {}, "rf": false,
    "crt": null, "cpi": 0, "sc": {}
  },
  "timer": { "limitMinutes": 30, "baselineTotalSec": 120, "sig": "1a2b3c" },
  "retake": { "lastCompletedDate": "2026-08-15" }
}
```

- `fp` — отпечаток состава пакета: `<число разделов>:<число вопросов в каждом через запятую>:<число ключей разреза>`.
- `last: 0` — целое: `0` означает «последняя совпадает с лучшей»; иначе объект сводки без `d`.
- `t[].s` — номер раздела в `TEST_DATA.sections`; `t[].f` — `formId` PRD-17; `t[].r` — разрешённый порог PRD-24.
- `bd[].k` — номер ключа разреза в `TEST_DATA.breakdownKeys` (список ключей выпекается задачей 3).
- `d` — детализация лучшей: `dl` выдача, `an` ответы, `st` статусы (§4.3 — ровно три ряда;
  перемешивание относится к прогону в работе, у завершённой попытки его никто не читает).
- Поля `timer` и `retake` не меняются ни формой, ни семантикой (FR-16).

---

### Task 1: Характеризационные тесты состояния до правки формата

**Files:**

- Create: `tests/run-state-store.test.ts`
- Rewrite: `tests/scorm-session-recovery.test.ts`

- [ ] **Шаг 1: Написать падающий тест на СЕГОДНЯШНЕЕ чтение и запись состояния**

```typescript
/**
 * @module tests/run-state-store
 * @description PRD-36: состояние прогона в `cmi.suspend_data`. Файл заведён ДО смены формата
 * и фиксирует поведение, которое обязано пережить правку: счётчик попыток, якорь таймера и обе
 * даты барьеров. Функции поднимаются из ИСХОДНИКА рантайма (port-паттерн), а не пересказываются.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/suspendAttempts.js"),
  "utf8",
);

interface Store {
  readSuspendObj: () => Record<string, unknown>;
  writeSuspendObj: (obj: unknown) => void;
  getAttemptsUsed: () => number;
  setAttemptsUsed: (n: number) => void;
}

/** Runtime store bound to an in-memory SCORM data model. */
function makeStore(initial = ""): { store: Store; cmi: { value: string } } {
  const cmi = { value: initial };
  const SCORM = {
    getValue: (k: string) => (k === "cmi.suspend_data" ? cmi.value : ""),
    setValue: (k: string, v: string) => { if (k === "cmi.suspend_data") cmi.value = v; },
    commit: () => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "SCORM", "TEST_DATA", "state", "console",
    `${src}
     return { readSuspendObj: readSuspendObj, writeSuspendObj: writeSuspendObj,
              getAttemptsUsed: getAttemptsUsed, setAttemptsUsed: setAttemptsUsed };`,
  );
  const store = factory(
    SCORM,
    { maxAttempts: 3, retakePolicy: null },
    { answers: {}, flatQuestions: [] },
    { log: () => undefined },
  ) as Store;
  return { store, cmi };
}

describe("состояние прогона: счётчик попыток", () => {
  it("пустое состояние читается как ноль попыток", () => {
    const { store } = makeStore("");
    expect(store.getAttemptsUsed()).toBe(0);
  });

  it("счётчик переживает перезапись состояния", () => {
    const { store } = makeStore("");
    store.setAttemptsUsed(2);
    expect(store.getAttemptsUsed()).toBe(2);
  });

  it("повреждённая строка не роняет чтение", () => {
    const { store } = makeStore('{"attemptsUsed":2,"attempts":[{"per');
    expect(store.getAttemptsUsed()).toBe(0);
  });
});
```

- [ ] **Шаг 2: Прогнать — тест обязан пройти на текущем коде**

Run: `npm test -- tests/run-state-store.test.ts`
Expected: PASS, 3 теста. Если падает — значит port-инжект собран неверно (проверить список
глобалов в `new Function`), а не рантайм сломан.

- [ ] **Шаг 3: Переписать тест восстановления на исходники рантайма**

`tests/scorm-session-recovery.test.ts` сегодня реплицирует логику на TypeScript и останется зелёным
при любой поломке пакета. Заменить его тело на подъём `determineRecovery` из исходника:

```typescript
/**
 * @module tests/scorm-session-recovery
 * @description Восстановление прерванного прогона в пакете. Проверяется ИСХОДНЫЙ
 * `determineRecovery` рантайма: прежняя версия файла пересказывала его логику на TypeScript
 * и не поймала бы ни одной регрессии в самом пакете (PRD-36, риск «модули состояния не покрыты»).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/sessionRecovery.js"),
  "utf8",
);

type Recovery = { action: string; session?: unknown; attempt?: unknown };

function determineRecoveryWith(suspend: unknown, TEST_DATA: unknown): Recovery {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "TEST_DATA", "state", "readSuspendObj", "readTimerAnchor", "readTotalTimeSec", "console",
    `${src}\nreturn determineRecovery;`,
  );
  return factory(
    TEST_DATA,
    { },
    () => suspend,
    () => null,
    () => 0,
    { log: () => undefined },
  )() as Recovery;
}

const session = (over: Record<string, unknown> = {}) => ({
  savedAt: new Date().toISOString(),
  currentIndex: 1,
  answers: {},
  flatQuestions: [{ question: { id: "q1" } }],
  ...over,
});

describe("determineRecovery", () => {
  it("без таймера прерванный прогон восстанавливается", () => {
    const r = determineRecoveryWith(
      { attemptsUsed: 1, attempts: [], currentSession: session() },
      { mode: "standard", timeLimitMinutes: null, flowPolicy: { mode: "linear_flat" } },
    );
    expect(r.action).toBe("restore");
  });

  it("протухший прогон не восстанавливается", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const r = determineRecoveryWith(
      { attemptsUsed: 1, attempts: [], currentSession: session({ savedAt: old }) },
      { mode: "standard", timeLimitMinutes: null, flowPolicy: { mode: "linear_flat" } },
    );
    expect(r.action).toBe("start_fresh");
  });

  it("адаптивный режим показывает последнюю попытку", () => {
    const r = determineRecoveryWith(
      { attemptsUsed: 1, attempts: [{ percent: 50 }], currentSession: null },
      { mode: "adaptive", timeLimitMinutes: null, flowPolicy: { mode: "linear_flat" } },
    );
    expect(r.action).toBe("show_last_attempt");
  });
});
```

- [ ] **Шаг 4: Прогнать оба файла**

Run: `npm test -- tests/run-state-store.test.ts tests/scorm-session-recovery.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add tests/run-state-store.test.ts tests/scorm-session-recovery.test.ts
git commit -m "test(scorm): состояние прогона проверяется на исходниках рантайма"
```

---

### Task 2: Кодек рядов и отпечаток состава

**Files:**

- Create: `server/scorm/template/app/utils/scorm/runState.js`
- Create: `tests/run-state-codec.test.ts`
- Modify: `server/scorm/index.ts:443-455` (подключение части в бандл)

- [ ] **Шаг 1: Написать падающий тест кодека**

```typescript
/**
 * @module tests/run-state-codec
 * @description PRD-36 §4.6, FR-20: ряды состояния кодируются строкой, элемент адресуется
 * позицией. Декодирование обязано быть обратным кодированию без потерь — иначе после
 * продолжения прогона ученик увидит чужие ответы.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const TBRunState = new Function(`${src}\nreturn TBRunState;`)() as any;

const Q = (type: string) => ({ type });

describe("кодек выдачи", () => {
  it("выдача кодируется парой «раздел.вопрос» и разворачивается обратно", () => {
    const delivery = [{ s: 0, q: 0 }, { s: 0, q: 3 }, { s: 1, q: 41 }];
    const encoded = TBRunState.encodeDelivery(delivery);
    expect(encoded).toBe("0.0,0.3,1.15");
    expect(TBRunState.decodeDelivery(encoded)).toEqual(delivery);
  });

  it("пустая выдача кодируется пустой строкой", () => {
    expect(TBRunState.encodeDelivery([])).toBe("");
    expect(TBRunState.decodeDelivery("")).toEqual([]);
  });
});

describe("кодек ответов", () => {
  const types = [Q("single"), Q("multiple"), Q("ranking"), Q("matching"), Q("allocation"), Q("single")];
  const answers = [2, [0, 3], [2, 0, 3, 1], { 0: 1, 1: 0 }, { 0: 5, 1: 10 }, undefined];

  it("каждый тип ответа переживает круг кодирования", () => {
    const encoded = TBRunState.encodeAnswers(answers, types);
    expect(TBRunState.decodeAnswers(encoded, types)).toEqual([2, [0, 3], [2, 0, 3, 1], { 0: 1, 1: 0 }, { 0: 5, 1: 10 }, undefined]);
  });

  it("распределение баллов не теряет значения больше 35", () => {
    const encoded = TBRunState.encodeAnswers([{ 0: 40, 1: 60 }], [Q("allocation")]);
    expect(TBRunState.decodeAnswers(encoded, [Q("allocation")])).toEqual([{ 0: 40, 1: 60 }]);
  });
});

describe("кодек статусов и перемешивания", () => {
  it("статусы кодируются одним символом на вопрос", () => {
    const statuses = ["answered", "skipped", "unanswered"];
    expect(TBRunState.encodeStatuses(statuses)).toBe("asu");
    expect(TBRunState.decodeStatuses("asu")).toEqual(statuses);
  });

  it("карта перемешивания переживает круг", () => {
    const maps = [[2, 0, 3, 1], null, [1, 0]];
    const encoded = TBRunState.encodeShuffle(maps);
    expect(TBRunState.decodeShuffle(encoded)).toEqual(maps);
  });
});

describe("порча ряда (FR-23)", () => {
  it("испорченная выдача читается как пустая, а не роняет разбор", () => {
    expect(TBRunState.decodeDelivery("0.0,мусор,1.2")).toEqual([{ s: 0, q: 0 }, { s: 1, q: 2 }]);
  });

  it("ответов меньше, чем вопросов — недостающие пусты, остальные на месте", () => {
    const types = [Q("single"), Q("single"), Q("single")];
    expect(TBRunState.decodeAnswers("1,2", types)).toEqual([1, 2, undefined]);
  });
});

describe("отпечаток состава", () => {
  const TEST_DATA = {
    sections: [{ questions: [{}, {}] }, { questions: [{}] }],
    breakdownKeys: ["a", "b"],
  };

  it("отпечаток собирается из состава пакета", () => {
    expect(TBRunState.fingerprint(TEST_DATA)).toBe("2:2,1:2");
  });

  it("состояние чужого пакета опознаётся по отпечатку", () => {
    expect(TBRunState.sameFingerprint("2:2,1:2", TEST_DATA)).toBe(true);
    expect(TBRunState.sameFingerprint("3:2,1,4:2", TEST_DATA)).toBe(false);
  });
});
```

- [ ] **Шаг 2: Прогнать — тест обязан упасть на отсутствии файла**

Run: `npm test -- tests/run-state-codec.test.ts`
Expected: FAIL — `ENOENT ... runState.js`.

- [ ] **Шаг 3: Написать кодек**

Создать `server/scorm/template/app/utils/scorm/runState.js`:

```javascript
/**
 * @module utils/scorm/runState
 * @description PRD-36: the run-state model of the SCORM package — the codec that keeps
 * `cmi.suspend_data` inside its budget, the attempt summary builder and the migration of the
 * legacy format. Pure functions only: nothing here touches the SCORM data model, so the whole
 * module is testable from the sources (port-pattern) without a package build.
 *
 * A ROW is a homogeneous run of values whose length equals the number of delivered questions.
 * A row is stored as ONE string and its elements are addressed by POSITION — names and ids cost
 * more than the values themselves, and a UUID key alone would eat a quarter of the budget.
 *
 * Exposes the global `TBRunState`.
 */
var TBRunState = (function () {
  var STATUS_CODES = { answered: 'a', skipped: 's', unanswered: 'u' };
  var STATUS_BY_CODE = { a: 'answered', s: 'skipped', u: 'unanswered' };

  /** Base36 keeps an index one character wide up to 35 — the common case for options. */
  function b36(n) { return Number(n).toString(36); }
  function unb36(s) { return parseInt(s, 36); }

  // ── Delivery: «section.question» pairs in delivery order ──────────────────
  function encodeDelivery(positions) {
    var out = [];
    for (var i = 0; i < (positions || []).length; i++) {
      out.push(b36(positions[i].s) + '.' + b36(positions[i].q));
    }
    return out.join(',');
  }

  function decodeDelivery(row) {
    if (!row) return [];
    var parts = String(row).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split('.');
      if (pair.length !== 2) continue;
      out.push({ s: unb36(pair[0]), q: unb36(pair[1]) });
    }
    return out;
  }

  // ── Answers: one element per delivered question, shape decided by its type ──
  function encodeAnswer(answer, question) {
    var type = (question && question.type) || 'single';
    if (answer === undefined || answer === null) return '';
    if (type === 'allocation') {
      // Amounts are unbounded, so they stay decimal with an explicit separator.
      var keys = Object.keys(answer).sort(function (a, b) { return Number(a) - Number(b); });
      var amounts = [];
      for (var i = 0; i < keys.length; i++) amounts.push(String(answer[keys[i]]));
      return amounts.join('.');
    }
    if (type === 'matching') {
      // Position = left item index, value = the right index it was matched to.
      var lefts = Object.keys(answer).sort(function (a, b) { return Number(a) - Number(b); });
      var pairs = [];
      for (var j = 0; j < lefts.length; j++) pairs.push(b36(lefts[j]) + b36(answer[lefts[j]]));
      return pairs.join('');
    }
    if (Object.prototype.toString.call(answer) === '[object Array]') {
      var idx = [];
      for (var k = 0; k < answer.length; k++) idx.push(b36(answer[k]));
      return idx.join('');
    }
    return b36(answer);
  }

  function decodeAnswer(cell, question) {
    var type = (question && question.type) || 'single';
    if (cell === '') return undefined;
    if (type === 'allocation') {
      var amounts = cell.split('.');
      var alloc = {};
      for (var i = 0; i < amounts.length; i++) alloc[i] = parseInt(amounts[i], 10);
      return alloc;
    }
    if (type === 'matching') {
      var map = {};
      for (var j = 0; j + 1 < cell.length; j += 2) map[unb36(cell[j])] = unb36(cell[j + 1]);
      return map;
    }
    if (type === 'multiple' || type === 'ranking') {
      var list = [];
      for (var k = 0; k < cell.length; k++) list.push(unb36(cell[k]));
      return list;
    }
    return unb36(cell);
  }

  function encodeAnswers(answers, questions) {
    var out = [];
    for (var i = 0; i < (questions || []).length; i++) {
      out.push(encodeAnswer((answers || [])[i], questions[i]));
    }
    return out.join(',');
  }

  function decodeAnswers(row, questions) {
    var cells = row === '' ? [] : String(row).split(',');
    var out = [];
    for (var i = 0; i < (questions || []).length; i++) {
      out.push(decodeAnswer(cells[i] === undefined ? '' : cells[i], questions[i]));
    }
    return out;
  }

  // ── Statuses (PRD-19) and option shuffling (PRD-16) ───────────────────────
  function encodeStatuses(statuses) {
    var out = '';
    for (var i = 0; i < (statuses || []).length; i++) {
      out += STATUS_CODES[statuses[i]] || 'u';
    }
    return out;
  }

  function decodeStatuses(row) {
    var out = [];
    for (var i = 0; i < (row || '').length; i++) out.push(STATUS_BY_CODE[row[i]] || 'unanswered');
    return out;
  }

  function encodeShuffle(maps) {
    var out = [];
    for (var i = 0; i < (maps || []).length; i++) {
      var m = maps[i];
      if (!m) { out.push(''); continue; }
      var cell = '';
      for (var j = 0; j < m.length; j++) cell += b36(m[j]);
      out.push(cell);
    }
    return out.join(',');
  }

  function decodeShuffle(row) {
    var cells = row === '' ? [] : String(row).split(',');
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i]) { out.push(null); continue; }
      var m = [];
      for (var j = 0; j < cells[i].length; j++) m.push(unb36(cells[i][j]));
      out.push(m);
    }
    return out;
  }

  // ── Package fingerprint: positions are valid only inside THIS package ─────
  function fingerprint(testData) {
    var sections = (testData && testData.sections) || [];
    var counts = [];
    for (var i = 0; i < sections.length; i++) {
      counts.push((sections[i].questions || []).length);
    }
    var keys = ((testData && testData.breakdownKeys) || []).length;
    return sections.length + ':' + counts.join(',') + ':' + keys;
  }

  function sameFingerprint(fp, testData) {
    return !!fp && fp === fingerprint(testData);
  }

  return {
    encodeDelivery: encodeDelivery,
    decodeDelivery: decodeDelivery,
    encodeAnswers: encodeAnswers,
    decodeAnswers: decodeAnswers,
    encodeStatuses: encodeStatuses,
    decodeStatuses: decodeStatuses,
    encodeShuffle: encodeShuffle,
    decodeShuffle: decodeShuffle,
    fingerprint: fingerprint,
    sameFingerprint: sameFingerprint,
  };
})();
```

- [ ] **Шаг 4: Прогнать тест кодека**

Run: `npm test -- tests/run-state-codec.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Шаг 5: Подключить модуль в бандл пакета**

В `server/scorm/index.ts` рядом с чтением прочих утилит (около строки 269, перед `suspendAttemptsJs`):

```typescript
  // PRD-36: run-state model + row codec. Must precede every part that reads or writes
  // suspend_data — suspendAttempts and sessionRecovery both call into TBRunState.
  const runStateJs = readOneOf([
    "app/utils/scorm/runState.js",
  ]);
```

и в массиве `joinJsParts` (строка 454) — строкой ВЫШЕ `suspendAttemptsJs`:

```typescript
    runStateJs,
    suspendAttemptsJs,
```

- [ ] **Шаг 6: Проверить, что пакет собирается и модуль в нём есть**

Run: `npm run scorm:template && node -e "const z=require('fs').readdirSync('out');console.log(z)"`
Expected: пакет собран; далее

Run: `npm test -- tests/scorm-export.test.ts tests/scorm-builders.test.ts`
Expected: PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add server/scorm/template/app/utils/scorm/runState.js tests/run-state-codec.test.ts server/scorm/index.ts
git commit -m "feat(scorm): кодек рядов состояния прогона (PRD-36 §4.6)"
```

---

### Task 3: Список ключей разреза и позиции выдачи в состоянии рантайма

**Files:**

- Modify: `server/scorm/builders/test-json.ts` (добавить `breakdownKeys` в `TEST_DATA`)
- Modify: `server/scorm/assets/app.js:258-277` (`generateVariant` пинит позиции)
- Modify: `server/scorm/template/app/state.js` (поля `deliveryPositions`, `deliveredForms`)
- Modify: `tests/run-state-codec.test.ts` (тест на позиции из `generateVariant`)

- [ ] **Шаг 1: Написать падающий тест на пин позиций**

Дописать в `tests/run-state-codec.test.ts`:

```typescript
describe("выдача пинится позициями при сборке варианта", () => {
  const appSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");

  it("generateVariant кладёт в state позицию каждого выданного вопроса", () => {
    expect(appSrc).toMatch(/state\.deliveryPositions\s*=/);
    // Позиция обязана сниматься с ТЕХ ЖЕ объектов, что уходят в flatQuestions,
    // иначе адрес и содержимое разъедутся на первом же перемешивании разделов.
    expect(appSrc).toMatch(/deliveryPositions\.push\(/);
  });
});
```

- [ ] **Шаг 2: Прогнать — тест падает**

Run: `npm test -- tests/run-state-codec.test.ts`
Expected: FAIL на двух новых ожиданиях.

- [ ] **Шаг 3: Выпечь список ключей разреза в `TEST_DATA`**

В `server/scorm/builders/test-json.ts`, там же где секции получают `breakdownRules`, добавить на
верхний уровень выпекаемого объекта:

```typescript
  // PRD-36 FR-02: breakdown keys are addressed by POSITION in the run state, so the package
  // carries the canonical key order. Built from the same rows the sections were baked from,
  // deduplicated, order stable — the index IS the address and must not drift between builds.
  breakdownKeys: Array.from(
    new Set(sections.flatMap((s) => (s.breakdownRules ?? []).map((r) => r.key))),
  ),
```

- [ ] **Шаг 4: Пинить позиции выдачи в `generateVariant`**

В `server/scorm/assets/app.js` внутри `generateVariant`, там где строится `sectionOf` и
заполняется `state.flatQuestions` (строки 254-277), добавить сбор позиций:

```javascript
  // PRD-36 FR-02: the ADDRESS of every delivered question — its position in TEST_DATA
  // (section index, index inside that section's bank). Collected here, next to the draw,
  // because this is the only place that still knows which bank object each question came
  // from; recovering it later by id would cost a scan per question on every save.
  var positionOf = {};
  TEST_DATA.sections.forEach(function (section, si) {
    (section.questions || []).forEach(function (q, qi) { positionOf[q.id] = { s: si, q: qi }; });
  });
  state.deliveryPositions = [];
  assembled.flat.forEach(function (q) {
    state.deliveryPositions.push(positionOf[q.id] || { s: -1, q: -1 });
  });
  // PRD-36 FR-19: the delivered PRD-17 variant per topic travels with the state, so a
  // resumed run resolves the same `by_variant` threshold a continuous run would.
  state.deliveredForms = {};
  state.variant.sections.forEach(function (vs) {
    if (vs.formId) state.deliveredForms[vs.topicId] = vs.formId;
  });
```

- [ ] **Шаг 5: Объявить новые поля состояния**

В `server/scorm/template/app/state.js` после `flatQuestions: []`:

```javascript
  // PRD-36: address of each delivered question in TEST_DATA ({ s, q } per delivery slot)
  // and the delivered PRD-17 variant per topic. Both are what suspend_data stores INSTEAD
  // of the question objects themselves.
  deliveryPositions: [],
  deliveredForms: {},
```

- [ ] **Шаг 6: Прогнать тесты**

Run: `npm test -- tests/run-state-codec.test.ts tests/scorm-builders.test.ts tests/draw-forms.test.ts`
Expected: PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add server/scorm/builders/test-json.ts server/scorm/assets/app.js server/scorm/template/app/state.js tests/run-state-codec.test.ts
git commit -m "feat(scorm): выдача и варианты адресуются позициями в TEST_DATA"
```

---

### Task 4: Сводка попытки, выбор лучшей и единая точка сохранения

**Files:**

- Modify: `server/scorm/template/app/utils/scorm/runState.js`
- Modify: `server/scorm/template/app/utils/scorm/suspendAttempts.js`
- Modify: `tests/run-state-store.test.ts`

- [ ] **Шаг 1: Написать падающий тест сводки и выбора лучшей**

Дописать в `tests/run-state-store.test.ts`:

```typescript
const codecSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${codecSrc}\nreturn TBRunState;`)() as any;

const attempt = (n: number, pc: number, at: string) => ({
  n, pc, at, c: 1, q: 2, e: 1, p: 2, ok: pc >= 60, t: [], bd: [], rv: {}, sv: {},
});

describe("выбор лучшей попытки", () => {
  it("больший процент побеждает", () => {
    expect(RS.pickBest(attempt(1, 80, "2026-08-01T10:00:00.000Z"),
      attempt(2, 50, "2026-08-02T10:00:00.000Z")).n).toBe(1);
  });

  it("при равенстве побеждает более поздняя", () => {
    expect(RS.pickBest(attempt(1, 80, "2026-08-01T10:00:00.000Z"),
      attempt(2, 80, "2026-08-02T10:00:00.000Z")).n).toBe(2);
  });

  it("первая завершённая попытка становится лучшей без сравнения", () => {
    expect(RS.pickBest(null, attempt(1, 10, "2026-08-01T10:00:00.000Z")).n).toBe(1);
  });
});

describe("сводка попытки", () => {
  const results = {
    percent: 75, correct: 3, totalQuestions: 4, earnedPoints: 3, possiblePoints: 4, passed: true,
    topicResults: [{
      topicId: "t1", topicName: "Тема", correct: 3, total: 4, earnedPoints: 3, possiblePoints: 4,
      percent: 75, passed: true, resolvedPassRule: { type: "percent", value: 70 },
      recommendedCourses: [{ title: "Курс", url: "https://example.test" }],
      breakdown: [{ scope: "section", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1,
        possible: 2, unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50 }],
    }],
    breakdowns: [],
    resultComputation: { values: { risk: 12 }, errors: [] },
    scaleComputation: { values: { E: 7 }, errors: [] },
  };
  const TEST_DATA = {
    sections: [{ topicId: "t1", questions: [{ id: "q1" }, { id: "q2" }] }],
    breakdownKeys: ["ПДн"],
  };

  it("в сводке нет ни названия темы, ни материалов, ни текста ключа", () => {
    const s = RS.buildSummary(results, TEST_DATA, { attemptNumber: 1, completedAt: "2026-08-15T10:00:00.000Z", source: "portal", deliveredForms: {} });
    const raw = JSON.stringify(s);
    expect(raw).not.toContain("Тема");
    expect(raw).not.toContain("example.test");
    expect(raw).not.toContain("ПДн");
  });

  it("тема адресуется номером раздела, ключ разреза — номером ключа", () => {
    const s = RS.buildSummary(results, TEST_DATA, { attemptNumber: 1, completedAt: "2026-08-15T10:00:00.000Z", source: "portal", deliveredForms: {} });
    expect(s.t[0].s).toBe(0);
    expect(s.t[0].bd[0].k).toBe(0);
  });
});
```

- [ ] **Шаг 2: Прогнать — падает на отсутствии `pickBest`/`buildSummary`**

Run: `npm test -- tests/run-state-store.test.ts`
Expected: FAIL — `RS.pickBest is not a function`.

- [ ] **Шаг 3: Добавить сводку и выбор лучшей в `runState.js`**

Внутрь `TBRunState` (перед `return`):

```javascript
  /** FR-04: higher percent wins; on a tie the LATER attempt does. */
  function pickBest(current, candidate) {
    if (!current) return candidate;
    if (!candidate) return current;
    if (candidate.pc !== current.pc) return candidate.pc > current.pc ? candidate : current;
    return new Date(candidate.at) >= new Date(current.at) ? candidate : current;
  }

  function sectionIndexOf(testData, topicId) {
    var sections = (testData && testData.sections) || [];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].topicId === topicId) return i;
    }
    return -1;
  }

  function keyIndexOf(testData, key) {
    var keys = (testData && testData.breakdownKeys) || [];
    for (var i = 0; i < keys.length; i++) if (keys[i] === key) return i;
    return -1;
  }

  /** FR-18: a breakdown row shrinks to its numbers; the key text lives in TEST_DATA. */
  function packBreakdown(entries, testData) {
    var out = [];
    for (var i = 0; i < (entries || []).length; i++) {
      var e = entries[i];
      var ki = keyIndexOf(testData, e.key);
      if (ki < 0) continue;
      out.push({ k: ki, i: e.items, a: e.answered, e: e.earned, p: e.possible,
        pp: e.percentPoints, pu: e.percentUnits });
    }
    return out.length ? out : undefined;
  }

  /**
   * FR-22: the ONE place a finished attempt becomes a stored summary. Everything derivable
   * from TEST_DATA (topic name, recommendations, pass rule text, breakdown key) is dropped:
   * the package already ships it, and a second copy is exactly what overflows the budget.
   */
  function buildSummary(results, testData, meta) {
    var topics = [];
    var trs = (results && results.topicResults) || [];
    for (var i = 0; i < trs.length; i++) {
      var t = trs[i];
      topics.push({
        s: sectionIndexOf(testData, t.topicId),
        c: t.correct, q: t.total, e: t.earnedPoints, p: t.possiblePoints,
        pc: t.percent, ok: t.passed,
        f: (meta.deliveredForms || {})[t.topicId] || undefined,
        r: (t.resolvedPassRule && t.resolvedPassRule.value != null) ? t.resolvedPassRule.value : undefined,
        bd: packBreakdown(t.breakdown, testData),
      });
    }
    var testScope = [];
    var all = (results && results.breakdowns) || [];
    for (var j = 0; j < all.length; j++) if (all[j].scope === 'test') testScope.push(all[j]);
    return {
      n: meta.attemptNumber,
      at: meta.completedAt,
      src: meta.source,
      pc: results.percent, c: results.correct, q: results.totalQuestions,
      e: parseFloat(results.earnedPoints) || 0, p: parseFloat(results.possiblePoints) || 0,
      ok: !!results.passed,
      t: topics,
      bd: packBreakdown(testScope, testData),
      rv: (results.resultComputation && results.resultComputation.values) || {},
      sv: (results.scaleComputation && results.scaleComputation.values) || {},
    };
  }
```

и добавить в возвращаемый объект: `pickBest: pickBest, buildSummary: buildSummary,
sectionIndexOf: sectionIndexOf, keyIndexOf: keyIndexOf,`.

- [ ] **Шаг 4: Перевести `saveAttemptResult` на сводку**

В `server/scorm/template/app/utils/scorm/suspendAttempts.js` заменить тело `saveAttemptResult`
(строки 211-255) на единственную точку сборки:

```javascript
/**
 * PRD-36 FR-03/FR-05/FR-22: persist a FINISHED attempt. The state keeps a counter, the best
 * summary and the last one — never a list: every consumer reads a maximum, a tail or a length,
 * and an unbounded array is what silently blew the 64000-character limit on the third attempt.
 */
function saveAttemptResult(resultData) {
  var s = readSuspendObj();
  var summary = TBRunState.buildSummary(resultData, TEST_DATA, {
    attemptNumber: s.attemptsUsed,
    // PRD-31: the portal clock, not the machine's — this mark is what barrier B
    // measures the next attempt against.
    completedAt: nowIso(),
    source: trustedNowSource(),
    deliveredForms: (typeof state !== 'undefined' && state.deliveredForms) || {},
  });
  summary.d = TBRunState.buildDetail(state);
  var best = TBRunState.pickBest(TBRunState.bestOf(s), summary);
  s.best = best;
  s.last = (best === summary) ? 0 : summary;
  writeSuspendObj(s);
}
```

Добавить в `runState.js` разворот текущей лучшей и сборку детализации:

```javascript
  /** The stored best summary, whatever format version the state came in. */
  function bestOf(stateObj) {
    return (stateObj && stateObj.best) || null;
  }

  /** FR-06/FR-07: rows of the attempt being stored — delivery, answers, statuses. */
  function buildDetail(runtimeState) {
    if (!runtimeState || !runtimeState.flatQuestions || !runtimeState.flatQuestions.length) return undefined;
    var questions = [], answers = [], statuses = [];
    for (var i = 0; i < runtimeState.flatQuestions.length; i++) {
      var q = runtimeState.flatQuestions[i].question;
      questions.push(q);
      answers.push(runtimeState.answers[q.id]);
      statuses.push((runtimeState.questionStatuses || {})[q.id] || 'unanswered');
    }
    return {
      dl: encodeDelivery(runtimeState.deliveryPositions || []),
      an: encodeAnswers(answers, questions),
      st: encodeStatuses(statuses),
    };
  }
```

и добавить обе в возвращаемый объект.

- [ ] **Шаг 5: Прогнать тесты**

Run: `npm test -- tests/run-state-store.test.ts tests/run-state-codec.test.ts`
Expected: PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add server/scorm/template/app/utils/scorm/runState.js server/scorm/template/app/utils/scorm/suspendAttempts.js tests/run-state-store.test.ts
git commit -m "feat(scorm): попытка хранится сводкой, история списком не ведётся"
```

---

### Task 5: Бюджет, порядок жертв и три исхода чтения

**Files:**

- Modify: `server/scorm/template/app/utils/scorm/runState.js`
- Modify: `server/scorm/template/app/utils/scorm/suspendAttempts.js`
- Modify: `tests/run-state-store.test.ts`

- [ ] **Шаг 1: Написать падающий тест бюджета и жертв**

Дописать в `tests/run-state-store.test.ts`:

```typescript
describe("бюджет состояния", () => {
  const bulky = (chars: number) => ({
    v: 2, attemptsUsed: 3,
    best: { n: 3, at: "2026-08-15T10:00:00.000Z", pc: 50, ok: false, t: [], bd: [],
      rv: {}, sv: {}, d: { dl: "x".repeat(chars), an: "", st: "", sh: "" } },
    last: 0,
    currentSession: { at: "2026-08-15T10:00:00.000Z", i: 1, dl: "0.0", an: "1", st: "a", sh: "01" },
    timer: { limitMinutes: 30, baselineTotalSec: 60, sig: "abc" },
    retake: { lastCompletedDate: "2026-08-15" },
  });

  it("состояние в бюджете не режется", () => {
    const fitted = RS.fitToBudget(bulky(10), 4096);
    expect(fitted.sacrifices).toEqual([]);
    expect(fitted.state.best.d).toBeDefined();
  });

  it("первой жертвуется детализация лучшей попытки", () => {
    const fitted = RS.fitToBudget(bulky(5000), 4096);
    expect(fitted.sacrifices).toContain("best.detail");
    expect(fitted.state.best.d).toBeUndefined();
  });

  it("счётчик, барьеры и таймер не жертвуются никогда", () => {
    const fitted = RS.fitToBudget(bulky(500000), 4096);
    expect(fitted.state.attemptsUsed).toBe(3);
    expect(fitted.state.timer.sig).toBe("abc");
    expect(fitted.state.retake.lastCompletedDate).toBe("2026-08-15");
  });

  it("прогон в работе не жертвуется раньше сводки лучшей", () => {
    const fitted = RS.fitToBudget(bulky(500000), 4096);
    expect(fitted.state.currentSession.an).toBe("1");
  });
});

describe("исход чтения состояния", () => {
  it("пусто, разобрано и повреждено — три разных исхода", () => {
    expect(RS.parseState("").outcome).toBe("empty");
    expect(RS.parseState('{"v":2,"attemptsUsed":1}').outcome).toBe("parsed");
    expect(RS.parseState('{"v":2,"attempts').outcome).toBe("corrupt");
  });
});
```

- [ ] **Шаг 2: Прогнать — падает**

Run: `npm test -- tests/run-state-store.test.ts`
Expected: FAIL — `RS.fitToBudget is not a function`.

- [ ] **Шаг 3: Реализовать бюджет и разбор**

В `runState.js`:

```javascript
  var BUDGET = 4096; // FR-15: the SCORM 1.2 limit; a 15x margin on 2004.

  /**
   * FR-14 / §6.2: fit the state into the budget by a DECLARED order of sacrifices, never by
   * silently truncating the string. What goes first is what a learner loses least by: the LMS
   * report's per-question interactions. What never goes is what the attempt limit and both
   * eligibility barriers stand on.
   */
  function fitToBudget(stateObj, budget) {
    var limit = budget || BUDGET;
    var s = JSON.parse(JSON.stringify(stateObj || {}));
    var sacrifices = [];
    var fits = function () { return JSON.stringify(s).length <= limit; };
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.best && s.best.d) { delete s.best.d; sacrifices.push('best.detail'); }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.currentSession && s.currentSession.sh) {
      delete s.currentSession.sh; sacrifices.push('session.shuffle');
    }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.best) {
      s.best = { n: s.best.n, at: s.best.at, src: s.best.src, pc: s.best.pc, ok: s.best.ok };
      sacrifices.push('best.summary');
    }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (typeof s.last === 'object' && s.last) {
      s.last = { n: s.last.n, at: s.last.at, src: s.last.src, pc: s.last.pc, ok: s.last.ok };
      sacrifices.push('last.summary');
    }
    return { state: s, sacrifices: sacrifices };
  }

  /** FR-24: an unreadable state is NOT an empty one — the two used to be indistinguishable. */
  function parseState(raw) {
    if (!raw) return { outcome: 'empty', state: { v: 2, attemptsUsed: 0 } };
    try {
      return { outcome: 'parsed', state: JSON.parse(raw) };
    } catch (e) {
      return { outcome: 'corrupt', state: { v: 2, attemptsUsed: 0 } };
    }
  }
```

и в возвращаемый объект: `fitToBudget: fitToBudget, parseState: parseState, BUDGET: BUDGET,`.

- [ ] **Шаг 4: Подключить бюджет и исход к чтению/записи**

В `suspendAttempts.js` заменить `readSuspendObj` и `writeSuspendObj`:

```javascript
/** Last read outcome ('empty' | 'parsed' | 'corrupt'), surfaced to the debug player. */
var lastReadOutcome = 'empty';
/** Sacrifices applied by the last write (§6.2), surfaced to the debug player. */
var lastWriteSacrifices = [];

function readSuspendObj() {
  var raw = '';
  try {
    raw = SCORM.getValue('cmi.suspend_data') || '';
  } catch (e) {
    raw = '';
  }
  var parsed = TBRunState.parseState(raw);
  lastReadOutcome = parsed.outcome;
  if (parsed.outcome === 'corrupt') {
    // The class of error this whole work exists to end: a truncated string used to be
    // returned as «no state», silently reopening the attempt limit and both barriers.
    console.log('⚠️ suspend_data повреждён (' + raw.length + ' симв.) — состояние не восстановлено');
  }
  // Приведение старого формата подключается задачей 6 — здесь состояние возвращается как есть.
  return parsed.state;
}

function writeSuspendObj(obj) {
  try {
    var fitted = TBRunState.fitToBudget(obj || {}, TBRunState.BUDGET);
    lastWriteSacrifices = fitted.sacrifices;
    if (fitted.sacrifices.length) {
      console.log('⚠️ Бюджет suspend_data исчерпан, пожертвовано:', fitted.sacrifices.join(', '));
    }
    var raw = JSON.stringify(fitted.state);
    SCORM.setValue('cmi.suspend_data', raw);
    SCORM.commit();
    console.log('🔵 writeSuspendObj: ' + raw.length + ' из ' + TBRunState.BUDGET + ' симв.');
  } catch (e) {
    console.log('⚠️ Ошибка writeSuspendObj:', e);
  }
}
```

- [ ] **Шаг 5: Дать тестовому хелперу доступ к `TBRunState`**

С этого шага `suspendAttempts.js` обращается к глобалу `TBRunState`, которого в инжекте задачи 1
не было. Обновить `makeStore` в `tests/run-state-store.test.ts`: поднять кодек из исходника
и передать его фабрике параметром.

```typescript
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${codecSrc}\nreturn TBRunState;`)() as any;

  const factory = new Function(
    "SCORM", "TEST_DATA", "state", "console", "TBRunState",
    `${src}
     return { readSuspendObj: readSuspendObj, writeSuspendObj: writeSuspendObj,
              getAttemptsUsed: getAttemptsUsed, setAttemptsUsed: setAttemptsUsed };`,
  );
  const store = factory(
    SCORM,
    { maxAttempts: 3, retakePolicy: null, sections: [], breakdownKeys: [] },
    { answers: {}, flatQuestions: [] },
    { log: () => undefined },
    RS,
  ) as Store;
```

- [ ] **Шаг 6: Прогнать**

Run: `npm test -- tests/run-state-store.test.ts`
Expected: PASS. Тест «повреждённая строка не роняет чтение» из задачи 1 остаётся зелёным:
`parseState` на повреждённой строке отдаёт `{ v: 2, attemptsUsed: 0 }`.

- [ ] **Шаг 7: Коммит**

```bash
git add server/scorm/template/app/utils/scorm/runState.js server/scorm/template/app/utils/scorm/suspendAttempts.js tests/run-state-store.test.ts
git commit -m "feat(scorm): бюджет suspend_data с объявленным порядком жертв"
```

---

### Task 6: Приведение состояния формата 1 к формату 2

**Files:**

- Modify: `server/scorm/template/app/utils/scorm/runState.js`
- Create: `tests/run-state-migration.test.ts`

- [ ] **Шаг 1: Написать падающий тест миграции**

```typescript
/**
 * @module tests/run-state-migration
 * @description PRD-36 FR-12/FR-13, §7: пакет после правки встречает состояние, записанное
 * пакетом ДО неё. Счётчик попыток, лучшая, последняя и обе даты барьеров обязаны пережить
 * приведение — на них стоят лимит попыток, кулдаун PRD-6 и интервал PRD-31.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${src}\nreturn TBRunState;`)() as any;

const TEST_DATA = {
  sections: [{ topicId: "t1", questions: [{ id: "q1" }, { id: "q2" }] }],
  breakdownKeys: [],
};

const legacy = {
  attemptsUsed: 2,
  attempts: [
    { attemptNumber: 1, completedAt: "2026-08-01T10:00:00.000Z", percent: 40, passed: false,
      totalCorrect: 1, totalQuestions: 2, earnedPoints: 1, possiblePoints: 2, topicResults: [],
      answers: { q1: 0 }, flatQuestions: [{ topicId: "t1", question: { id: "q1", type: "single" } }] },
    { attemptNumber: 2, completedAt: "2026-08-02T10:00:00.000Z", percent: 90, passed: true,
      totalCorrect: 2, totalQuestions: 2, earnedPoints: 2, possiblePoints: 2, topicResults: [],
      answers: { q1: 1 }, flatQuestions: [{ topicId: "t1", question: { id: "q1", type: "single" } }] },
  ],
  timer: { limitMinutes: 30, baselineTotalSec: 120, sig: "abc" },
  retake: { lastCompletedDate: "2026-08-02" },
};

describe("приведение формата 1 к формату 2", () => {
  it("счётчик попыток сохраняется", () => {
    expect(RS.migrate(legacy, TEST_DATA).attemptsUsed).toBe(2);
  });

  it("лучшая выбирается по проценту, последняя — по хвосту массива", () => {
    const s = RS.migrate(legacy, TEST_DATA);
    expect(s.best.pc).toBe(90);
    expect(s.last).toBe(0); // лучшая и последняя совпали
  });

  it("якорь таймера и дата кулдауна не трогаются", () => {
    const s = RS.migrate(legacy, TEST_DATA);
    expect(s.timer).toEqual(legacy.timer);
    expect(s.retake).toEqual(legacy.retake);
  });

  it("содержимое вопросов при приведении отбрасывается", () => {
    expect(JSON.stringify(RS.migrate(legacy, TEST_DATA))).not.toContain("flatQuestions");
  });

  it("состояние формата 2 проходит насквозь", () => {
    const v2 = { v: 2, fp: RS.fingerprint(TEST_DATA), attemptsUsed: 1, best: null, last: 0 };
    expect(RS.migrate(v2, TEST_DATA)).toEqual(v2);
  });

  it("состояние ЧУЖОГО пакета теряет детализацию, но сохраняет счётчик и барьеры", () => {
    const alien = { v: 2, fp: "9:1,1,1,1,1,1,1,1,1:0", attemptsUsed: 2,
      best: { n: 2, at: "2026-08-02T10:00:00.000Z", pc: 90, ok: true, t: [], d: { dl: "0.0" } },
      last: 0, timer: legacy.timer, retake: legacy.retake };
    const s = RS.migrate(alien, TEST_DATA);
    expect(s.attemptsUsed).toBe(2);
    expect(s.retake).toEqual(legacy.retake);
    expect(s.best.d).toBeUndefined();
  });
});
```

- [ ] **Шаг 2: Прогнать — падает**

Run: `npm test -- tests/run-state-migration.test.ts`
Expected: FAIL — `RS.migrate is not a function`.

- [ ] **Шаг 3: Реализовать приведение**

В `runState.js`:

```javascript
  /** A legacy (format 1) attempt record as a format-2 summary; content is dropped. */
  function summaryFromLegacy(record, testData) {
    var topics = [];
    var trs = (record && record.topicResults) || [];
    for (var i = 0; i < trs.length; i++) {
      topics.push({
        s: sectionIndexOf(testData, trs[i].topicId),
        c: trs[i].correct, q: trs[i].total, e: trs[i].earnedPoints, p: trs[i].possiblePoints,
        pc: trs[i].percent, ok: trs[i].passed,
      });
    }
    return {
      n: record.attemptNumber, at: record.completedAt, src: record.completedAtSource,
      pc: record.percent, c: record.totalCorrect, q: record.totalQuestions,
      e: record.earnedPoints, p: record.possiblePoints, ok: !!record.passed,
      t: topics, rv: record.resultValues || {}, sv: record.scaleValues || {},
    };
  }

  /**
   * FR-12/FR-13: bring whatever the LMS hands back to format 2. Three inputs are possible —
   * format 2 of THIS package (pass through), format 2 of ANOTHER package (positions address
   * other questions: keep the counter and both barriers, drop the detail), and format 1
   * (fold the attempt array into counter + best + last).
   */
  function migrate(stateObj, testData) {
    var s = stateObj || {};
    if (s.v === 2) {
      if (s.fp && !sameFingerprint(s.fp, testData)) {
        if (s.best) delete s.best.d;
        if (s.currentSession) s.currentSession = null;
        s.fp = fingerprint(testData);
      }
      return s;
    }
    var attempts = s.attempts || [];
    var best = null;
    for (var i = 0; i < attempts.length; i++) {
      best = pickBest(best, summaryFromLegacy(attempts[i], testData));
    }
    var last = attempts.length ? summaryFromLegacy(attempts[attempts.length - 1], testData) : null;
    var out = {
      v: 2,
      fp: fingerprint(testData),
      attemptsUsed: typeof s.attemptsUsed === 'number' ? s.attemptsUsed : 0,
      best: best,
      last: (best && last && best.n === last.n) ? 0 : last,
    };
    // FR-16: the barriers' own fields travel unchanged, shape and meaning both.
    if (s.timer) out.timer = s.timer;
    if (s.retake) out.retake = s.retake;
    return out;
  }
```

и в возвращаемый объект: `migrate: migrate,`.

- [ ] **Шаг 4: Подключить приведение к чтению состояния**

В `suspendAttempts.js` в `readSuspendObj` заменить строку-заглушку задачи 5:

```javascript
  // FR-12: whatever the LMS hands back is brought to format 2 before anyone reads it —
  // one place, so no consumer ever branches on the format version.
  return TBRunState.migrate(parsed.state, TEST_DATA);
```

- [ ] **Шаг 5: Прогнать миграцию и весь набор состояния**

Run: `npm test -- tests/run-state-migration.test.ts tests/run-state-store.test.ts tests/run-state-codec.test.ts`
Expected: PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add server/scorm/template/app/utils/scorm/runState.js server/scorm/template/app/utils/scorm/suspendAttempts.js tests/run-state-migration.test.ts
git commit -m "feat(scorm): состояние прежнего формата приводится к формату 2"
```

---

### Task 7: Прогон в работе на позициях, перемешивание и вариант

**Files:**

- Modify: `server/scorm/template/app/utils/scorm/sessionRecovery.js`
- Modify: `server/scorm/template/app/render/startPage.js:72-81`
- Modify: `tests/scorm-session-recovery.test.ts`

- [ ] **Шаг 1: Дописать падающие тесты на два дефекта §8**

```typescript
describe("PRD-36 §8: продолжение прогона", () => {
  const recoverySrc = readFileSync(
    resolve(process.cwd(), "server/scorm/template/app/utils/scorm/sessionRecovery.js"),
    "utf8",
  );

  it("перемешивание вариантов сохраняется вместе с прогоном", () => {
    expect(recoverySrc).toMatch(/sh:\s*TBRunState\.encodeShuffle/);
    expect(recoverySrc).toMatch(/state\.shuffleMappings\s*=/);
  });

  it("выданный вариант PRD-17 сохраняется и восстанавливается", () => {
    expect(recoverySrc).toMatch(/f:\s*JSON\.parse\(JSON\.stringify\(state\.deliveredForms/);
    expect(recoverySrc).toMatch(/state\.deliveredForms\s*=\s*session\.f/);
  });

  it("содержимого вопросов в снимке прогона нет", () => {
    expect(recoverySrc).not.toMatch(/flatQuestions:\s*JSON\.parse/);
  });
});
```

- [ ] **Шаг 2: Прогнать — падает**

Run: `npm test -- tests/scorm-session-recovery.test.ts`
Expected: FAIL на трёх новых ожиданиях.

- [ ] **Шаг 3: Переписать сохранение прогона**

В `sessionRecovery.js` заменить тело `saveCurrentSession` (строки 38-64):

```javascript
  var s = readSuspendObj();
  var questions = [], answers = [], statuses = [], shuffles = [];
  var fq = state.flatQuestions || [];
  for (var i = 0; i < fq.length; i++) {
    var q = fq[i].question;
    questions.push(q);
    answers.push(state.answers[q.id]);
    statuses.push((state.questionStatuses || {})[q.id] || 'unanswered');
    shuffles.push((state.shuffleMappings || {})[q.id] || null);
  }
  s.currentSession = {
    at: new Date().toISOString(),
    i: state.currentIndex,
    // PRD-36 FR-10: rows instead of question objects — the checkpoint used to carry a full
    // copy of every delivered question, which is half of what overflowed the budget.
    dl: TBRunState.encodeDelivery(state.deliveryPositions || []),
    an: TBRunState.encodeAnswers(answers, questions),
    st: TBRunState.encodeStatuses(statuses),
    // PRD-36 §8: option order survives the break. Without it the learner returns to a screen
    // whose options sit in the AUTHOR's order — the answers stay right, the screen looks wrong.
    sh: TBRunState.encodeShuffle(shuffles),
    // PRD-36 FR-19 / §8: the delivered PRD-17 variant. Without it `deliveredFormId` returns
    // null after a resume and a `by_variant` threshold silently degrades to the topic's own.
    f: JSON.parse(JSON.stringify(state.deliveredForms || {})),
    fm: (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode) || 'linear_flat',
    rt: JSON.parse(JSON.stringify(state.routerTopicStates || {})),
    sr: JSON.parse(JSON.stringify(state.sectionResults || {})),
    rf: state.routerFinished === true,
    crt: state.currentRouterTopic || null,
    cpi: state.currentPageIndex || 0,
    sc: JSON.parse(JSON.stringify(state.sectionCommitted || {})),
  };
  writeSuspendObj(s);
```

- [ ] **Шаг 4: Переписать восстановление**

В том же файле заменить `restoreSession` (строки 155-169):

```javascript
/**
 * PRD-36 FR-10: rebuild the runtime state from the stored ROWS. The delivered questions come
 * back from TEST_DATA by position, so the checkpoint carries addresses, not content.
 */
function restoreSession(session) {
  var positions = TBRunState.decodeDelivery(session.dl || '');
  state.deliveryPositions = positions;
  state.flatQuestions = [];
  var questions = [];
  for (var i = 0; i < positions.length; i++) {
    var section = TEST_DATA.sections[positions[i].s];
    var q = section && section.questions ? section.questions[positions[i].q] : null;
    if (!q) continue;
    questions.push(q);
    state.flatQuestions.push({ question: q, topicId: section.topicId, topicName: section.topicName });
  }
  var answers = TBRunState.decodeAnswers(session.an || '', questions);
  var statuses = TBRunState.decodeStatuses(session.st || '');
  var shuffles = TBRunState.decodeShuffle(session.sh || '');
  state.answers = {};
  state.questionStatuses = {};
  state.shuffleMappings = {};
  for (var j = 0; j < questions.length; j++) {
    if (answers[j] !== undefined) state.answers[questions[j].id] = answers[j];
    state.questionStatuses[questions[j].id] = statuses[j] || 'unanswered';
    if (shuffles[j]) state.shuffleMappings[questions[j].id] = shuffles[j];
  }
  state.deliveredForms = session.f || {};
  // PRD-24 reads the pinned variant through state.variant — rebuild it from the stored map.
  state.variant = { sections: [] };
  for (var tid in state.deliveredForms) {
    if (Object.prototype.hasOwnProperty.call(state.deliveredForms, tid)) {
      state.variant.sections.push({ topicId: tid, formId: state.deliveredForms[tid] });
    }
  }
  state.currentIndex = session.i || 0;
  state.sectionCommitted = session.sc || {};
  state.phase = 'question';
  state.submitted = false;
  state.feedbackShown = false;
  state.answerConfirmed = false;
  state.timeExpired = false;
}
```

Там же в `determineRecovery` и `restoreRouterSession` заменить обращения к старым именам полей
(`session.flatQuestions` -> `session.dl`, `session.savedAt` -> `session.at`,
`session.flowMode` -> `session.fm`, `session.routerTopicStates` -> `session.rt`,
`session.sectionResults` -> `session.sr`, `session.routerFinished` -> `session.rf`),
а проверку «есть что восстанавливать» — на `!session.dl`.

- [ ] **Шаг 5: Поправить стартовый экран**

В `server/scorm/template/app/render/startPage.js` заменить проверку возобновления (строки 72-81):

```javascript
  var suspendObj = readSuspendObj();
  var pendingSession = suspendObj.currentSession;
  var pendingCount = pendingSession
    ? TBRunState.decodeDelivery(pendingSession.dl || '').length
    : 0;
  var canResume = !!(
    pendingSession &&
    !TEST_DATA.timeLimitMinutes &&
    TEST_DATA.mode !== 'adaptive' &&
    pendingCount > 0 &&
    !isSessionStale(pendingSession)
  );
```

и ниже, в передаче `resume`: `resume: canResume ? { index: (pendingSession.i || 0), total: pendingCount } : null,`.
В `isSessionStale` заменить `session.savedAt` на `session.at`.

- [ ] **Шаг 6: Прогнать**

Run: `npm test -- tests/scorm-session-recovery.test.ts tests/run-state-store.test.ts`
Expected: PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add server/scorm/template/app/utils/scorm/sessionRecovery.js server/scorm/template/app/render/startPage.js tests/scorm-session-recovery.test.ts
git commit -m "fix(scorm): продолжение прогона сохраняет порядок вариантов и выданный вариант"
```

---

### Task 8: Потребители сводки — экраны, отчёт, гейт

**Files:**

- Modify: `server/scorm/template/app/render/resultsPage.js:283-331` (interactions лучшей попытки)
- Modify: `server/scorm/template/app/render/startPage.js:58-70, 374`
- Modify: `server/scorm/template/app/render/viewResults.js`
- Modify: `server/scorm/template/app/utils/pdfExport.js:296`
- Modify: `server/scorm/template/app/eligibility/gate.js:461-474`
- Modify: `server/scorm/template/app/utils/scorm/suspendAttempts.js` — хелперы `getBestAttempt`,
  `getLastAttempt`, `hasCompletedAttempts`; `getAllAttempts` удаляется
- Create: `tests/run-state-consumers.test.ts`

- [ ] **Шаг 1: Написать падающий тест потребителей**

```typescript
/**
 * @module tests/run-state-consumers
 * @description PRD-36 FR-07/FR-08/FR-09: экраны и отчёт строятся по СВОДКЕ, а содержимое
 * вопросов для interactions разворачивается из позиций. Проверяется, что ни один потребитель
 * не остался на `attempts[]` и на сохранённом `flatQuestions`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const results = read("server/scorm/template/app/render/resultsPage.js");
const start = read("server/scorm/template/app/render/startPage.js");
const pdf = read("server/scorm/template/app/utils/pdfExport.js");
const gate = read("server/scorm/template/app/eligibility/gate.js");
const suspend = read("server/scorm/template/app/utils/scorm/suspendAttempts.js");

describe("потребители состояния", () => {
  it("массив попыток больше не читает никто", () => {
    expect(results).not.toMatch(/getAllAttempts\(\)/);
    expect(start).not.toMatch(/getAllAttempts\(\)/);
    expect(pdf).not.toMatch(/getAllAttempts\(\)/);
    expect(suspend).not.toMatch(/s\.attempts\.push/);
  });

  it("отчёт в LMS собирается из детализации лучшей, а не подменой flatQuestions", () => {
    expect(results).not.toMatch(/state\.flatQuestions = bestAttempt\.flatQuestions/);
    expect(results).toMatch(/TBRunState\.decodeDelivery/);
    // PRD-36 §8, дефект 1: статусы ТОЙ попытки, а не текущей.
    expect(results).toMatch(/state\.questionStatuses = /);
  });

  it("PDF берёт число попыток из счётчика", () => {
    expect(pdf).toMatch(/attemptsCount: .*getAttemptsUsed\(\)/);
  });

  it("гейт опознаёт повторный вход в состоянии обоих форматов", () => {
    expect(gate).toMatch(/obj\.best/);
    expect(gate).toMatch(/obj\.attempts/); // легаси-пакеты ещё живы в LMS
  });
});
```

- [ ] **Шаг 2: Прогнать — падает**

Run: `npm test -- tests/run-state-consumers.test.ts`
Expected: FAIL.

- [ ] **Шаг 3: Перевести хелперы состояния на сводку**

В `suspendAttempts.js` заменить `getAllAttempts`/`getBestAttempt`/`getLastAttempt`/`hasCompletedAttempts`:

```javascript
/** FR-03: the best summary; null until an attempt finishes. */
function getBestAttempt() {
  var s = readSuspendObj();
  return s.best || null;
}

/** FR-03: the last summary — `last: 0` means «same as best», the common case. */
function getLastAttempt() {
  var s = readSuspendObj();
  if (!s.best) return null;
  return (s.last === 0 || !s.last) ? s.best : s.last;
}

function hasCompletedAttempts() {
  return getAttemptsUsed() > 0;
}
```

Функцию `getAllAttempts` удалить: массива больше нет, и оставленная заглушка вернула бы
пустой список, из-за чего экран старта молча решил бы, что завершённых попыток не было.

В `attemptIntervalState` заменить `last.completedAt` на `last.at`.

- [ ] **Шаг 4: Собрать interactions из детализации лучшей**

В `resultsPage.js` заменить блок подмены состояния (строки 316-331):

```javascript
    if (bestAttempt && bestAttempt !== results && bestAttempt.d) {
      // PRD-36 FR-07/FR-08: the LMS report is built from the BEST attempt's own rows —
      // delivery positions, answers AND statuses. Before this the statuses of the CURRENT
      // run leaked into a past attempt's interactions (§8, defect 1).
      var savedAnswers = state.answers;
      var savedFlat = state.flatQuestions;
      var savedStatuses = state.questionStatuses;
      var positions = TBRunState.decodeDelivery(bestAttempt.d.dl || '');
      var flat = [], questions = [];
      for (var bi = 0; bi < positions.length; bi++) {
        var sec = TEST_DATA.sections[positions[bi].s];
        var bq = sec && sec.questions ? sec.questions[positions[bi].q] : null;
        if (!bq) continue;
        questions.push(bq);
        flat.push({ question: bq, topicId: sec.topicId, topicName: sec.topicName });
      }
      var bAnswers = TBRunState.decodeAnswers(bestAttempt.d.an || '', questions);
      var bStatuses = TBRunState.decodeStatuses(bestAttempt.d.st || '');
      state.answers = {};
      state.questionStatuses = {};
      for (var bj = 0; bj < questions.length; bj++) {
        if (bAnswers[bj] !== undefined) state.answers[questions[bj].id] = bAnswers[bj];
        state.questionStatuses[questions[bj].id] = bStatuses[bj] || 'unanswered';
      }
      state.flatQuestions = flat;

      finishScormLmsOnly(resultsForLms, bestPassed, resultComputation, scaleComputation);

      state.answers = savedAnswers;
      state.flatQuestions = savedFlat;
      state.questionStatuses = savedStatuses;
    } else {
      finishScormLmsOnly(resultsForLms, bestPassed, resultComputation, scaleComputation);
    }
```

Выше, где берётся `resultsForLms`, привести сводку к форме, которую ждёт сборщик: `percent`,
`passed`, `topicResults` собираются из сводки развёртыванием позиций — добавить в `runState.js`:

```javascript
  /**
   * FR-09: a stored summary as the result shape the screens and the LMS builder expect.
   * Everything the summary dropped (topic name, recommendations, pass rule) comes back from
   * TEST_DATA by position — that is the whole point of storing addresses instead of copies.
   */
  function expandSummary(summary, testData) {
    if (!summary) return null;
    var keys = (testData && testData.breakdownKeys) || [];
    var unpackBd = function (rows, scope) {
      var out = [];
      for (var i = 0; i < (rows || []).length; i++) {
        var r = rows[i];
        out.push({ scope: scope, axis: 'tag', key: keys[r.k], items: r.i, answered: r.a,
          earned: r.e, possible: r.p, unitEarned: r.e, unitPossible: r.p,
          percentPoints: r.pp, percentUnits: r.pu });
      }
      return out;
    };
    var topics = [];
    for (var i = 0; i < (summary.t || []).length; i++) {
      var t = summary.t[i];
      var section = ((testData && testData.sections) || [])[t.s] || {};
      topics.push({
        topicId: section.topicId, topicName: section.topicName,
        correct: t.c, total: t.q, earnedPoints: t.e, possiblePoints: t.p,
        percent: t.pc, passed: t.ok,
        resolvedPassRule: t.r != null ? { type: 'percent', value: t.r } : null,
        recommendedCourses: section.recommendedCourses || [],
        recommendedEvents: section.recommendedEvents || [],
        breakdown: unpackBd(t.bd, 'section'),
        groupKey: section.groupKey || null,
      });
    }
    return {
      attemptNumber: summary.n, completedAt: summary.at, completedAtSource: summary.src,
      percent: summary.pc, correct: summary.c, totalQuestions: summary.q,
      earnedPoints: summary.e, possiblePoints: summary.p, passed: summary.ok,
      topicResults: topics, breakdowns: unpackBd(summary.bd, 'test'),
      resultValues: summary.rv || {}, scaleValues: summary.sv || {},
      d: summary.d,
    };
  }
```

и вызывать `expandSummary` там, где экраны сегодня получают запись попытки: `getBestAttempt()` в
`resultsPage.js` (строка 283), `startPage.js` (строки 70, 374), `viewResults.js`.

- [ ] **Шаг 5: Поправить PDF и гейт**

`pdfExport.js:296`:

```javascript
      attemptsCount: (typeof getAttemptsUsed === 'function') ? getAttemptsUsed() : 1
```

`gate.js` в проверке повторного входа (строки 465-471) — добавить формат 2 перед легаси:

```javascript
      // PRD-36: format 2 carries the counter and the best summary; the legacy array is still
      // checked because packages built before PRD-36 keep writing it inside their own runs.
      if (typeof obj.attemptsUsed === 'number' && obj.attemptsUsed > 0) return true;
      if (obj.best) return true;
      if (obj.attempts && obj.attempts.length > 0) return true;
```

- [ ] **Шаг 6: Прогнать целевые тесты**

```bash
npm test -- tests/run-state-consumers.test.ts tests/breakdown-block-hosts.test.ts
npm test -- tests/results-report-action.test.ts tests/results-ipsative-scorm.test.ts
```

Expected: PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add server/scorm/template/app tests/run-state-consumers.test.ts
git commit -m "feat(scorm): экраны и отчёт строятся по сводке попытки"
```

---

### Task 9: Отладочный плеер PRD-18

**Files:**

- Modify: `server/scorm/debug-player/assets/inspector-compute.js:261-300` (протокол прошлой попытки)
- Modify: `client/src/features/tests/debug-player/inspector-snapshot.ts` (доля бюджета)
- Modify: `tests/debug-player-snapshot.test.ts`

- [ ] **Шаг 1: Написать падающий тест инспектора**

Дописать в `tests/debug-player-snapshot.test.ts`:

```typescript
describe("PRD-36: инспектор показывает бюджет состояния", () => {
  it("снимок несёт длину состояния и его долю бюджета", () => {
    const cmi = { "cmi.suspend_data": JSON.stringify({ v: 2, attemptsUsed: 1, best: null }) };
    const snap = buildInspectorSnapshot({ cmi } as never);
    expect(snap.runState.length).toBe(cmi["cmi.suspend_data"].length);
    expect(snap.runState.budget).toBe(4096);
    expect(snap.runState.share).toBeCloseTo(cmi["cmi.suspend_data"].length / 4096, 5);
  });
});
```

- [ ] **Шаг 2: Прогнать — падает**

Run: `npm test -- tests/debug-player-snapshot.test.ts`
Expected: FAIL — `snap.runState is undefined`.

- [ ] **Шаг 3: Отдать долю бюджета в снимок**

В `client/src/features/tests/debug-player/inspector-snapshot.ts` рядом с чтением `cmi.suspend_data`
(строка 277) добавить в возвращаемый снимок:

```typescript
  // PRD-36 FR-17: the run state is a BUDGET, not a bucket — the debug player is where its
  // occupancy has to be visible, otherwise the only signal of an overflow is the silent
  // failure this whole work exists to end.
  const rawRunState = cmi["cmi.suspend_data"] || "";
  const runState = {
    length: rawRunState.length,
    budget: 4096,
    share: rawRunState.length / 4096,
  };
```

- [ ] **Шаг 4: Строить протокол прошлой попытки из позиций**

В `server/scorm/debug-player/assets/inspector-compute.js` заменить `getSuspendAttempts` и
`buildAttemptRows`:

```javascript
  /** PRD-36: the stored best/last summaries, in the order the tabs show them. */
  function getSuspendAttempts(cmi) {
    try {
      var s = JSON.parse((cmi && cmi["cmi.suspend_data"]) || "null");
      if (!s) return [];
      if (s.attempts) return s.attempts; // legacy package, format 1
      var out = [];
      if (s.best) out.push(s.best);
      if (s.last && typeof s.last === "object") out.push(s.last);
      return out;
    } catch (e) { return []; }
  }

  /**
   * PRD-36: a past attempt's rows come from the package's own TEST_DATA by position — the
   * attempt no longer carries question objects. A legacy attempt (format 1) still does, and
   * both shapes are shown by the same tab.
   */
  function buildAttemptRows(att, pkg) {
    if (att.flatQuestions) {
      return att.flatQuestions.map(function (fq) {
        return { q: fq.question, topicName: fq.topicName, answer: (att.answers || {})[fq.question.id], levelName: null };
      });
    }
    var detail = att.d;
    var data = pkg && pkg.TEST_DATA;
    if (!detail || !data) return [];
    var positions = window.TBRunState.decodeDelivery(detail.dl || "");
    var questions = [], rows = [];
    positions.forEach(function (p) {
      var sec = (data.sections || [])[p.s];
      var q = sec && sec.questions ? sec.questions[p.q] : null;
      if (!q) return;
      questions.push(q);
      rows.push({ q: q, topicName: sec.topicName, answer: undefined, levelName: null });
    });
    var answers = window.TBRunState.decodeAnswers(detail.an || "", questions);
    rows.forEach(function (row, i) { row.answer = answers[i]; });
    return rows;
  }
```

Вызов `buildAttemptRows(att)` в `buildProtocolRows` заменить на `buildAttemptRows(att, pkg)`.

- [ ] **Шаг 5: Прогнать тесты плеера**

Run: `npm test -- tests/debug-player-snapshot.test.ts tests/scorm-debug-player-assets.test.ts client/src/features/tests/debug-player`
Expected: PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add server/scorm/debug-player client/src/features/tests/debug-player tests/debug-player-snapshot.test.ts
git commit -m "feat(scorm): отладочный плеер показывает состояние формата 2 и долю бюджета"
```

---

### Task 10: Замер бюджета на контрольном тесте

**Files:**

- Create: `tests/run-state-budget.test.ts`

- [ ] **Шаг 1: Написать тест бюджета на контрольном составе**

```typescript
/**
 * @module tests/run-state-budget
 * @description PRD-36 §11 критерий 3: тест 60 вопросов / 10 тем / 5 шкал / 5 показателей /
 * 11 ключей разреза укладывается в 4096 символов С завершённой попыткой И прогоном в работе
 * одновременно. Порог проверяется ФАКТИЧЕСКИ, а не оценкой: состав задаёт автор, не разработчик.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${src}\nreturn TBRunState;`)() as any;

const SECTIONS = 10;
const PER_SECTION = 6; // 60 delivered questions
const KEYS = 11;

const TEST_DATA = {
  sections: Array.from({ length: SECTIONS }, (_, s) => ({
    topicId: `t${s}`,
    topicName: `Тема номер ${s} с длинным названием`,
    questions: Array.from({ length: 20 }, (_, q) => ({ id: `q-${s}-${q}`, type: "single" })),
  })),
  breakdownKeys: Array.from({ length: KEYS }, (_, k) => `Ключ разреза номер ${k}`),
};

function summary() {
  return {
    n: 3, at: "2026-08-15T10:22:03.000Z", src: "portal",
    pc: 78.5, c: 47, q: 60, e: 47, p: 60, ok: true,
    t: Array.from({ length: SECTIONS }, (_, s) => ({
      s, c: 5, q: 6, e: 5, p: 6, pc: 83.3, ok: true, f: "form-a", r: 70,
      bd: [{ k: s % KEYS, i: 6, a: 6, e: 4, p: 6, pp: 66.7, pu: 66.7 }],
    })),
    bd: Array.from({ length: KEYS }, (_, k) => ({ k, i: 6, a: 6, e: 4, p: 6, pp: 66.7, pu: 66.7 })),
    rv: { risk: 12, focus: 8, stress: 4, energy: 9, drive: 3 },
    sv: { E: 7, I: 5, S: 6, N: 4, T: 8 },
    d: detail(),
  };
}

function detail() {
  const positions = Array.from({ length: SECTIONS * PER_SECTION }, (_, i) => ({
    s: Math.floor(i / PER_SECTION), q: i % PER_SECTION,
  }));
  const questions = positions.map(() => ({ type: "single" }));
  return {
    dl: RS.encodeDelivery(positions),
    an: RS.encodeAnswers(questions.map((_, i) => i % 4), questions),
    st: RS.encodeStatuses(questions.map(() => "answered")),
  };
}

describe("бюджет на контрольном тесте", () => {
  it("завершённая попытка и прогон в работе вместе умещаются в 4096", () => {
    const positions = Array.from({ length: SECTIONS * PER_SECTION }, (_, i) => ({
      s: Math.floor(i / PER_SECTION), q: i % PER_SECTION,
    }));
    const questions = positions.map(() => ({ type: "single" }));
    const state = {
      v: 2, fp: RS.fingerprint(TEST_DATA), attemptsUsed: 3,
      best: summary(), last: 0,
      currentSession: {
        at: "2026-08-15T10:40:00.000Z", i: 27,
        dl: RS.encodeDelivery(positions),
        an: RS.encodeAnswers(questions.map((_, i) => i % 4), questions),
        st: RS.encodeStatuses(questions.map(() => "answered")),
        sh: RS.encodeShuffle(questions.map(() => [2, 0, 3, 1])),
        f: { t0: "form-a", t1: "form-b" }, fm: "linear_flat",
        rt: {}, sr: {}, rf: false, crt: null, cpi: 0, sc: {},
      },
      timer: { limitMinutes: 60, baselineTotalSec: 1800, sig: "1a2b3c" },
      retake: { lastCompletedDate: "2026-08-15" },
    };
    const size = JSON.stringify(state).length;
    // Диагностика на случай падения: печатать размер, а не только вердикт.
    expect({ size }).toEqual({ size: expect.any(Number) });
    expect(size).toBeLessThanOrEqual(4096);
  });

  it("состояние не растёт с числом попыток", () => {
    const one = { v: 2, attemptsUsed: 1, best: summary(), last: 0 };
    const fifty = { v: 2, attemptsUsed: 50, best: summary(), last: 0 };
    expect(Math.abs(JSON.stringify(fifty).length - JSON.stringify(one).length)).toBeLessThanOrEqual(2);
  });

  it("состояние не содержит текстов пакета", () => {
    const raw = JSON.stringify({ v: 2, attemptsUsed: 3, best: summary(), last: 0 });
    expect(raw).not.toContain("Тема номер");
    expect(raw).not.toContain("Ключ разреза");
  });
});
```

- [ ] **Шаг 2: Прогнать**

Run: `npm test -- tests/run-state-budget.test.ts`
Expected: PASS. Если первый тест падает — печатать `size` и урезать по §6.2 не тест, а модель:
жертвовать можно только тем, что перечислено в порядке жертв, менять критерий приёмки нельзя
без владельца продукта.

- [ ] **Шаг 3: Коммит**

```bash
git add tests/run-state-budget.test.ts
git commit -m "test(scorm): контрольный тест бюджета состояния прогона"
```

---

### Task 11: Сборка пакета и приёмка

**Files:** изменений кода нет; задача — проверка собранного пакета.

- [ ] **Шаг 1: Собрать образец и открыть плеер**

```bash
npm run scorm:template
npm run scorm:player
```

Открыть `http://localhost:5050`, пройти тест целиком.

- [ ] **Шаг 2: Проверить критерий 1 спеки**

В отладочном плеере (вкладка «LMS» / «Состояние») найти строку `cmi.suspend_data`. Проверить поиском
по строке: ни одного текста вопроса, варианта ответа, названия темы, адреса материала, текста ключа.

- [ ] **Шаг 3: Проверить критерии 5, 6, 7**

- Тест с «возвратом к неотвеченным»: пройти дважды, вторую попытку сделать ХУЖЕ первой, проверить,
  что interactions в отчёте соответствуют лучшей попытке и её статусам.
- Прервать прогон на середине (закрыть SCO), войти снова, продолжить: порядок вариантов ответа
  тот же, что до перерыва.
- Тест с вариантами PRD-17 и правилом `by_variant`: сравнить порог темы и метку «Требуется…»
  у непрерывного прогона и у продолженного.

- [ ] **Шаг 4: Проверить критерий 10 (миграция)**

Собрать пакет ДО правки (`git stash` или сборка из `main`), пройти попытку, снять строку
`cmi.suspend_data` из консоли плеера. Затем открыть пакет ПОСЛЕ правки, подставив ту же строку
в состояние, и убедиться: счётчик попыток, лучшая попытка и обе даты барьеров на месте.

- [ ] **Шаг 5: Приёмка на живом стенде WebTutor (критерий 13)**

Выгрузить пакет в WebTutor, отыграть: две попытки подряд, прерывание посередине, барьер интервала
PRD-31, кулдаун PRD-6. Приложить к отчёту снимки и снятую строку состояния с её длиной.

- [ ] **Шаг 6: Коммит отчёта приёмки**

```bash
git add docs/specs/prd-36/run-state-compactness.md
git commit -m "docs(prd-36): отметка о пройденной приёмке"
```

---

## Проверка этапа

- [ ] `npm run check` — чисто
- [ ] целевые прогоны — PASS:

```bash
npm test -- tests/run-state-codec.test.ts tests/run-state-store.test.ts tests/run-state-migration.test.ts
npm test -- tests/run-state-consumers.test.ts tests/run-state-budget.test.ts tests/scorm-session-recovery.test.ts
npm test -- tests/scorm-export.test.ts tests/scorm-builders.test.ts tests/draw-forms.test.ts
npm test -- tests/breakdown-block-hosts.test.ts tests/results-report-action.test.ts tests/results-ipsative-scorm.test.ts
npm test -- tests/debug-player-snapshot.test.ts tests/scorm-debug-player-assets.test.ts
npm test -- client/src/features/tests/debug-player
```

- [ ] `npm run lint:md` — чисто
- [ ] полный прогон `npm test` — ТОЛЬКО по явному разрешению владельца
- [ ] приёмка Task 11 проведена, снимки и снятая строка состояния приложены к отчёту
- [ ] сверка со спекой: FR-01 - FR-24 и NFR-01 - NFR-05 закрыты; 13 критериев §11 проверены,
      для каждого назван способ проверки (тест или прогон)
- [ ] ROADMAP: строка PRD-36 переведена из «НЕ НАЧАТ» в реализованный статус с датой и перечнем
      закрытых дефектов §8
