/**
 * @module tests/sim-router-section-passed
 * @description «Сценарий в ИС», техдолг №8: пакет фиксирует, пройден ли пункт роутера, при КАЖДОМ
 * возврате в хаб — а не только там, где тест показывает итоги раздела.
 *
 * Прежде исход пункта (`state.sectionResults`) появлялся только у экрана итогов раздела. Без него
 * «Открывается после успешного прохождения» считал пройденным любой завершённый пункт, а политика
 * «все обязательные пройдены» — ни один. Исполняется ИСХОДНЫЙ `routerFlow.js` с общими правилами
 * хаба (`shared/flow/router-hub`) и исходный `sessionRecovery.js`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isRouterReadyToFinish, isSectionUnlocked } from "@shared/flow/router-hub";

const routerSrc = readFileSync(resolve(process.cwd(), "server/scorm/template/app/routerFlow.js"), "utf8");
const sessionSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/sessionRecovery.js"),
  "utf8",
);

const SCENARIO = "scenario:s";

function testData(policy: Record<string, unknown> = {}) {
  return {
    mode: "standard",
    allowAnswerChange: true,
    flowPolicy: {
      mode: "router_by_topics",
      sectionUnlockRules: { [SCENARIO]: { mode: "after_sections_passed", sectionIds: ["t1"] } },
      ...policy,
    },
    contentPages: [{ id: "hub", kind: "router" }],
    sections: [{ topicId: "t1", required: true }, { topicId: SCENARIO, required: true }],
  };
}

/** Рантайм роутера с заглушками; `passedOf` — что вернёт расчёт результата раздела. */
function runtime(data: ReturnType<typeof testData>, passedOf: Record<string, boolean | null>) {
  const state: any = { routerTopicStates: {}, sectionResults: {}, currentRouterTopic: null, flatQuestions: [] };
  const root: any = {};
  const allowed: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    "TEST_DATA", "state", "TBTemplate", "buildSectionResult", "render", "saveCurrentSession", "TBSimRun", "window",
    routerSrc,
  )(
    data,
    state,
    { isSectionUnlocked, isRouterReadyToFinish, buildTopicChunk: () => [] },
    (topicId: string) => ({ topicId, passed: passedOf[topicId] ?? null }),
    () => undefined,
    () => undefined,
    { allowRerun: (key: string) => allowed.push(key) },
    root,
  );
  const flow = root.RouterFlow;
  /** Пройти пункт: войти из хаба и вернуться. */
  const run = (topicId: string) => {
    flow.selectRouterTopic(topicId);
    flow.returnFromTopic();
  };
  return { state, flow, run, allowed };
}

describe("исход пункта фиксируется при возврате в хаб", () => {
  it("непройденная тема не открывает сценарий «после успешного прохождения» — экрана итогов раздела нет", () => {
    const { flow, run, state } = runtime(testData(), { t1: false });
    run("t1");
    expect(state.sectionResults).toEqual({});
    expect(flow.isSectionUnlocked({ topicId: SCENARIO })).toBe(false);
  });

  it("пройденная тема открывает сценарий", () => {
    const { flow, run } = runtime(testData(), { t1: true });
    run("t1");
    expect(flow.isSectionUnlocked({ topicId: SCENARIO })).toBe(true);
  });

  it("тема без порога (passed: null) засчитывается завершением", () => {
    const { flow, run } = runtime(testData(), { t1: null });
    run("t1");
    expect(flow.isSectionUnlocked({ topicId: SCENARIO })).toBe(true);
  });

  it("«все обязательные пройдены»: непройденный сценарий не даёт завершить тест", () => {
    const data = testData({ sectionUnlockRules: {}, routerCompletionPolicy: "all_required_passed" });
    const { flow, run } = runtime(data, { t1: true, [SCENARIO]: false });
    run("t1");
    run(SCENARIO);
    expect(flow.isRouterReadyToFinish()).toBe(false);
  });

  it("повторный прогон сценария снимает прежний исход, возврат фиксирует новый", () => {
    const passedOf: Record<string, boolean | null> = { t1: true, [SCENARIO]: false };
    const data = testData({ sectionUnlockRules: {}, routerCompletionPolicy: "all_required_passed" });
    const { flow, run, state, allowed } = runtime(data, passedOf);
    run("t1");
    run(SCENARIO);
    expect(flow.isRouterReadyToFinish()).toBe(false);

    flow.selectRouterTopic(SCENARIO);
    expect(allowed).toEqual([SCENARIO]);
    expect(state.sectionPassed[SCENARIO]).toBeUndefined();
    passedOf[SCENARIO] = true;
    flow.returnFromTopic();
    expect(flow.isRouterReadyToFinish()).toBe(true);
  });
});

describe("исходы пунктов в suspend_data", () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const api = new Function(
    "TEST_DATA", "state", "readSuspendObj", "writeSuspendObj", "TBRunState", "console",
    `${sessionSrc}\nreturn { encode: encodeSectionPassed, decode: decodeSectionPassed };`,
  )({}, {}, () => ({}), () => undefined, {}, { log: () => undefined });

  it("пишутся компактно: 1/0, пункт без порога не пишется", () => {
    expect(api.encode({ t1: true, t2: false, t3: null })).toEqual({ t1: 1, t2: 0 });
  });

  it("читаются обратно; сеанс до появления поля — пустая карта", () => {
    expect(api.decode({ t1: 1, t2: 0 })).toEqual({ t1: true, t2: false });
    expect(api.decode(undefined)).toEqual({});
  });
});
