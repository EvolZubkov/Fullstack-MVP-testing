/**
 * @module tests/eligibility-gate-date
 *
 * PRD-6 trusted date. Two concerns, both over the REAL gate runtime:
 *
 * 1. Memoization — the gate must hit the portal chrome only once per URL: SECID,
 *    person id and the date all read the SAME response, so a plugin configured to
 *    resolve both SECID and person id must still fetch `/` exactly once, and both
 *    resolvers must read off that one response (the collection POST body carries
 *    the person id it produced).
 * 2. Source of "today" (FR-TD-01/02) — the gate takes the calendar day from the
 *    portal response's `Date` header (the LMS clock), so rolling the machine clock
 *    forward past the cooldown does NOT open the gate; every degradation branch
 *    (no header, request failure) falls back to the machine clock, i.e. legacy
 *    behaviour, and never blocks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const engineSrc = read("server/scorm/template/app/eligibility/engine.js");
const pluginsSrc = read("server/scorm/template/app/eligibility/plugins.js");
const gateSrc = read("server/scorm/template/app/eligibility/gate.js");
// PRD-31: the portal clock and its memoized fetch moved OUT of the gate into a shared
// utility, because the hour interval between attempts needs the same source. The gate
// is no longer self-contained, so the runtime under test has to be assembled the way
// the package assembles it.
const trustedNowSrc = read("server/scorm/template/app/utils/trusted-now.js");

/** The gate's own sub-budget for resolving the date (NFR-TD-01), mirrored from gate.js. */
const DATE_TIMEOUT_MS = 2500;

/** Build a fresh RetakeGate over the supplied runtime globals. */
function makeGate(state: Record<string, unknown>, SCORM: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "state",
    "SCORM",
    "escapeHtml",
    "loadDesignTemplate",
    `${trustedNowSrc}\n${engineSrc}\n${pluginsSrc}\n${gateSrc}\n;return RetakeGate;`,
  );
  return factory(state, SCORM, (s: unknown) => String(s == null ? "" : s), () => Promise.resolve(null));
}

/**
 * Record every fetch and answer it: portal chrome (with/without Date) + collection.
 * `ok`/`status` shape the PORTAL CHROME response only (the collection endpoint always
 * answers 200), so a caller can model "the portal errored but still stamped a Date".
 * Both default to a healthy 200, which is what every pre-existing caller relies on.
 */
function stubFetch(opts: {
  dateHeader?: string | null;
  chrome?: string;
  ok?: boolean;
  status?: number;
  records?: Array<Record<string, unknown>>;
}) {
  const calls: string[] = [];
  const bodies: Array<{ url: string; body: unknown }> = [];
  const records = opts.records ?? [{ state: "Пройден", progress: "100%", last_usage_date: "20.05.2026" }];
  vi.stubGlobal("fetch", (url: string, init?: { body?: unknown }) => {
    calls.push(String(url));
    bodies.push({ url: String(url), body: init?.body });
    const headers = { get: (k: string) => (String(k).toLowerCase() === "date" ? opts.dateHeader ?? null : null) };
    if (String(url).indexOf("extjs_json_collection_data") !== -1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers,
        json: () => Promise.resolve({ success: true, total: records.length, results: records }),
        text: () => Promise.resolve(""),
      });
    }
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      headers,
      text: () => Promise.resolve(opts.chrome ?? "ABCDEF0123456789ABCDEF0123456789"),
    });
  });
  return { calls, bodies };
}

/** Capture `console.log` and expose the emitted lines as flat strings. */
function captureLog() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  });
  return { lines, restore: () => spy.mockRestore(), text: () => lines.join("\n") };
}

async function flush() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

const SCORM_NO_SESSION = { getValue: () => "", init: () => {} };

/**
 * Gated test data driven by `webtutor_cooldown`: the collection stub below always
 * answers with ONE matching record dated 20.05.2026, so — like the removed
 * `suspend_data_cooldown` fixture it replaces — the verdict depends on ONE
 * remaining input: "today". 30-day cooldown => available 2026-06-19.
 */
