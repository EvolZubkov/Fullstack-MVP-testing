/**
 * @module tests/section-close-on-leave
 * @description PRD-67 «Закрывать раздел при выходе» в SCORM-пакете.
 *
 * Выпечка: настройка попадает в `TEST_DATA` ТОЛЬКО когда включена — рантайм читает
 * отсутствие поля как прежнее поведение (выход замораживает время раздела), поэтому пакет
 * теста, который настройки не касался, остаётся байт-в-байт прежним.
 *
 * Рантайм: шаг `syncSectionLeaveGate` исполняется на исходнике `timer.js` поверх
 * настоящего `suspend_data` и того же общего модуля бюджета, что крутится на веб-сервере.
 * Выход опознаётся без часов: раздел, открытый на момент загрузки SCO, — раздел, внутри
 * которого оборвалась прошлая сессия.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";
import * as sectionBudget from "../shared/flow/section-budget";

const baseTest = {
  id: "t1",
  title: "Тест",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: 30,
  maxAttempts: 3,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

function fixture(closeSectionOnLeave?: boolean) {
  return {
    test: {
      ...baseTest,
      ...(closeSectionOnLeave === undefined ? {} : { closeSectionOnLeave }),
    },
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

describe("PRD-67: выпечка настройки в пакет", () => {
  it("включённая настройка уезжает в TEST_DATA", () => {
    expect(bake(fixture(true)).closeSectionOnLeave).toBe(true);
  });

  it("выключенная и отсутствующая не выпекаются — пакет прежний", () => {
    expect("closeSectionOnLeave" in bake(fixture(false))).toBe(false);
    expect("closeSectionOnLeave" in bake(fixture())).toBe(false);
  });
});

// ─── Рантайм пакета ──────────────────────────────────────────────────────────

const timerSrc = readFileSync(resolve(process.cwd(), "server/scorm/template/app/timer/timer.js"), "utf8");

interface Harness {
  cmi: Record<string, string>;
  state: Record<string, any>;
  toast: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  skip: ReturnType<typeof vi.fn>;
  returnFromTopic: ReturnType<typeof vi.fn>;
  stored: () => any;
  api: {
    syncSectionLeaveGate: () => boolean;
    closeInterruptedSectionOnLoad: () => string | null;
    resetSectionRunState: () => void;
    isSectionClosedByLeave: (topicId: string) => boolean;
    leaveOpenSection: () => string | null;
  };
}

/**
 * Рантайм `timer.js` поверх памяти. `suspend_data` — простой JSON: формат состояния
 * (PRD-36) здесь не предмет, предмет — что таймер кладёт в него и что читает обратно.
 */
function makeHarness(opts: {
  testData?: Record<string, unknown>;
  flowMode?: string;
  initial?: Record<string, unknown>;
  router?: boolean;
}): Harness {
  const cmi: Record<string, string> = {
    "cmi.total_time": "PT0H0M0S",
    ...(opts.initial ? { "cmi.suspend_data": JSON.stringify(opts.initial) } : {}),
  };
  const SCORM = {
    getValue: (k: string) => cmi[k] ?? "",
    setValue: (k: string, v: string) => { cmi[k] = String(v); },
    commit: () => undefined,
  };
  const readSuspendObj = () => JSON.parse(cmi["cmi.suspend_data"] || "{}");
  const writeSuspendObj = (o: unknown) => { cmi["cmi.suspend_data"] = JSON.stringify(o); };
  const TEST_DATA = {
    mode: "standard",
    timeLimitMinutes: null,
    flowPolicy: { mode: opts.flowMode ?? "linear_by_topics" },
    closeSectionOnLeave: true,
    sections: [
      { topicId: "A", topicName: "Финансы", timeLimitMinutes: 10 },
      { topicId: "B", topicName: "Технологии", timeLimitMinutes: 5 },
      { topicId: "C", topicName: "Без лимита", timeLimitMinutes: null },
    ],
    ...opts.testData,
  };
  const state: Record<string, any> = {
    phase: "question",
    currentIndex: 0,
    submitted: false,
    flatQuestions: [{ topicId: "A" }, { topicId: "A" }, { topicId: "B" }, { topicId: "C" }],
    routerTopicStates: {},
    currentRouterTopic: null,
  };
  const toast = vi.fn();
  const submit = vi.fn(() => { state.submitted = true; });
  const skip = vi.fn();
  const returnFromTopic = vi.fn();
  const RouterFlow = { isRouterMode: () => !!opts.router, returnFromTopic };
  const clock = { now: () => 0 };
  const win = { performance: clock, TBTemplate: { sectionBudget } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "SCORM", "TEST_DATA", "state", "window", "performance", "readSuspendObj", "writeSuspendObj",
    "showToast", "submit", "skipSectionFromCurrent", "RouterFlow", "currentPageItem",
    `${timerSrc}
     return { syncSectionLeaveGate: syncSectionLeaveGate,
              closeInterruptedSectionOnLoad: closeInterruptedSectionOnLoad,
              resetSectionRunState: resetSectionRunState,
              isSectionClosedByLeave: isSectionClosedByLeave,
              leaveOpenSection: leaveOpenSection };`,
  );
  const api = factory(
    SCORM, TEST_DATA, state, win, clock, readSuspendObj, writeSuspendObj,
    toast, submit, skip, RouterFlow, () => state.pageItem ?? null,
  );
  return { cmi, state, toast, submit, skip, returnFromTopic, api, stored: readSuspendObj };
}

