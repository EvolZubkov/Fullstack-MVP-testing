/**
 * @module tests/scorm-report-on-results
 * @description The attempt reaches the LMS on entry to the results, not on «Завершить».
 *
 * The package used to report an attempt — suspend_data, telemetry `finish`, score, verdict,
 * objectives and interactions — only from `finishAndClose`, i.e. only when the learner pressed
 * «Завершить». A learner who reached the results and then closed the course from the LMS side
 * left the LMS with a learning it had closed itself, with no score and no answers; the unload
 * handler wrote a percent with no interactions, and only when the browser fired it at all.
 *
 * Now `reportAttempt` does the whole report once per attempt and is called on entry to the
 * results; «Завершить» only terminates. A retry reopens the learning (`incomplete` +
 * `suspend`), and a second report in the same SCO session neutralizes the rows of the first
 * one it no longer covers — SCORM 2004 cannot delete an interaction. Runs the shipped
 * runtime functions against stubs.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const resultsSrc = read("server/scorm/template/app/render/resultsPage.js");
const startPageSrc = read("server/scorm/template/app/render/startPage.js");
const runtimeSrc = read("server/scorm/assets/runtime.js");

/** A top-level function of a runtime file, cut out by name. */
function functionSource(src: string, name: string): string {
  const match = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`${name} not found`);
  return match[0];
}

interface Harness {
  reportAttempt: () => void;
  finishAndClose: () => void;
  reopenLearningForRetry: () => void;
  reported: () => boolean;
  written: Record<string, string>;
  calls: string[];
  deps: Record<string, ReturnType<typeof vi.fn> | unknown>;
}

/** The report/finish/reopen trio of resultsPage.js over stubbed runtime globals. */
function harness(state: Record<string, unknown> = {}): Harness {
  const written: Record<string, string> = {};
  const calls: string[] = [];
  const results = {
    percent: 40,
    passed: false,
    earnedPoints: 4,
    possiblePoints: 10,
    totalQuestions: 10,
    correct: 4,
    topicResults: [],
  };
  const deps: Record<string, unknown> = {
    TEST_DATA: { mode: "standard", lmsAttemptResult: "last" },
    state: { timeExpired: false, ...state },
    SCORM: {
      setValue: (k: string, v: unknown) => { written[k] = String(v); return true; },
      commit: () => { calls.push("commit"); return true; },
      terminate: () => { calls.push("terminate"); return true; },
    },
    Telemetry: { finish: vi.fn() },
    window: { close: vi.fn() },
    RESULTS_CLOSE_DELAY_MS: 0,
    disableFinishButtons: () => undefined,
    closeReviewLaunch: vi.fn(),
    calculateResults: () => ({ ...results }),
    computeTestScales: () => ({ values: {}, errors: [] }),
    computeTestResultVariables: () => ({ values: {}, errors: [], status: {} }),
    saveAttemptResult: vi.fn(),
    clearCurrentSession: vi.fn(),
    collectFailedTopicCourses: () => [],
    telemetryScaleValues: () => ({}),
    telemetryVariableValues: () => ({}),
    hasAttemptsLeft: () => true,
    getBestAttempt: () => null,
    getBestAttemptDetail: () => null,
    finishScormLmsOnly: vi.fn(),
    finishScormAdaptive: vi.fn(),
    buildAdaptiveResult: () => null,
    getAdaptiveResultForScorm: () => null,
    setTimeout: (fn: () => void) => fn(),
    console: { log: () => undefined },
  };
  const names = Object.keys(deps);
  const source = ["finishAndClose", "reportAttempt", "reopenLearningForRetry"]
    .map((n) => functionSource(resultsSrc, n))
    .join("\n");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fns = new Function(
    ...names,
    `var scormFinished = false;\nvar attemptReported = false;\n${source}\n` +
      "return { finishAndClose: finishAndClose, reportAttempt: reportAttempt, " +
      "reopenLearningForRetry: reopenLearningForRetry, reported: function () { return attemptReported; } };",
  )(...names.map((n) => deps[n])) as Omit<Harness, "written" | "calls" | "deps">;
  return { ...fns, written, calls, deps };
}

