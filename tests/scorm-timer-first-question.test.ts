/**
 * @module tests/scorm-timer-first-question
 * @description The SCORM package's test-wide countdown starts on the FIRST QUESTION,
 * not on «Начать»: intro pages, section intros and the router hub before the first
 * topic do not spend the limit.
 *
 * Runs the package's own `timer.js` over its own `suspendAttempts.js` (the anchor
 * store) and an in-memory SCORM RTE, with a controlled monotonic clock:
 *   - «Начать» only arms the countdown and writes a PENDING anchor;
 *   - the first question starts it, every later one is a no-op;
 *   - the anchor baseline counts the session time spent before that question, so a
 *     later resume charges only the time since the first question;
 *   - a session restored before any question re-arms the countdown instead of
 *     starting (or dropping) it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const suspendSrc = read("server/scorm/template/app/utils/scorm/suspendAttempts.js");
const timerSrc = read("server/scorm/template/app/timer/timer.js");
const runStateSrc = read("server/scorm/template/app/utils/scorm/runState.js");
const recoverySrc = read("server/scorm/template/app/utils/scorm/sessionRecovery.js");

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${runStateSrc}\nreturn TBRunState;`)() as any;

interface Runtime {
  cmi: Record<string, string>;
  state: Record<string, any>;
  clock: { ms: number };
  submit: ReturnType<typeof vi.fn>;
  armTestTimer: () => void;
  ensureTestTimerStarted: () => void;
  resumeTestTimer: () => void;
  stopTestTimer: () => void;
  readTimerAnchor: () => any;
  writeTimerAnchor: (a: Record<string, unknown>) => void;
  readSuspendObj: () => any;
  writeSuspendObj: (o: unknown) => void;
}

/** The package runtime over memory: a SCORM RTE, a clock and the given suspend_data. */
function makeRuntime(opts: { limitMinutes?: number | null; totalTime?: string; suspend?: string } = {}): Runtime {
  const cmi: Record<string, string> = {};
  if (opts.totalTime) cmi["cmi.total_time"] = opts.totalTime;
  if (opts.suspend) cmi["cmi.suspend_data"] = opts.suspend;
  const SCORM = {
    getValue: (k: string) => cmi[k] ?? "",
    setValue: (k: string, v: string) => { cmi[k] = String(v); },
    commit: () => undefined,
  };
  const TEST_DATA = {
    maxAttempts: 3,
    timeLimitMinutes: opts.limitMinutes === undefined ? 30 : opts.limitMinutes,
    sections: [],
    breakdownKeys: [],
    integritySecret: "s3cret",
  };
  const state: Record<string, any> = {
    timerInterval: null,
    timerStartPerfMs: null,
    timerCommitInterval: null,
    testTimerArmed: false,
    sessionCommitStartPerfMs: null,
    remainingSeconds: null,
    submitted: false,
  };
  const clock = { ms: 1_000 };
  const performance = { now: () => clock.ms };
  const submit = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "SCORM", "TEST_DATA", "state", "console", "TBRunState", "window", "performance",
    "submit", "showToast", "EligibilityEngine",
    `${suspendSrc}\n${timerSrc}
     return { armTestTimer: armTestTimer, ensureTestTimerStarted: ensureTestTimerStarted,
              resumeTestTimer: resumeTestTimer, stopTestTimer: stopTestTimer,
              readTimerAnchor: readTimerAnchor, writeTimerAnchor: writeTimerAnchor,
              readSuspendObj: readSuspendObj, writeSuspendObj: writeSuspendObj };`,
  );
  const api = factory(
    SCORM, TEST_DATA, state, { log: () => undefined }, RS, { performance }, performance,
    submit, () => undefined, {},
  );
  return { ...api, cmi, state, clock, submit } as Runtime;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("«Начать» arms the countdown, the first question starts it", () => {
  it("after «Начать» the clock does not run and the anchor is pending", () => {
    const rt = makeRuntime({ totalTime: "PT0S" });
    rt.armTestTimer();
    expect(rt.state.testTimerArmed).toBe(true);
    expect(rt.state.remainingSeconds).toBeNull();
    expect(rt.state.timerInterval).toBeNull();
    expect(rt.readTimerAnchor()).toMatchObject({ limitMinutes: 30, pending: true, baselineTotalSec: null });
  });

  it("intro pages read before the first question do not spend the limit", () => {
    const rt = makeRuntime({ totalTime: "PT0S" });
    rt.armTestTimer();
    rt.clock.ms += 5 * 60 * 1000; // five minutes on the intro page
    rt.ensureTestTimerStarted();
    expect(rt.state.remainingSeconds).toBe(30 * 60);
    expect(rt.state.testTimerArmed).toBe(false);
    expect(rt.state.timerInterval).not.toBeNull();
  });

  it("a later question does not restart the clock", () => {
    const rt = makeRuntime({ totalTime: "PT0S" });
    rt.armTestTimer();
    rt.ensureTestTimerStarted();
    const startedAt = rt.state.timerStartPerfMs;
    rt.clock.ms += 10_000;
    vi.advanceTimersByTime(1_000);
    expect(rt.state.remainingSeconds).toBe(30 * 60 - 10);
    rt.ensureTestTimerStarted();
    expect(rt.state.timerStartPerfMs).toBe(startedAt);
    expect(rt.state.remainingSeconds).toBe(30 * 60 - 10);
  });

  it("the anchor baseline counts the session time spent before the first question", () => {
    // 100 s of earlier sessions, then 60 s on the intro page of this one.
    const rt = makeRuntime({ totalTime: "PT100S" });
    rt.armTestTimer();
    rt.clock.ms += 60_000;
    rt.ensureTestTimerStarted();
    expect(rt.readTimerAnchor()).toMatchObject({ limitMinutes: 30, baselineTotalSec: 160 });
    expect(rt.readTimerAnchor().pending).toBeUndefined();
  });

  it("the LMS is still credited the intro time: session time counts from «Начать»", () => {
    const rt = makeRuntime({ totalTime: "PT0S" });
    rt.armTestTimer();
    rt.clock.ms += 20_000;
    vi.advanceTimersByTime(10_000); // one commit tick before any question
    expect(rt.cmi["cmi.session_time"]).toBe("PT0H0M20S");
  });

  it("a submitted attempt is not started", () => {
    const rt = makeRuntime({ totalTime: "PT0S" });
    rt.armTestTimer();
    rt.state.submitted = true;
    rt.ensureTestTimerStarted();
    expect(rt.state.remainingSeconds).toBeNull();
  });

  it("stopping the test disarms a countdown that never started", () => {
    const rt = makeRuntime({ totalTime: "PT0S" });
    rt.armTestTimer();
    rt.stopTestTimer();
    rt.ensureTestTimerStarted();
    expect(rt.state.remainingSeconds).toBeNull();
  });

  it("a test without a limit arms nothing", () => {
    const rt = makeRuntime({ limitMinutes: null, totalTime: "PT0S" });
    rt.armTestTimer();
    rt.ensureTestTimerStarted();
    expect(rt.state.testTimerArmed).toBe(false);
    expect(rt.state.remainingSeconds).toBeNull();
    expect(rt.readTimerAnchor()).toBeNull();
  });
});