describe("PRD-67: рантайм пакета", () => {
  it("первый вопрос раздела открывает его молча — правило автор пишет на вводной странице", () => {
    const h = makeHarness({});
    expect(h.api.syncSectionLeaveGate()).toBe(false);
    expect(h.stored().sectionGate).toEqual({ open: "A", closed: [] });
    h.state.currentIndex = 1; // следующий вопрос того же раздела
    h.api.syncSectionLeaveGate();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("переход к следующему разделу закрывает предыдущий навсегда", () => {
    const h = makeHarness({});
    h.api.syncSectionLeaveGate();
    h.state.currentIndex = 2; // раздел B
    h.api.syncSectionLeaveGate();
    expect(h.stored().sectionGate).toEqual({ open: "B", closed: ["A"] });
    expect(h.api.isSectionClosedByLeave("A")).toBe(true);
  });

  it("обзор своего раздела — внутри раздела", () => {
    const h = makeHarness({});
    h.api.syncSectionLeaveGate();
    h.state.phase = "review";
    h.api.syncSectionLeaveGate();
    expect(h.stored().sectionGate).toEqual({ open: "A", closed: [] });
  });

  it("итоги раздела — уже выход", () => {
    const h = makeHarness({});
    h.api.syncSectionLeaveGate();
    h.state.phase = "sectionResults";
    h.api.syncSectionLeaveGate();
    expect(h.stored().sectionGate).toEqual({ open: null, closed: ["A"] });
  });

  it("раздел, открытый на момент загрузки SCO, закрывается", () => {
    const h = makeHarness({ initial: { sectionGate: { open: "A", closed: [] } } });
    expect(h.api.closeInterruptedSectionOnLoad()).toBe("A");
    expect(h.stored().sectionGate).toEqual({ open: null, closed: ["A"] });
  });

  it("возврат к вопросу закрытого раздела уводит дальше и объясняет", () => {
    const h = makeHarness({ initial: { sectionGate: { open: null, closed: ["A"] } } });
    expect(h.api.syncSectionLeaveGate()).toBe(true);
    expect(h.skip).toHaveBeenCalledWith("A");
    expect(h.toast.mock.calls[0][0]).toMatch(/^Раздел «Финансы» закрыт/);
  });

  it("в маршрутизаторе закрытый раздел возвращает в хаб пройденным", () => {
    const h = makeHarness({ router: true, flowMode: "router_by_topics" });
    h.api.syncSectionLeaveGate();
    h.state.phase = "router"; // вышли в хаб
    h.api.syncSectionLeaveGate();
    expect(h.state.routerTopicStates.A).toBe("completed");
    // Повторный вход в ту же тему: возврат в хаб, а не вопросы.
    h.state.phase = "question";
    h.state.currentRouterTopic = "A";
    expect(h.api.syncSectionLeaveGate()).toBe(true);
    expect(h.returnFromTopic).toHaveBeenCalled();
  });

  it("раздел без своего лимита в тесте без общего лимита не затрагивается", () => {
    const h = makeHarness({});
    h.state.currentIndex = 3; // раздел C
    h.api.syncSectionLeaveGate();
    expect(h.stored().sectionGate).toBeUndefined();
  });

  it("под общим лимитом теста закрывается и раздел без своего лимита", () => {
    const h = makeHarness({ testData: { timeLimitMinutes: 60 } });
    h.state.currentIndex = 3;
    h.api.syncSectionLeaveGate();
    h.state.phase = "sectionResults";
    h.api.syncSectionLeaveGate();
    expect(h.stored().sectionGate.closed).toEqual(["C"]);
  });

  it("тест без разделов: открыт на первом вопросе, свои страницы — внутри", () => {
    const h = makeHarness({ flowMode: "linear_flat", testData: { timeLimitMinutes: 30 } });
    h.api.syncSectionLeaveGate();
    expect(h.stored().sectionGate).toEqual({ open: "__test__", closed: [] });
    expect(h.toast).not.toHaveBeenCalled();
    h.state.phase = "content"; // страница «После теста» — не выход
    h.api.syncSectionLeaveGate();
    expect(h.stored().sectionGate.open).toBe("__test__");
  });

  it("тест без разделов после обрыва сессии сдаётся", () => {
    const h = makeHarness({
      flowMode: "linear_flat",
      testData: { timeLimitMinutes: 30 },
      initial: { sectionGate: { open: "__test__", closed: [] } },
    });
    h.api.closeInterruptedSectionOnLoad();
    expect(h.api.syncSectionLeaveGate()).toBe(true);
    expect(h.submit).toHaveBeenCalledWith(true);
    expect(h.toast.mock.calls[0][0]).toMatch(/^Попытка завершена/);
  });

  it("без настройки состояние не пишется вовсе", () => {
    const h = makeHarness({ testData: { closeSectionOnLeave: undefined } });
    h.api.syncSectionLeaveGate();
    h.state.currentIndex = 2;
    h.api.syncSectionLeaveGate();
    expect(h.cmi["cmi.suspend_data"]).toBeUndefined();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("новая попытка начинается без закрытых разделов и без старых бюджетов", () => {
    const h = makeHarness({
      initial: {
        attemptsUsed: 1,
        sectionGate: { open: null, closed: ["A"] },
        sectionBudgets: { A: { remainingMs: 0, runningSince: null } },
      },
    });
    h.api.resetSectionRunState();
    expect(h.stored()).toEqual({ attemptsUsed: 1 });
  });
});
