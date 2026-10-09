/**
 * @module tests/scorm-review-launch
 * @description Opening a FINISHED learning shows its result, not a start screen.
 *
 * WebTutor lets a learner back into a finished learning only through «Просмотреть», and it
 * hands the SCO that learning's own run state with `cmi.completion_status = completed` (a
 * fresh or unfinished one arrives `not attempted` / `incomplete`); other LMSs say the same
 * with `cmi.mode = review`. The package used to draw its start screen there, with the hour
 * interval of barrier B — a wait for an attempt that the closed learning will never give —
 * and wrote the saved result back into the LMS when the window closed (testuniver.rt.ru,
 * 2026-09-29). Now such a launch opens the saved attempt's result with «Скачать отчёт» and
 * «Закрыть», and writes nothing but `cmi.exit`. Runs the shipped runtime functions.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const mainSrc = read("server/scorm/template/app/bootstrap/main.js");
const resultsSrc = read("server/scorm/template/app/render/resultsPage.js");

/** A top-level function of a runtime file, cut out by name. */
function functionSource(src: string, name: string): string {
  const match = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`${name} not found`);
  return match[0];
}

/** An LMS stub: `cmi` values to read, and every write recorded. */
function lms(cmi: Record<string, string>) {
  const written: Record<string, string> = {};
  const calls: string[] = [];
  return {
    written,
    calls,
    SCORM: {
      getValue: (k: string) => cmi[k] ?? "",
      setValue: (k: string, v: unknown) => { written[k] = String(v); return true; },
      commit: () => { calls.push("commit"); return true; },
      terminate: () => { calls.push("terminate"); return true; },
    },
  };
}

/** Evaluate the named functions of main.js over the given globals. */
function mainFns(globals: Record<string, unknown>) {
  const names = Object.keys(globals);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    ...names,
    `${functionSource(mainSrc, "detectReviewLaunch")}\n${functionSource(mainSrc, "closeReviewLaunch")}\n` +
      "return { detectReviewLaunch: detectReviewLaunch, closeReviewLaunch: closeReviewLaunch };",
  )(...names.map((n) => globals[n])) as { detectReviewLaunch: () => boolean; closeReviewLaunch: () => void };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("detectReviewLaunch — a finished learning re-opened for viewing", () => {
  const withAttempt = () => true;

  it("WebTutor «Просмотреть»: the learning is completed and holds a finished attempt", () => {
    const { SCORM } = lms({ "cmi.mode": "normal", "cmi.completion_status": "completed" });
    expect(mainFns({ SCORM, hasCompletedAttempts: withAttempt }).detectReviewLaunch()).toBe(true);
  });

  it("an LMS review mode counts too", () => {
    const { SCORM } = lms({ "cmi.mode": "review", "cmi.completion_status": "incomplete" });
    expect(mainFns({ SCORM, hasCompletedAttempts: withAttempt }).detectReviewLaunch()).toBe(true);
  });

  it("an unfinished learning («Продолжить», «Пройти заново» into an open one) is not a review", () => {
    for (const completion of ["incomplete", "not attempted", "unknown", ""]) {
      const { SCORM } = lms({ "cmi.mode": "normal", "cmi.completion_status": completion });
      expect(mainFns({ SCORM, hasCompletedAttempts: withAttempt }).detectReviewLaunch()).toBe(false);
    }
  });

  it("a completed learning with no saved attempt has nothing to show and is not a review", () => {
    const { SCORM } = lms({ "cmi.mode": "normal", "cmi.completion_status": "completed" });
    expect(mainFns({ SCORM, hasCompletedAttempts: () => false }).detectReviewLaunch()).toBe(false);
  });
});

describe("closeReviewLaunch — leaving the result writes nothing but the exit", () => {
  it("keeps the run state for the next viewing and closes the session", () => {
    vi.useFakeTimers();
    const { SCORM, written, calls } = lms({});
    const close = vi.fn();
    mainFns({ SCORM, window: { close }, RESULTS_CLOSE_DELAY_MS: 10 }).closeReviewLaunch();
    vi.advanceTimersByTime(10);

    expect(written).toEqual({ "cmi.exit": "suspend" });
    expect(calls).toEqual(["commit", "terminate"]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("finishAndClose in a review launch", () => {
  it("does not report a result — it only closes the window", () => {
    const closeReviewLaunch = vi.fn();
    const finishScormLmsOnly = vi.fn();
    const deps: Record<string, unknown> = {
      state: { reviewLaunch: true },
      closeReviewLaunch,
      finishScormLmsOnly,
      calculateResults: () => { throw new Error("must not grade a viewing"); },
      disableFinishButtons: () => {},
    };
    const names = Object.keys(deps);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const finishAndClose = new Function(
      ...names,
      `var scormFinished = false;\n${functionSource(resultsSrc, "finishAndClose")}\nreturn finishAndClose;`,
    )(...names.map((n) => deps[n])) as () => void;
    finishAndClose();

    expect(closeReviewLaunch).toHaveBeenCalledTimes(1);
    expect(finishScormLmsOnly).not.toHaveBeenCalled();
  });
});
