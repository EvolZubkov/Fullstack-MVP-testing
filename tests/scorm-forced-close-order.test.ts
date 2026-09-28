/**
 * @module tests/scorm-forced-close-order
 * @description Order of the two verdict overrides in `finishAndClose` (resultsPage.js).
 *
 * WebTutor keeps a course open while the SCO reports «failed», so a package whose attempts
 * are spent reports «passed» and writes the real outcome into `cmi.comments_from_learner`
 * (the forced close). A boolean indicator with «Ставит «Пройден», когда истина» used to be
 * applied AFTER that and wrote the forced «passed» back to «failed»: the comment said
 * «forced close», the status did not, and the course stayed open for good (seen live on
 * testuniver.rt.ru, 2026-09-28). The indicator is now resolved first and the forced close
 * goes last. The test runs the shipped function itself, not a replica of it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const resultsSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);

/** The shipped `finishAndClose` body, cut out of the runtime file. */
function finishAndCloseSource(): string {
  const match = resultsSrc.match(/function finishAndClose\(\)\s*\{[\s\S]*?\n\}/);
  if (!match) throw new Error("finishAndClose not found in resultsPage.js");
  return match[0];
}

interface Scenario {
  /** Verdict of the test's own pass rule. */
  standardPassed: boolean;
  /** Verdict of the status-controlling indicators; `undefined` = the test has none. */
  indicator?: boolean;
  /** Whether the attempt limit is used up by this attempt. */
  attemptsExhausted: boolean;
  timeExpired?: boolean;
}

interface Outcome {
  /** The pass flag handed to the LMS writer. */
  passedForLms: boolean;
  /** Values written straight through `SCORM.setValue`. */
  written: Record<string, string>;
}

/** Run the real `finishAndClose` against stubbed runtime globals and record what reaches the LMS. */
function run(s: Scenario): Outcome {
  const written: Record<string, string> = {};
  let passedForLms: boolean | undefined;
  const results = {
    percent: 29,
    passed: s.standardPassed,
    earnedPoints: 29,
    possiblePoints: 100,
    totalQuestions: 10,
    correct: 3,
    topicResults: [],
  };
  const deps = {
    TEST_DATA: { mode: "standard", maxAttempts: 1, lmsAttemptResult: "last" },
    state: { timeExpired: !!s.timeExpired },
    SCORM: {
      setValue: (k: string, v: unknown) => { written[k] = String(v); return true; },
      commit: () => true,
      terminate: () => true,
    },
    Telemetry: { finish: () => undefined },
    window: { close: () => undefined },
    RESULTS_CLOSE_DELAY_MS: 0,
    disableFinishButtons: () => undefined,
    calculateResults: () => ({ ...results }),
    computeTestScales: () => ({ values: {}, errors: [] }),
    computeTestResultVariables: () => ({
      values: {},
      errors: [],
      status: s.indicator === undefined ? {} : { success: s.indicator },
    }),
    saveAttemptResult: () => undefined,
    clearCurrentSession: () => undefined,
    collectFailedTopicCourses: () => [],
    telemetryScaleValues: () => ({}),
    telemetryVariableValues: () => ({}),
    hasAttemptsLeft: () => !s.attemptsExhausted,
    getBestAttempt: () => null,
    getBestAttemptDetail: () => null,
    finishScormLmsOnly: (_r: unknown, passed: boolean) => { passedForLms = passed; },
    finishScormAdaptive: () => { throw new Error("adaptive path must not run"); },
    buildAdaptiveResult: () => null,
    getAdaptiveResultForScorm: () => null,
    setTimeout: () => undefined,
    console: { log: () => undefined },
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    ...names,
    `var scormFinished = false;\n${finishAndCloseSource()}\n;return finishAndClose;`,
  );
  const finishAndClose = factory(...names.map((n) => deps[n as keyof typeof deps])) as () => void;
  finishAndClose();
  if (passedForLms === undefined) throw new Error("finishScormLmsOnly was not called");
  return { passedForLms, written };
}

const FORCED = "ATTEMPTS_EXHAUSTED: FAILED (forced close)";

describe("finishAndClose — the forced close is applied after the indicator verdict", () => {
  it("attempts spent, indicator says «failed»: the LMS still gets «passed» with the note", () => {
    const out = run({ standardPassed: false, indicator: false, attemptsExhausted: true });
    expect(out.passedForLms).toBe(true);
    expect(out.written["cmi.comments_from_learner"]).toBe(FORCED);
  });

  it("attempts spent, rule passed but indicator failed: the verdict that counts is the indicator's", () => {
    const out = run({ standardPassed: true, indicator: false, attemptsExhausted: true });
    expect(out.passedForLms).toBe(true);
    expect(out.written["cmi.comments_from_learner"]).toBe(FORCED);
  });

  it("attempts spent, indicator says «passed»: an honest pass, no forced-close note", () => {
    const out = run({ standardPassed: false, indicator: true, attemptsExhausted: true });
    expect(out.passedForLms).toBe(true);
    expect(out.written["cmi.comments_from_learner"]).toBeUndefined();
  });

  it("attempts left, indicator says «failed»: the course stays open for a retake", () => {
    const out = run({ standardPassed: true, indicator: false, attemptsExhausted: false });
    expect(out.passedForLms).toBe(false);
    expect(out.written["cmi.comments_from_learner"]).toBeUndefined();
  });

  it("no indicator: the pass rule decides, and a spent failed attempt is force-closed", () => {
    const out = run({ standardPassed: false, attemptsExhausted: true });
    expect(out.passedForLms).toBe(true);
    expect(out.written["cmi.comments_from_learner"]).toBe(FORCED);
  });

  it("time ran out: no forced close, the failure is reported as is", () => {
    const out = run({ standardPassed: false, indicator: false, attemptsExhausted: true, timeExpired: true });
    expect(out.passedForLms).toBe(false);
    expect(out.written["cmi.comments_from_learner"]).toBeUndefined();
  });
});