describe("restoring a session", () => {
  it("a session that never reached a question re-arms the countdown", () => {
    const first = makeRuntime({ totalTime: "PT0S" });
    first.armTestTimer();
    const rt = makeRuntime({ totalTime: "PT300S", suspend: first.cmi["cmi.suspend_data"] });
    rt.resumeTestTimer();
    expect(rt.state.testTimerArmed).toBe(true);
    expect(rt.state.remainingSeconds).toBeNull();
    rt.ensureTestTimerStarted();
    expect(rt.state.remainingSeconds).toBe(30 * 60);
  });

  it("a session past the first question resumes from the time since it", () => {
    // Earlier sessions: 100 s before the first question, then 400 s on questions.
    const first = makeRuntime({ totalTime: "PT0S" });
    first.writeTimerAnchor({ limitMinutes: 30, baselineTotalSec: 100 });
    const rt = makeRuntime({ totalTime: "PT500S", suspend: first.cmi["cmi.suspend_data"] });
    rt.resumeTestTimer();
    expect(rt.state.testTimerArmed).toBe(false);
    expect(rt.state.remainingSeconds).toBe(30 * 60 - 400);
  });

  it("rewriting a started anchor into a pending one is detected", () => {
    const rt = makeRuntime({ totalTime: "PT0S" });
    rt.writeTimerAnchor({ limitMinutes: 30, baselineTotalSec: 100 });
    const s = rt.readSuspendObj();
    s.timer.pending = true; // «вернуть себе весь лимит» правкой строки состояния
    s.timer.baselineTotalSec = null;
    rt.writeSuspendObj(s);
    expect(rt.readTimerAnchor()).toBeNull();
  });
});

