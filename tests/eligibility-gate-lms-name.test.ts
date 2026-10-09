/**
 * @module tests/eligibility-gate-lms-name
 * @description Which course name the PRD-6 gate looks for in WebTutor.
 *
 * `webtutor_cooldown` keeps only the learning records whose `name` equals the course
 * name EXACTLY. That name used to be the test title, and a course named differently in
 * WebTutor never matched: every record was dropped and every retake was let through with
 * no cooldown at all (testuniver.rt.ru, 2026-09-29: test «Сертификация руководителей в
 * «Ростелекоме»», course «… (предфинальный тест)»). The author's `lmsCourseName` now
 * names the course; the title stays the fallback. Runs the REAL gate runtime.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const runtimeSrc = [
  "server/scorm/template/app/utils/trusted-now.js",
  "server/scorm/template/app/eligibility/engine.js",
  "server/scorm/template/app/eligibility/plugins.js",
  "server/scorm/template/app/eligibility/gate.js",
].map(read).join("\n");

const TITLE = "Сертификация руководителей";
const LMS_NAME = "Сертификация руководителей (предфинальный тест)";

/** Build a fresh RetakeGate over the supplied runtime globals, the way the package assembles it. */
function makeGate(state: Record<string, unknown>) {
  const SCORM = { getValue: () => "", init: () => {}, terminate: () => {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "state",
    "SCORM",
    "escapeHtml",
    "loadDesignTemplate",
    `${runtimeSrc}\n;return RetakeGate;`,
  );
  return factory(state, SCORM, (s: unknown) => String(s == null ? "" : s), () => Promise.resolve(null));
}

/** Answer the portal chrome and the collection; record the collection POST bodies. */
function stubPortal(records: Array<Record<string, unknown>>) {
  const bodies: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: { body?: unknown }) => {
    const headers = { get: (k: string) => (String(k).toLowerCase() === "date" ? "Tue, 29 Sep 2026 09:00:00 GMT" : null) };
    if (String(url).indexOf("extjs_json_collection_data") !== -1) {
      bodies.push(String(init?.body ?? ""));
      return Promise.resolve({
        ok: true,
        status: 200,
        headers,
        json: () => Promise.resolve({ success: true, total: records.length, results: records }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, headers, text: () => Promise.resolve("ABCDEF0123456789ABCDEF0123456789") });
  });
  return bodies;
}

/** Gated test data with the production filter (exact match on `name`). */
function gatedTest(lmsCourseName?: string) {
  return {
    id: "t1",
    title: TITLE,
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 14,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
      ...(lmsCourseName !== undefined ? { lmsCourseName } : {}),
    },
    retakePlugin: {
      runtimeEntry: "webtutorCooldown",
      config: {
        collectionEndpoint: "/pp/Ext5/extjs_json_collection_data.html",
        secidSource: { endpoint: "/", pattern: "[A-F0-9]{32}" },
        parametersTemplate: "cur_person_id={{personId}};sSearchWord={{test.title}};sCatalogName=learning",
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
}

/** A finished attempt of the WebTutor course, two days ago. */
const RECORD = { name: LMS_NAME, state: "Не пройден", last_usage_date: "27.09.2026" };

async function flush() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
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

describe("PRD-6 gate — the course name looked up in WebTutor", () => {
  it("without lmsCourseName a differently named course is not found and the retake is let through", async () => {
    stubPortal([RECORD]);
    const state: Record<string, unknown> = { templateLayouts: {} };
    let started = false;
    makeGate(state).run(gatedTest(), () => { started = true; });
    await flush();

    expect((state.retake as any)?.reason).toBe("no_prior_attempt");
    expect(started).toBe(true);
  });

  it("with lmsCourseName the record is found and the cooldown holds", async () => {
    stubPortal([RECORD]);
    const state: Record<string, unknown> = { templateLayouts: {} };
    let started = false;
    makeGate(state).run(gatedTest(LMS_NAME), () => { started = true; });
    await flush();

    expect((state.retake as any)?.allowed).toBe(false);
    expect((state.retake as any)?.lastAttemptDate).toBe("2026-09-27");
    expect((state.retake as any)?.availableDate).toBe("2026-10-11");
    expect(started).toBe(false);
  });

  it("searches WebTutor by the course name, not by the test title", async () => {
    const bodies = stubPortal([RECORD]);
    makeGate({ templateLayouts: {} }).run(gatedTest(LMS_NAME), () => {});
    await flush();

    expect(bodies).toHaveLength(1);
    const params = new URLSearchParams(bodies[0]).get("parameters");
    expect(params).toContain(`sSearchWord=${LMS_NAME};`);
  });

  it("a blank lmsCourseName falls back to the test title", async () => {
    const bodies = stubPortal([{ ...RECORD, name: TITLE }]);
    const state: Record<string, unknown> = { templateLayouts: {} };
    makeGate(state).run(gatedTest("   "), () => {});
    await flush();

    expect(new URLSearchParams(bodies[0]).get("parameters")).toContain(`sSearchWord=${TITLE};`);
    expect((state.retake as any)?.allowed).toBe(false);
  });
});