describe("reportAttempt — the whole report, once per attempt", () => {
  it("persists, sends telemetry and writes the LMS record, then commits without terminating", () => {
    const h = harness();
    h.reportAttempt();

    expect(h.deps.saveAttemptResult).toHaveBeenCalledTimes(1);
    expect(h.deps.clearCurrentSession).toHaveBeenCalledTimes(1);
    expect((h.deps.Telemetry as { finish: ReturnType<typeof vi.fn> }).finish).toHaveBeenCalledTimes(1);
    expect(h.deps.finishScormLmsOnly).toHaveBeenCalledTimes(1);
    // The learner is still on the results screen: the session stays open.
    expect(h.calls).toContain("commit");
    expect(h.calls).not.toContain("terminate");
    expect(h.reported()).toBe(true);
  });

  it("a second call for the same attempt is a no-op", () => {
    const h = harness();
    h.reportAttempt();
    h.reportAttempt();

    expect(h.deps.saveAttemptResult).toHaveBeenCalledTimes(1);
    expect((h.deps.Telemetry as { finish: ReturnType<typeof vi.fn> }).finish).toHaveBeenCalledTimes(1);
    expect(h.deps.finishScormLmsOnly).toHaveBeenCalledTimes(1);
  });

  it("a viewing of a finished learning reports nothing", () => {
    const h = harness({ reviewLaunch: true });
    h.reportAttempt();

    expect(h.deps.saveAttemptResult).not.toHaveBeenCalled();
    expect(h.deps.finishScormLmsOnly).not.toHaveBeenCalled();
    expect(h.reported()).toBe(false);
  });
});