describe("determineRecovery with a pending anchor", () => {
  function determineRecoveryIn(anchor: unknown, totalSec: number | null) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "TEST_DATA", "state", "readSuspendObj", "readTimerAnchor", "readTotalTimeSec",
      "writeSuspendObj", "console",
      `${recoverySrc}\nreturn determineRecovery;`,
    );
    const session = { at: new Date().toISOString(), i: 0, dl: "AA", fm: "linear_flat" };
    return factory(
      { mode: "standard", timeLimitMinutes: 30, flowPolicy: { mode: "linear_flat" } },
      {},
      () => ({ currentSession: session, attempts: [] }),
      () => anchor,
      () => totalSec,
      () => undefined,
      { log: () => undefined },
    )() as { action: string };
  }

  it("an attempt whose clock has not started yet is restored", () => {
    expect(determineRecoveryIn({ limitMinutes: 30, baselineTotalSec: null, pending: true }, 0).action).toBe("restore");
  });

  it("a pending anchor of another limit is not", () => {
    expect(determineRecoveryIn({ limitMinutes: 45, baselineTotalSec: null, pending: true }, 0).action).not.toBe("restore");
  });
});

describe("adaptive test: «Начать заново» and the results screen", () => {
  const adaptiveSrc = read("server/scorm/template/app/render/adaptiveRender.js");
  const lift = (name: string) => {
    const m = adaptiveSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\r?\\n\\}`));
    if (!m) throw new Error(`${name} not found in adaptiveRender.js`);
    return m[0];
  };

  /** One of the two functions over recording stubs: what it calls, in order, and the state. */
  function run(name: string, state: Record<string, unknown>) {
    const calls: string[] = [];
    const stub = (n: string) => () => { calls.push(n); return true; };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "state", "hasAttemptsLeft", "showToast", "Telemetry", "registerAttemptStart",
      "resetSectionRunState", "stopTestTimer", "armTestTimer", "initAdaptiveTest", "render",
      "buildAdaptiveResult", "renderAdaptiveResultsFallback", "renderAdaptiveResultsTemplated",
      "getAdaptiveResultForScorm", "document", "window",
      `${lift(name)}\nreturn ${name};`,
    );
    factory(
      state, stub("hasAttemptsLeft"), stub("showToast"),
      { finish: stub("Telemetry.finish"), startNewAttempt: stub("Telemetry.startNewAttempt") },
      stub("registerAttemptStart"), stub("resetSectionRunState"),
      () => { calls.push("stopTestTimer"); state.testTimerArmed = false; },
      () => { calls.push("armTestTimer"); state.testTimerArmed = true; },
      stub("initAdaptiveTest"), stub("render"),
      () => ({}), stub("renderAdaptiveResultsFallback"), stub("renderAdaptiveResultsTemplated"),
      () => ({}), { getElementById: () => null }, {},
    )();
    return calls;
  }

  it("«Начать заново» stops the old countdown and arms a new one before the first question", () => {
    const state: Record<string, unknown> = { adaptiveState: null, remainingSeconds: 42, timeExpired: true };
    const calls = run("restartAdaptive", state);
    expect(calls.indexOf("stopTestTimer")).toBeGreaterThan(calls.indexOf("registerAttemptStart"));
    expect(calls.indexOf("armTestTimer")).toBeGreaterThan(calls.indexOf("stopTestTimer"));
    expect(calls.indexOf("armTestTimer")).toBeLessThan(calls.indexOf("render"));
    expect(state.remainingSeconds).toBeNull();
    expect(state.timeExpired).toBe(false);
    expect(state.testTimerArmed).toBe(true);
  });

  it("the results screen stops the countdown of the finished attempt", () => {
    const state: Record<string, unknown> = { adaptiveState: { result: {} }, templateLayouts: {} };
    expect(run("renderAdaptiveResults", state)).toContain("stopTestTimer");
  });
});
