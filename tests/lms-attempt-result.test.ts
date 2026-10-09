/**
 * @module tests/lms-attempt-result
 * @description Настройка теста «какой результат уходит в LMS при нескольких попытках».
 *
 * Стандарт SCORM не решает этого вопроса: он ничего не требует от LMS о хранении истории,
 * а платформы (Moodle, Blackboard, Teachbase) держат выбор «лучшая / последняя» у себя и ждут
 * от содержимого данные ТЕКУЩЕЙ попытки. Но LMS, хранящая лишь снимок, при «последней»
 * безвозвратно перекроет удачную попытку неудачной — поэтому выбор отдан автору теста.
 *
 * Умолчание для НОВЫХ тестов — «последняя»: содержимое отчитывается за текущую попытку, как
 * того ждёт платформа. Тесты, заведённые до колонки, остались на «лучшей», и пакет без поля
 * читается как «лучшая» — иначе правка меняла бы поведение уже выданных пакетов задним числом.
 * В вебе настройка не применяется: внешней системы там нет.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest = {
  id: "t1",
  title: "Тест",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: null,
  maxAttempts: 3,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

function fixture(lmsAttemptResult?: "best" | "last") {
  return {
    test: { ...baseTest, ...(lmsAttemptResult ? { lmsAttemptResult } : {}) },
    sections: [
      {
        id: "sec-1", topicId: "t1", drawCount: 1, required: true, feedbackJson: null,
        topic: { id: "t1", name: "Тема", feedback: null, feedbackJson: null },
        questions: [
          { id: "q1", type: "single", prompt: "?", dataJson: {}, correctJson: { correctIndex: 0 },
            points: 1, difficulty: 50, tags: [] },
        ],
        courses: [], events: [],
      },
    ],
  } as never;
}

const bake = (data: unknown): Record<string, unknown> => JSON.parse(buildTestJson(data as never));

describe("выпечка настройки в пакет", () => {
  it("«последняя» уезжает в TEST_DATA", () => {
    // Умолчание для новых тестов — именно оно, поэтому поле в пакете теперь обычное дело.
    expect(bake(fixture("last")).lmsAttemptResult).toBe("last");
  });

  it("«лучшая» не выпекается: пакет остаётся байт-в-байт прежним", () => {
    // Отсутствие поля рантайм читает как «лучшая» — поведение всех уже выданных пакетов,
    // и менять его задним числом нельзя, даже сменив умолчание для новых тестов.
    expect("lmsAttemptResult" in bake(fixture("best"))).toBe(false);
    expect("lmsAttemptResult" in bake(fixture())).toBe(false);
  });
});

const suspendSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/suspendAttempts.js"),
  "utf8",
);
const runStateSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
const resultsSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${runStateSrc}\nreturn TBRunState;`)() as any;

interface Store {
  saveAttemptResult: (r: unknown) => void;
  readSuspendObj: () => any;
  setAttemptsUsed: (n: number) => void;
}

/** Хранилище рантайма поверх памяти, с настройкой теста как у собранного пакета. */
function makeStore(lmsAttemptResult?: "best" | "last"): Store {
  const cmi: Record<string, string> = {};
  const SCORM = {
    getValue: (k: string) => cmi[k] ?? "",
    setValue: (k: string, v: string) => { cmi[k] = String(v); },
    commit: () => undefined,
  };
  const TEST_DATA = {
    maxAttempts: 3, retakePolicy: null, sections: [{ topicId: "t1", questions: [{ id: "q1", type: "single" }] }],
    breakdownKeys: [], ...(lmsAttemptResult ? { lmsAttemptResult } : {}),
  };
  const state = {
    answers: { q1: 1 },
    questionStatuses: { q1: "answered" },
    deliveryPositions: [{ s: 0, q: 0 }],
    deliveredForms: {},
    flatQuestions: [{ question: TEST_DATA.sections[0].questions[0], topicId: "t1", topicName: "Тема" }],
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "SCORM", "TEST_DATA", "state", "console", "TBRunState",
    `${suspendSrc}
     return { saveAttemptResult: saveAttemptResult, readSuspendObj: readSuspendObj,
              setAttemptsUsed: setAttemptsUsed };`,
  );
  return factory(SCORM, TEST_DATA, state, { log: () => undefined }, RS) as Store;
}

const results = {
  percent: 60, correct: 1, totalQuestions: 2, earnedPoints: 1, possiblePoints: 2, passed: false,
  topicResults: [{ topicId: "t1", correct: 1, total: 2, earnedPoints: 1, possiblePoints: 2, percent: 60, passed: false }],
  breakdowns: [],
  resultComputation: { values: {}, errors: [] },
  scaleComputation: { values: {}, errors: [] },
};

describe("детализация попытки хранится только там, где она нужна", () => {
  it("при «лучшей» ряды сохраняются: по ним собирается отчёт прошлой попытки", () => {
    const store = makeStore("best");
    store.setAttemptsUsed(1);
    store.saveAttemptResult(results);
    expect(store.readSuspendObj().best.d).toBeDefined();
  });

  it("при «последней» рядов нет: отчёт строится по прогону, который ещё в памяти", () => {
    const store = makeStore("last");
    store.setAttemptsUsed(1);
    store.saveAttemptResult(results);
    const best = store.readSuspendObj().best;
    expect(best).toBeDefined();
    expect(best.d).toBeUndefined();
  });

  it("сводка попытки сохраняется в обоих случаях — её читают экраны и отчёт", () => {
    for (const mode of ["best", "last"] as const) {
      const store = makeStore(mode);
      store.setAttemptsUsed(1);
      store.saveAttemptResult(results);
      expect(store.readSuspendObj().best.pc).toBe(60);
    }
  });
});

describe("рантайм отправляет в LMS выбранную попытку", () => {
  it("выбор читается из настройки, а не зашит", () => {
    expect(resultsSrc).toMatch(/TEST_DATA\.lmsAttemptResult === 'last'/);
    // При «последней» лучшая не запрашивается вовсе — иначе в LMS уехал бы прежний результат.
    expect(resultsSrc).toMatch(/lmsWantsLast \? null : getBestAttempt\(\)/);
  });

  it("отсутствие настройки означает «лучшая»", () => {
    // Строгое сравнение с 'last': любое иное значение (включая отсутствие поля в пакете,
    // собранном до настройки) оставляет прежнее поведение.
    expect(resultsSrc).not.toMatch(/lmsAttemptResult !== 'best'/);
  });
});