function webtutorGate() {
  return {
    id: "t1",
    title: "Курс",
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
    },
    retakePlugin: {
      runtimeEntry: "webtutorCooldown",
      config: {
        collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
        secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
        attemptFilter: {
          stateField: "state",
          stateIn: ["Пройден", "Не пройден"],
          dateField: "last_usage_date",
          dateFormat: "dd.MM.yyyy",
        },
      },
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PRD-6 gate — trusted date", () => {
  it("hits the portal chrome once even when SECID and person id are both configured", async () => {
    const { calls, bodies } = stubFetch({
      dateHeader: "Sat, 30 May 2026 09:00:00 GMT",
      chrome: "secid=ABCDEF0123456789ABCDEF0123456789 cur_person_id=42",
    });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    gate.run(
      {
        id: "t1",
        title: "Курс",
        retakePolicy: {
          enabled: true,
          cooldownPeriodDays: 30,
          eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
        },
        retakePlugin: {
          runtimeEntry: "webtutorCooldown",
          config: {
            collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
            secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
            personIdSource: { endpoint: "/", pattern: "cur_person_id=(\\d+)" },
            parametersTemplate: "cur_person_id={{personId}};sSearchWord={{test.title}}",
          },
        },
      },
      () => {},
    );
    await flush();

    // Memoization: SECID and person id both come from the SAME `/` fetch.
    expect(calls.filter((u) => u === "/")).toHaveLength(1);

    // Both resolvers read off that one response: the collection POST body carries
    // the person id `resolvePersonId` scraped from it (proves the memoized value
    // reached the request, not just that the fetch count is low).
    const collectionCall = bodies.find((b) => b.url.indexOf("extjs_json_collection_data") !== -1);
    expect(String(collectionCall?.body)).toContain(encodeURIComponent("cur_person_id=42"));
  });

  it("uses the portal clock, so a machine clock rolled forward does not open the gate", async () => {
    vi.useFakeTimers();
    // Machine says 30.06.2026 (well past the 30-day cooldown); the portal says 30.05.2026.
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    stubFetch({ dateHeader: "Sat, 30 May 2026 09:00:00 GMT" });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    gate.run(webtutorGate(), () => { started = true; });
    await flush();

    expect((state.retake as any)?.todayDate).toBe("2026-05-30");
    expect((state.retake as any)?.allowed).toBe(false);
    expect(started).toBe(false);
  });

  it("degrades to the machine clock when the portal sends no Date header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    stubFetch({ dateHeader: null });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    gate.run(webtutorGate(), () => { started = true; });
    await flush();

    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
    expect((state.retake as any)?.allowed).toBe(true);
    expect(started).toBe(true);
  });

  // FR-TD-03: the calendar day is UTC on BOTH inputs, so the learner's time zone never
  // participates. 23:30 GMT is "tomorrow" in any zone east of UTC+0:30 — computing the
  // day locally (`new Date(ms).getDate()` & friends) would hand out 31.05 and shorten
  // every cooldown by a day for half the planet. The zone is PINNED here: with the
  // runner left on UTC the local and UTC days coincide and the assertion is vacuous.
  it("takes the UTC calendar day at the day boundary, not the learner's local day", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Europe/Moscow"; // UTC+3, no DST — local day is already 31.05
    try {
      vi.useFakeTimers();
      // Machine clock agrees with the portal (same instant, same zone): both readings
      // must yield 30.05, so the test fails on a local-day computation of EITHER input.
      vi.setSystemTime(new Date("2026-05-30T23:35:00Z"));
      stubFetch({ dateHeader: "Sat, 30 May 2026 23:30:00 GMT" });
      const state: Record<string, unknown> = { templateLayouts: {} };
      const gate = makeGate(state, SCORM_NO_SESSION);

      gate.run(webtutorGate(), () => {});
      await flush();

      expect((state.retake as any)?.todayDate).toBe("2026-05-30");
      // 20.05 + 30 дн. => the verdict follows the UTC day, not the local one.
      expect((state.retake as any)?.allowed).toBe(false);
    } finally {
      process.env.TZ = prevTz;
    }
  });

  it("degrades to the machine clock when the Date header is unparseable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    stubFetch({ dateHeader: "not-a-date" });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    expect(() => gate.run(webtutorGate(), () => { started = true; })).not.toThrow();
    await flush();

    // A verdict was still reached, on the machine clock (legacy behaviour).
    expect((state.retake as any)?.checked).toBe(true);
    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
    expect((state.retake as any)?.allowed).toBe(true);
    expect(started).toBe(true);
  });

  // The date resolve now runs SYNCHRONOUSLY inside buildContext, i.e. before run()
  // has a promise chain to catch anything. A `fetch` that is missing or throws
  // synchronously (hostile shim, ancient runtime) would therefore escape run() —
  // and bootstrap/main.js calls `RetakeGate.run(TEST_DATA, runCourse)` with no
  // try/catch, so the learner would sit on «Загрузка теста…» forever.
  it("survives a fetch that throws synchronously and still reaches a verdict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    vi.stubGlobal("fetch", () => { throw new TypeError("fetch is not a function"); });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    expect(() => gate.run(webtutorGate(), () => { started = true; })).not.toThrow();
    await flush();

    expect((state.retake as any)?.checked).toBe(true);
    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
    // failOpen + an elapsed cooldown on the machine clock => the course starts.
    expect(started).toBe(true);
  });

  it("degrades to the machine clock when the portal request fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    gate.run(webtutorGate(), () => {});
    await flush();

    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
  });

  // An HTTP ERROR is NOT a reason to distrust the clock: the `Date` header is stamped by
  // the portal server whatever the status line says, so a 500 that still carries one is a
  // trusted reading. Treating it as a fallback would hand the gate back to the machine
  // clock — i.e. reopen the very bypass this feature closes — on any portal hiccup.
  it("trusts the Date header of an HTTP error response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    stubFetch({ dateHeader: "Sat, 30 May 2026 09:00:00 GMT", ok: false, status: 500 });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    gate.run(webtutorGate(), () => { started = true; });
    await flush();

    // The server day, not the machine's 30.06 — so the cooldown still holds.
    expect((state.retake as any)?.todayDate).toBe("2026-05-30");
    expect((state.retake as any)?.allowed).toBe(false);
    expect(started).toBe(false);
  });

  it("degrades to the machine clock on an HTTP error with no Date header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    stubFetch({ dateHeader: null, ok: false, status: 500 });
    const log = captureLog();
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    try {
      gate.run(webtutorGate(), () => { started = true; });
      await flush();
    } finally {
      log.restore();
    }

    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
    expect(started).toBe(true);
    // The status reaches the diagnostics, so a broken portal is distinguishable from a
    // portal that answered fine but exposed no header.
    expect(log.text()).toContain("date source: client (request-failed: HTTP 500)");
  });

  // NFR-TD-02. The gate degrades SILENTLY by design, so this console line is the ONLY
  // signal that separates a mis-integration from a healthy portal — §6 requires the first
  // live LMS run to be readable in one pass. Every branch is exercised, because a cause
  // string that is never emitted is exactly as useless as no diagnostics at all.
  it("names the date source and every fallback cause on the console", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));

    /** Run one full gate pass against the currently stubbed fetch; return its log. */
    async function runGate(): Promise<string> {
      const log = captureLog();
      try {
        const state: Record<string, unknown> = { templateLayouts: {} };
        makeGate(state, SCORM_NO_SESSION).run(webtutorGate(), () => {});
        await flush();
        // Let the date sub-budget elapse — only the "never answers" branch needs it,
        // the others have long since settled and simply ignore the extra time.
        await vi.advanceTimersByTimeAsync(DATE_TIMEOUT_MS);
        await flush();
        return log.text();
      } finally {
        log.restore();
      }
    }

    stubFetch({ dateHeader: "Sat, 30 May 2026 09:00:00 GMT" });
    const networkLog = await runGate();
    expect(networkLog).toContain("date source: network");
    // The two raw readings and the skew, per §6 — not just the two calendar days.
    expect(networkLog).toContain("skew sec:");

    stubFetch({ dateHeader: null });
    expect(await runGate()).toContain("date source: client (no-header)");

    stubFetch({ dateHeader: "not-a-date" });
    expect(await runGate()).toContain('date source: client (unparseable-header: "not-a-date")');

    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(await runGate()).toContain("date source: client (request-failed: offline)");

    vi.stubGlobal("fetch", () => new Promise(() => {})); // connects, never settles
    expect(await runGate()).toContain("date source: client (timeout after 2500 ms)");
  });

  // FR-TD-05 on the SCORM path. `cooldownDecision` clamps an impossible "today" (a clock
  // reading BEHIND the last attempt) up to the attempt date and reports it as
  // `effectiveToday`; the gate must count the «через N дн.» line from THAT, not from the
  // raw reading — otherwise the screen contradicts the verdict it sits on. This is the
  // only SCORM consumer of `effectiveToday` (renderCooldownStart -> buildStartState).
  it("counts the cooldown countdown from effectiveToday, not the raw clock", async () => {
    vi.useFakeTimers();
    // The portal reports 20.05 while the recorded attempt is 01.06 (clock rolled back,
    // or a portal whose date is behind the learning record). Cooldown 30 дн. =>
    // available 01.07: 30 days from the clamped day, but 42 from the raw one.
    vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
    stubFetch({
      dateHeader: "Wed, 20 May 2026 10:00:00 GMT",
      records: [{ state: "Пройден", progress: "100%", last_usage_date: "01.06.2026" }],
    });

    const startInputs: any[] = [];
    vi.stubGlobal("TBTemplate", {
      buildStartState: (input: any) => { startInputs.push(input); return { start: {} }; },
      renderScreenInto: (el: HTMLElement) => { el.innerHTML = '<div data-testid="cooldown-start"></div>'; },
    });

    const state: Record<string, unknown> = { templateLayouts: { start: "<div></div>" } };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    gate.run(webtutorGate(), () => { started = true; });
    await flush();

    expect(started).toBe(false);
    expect((state.retake as any)?.todayDate).toBe("2026-05-20");
    expect((state.retake as any)?.effectiveToday).toBe("2026-06-01");
    expect((state.retake as any)?.availableDate).toBe("2026-07-01");
    // The cooldown block handed to the start screen: 01.07 − 01.06 = 30, NOT 42.
    expect(startInputs).toHaveLength(1);
    expect(startInputs[0].cooldown).toMatchObject({ availableDateHuman: "01.07.2026", daysUntil: 30 });
    // ...and that block did reach the rendered screen.
    expect(document.querySelector('[data-testid="cooldown-start"]')).toBeTruthy();
  });

  // NFR-06 + NFR-TD-01: GATE_TIMEOUT_MS (5 s) is the budget for the WHOLE gate, and the
  // date resolution spends part of it, so the plugin must inherit the REMAINDER. A portal
  // that accepts the connection and then answers nothing stalls BOTH steps — the date
  // resolve and the plugin's SECID scrape — which is the only case where the two budgets
  // could stack. Driving the fake clock pins the verdict to 5 s: still pending at 4999 ms
  // (so the assertion cannot pass vacuously) and present at 5000 ms. Before the fix this
  // took 7500 ms (2500 date + a fresh 5000 for the plugin).
  it("keeps the whole gate inside GATE_TIMEOUT_MS when the portal never answers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
    vi.stubGlobal("fetch", () => new Promise(() => {})); // connects, never settles
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_NO_SESSION);

    let started = false;
    gate.run(
      {
        id: "t1",
        title: "Курс",
        retakePolicy: {
          enabled: true,
          cooldownPeriodDays: 30,
          eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
        },
        retakePlugin: {
          runtimeEntry: "webtutorCooldown",
          config: {
            collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
            secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
          },
        },
      },
      () => { started = true; },
    );

    await vi.advanceTimersByTimeAsync(4999);
    await flush();
    expect(started).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await flush();
    // failOpen on `eligibility_timeout` => the course starts rather than hanging.
    expect(started).toBe(true);
    expect((state.retake as any)?.reason).toBe("plugin_error_fail_open");
    // ...and this pins the DATE sub-budget too (NFR-TD-01): the same never-answering
    // portal stalls the date resolve, so at 2500 ms it must have given up and fallen back
    // to the machine clock. Were the sub-budget missing or longer, the gate would still
    // be waiting on the date and `todayDate` would never be set.
    expect((state.retake as any)?.todayDate).toBe("2026-06-30");
  });
});
