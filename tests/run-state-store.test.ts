/**
 * @module tests/run-state-store
 * @description PRD-36: состояние прогона в `cmi.suspend_data`. Файл заведён ДО смены формата
 * и фиксирует поведение, которое обязано пережить правку: счётчик попыток, якорь таймера и обе
 * даты барьеров. Функции поднимаются из ИСХОДНИКА рантайма (port-паттерн), а не пересказываются:
 * пересказ остаётся зелёным при любой поломке пакета и потому ничего не охраняет.
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
  hasCompletedAttempts: () => boolean;
}

/** Runtime store bound to an in-memory SCORM data model. */
function makeStore(initial = ""): { store: Store; cmi: { value: string } } {
  const cmi = { value: initial };
  const SCORM = {
    getValue: (k: string) => (k === "cmi.suspend_data" ? cmi.value : ""),
    setValue: (k: string, v: string) => {
      if (k === "cmi.suspend_data") cmi.value = v;
    },
    commit: () => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "SCORM",
    "TEST_DATA",
    "state",
    "console",
    "TBRunState",
    `${src}
     return { readSuspendObj: readSuspendObj, writeSuspendObj: writeSuspendObj,
              getAttemptsUsed: getAttemptsUsed, setAttemptsUsed: setAttemptsUsed,
              hasCompletedAttempts: hasCompletedAttempts };`,
  );
  const store = factory(
    SCORM,
    { maxAttempts: 3, retakePolicy: null, sections: [], breakdownKeys: [] },
    { answers: {}, flatQuestions: [] },
    { log: () => undefined },
    RS,
  ) as Store;
  return { store, cmi };
}

const codecSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${codecSrc}\nreturn TBRunState;`)() as any;

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

describe("состояние прогона: есть ли завершённые попытки («Мой результат»)", () => {
  const summary = { n: 1, at: "2026-08-15T10:00:00.000Z", pc: 80, ok: true, t: [], bd: [], rv: {}, sv: {} };

  it("начатая и брошенная попытка завершённой не считается", () => {
    // Счётчик растёт на СТАРТЕ — так лимит попыток не обходится брошенной попыткой. Судить
    // по нему о результатах значило показать «Мой результат», которого нет.
    const { store } = makeStore(JSON.stringify({ v: 2, attemptsUsed: 1 }));
    expect(store.hasCompletedAttempts()).toBe(false);
  });

  it("сводка лучшей попытки — это и есть завершённая попытка", () => {
    const { store } = makeStore(JSON.stringify({ v: 2, attemptsUsed: 1, best: summary, last: 0 }));
    expect(store.hasCompletedAttempts()).toBe(true);
  });

  it("тест без лимита попыток счётчик не ведёт, но результат у него есть", () => {
    const { store } = makeStore(JSON.stringify({ v: 2, attemptsUsed: 0, best: summary, last: 0 }));
    expect(store.hasCompletedAttempts()).toBe(true);
  });
});

const attempt = (n: number, pc: number, at: string) => ({
  n, pc, at, c: 1, q: 2, e: 1, p: 2, ok: pc >= 60, t: [], bd: [], rv: {}, sv: {},
});

describe("выбор лучшей попытки", () => {
  it("больший процент побеждает", () => {
    expect(RS.pickBest(
      attempt(1, 80, "2026-08-01T10:00:00.000Z"),
      attempt(2, 50, "2026-08-02T10:00:00.000Z"),
    ).n).toBe(1);
  });

  it("при равенстве побеждает более поздняя", () => {
    expect(RS.pickBest(
      attempt(1, 80, "2026-08-01T10:00:00.000Z"),
      attempt(2, 80, "2026-08-02T10:00:00.000Z"),
    ).n).toBe(2);
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
      breakdown: [{
        scope: "section", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1,
        possible: 2, unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50,
      }],
    }],
    breakdowns: [],
    resultComputation: { values: { risk: 12 }, errors: [] },
    scaleComputation: { values: { E: 7 }, errors: [] },
  };
  const TEST_DATA = {
    sections: [{ topicId: "t1", questions: [{ id: "q1" }, { id: "q2" }] }],
    breakdownKeys: ["ПДн"],
  };
  const meta = {
    attemptNumber: 1, completedAt: "2026-08-15T10:00:00.000Z", source: "portal", deliveredForms: {},
  };

  it("в сводке нет ни названия темы, ни материалов, ни текста ключа", () => {
    const raw = JSON.stringify(RS.buildSummary(results, TEST_DATA, meta));
    expect(raw).not.toContain("Тема");
    expect(raw).not.toContain("example.test");
    expect(raw).not.toContain("ПДн");
  });

  it("тема адресуется номером раздела, ключ разреза — номером ключа", () => {
    const s = RS.buildSummary(results, TEST_DATA, meta);
    expect(s.t[0].s).toBe(0);
    expect(s.t[0].bd[0].k).toBe(0);
  });

  it("разрешённый порог темы сохраняется: по нему печатается «Требуется…»", () => {
    expect(RS.buildSummary(results, TEST_DATA, meta).t[0].r).toBe(70);
  });

  it("выданный вариант темы попадает в сводку", () => {
    const s = RS.buildSummary(results, TEST_DATA, { ...meta, deliveredForms: { t1: "form-a" } });
    expect(s.t[0].f).toBe("form-a");
  });

  it("значения показателей и шкал переезжают в сводку", () => {
    const s = RS.buildSummary(results, TEST_DATA, meta);
    expect(s.rv).toEqual({ risk: 12 });
    expect(s.sv).toEqual({ E: 7 });
  });
});

describe("бюджет состояния", () => {
  const bulky = (chars: number) => ({
    v: 2,
    attemptsUsed: 3,
    best: {
      n: 3, at: "2026-08-15T10:00:00.000Z", pc: 50, ok: false, t: [], bd: [], rv: {}, sv: {},
      d: { dl: "x".repeat(chars), an: "", st: "" },
    },
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

  it("ответы прогона в работе не жертвуются: это потеря попытки прямо на ходу", () => {
    const fitted = RS.fitToBudget(bulky(500000), 4096);
    expect(fitted.state.currentSession.an).toBe("1");
    expect(fitted.state.currentSession.dl).toBe("0.0");
    expect(fitted.state.currentSession.st).toBe("a");
  });

  it("исходное состояние не портится: режется копия", () => {
    const original = bulky(5000);
    RS.fitToBudget(original, 4096);
    expect(original.best.d).toBeDefined();
  });
});

describe("бюджет зависит от профиля выгрузки", () => {
  it("без выпеченного бюджета действует предел SCORM 2004", () => {
    // Проектная цель 4096 — это предел SCORM 1.2, к которому подогнана ФОРМА состояния.
    // Резать по ней в 2004, где LMS принимает 64000, значило бы выбрасывать данные,
    // которые LMS готова хранить.
    expect(RS.budgetFor({})).toBe(64000);
    expect(RS.DESIGN_BUDGET).toBe(4096);
  });

  it("пакет профиля 1.2 получает свой, тесный бюджет", () => {
    expect(RS.budgetFor({ stateBudget: 4096 })).toBe(4096);
  });

  it("тест на 20 тем в 2004 сохраняет сводку целиком", () => {
    const big = {
      v: 2, attemptsUsed: 3,
      best: {
        n: 3, at: "2026-08-15T10:00:00.000Z", pc: 68, ok: false,
        t: Array.from({ length: 20 }, (_, i) => ({ s: i, c: 2, q: 3, e: 2, p: 3, pc: 66.7, ok: true })),
        bd: Array.from({ length: 20 }, (_, k) => ({ k, i: 3, a: 3, e: 2, p: 3, pp: 66.7, pu: 66.7 })),
        rv: {}, sv: {},
      },
      last: 0,
    };
    const fitted = RS.fitToBudget(big, RS.budgetFor({}));
    expect(fitted.sacrifices).toEqual([]);
    expect(fitted.state.best.t).toHaveLength(20);
  });
});

describe("исход чтения состояния", () => {
  it("пусто, разобрано и повреждено — три разных исхода", () => {
    expect(RS.parseState("").outcome).toBe("empty");
    expect(RS.parseState('{"v":2,"attemptsUsed":1}').outcome).toBe("parsed");
    expect(RS.parseState('{"v":2,"attempts').outcome).toBe("corrupt");
  });

  it("повреждённое состояние не выдаётся за пустое, но и не роняет запуск", () => {
    const parsed = RS.parseState('{"v":2,"attempts');
    expect(parsed.outcome).toBe("corrupt");
    expect(parsed.state).toEqual({ v: 2, attemptsUsed: 0 });
  });
});