describe("finishAndClose — «Завершить» after the report", () => {
  it("does not report the attempt again, only terminates and closes", () => {
    const h = harness();
    h.reportAttempt();
    h.finishAndClose();

    expect(h.deps.saveAttemptResult).toHaveBeenCalledTimes(1);
    expect(h.deps.finishScormLmsOnly).toHaveBeenCalledTimes(1);
    expect(h.calls[h.calls.length - 1]).toBe("terminate");
    expect((h.deps.window as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
  });

  it("reports the attempt itself when the results never did", () => {
    const h = harness();
    h.finishAndClose();

    expect(h.deps.saveAttemptResult).toHaveBeenCalledTimes(1);
    expect(h.deps.finishScormLmsOnly).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["commit", "commit", "terminate"]);
  });
});

describe("reopenLearningForRetry — a retry after a reported attempt", () => {
  it("reopens the learning and lets the next attempt report again", () => {
    const h = harness();
    h.reportAttempt();
    h.reopenLearningForRetry();

    expect(h.written["cmi.completion_status"]).toBe("incomplete");
    expect(h.written["cmi.exit"]).toBe("suspend");
    expect(h.reported()).toBe(false);

    h.reportAttempt();
    expect(h.deps.finishScormLmsOnly).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when no attempt was reported", () => {
    const h = harness();
    h.reopenLearningForRetry();

    expect(h.written).toEqual({});
    expect(h.calls).toEqual([]);
  });
});

describe("restart — «Пройти ещё раз» after a reported attempt", () => {
  /** The shipped `restart` of startPage.js over stubs; `reported` is the trio's flag. */
  function runRestart(reported: boolean) {
    const deps: Record<string, unknown> = {
      attemptReported: reported,
      reopenLearningForRetry: vi.fn(),
      state: { flatQuestions: [{}], currentIndex: 1 },
      hasAttemptsLeft: () => true,
      getAttemptsUsed: () => 1,
      calculateResults: () => ({ percent: 40 }),
      saveAttemptResult: vi.fn(),
      reportPendingAnswerTelemetry: vi.fn(),
      Telemetry: { finish: vi.fn(), getAttemptNumber: () => 1, startNewAttempt: vi.fn() },
      stopTestTimer: () => undefined,
      document: { querySelector: () => null, querySelectorAll: () => [] },
      generateVariant: () => undefined,
      registerAttemptStart: () => true,
      resetSectionRunState: () => undefined,
      goToPageSequenceIndex: () => undefined,
      initTimer: () => undefined,
      armTestTimer: () => undefined,
      render: () => undefined,
      showToast: () => undefined,
      console: { log: () => undefined },
    };
    const names = Object.keys(deps);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const restart = new Function(
      ...names,
      `${functionSource(startPageSrc, "restart")}\nreturn restart;`,
    )(...names.map((n) => deps[n])) as () => void;
    restart();
    return deps as Record<string, ReturnType<typeof vi.fn>> & {
      Telemetry: { finish: ReturnType<typeof vi.fn>; startNewAttempt: ReturnType<typeof vi.fn> };
    };
  }

  it("does not record the reported attempt a second time and reopens the learning", () => {
    const deps = runRestart(true);
    expect(deps.saveAttemptResult).not.toHaveBeenCalled();
    expect(deps.Telemetry.finish).not.toHaveBeenCalled();
    expect(deps.reopenLearningForRetry).toHaveBeenCalledTimes(1);
    expect(deps.Telemetry.startNewAttempt).toHaveBeenCalledTimes(1);
  });

  it("an attempt abandoned before the results is still recorded as before", () => {
    const deps = runRestart(false);
    expect(deps.saveAttemptResult).toHaveBeenCalledTimes(1);
    expect(deps.Telemetry.finish).toHaveBeenCalledTimes(1);
    expect(deps.reopenLearningForRetry).not.toHaveBeenCalled();
  });
});

describe("SCORM.finish — the tail of an earlier report is neutralized", () => {
  /**
   * A SCORM 2004 API stub holding `existing` interactions already written in this session.
   * `refuseRename` makes it reject a new id for a row it already holds.
   */
  function lmsApi(existing: number, refuseRename = false) {
    const values: Record<string, string> = { "cmi.interactions._count": String(existing) };
    const api = {
      Initialize: () => "true",
      GetValue: (k: string) => values[k] ?? "",
      SetValue: (k: string, v: string) => {
        const m = k.match(/^cmi\.interactions\.(\d+)\.id$/);
        if (m && refuseRename && Number(m[1]) < existing) return "false";
        values[k] = v;
        return "true";
      },
      Commit: () => "true",
      Terminate: () => "true",
    };
    return { api, values };
  }

  /** The shipped SCORM wrapper bound to a window that exposes `api`. */
  function scormOver(api: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function("window", "console", `${runtimeSrc}\nreturn SCORM;`)(
      { API_1484_11: api, parent: null },
      { log: () => undefined },
    ) as { finish: (...a: unknown[]) => void };
  }

  const interaction = (id: string) => ({
    id, type: "choice", result: "correct", response: "a", correct: "a", description: "Вопрос",
  });

  it("rows past the new set become `void_<n>` markers with no answer", () => {
    const { api, values } = lmsApi(4);
    scormOver(api).finish(1, 2, false, [], [interaction("q_a"), interaction("q_b")]);

    for (const n of [2, 3]) {
      expect(values[`cmi.interactions.${n}.id`]).toBe(`void_${n}`);
      expect(values[`cmi.interactions.${n}.type`]).toBe("other");
      expect(values[`cmi.interactions.${n}.result`]).toBe("neutral");
      expect(values[`cmi.interactions.${n}.learner_response`]).toBe("");
      expect(values[`cmi.interactions.${n}.correct_responses.0.pattern`]).toBe("");
    }
    expect(values["cmi.interactions.0.id"]).toBe("q_a");
    expect(values["cmi.interactions.1.id"]).toBe("q_b");
    expect(values["cmi.interactions.4.id"]).toBeUndefined();
  });

  it("an LMS that refuses to rename a row still gets its answer and outcome cleared", () => {
    const { api, values } = lmsApi(3, true);
    scormOver(api).finish(1, 2, false, [], [interaction("q_a")]);

    expect(values["cmi.interactions.2.id"]).toBeUndefined();
    expect(values["cmi.interactions.2.type"]).toBeUndefined();
    expect(values["cmi.interactions.2.result"]).toBe("neutral");
    expect(values["cmi.interactions.2.learner_response"]).toBe("");
    expect(values["cmi.interactions.2.description"]).toBe("Не относится к попытке");
  });

  it("the first report of a session neutralizes nothing", () => {
    const { api, values } = lmsApi(0);
    scormOver(api).finish(1, 2, false, [], [interaction("q_a")]);

    expect(Object.keys(values).filter((k) => k.startsWith("cmi.interactions.1."))).toEqual([]);
  });
});
