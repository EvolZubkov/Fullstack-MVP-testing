/**
 * @module tests/eligibility-gate-date
 *
 * PRD-6 trusted date. The gate must source "today" from the LMS clock (the portal
 * response's `Date` header) instead of the learner's machine, must degrade to the
 * machine clock when the header is unavailable, and must hit the portal chrome only
 * once per URL (SECID, person id and the date all read the SAME response).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const engineSrc = read("server/scorm/template/app/eligibility/engine.js");
const pluginsSrc = read("server/scorm/template/app/eligibility/plugins.js");
const gateSrc = read("server/scorm/template/app/eligibility/gate.js");

/** Build a fresh RetakeGate over the supplied runtime globals. */
function makeGate(state: Record<string, unknown>, SCORM: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "state",
    "SCORM",
    "escapeHtml",
    "loadDesignTemplate",
    `${engineSrc}\n${pluginsSrc}\n${gateSrc}\n;return RetakeGate;`,
  );
  return factory(state, SCORM, (s: unknown) => String(s == null ? "" : s), () => Promise.resolve(null));
}

/** Record every fetch and answer it: portal chrome (with/without Date) + collection. */
function stubFetch(opts: { dateHeader?: string | null; chrome?: string }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(String(url));
    const headers = { get: (k: string) => (String(k).toLowerCase() === "date" ? opts.dateHeader ?? null : null) };
    if (String(url).indexOf("extjs_json_collection_data") !== -1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers,
        json: () => Promise.resolve({ success: true, total: 0, results: [] }),
        text: () => Promise.resolve(""),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers,
      text: () => Promise.resolve(opts.chrome ?? ""),
    });
  });
  return calls;
}

async function flush() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

const SCORM_WITH_ATTEMPT = {
  getValue: (k: string) =>
    k === "cmi.suspend_data" ? JSON.stringify({ retake: { lastCompletedDate: "2026-05-20" } }) : "",
  init: () => {},
};

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PRD-6 gate — trusted date", () => {
  it("hits the portal chrome once even when SECID and person id are both configured", async () => {
    const calls = stubFetch({
      dateHeader: "Sat, 30 May 2026 09:00:00 GMT",
      chrome: "secid=ABCDEF0123456789ABCDEF0123456789 cur_person_id=42",
    });
    const state: Record<string, unknown> = { templateLayouts: {} };
    const gate = makeGate(state, SCORM_WITH_ATTEMPT);

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
          },
        },
      },
      () => {},
    );
    await flush();

    expect(calls.filter((u) => u === "/")).toHaveLength(1);
  });
});
