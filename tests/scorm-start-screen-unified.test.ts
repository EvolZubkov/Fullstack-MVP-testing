/**
 * @module tests/scorm-start-screen-unified
 * @description One start screen for every way into a SCORM package.
 *
 * WebTutor reaches the same learner-facing situation along two paths. «Просмотреть» on a
 * finished learning re-opens THAT learning (its run state included) and the package draws
 * its ordinary start screen (`startPage.js`). «Пройти заново» without an open learning
 * starts a fresh one, the retake gate blocks it by the cooldown, and the gate used to draw
 * a second, hand-assembled copy of the screen: it dropped the description format (raw HTML
 * tags on screen) and diverged in everything else it did not repeat (testuniver.rt.ru,
 * 2026-09-29). The gate now hands the verdict to the ordinary screen, and the ordinary
 * screen shows no hour-interval wait once the attempts are spent. Runs the shipped runtime.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStartState } from "../shared/template/start-state";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const runtimeSrc = [
  "server/scorm/template/app/utils/trusted-now.js",
  "server/scorm/template/app/eligibility/engine.js",
  "server/scorm/template/app/eligibility/plugins.js",
  "server/scorm/template/app/eligibility/gate.js",
  "server/scorm/template/app/render/startPage.js",
].map(read).join("\n");

const TITLE = "Сертификация руководителей";
const DESCRIPTION = "<p>Что нужно, чтобы стать <strong>успешным</strong> лидером?</p>";

/** Package facts the start screen reads, overridable per test. */
interface Facts {
  maxAttempts: number | null;
  attemptsUsed: number;
  best: { percent: number; passed: boolean; attemptNumber: number } | null;
  intervalAllowed: boolean;
}

/** Assemble the runtime the way the package does, over stubbed package helpers. */
function makeRuntime(facts: Facts) {
  const state: Record<string, any> = { templateLayouts: {}, templateManifest: {} };
  const TEST_DATA = {
    id: "t1",
    title: TITLE,
    description: DESCRIPTION,
    descriptionFormat: "richText",
    totalQuestions: 64,
    maxAttempts: facts.maxAttempts,
    contentPages: [],
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 14,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
      attemptInterval: { enabled: true, hours: 24 },
    },
    retakePlugin: {
      runtimeEntry: "webtutorCooldown",
      config: {
        collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
        secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
        parametersTemplate: "sSearchWord={{test.title}}",
        attemptFilter: {
          stateField: "state",
          stateIn: ["Пройден", "Не пройден"],
          dateField: "last_usage_date",
          dateFormat: "dd.MM.yyyy",
          nameField: "name",
        },
      },
    },
  };
  const rendered: any[] = [];
  const TBTemplate = {
    buildStartState,
    renderScreenInto: (el: HTMLElement, opts: { context: any }) => {
      rendered.push(opts.context);
      el.innerHTML = '<div data-testid="start-screen"></div>';
    },
  };
  vi.stubGlobal("TBTemplate", TBTemplate);
  const SCORM = { getValue: () => "", init: () => {}, terminate: () => {} };
  const helpers: Record<string, unknown> = {
    state,
    SCORM,
    TEST_DATA,
    escapeHtml: (s: unknown) => String(s == null ? "" : s),
    loadDesignTemplate: () => {
      state.templateLayouts = { start: "<div>{{course.title}}</div>" };
      return Promise.resolve();
    },
    systemLayout: (key: string) => state.templateLayouts[key],
    applySystemScreenStyles: () => {},
    getAttemptsUsed: () => facts.attemptsUsed,
    hasAttemptsLeft: () => !facts.maxAttempts || facts.attemptsUsed < facts.maxAttempts,
    hasCompletedAttempts: () => !!facts.best,
    attemptIntervalState: () =>
      facts.intervalAllowed
        ? { allowed: true, availableAt: null }
        : { allowed: false, availableAt: "2026-09-30T15:23:00.000Z" },
    fmtInstantHuman: () => "30.09.2026 в 18:23",
    getBestAttempt: () => facts.best,
    readSuspendObj: () => ({}),
    isSessionStale: () => false,
    packageClosesOnLeave: () => false,
    TBRunState: { decodeDelivery: () => [] },
  };
  const names = Object.keys(helpers);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    ...names,
    `${runtimeSrc}\n;return { RetakeGate: RetakeGate, buildScormStartContext: buildScormStartContext };`,
  );
  const api = factory(...names.map((n) => helpers[n]));
  return { ...api, state, TEST_DATA, rendered };
}

/** Portal answering the gate: the chrome (SECID + Date) and one finished learning record. */
function stubPortal() {
  vi.stubGlobal("fetch", (url: string) => {
    const headers = { get: (k: string) => (String(k).toLowerCase() === "date" ? "Tue, 29 Sep 2026 09:00:00 GMT" : null) };
    if (String(url).indexOf("extjs_json_collection_data") !== -1) {
      const results = [{ name: TITLE, state: "Не пройден", last_usage_date: "27.09.2026" }];
      return Promise.resolve({ ok: true, status: 200, headers, json: () => Promise.resolve({ success: true, results }) });
    }
    return Promise.resolve({ ok: true, status: 200, headers, text: () => Promise.resolve("ABCDEF0123456789ABCDEF0123456789") });
  });
}

