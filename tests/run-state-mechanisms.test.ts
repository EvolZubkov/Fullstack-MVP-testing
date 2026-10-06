/**
 * @module tests/run-state-mechanisms
 * @description Состояние прогона делят ПЯТЬ независимых механизмов: учёт попыток,
 * якорь активного времени (PRD-20), интервал между попытками (PRD-31), кулдаун (PRD-6)
 * и остаток времени по разделам (PRD-4). Смена формата состояния (PRD-36) не должна была
 * задеть ни один — «до правки работало, значит и после обязано».
 *
 * До этого файла ни один из них не проверялся ПОВЕРХ состояния: в чужих тестах они
 * подставлялись заглушками, поэтому потеря секционных бюджетов при приведении формата
 * прошла мимо тестов и нашлась только разбором рисков выката. Здесь каждый механизм
 * исполняется на исходниках рантайма поверх настоящей строки состояния — и в новом
 * формате, и в состоянии пакета, собранного до правки.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const suspendSrc = read("server/scorm/template/app/utils/scorm/suspendAttempts.js");
const timerSrc = read("server/scorm/template/app/timer/timer.js");
const runStateSrc = read("server/scorm/template/app/utils/scorm/runState.js");

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${runStateSrc}\nreturn TBRunState;`)() as any;

const TEST_DATA_BASE = {
  maxAttempts: 3,
  retakePolicy: null as unknown,
  timeLimitMinutes: 30,
  sections: [{ topicId: "t1", questions: [{ id: "q1", type: "single" }, { id: "q2", type: "single" }] }],
  breakdownKeys: [],
  integritySecret: "s3cret",
};

interface Runtime {
  cmi: Record<string, string>;
  getAttemptsUsed: () => number;
  setAttemptsUsed: (n: number) => void;
  hasAttemptsLeft: () => boolean;
  registerAttemptStart: () => boolean;
  readTimerAnchor: () => unknown;
  writeTimerAnchor: (a: { limitMinutes: number; baselineTotalSec: number }) => void;
  clearTimerAnchor: () => void;
  attemptIntervalState: () => { allowed: boolean; availableAt: string | null };
  saveAttemptResult: (r: unknown) => void;
  readSuspendObj: () => any;
  writeSuspendObj: (o: unknown) => void;
  state: Record<string, unknown>;
}

/** Рантайм учёта попыток поверх памяти, с заданной начальной строкой состояния. */
function makeRuntime(initial = "", overrides: Record<string, unknown> = {}): Runtime {
  const cmi: Record<string, string> = initial ? { "cmi.suspend_data": initial } : {};
  const SCORM = {
    getValue: (k: string) => cmi[k] ?? "",
    setValue: (k: string, v: string) => { cmi[k] = String(v); },
    commit: () => undefined,
  };
  const TEST_DATA = { ...TEST_DATA_BASE, ...overrides };
  const state: Record<string, unknown> = {
    answers: { q1: 1 },
    questionStatuses: { q1: "answered" },
    deliveryPositions: [{ s: 0, q: 0 }],
    deliveredForms: {},
    flatQuestions: [{ question: TEST_DATA.sections[0].questions[0], topicId: "t1", topicName: "Тема" }],
  };
  // PRD-31 решает по общему движку допуска; здесь важен ФАКТ, который ему передали.
  const EligibilityEngine = {
    attemptIntervalDecision: (lastCompletedAt: string | null) => ({
      allowed: lastCompletedAt === null,
      availableAt: lastCompletedAt,
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "SCORM", "TEST_DATA", "state", "console", "TBRunState", "EligibilityEngine",
    `${suspendSrc}
     return { getAttemptsUsed: getAttemptsUsed, setAttemptsUsed: setAttemptsUsed,
              hasAttemptsLeft: hasAttemptsLeft, registerAttemptStart: registerAttemptStart,
              readTimerAnchor: readTimerAnchor, writeTimerAnchor: writeTimerAnchor,
              clearTimerAnchor: clearTimerAnchor, attemptIntervalState: attemptIntervalState,
              saveAttemptResult: saveAttemptResult, readSuspendObj: readSuspendObj,
              writeSuspendObj: writeSuspendObj };`,
  );
  const api = factory(SCORM, TEST_DATA, state, { log: () => undefined }, RS, EligibilityEngine);
  return { ...api, cmi, state } as Runtime;
}

/** Секционные бюджеты PRD-4 пишет ТАЙМЕР — отдельный модуль поверх того же состояния. */
function makeBudgets(rt: Runtime) {
  const lift = (name: string) => {
    const m = timerSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${name} not found in timer.js`);
    return m[0];
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "readSuspendObj", "writeSuspendObj",
    `${lift("readSectionBudgets")}\n${lift("writeSectionBudgets")}
     return { read: readSectionBudgets, write: writeSectionBudgets };`,
  );
  return factory(rt.readSuspendObj, rt.writeSuspendObj) as {
    read: () => Record<string, unknown>;
    write: (b: Record<string, unknown>) => void;
  };
}

const results = {
  percent: 50, correct: 1, totalQuestions: 2, earnedPoints: 1, possiblePoints: 2, passed: false,
  topicResults: [{ topicId: "t1", correct: 1, total: 2, earnedPoints: 1, possiblePoints: 2, percent: 50, passed: false }],
  breakdowns: [], resultComputation: { values: {}, errors: [] }, scaleComputation: { values: {}, errors: [] },
};

/** Состояние пакета, собранного ДО правки (формат 1), со всеми механизмами разом. */
const legacyState = JSON.stringify({
  attemptsUsed: 2,
  attempts: [
    { attemptNumber: 1, completedAt: "2026-08-01T10:00:00.000Z", percent: 40, passed: false,
      totalCorrect: 1, totalQuestions: 2, earnedPoints: 1, possiblePoints: 2, topicResults: [], answers: {}, flatQuestions: [] },
    { attemptNumber: 2, completedAt: "2026-08-02T10:00:00.000Z", percent: 90, passed: true,
      totalCorrect: 2, totalQuestions: 2, earnedPoints: 2, possiblePoints: 2, topicResults: [], answers: {}, flatQuestions: [] },
  ],
  timer: { limitMinutes: 30, baselineTotalSec: 120, sig: "unsigned-legacy" },
  retake: { lastCompletedDate: "2026-08-02" },
  sectionBudgets: { t1: { remainingMs: 420000 } },
  sectionGate: { open: null, closed: ["t1"] },
  rk: "lx1a2b3cq9zk",
});

describe("учёт попыток (maxAttempts)", () => {
  it("считает попытки в новом формате", () => {
    const rt = makeRuntime();
    expect(rt.getAttemptsUsed()).toBe(0);
    expect(rt.registerAttemptStart()).toBe(true);
    expect(rt.getAttemptsUsed()).toBe(1);
  });

  it("исчерпанные попытки закрывают старт", () => {
    const rt = makeRuntime();
    rt.setAttemptsUsed(3);
    expect(rt.hasAttemptsLeft()).toBe(false);
    expect(rt.registerAttemptStart()).toBe(false);
  });

  it("счётчик из состояния СТАРОГО пакета не обнуляется", () => {
    // Это ровно то, чем грозило переполнение: заново открытый лимит попыток.
    const rt = makeRuntime(legacyState);
    expect(rt.getAttemptsUsed()).toBe(2);
    expect(rt.hasAttemptsLeft()).toBe(true);
  });

  it("сохранение попытки счётчик не трогает", () => {
    const rt = makeRuntime();
    rt.setAttemptsUsed(2);
    rt.saveAttemptResult(results);
    expect(rt.getAttemptsUsed()).toBe(2);
  });
});

describe("якорь активного времени (PRD-20)", () => {
  it("записанный якорь читается обратно", () => {
    const rt = makeRuntime();
    rt.writeTimerAnchor({ limitMinutes: 30, baselineTotalSec: 120 });
    expect(rt.readTimerAnchor()).toMatchObject({ limitMinutes: 30, baselineTotalSec: 120 });
  });

  it("правка якоря в состоянии обнаруживается по подписи", () => {
    const rt = makeRuntime();
    rt.writeTimerAnchor({ limitMinutes: 30, baselineTotalSec: 120 });
    const s = rt.readSuspendObj();
    s.timer.baselineTotalSec = 0; // «вернуть себе время» правкой строки состояния
    rt.writeSuspendObj(s);
    expect(rt.readTimerAnchor()).toBeNull();
  });

  it("якорь переживает сохранение попытки", () => {
    const rt = makeRuntime();
    rt.writeTimerAnchor({ limitMinutes: 30, baselineTotalSec: 120 });
    rt.setAttemptsUsed(1);
    rt.saveAttemptResult(results);
    expect(rt.readTimerAnchor()).toMatchObject({ baselineTotalSec: 120 });
  });

  it("якорь из состояния СТАРОГО пакета не теряется при приведении формата", () => {
    const rt = makeRuntime(legacyState);
    expect(rt.readSuspendObj().timer).toMatchObject({ limitMinutes: 30, baselineTotalSec: 120 });
  });

  it("снятие якоря очищает только его", () => {
    const rt = makeRuntime();
    rt.setAttemptsUsed(2);
    rt.writeTimerAnchor({ limitMinutes: 30, baselineTotalSec: 120 });
    rt.clearTimerAnchor();
    expect(rt.readTimerAnchor()).toBeNull();
    expect(rt.getAttemptsUsed()).toBe(2);
  });
});

describe("интервал между попытками (PRD-31)", () => {
  const withPolicy = { retakePolicy: { attemptInterval: { enabled: true, hours: 24 } } };

  it("без завершённых попыток барьер открыт", () => {
    const rt = makeRuntime("", withPolicy);
    expect(rt.attemptIntervalState().allowed).toBe(true);
  });

  it("после завершения попытки барьер видит момент её завершения", () => {
    const rt = makeRuntime("", withPolicy);
    rt.setAttemptsUsed(1);
    rt.saveAttemptResult(results);
    const decision = rt.attemptIntervalState();
    // Движку передан НЕ null — то есть дата последней попытки до него доехала.
    expect(decision.allowed).toBe(false);
    expect(decision.availableAt).toBeTruthy();
  });

  it("дата последней попытки СТАРОГО пакета доезжает до барьера", () => {
    const rt = makeRuntime(legacyState, withPolicy);
    expect(rt.attemptIntervalState().availableAt).toBe("2026-08-02T10:00:00.000Z");
  });
});

describe("кулдаун (PRD-6)", () => {
  it("дата кулдауна переживает сохранение попытки", () => {
    const rt = makeRuntime(JSON.stringify({ v: 2, attemptsUsed: 1, best: null, retake: { lastCompletedDate: "2026-08-10" } }));
    rt.saveAttemptResult(results);
    expect(rt.readSuspendObj().retake).toEqual({ lastCompletedDate: "2026-08-10" });
  });

  it("дата кулдауна СТАРОГО пакета переживает приведение формата", () => {
    expect(makeRuntime(legacyState).readSuspendObj().retake).toEqual({ lastCompletedDate: "2026-08-02" });
  });
});

describe("остаток времени по разделам (PRD-4)", () => {
  it("бюджеты пишутся и читаются поверх нового формата", () => {
    const rt = makeRuntime();
    const budgets = makeBudgets(rt);
    budgets.write({ t1: { remainingMs: 300000 } });
    expect(budgets.read()).toEqual({ t1: { remainingMs: 300000 } });
  });

  it("бюджеты переживают сохранение попытки", () => {
    const rt = makeRuntime();
    const budgets = makeBudgets(rt);
    budgets.write({ t1: { remainingMs: 300000 } });
    rt.setAttemptsUsed(1);
    rt.saveAttemptResult(results);
    expect(budgets.read()).toEqual({ t1: { remainingMs: 300000 } });
  });

  it("бюджеты СТАРОГО пакета переживают приведение формата", () => {
    // Потеря подарила бы ученику полный лимит раздела заново — молча и ровно там,
    // где идёт секционный тест с ограничением времени.
    const rt = makeRuntime(legacyState);
    expect(makeBudgets(rt).read()).toEqual({ t1: { remainingMs: 420000 } });
  });
});

describe("страж: приведение формата не теряет полей состояния", () => {
  /**
   * Перечень того, что живёт в состоянии помимо учёта попыток. Каждое поле пишет СВОЙ
   * механизм, и ни один из них не упоминается в требованиях PRD-36 — поэтому список
   * держится здесь: миграция, собирающая новый объект, обязана перенести всё.
   */
  // PRD-67: `sectionGate` — разделы, закрытые выходом; потеря открыла бы их снова.
  // PRD-54 BR-54-35: `rk` — метка регистрации; потеря развела бы строку отчёта LMS на две записи.
  const CARRIED = ["attemptsUsed", "timer", "retake", "sectionBudgets", "sectionGate", "rk"];

  it("каждое поле старого состояния доезжает до нового", () => {
    const migrated = RS.migrate(JSON.parse(legacyState), TEST_DATA_BASE);
    for (const key of CARRIED) {
      expect({ key, present: key in migrated }).toEqual({ key, present: true });
    }
  });

  it("новые поля состояния попадают в перечень стража", () => {
    // Если рантайм начнёт писать в состояние что-то ещё, а строку сюда не добавят,
    // потеря найдётся не тестом, а на живом стенде — как это и произошло с PRD-4.
    const writers = [suspendSrc, timerSrc, read("server/scorm/template/app/utils/scorm/sessionRecovery.js")].join("\n");
    const assigned = new Set<string>();
    for (const m of writers.matchAll(/\bs\.([a-zA-Z][a-zA-Z0-9]*)\s*=/g)) assigned.add(m[1]);
    // Поля модели PRD-36 перечислены в самой миграции, остальные — забота стража.
    const known = new Set([...CARRIED, "best", "last", "currentSession", "v", "fp", "lastUpdated"]);
    const unknown = [...assigned].filter((k) => !known.has(k));
    expect(unknown).toEqual([]);
  });
});