async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T09:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SCORM start screen — the gate draws the ordinary screen", () => {
  it("«Пройти заново» into a fresh learning: the description keeps its markup", async () => {
    stubPortal();
    const rt = makeRuntime({ maxAttempts: 1, attemptsUsed: 0, best: null, intervalAllowed: true });
    let started = false;
    rt.RetakeGate.run(rt.TEST_DATA, () => { started = true; });
    await flush();

    expect(started).toBe(false);
    expect(rt.rendered).toHaveLength(1);
    // The same builder input as the ordinary screen: the format rides with the text.
    expect(rt.rendered[0].course.descriptionHtml).toBe(DESCRIPTION);
    expect(document.querySelector('[data-testid="start-screen"]')).toBeTruthy();
  });

  it("the blocked screen carries the cooldown card and the attempt counter of the ordinary one", async () => {
    stubPortal();
    const rt = makeRuntime({ maxAttempts: 1, attemptsUsed: 0, best: null, intervalAllowed: true });
    rt.RetakeGate.run(rt.TEST_DATA, () => {});
    await flush();

    const ctx = rt.rendered[0];
    // 27.09 + 14 days = 11.10; the countdown runs from the portal's 29.09.
    expect(ctx.state.cooldown).toEqual({ availableDateHuman: "11.10.2026", daysUntil: 12 });
    expect(ctx.state.canStart).toBe(false);
    expect(ctx.course.subtitle).toBe("Попытка 1 из 1");
  });

  it("counts «через N дн.» from effectiveToday, not from a clock that lags behind the attempt", () => {
    const rt = makeRuntime({ maxAttempts: 1, attemptsUsed: 0, best: null, intervalAllowed: true });
    // The verdict the gate stores when the portal says 20.05 but the attempt is dated 01.06
    // (FR-TD-05): 01.07 − 01.06 = 30 days, NOT the 42 the raw clock would give.
    rt.state.retake = {
      checked: true,
      allowed: false,
      todayDate: "2026-05-20",
      effectiveToday: "2026-06-01",
      availableDate: "2026-07-01",
    };
    expect(rt.buildScormStartContext().state.cooldown).toEqual({ availableDateHuman: "01.07.2026", daysUntil: 30 });
  });

  it("the gate's verdict survives a redraw of the start screen", async () => {
    stubPortal();
    const rt = makeRuntime({ maxAttempts: 1, attemptsUsed: 0, best: null, intervalAllowed: true });
    rt.RetakeGate.run(rt.TEST_DATA, () => {});
    await flush();

    // Coming back from another screen rebuilds the context from the same facts.
    expect(rt.buildScormStartContext().state.cooldown).toEqual({ availableDateHuman: "11.10.2026", daysUntil: 12 });
  });
});

describe("SCORM start screen — the overall threshold only when it decides", () => {
  it("topics decide («только обязательные темы»): a threshold set for the LMS is not shown", () => {
    const rt = makeRuntime({ maxAttempts: 1, attemptsUsed: 0, best: null, intervalAllowed: true });
    Object.assign(rt.TEST_DATA, { passPercent: 80, passDecisionPolicy: "required_topics_only" });
    expect(rt.buildScormStartContext().course.passPercent).toBeNull();
  });

  it("the overall result decides: the threshold is shown", () => {
    const rt = makeRuntime({ maxAttempts: 1, attemptsUsed: 0, best: null, intervalAllowed: true });
    Object.assign(rt.TEST_DATA, { passPercent: 80, passDecisionPolicy: "overall_and_required_topics" });
    expect(rt.buildScormStartContext().course.passPercent).toBe(80);
  });
});

describe("SCORM start screen — re-entry into the same learning («Просмотреть»)", () => {
  const best = { percent: 46.3, passed: false, attemptNumber: 1 };

  it("attempts spent: no hour-interval wait, the prior result and the counter within the limit", () => {
    const rt = makeRuntime({ maxAttempts: 1, attemptsUsed: 1, best, intervalAllowed: false });
    const ctx = rt.buildScormStartContext();

    expect(ctx.state.cooldown).toBeUndefined();
    expect(ctx.state.canStart).toBe(false);
    expect(ctx.state.canViewResults).toBe(true);
    expect(ctx.state.canDownloadReport).toBe(true);
    expect(ctx.course.subtitle).toBe("Попытка 1 из 1");
  });

  it("attempts remain: the hour interval still holds the next one back", () => {
    const rt = makeRuntime({ maxAttempts: 3, attemptsUsed: 1, best, intervalAllowed: false });
    const ctx = rt.buildScormStartContext();

    expect(ctx.state.cooldown).toEqual({ availableDateHuman: "30.09.2026 в 18:23", daysUntil: null });
    expect(ctx.state.canStart).toBe(false);
    expect(ctx.course.subtitle).toBe("Попытка 2 из 3");
  });
});
