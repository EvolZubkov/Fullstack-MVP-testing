/**
 * @module tests/eligibility-gate-blockwall
 *
 * PRD-6 §4.4 — the retake block page is a SYSTEM PAGE of the design template.
 * This loads the REAL runtime files (templateCore.js + the gate's plain-JS port
 * engine.js/plugins.js/gate.js) and the REAL `default` `system.blocked` layout
 * into a jsdom document, drives {@link RetakeGate.run} through the blocked path,
 * and asserts the gate renders the template layout (filling `retake.*` via the
 * path-DSL and toggling the cooldown/error branches) — falling back to the
 * built-in wall only when the template carries no `system.blocked` layout.
 *
 * The gate never calls SCORM.Initialize on the blocked path (NFR-01/02): the SCORM
 * stub here records calls and the test asserts `initialize` was never invoked.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const coreSrc = read("server/scorm/template/app/templateCore.js");
const engineSrc = read("server/scorm/template/app/eligibility/engine.js");
const pluginsSrc = read("server/scorm/template/app/eligibility/plugins.js");
const gateSrc = read("server/scorm/template/app/eligibility/gate.js");
const blockedLayout = read("server/scorm/templates/default/layouts/system.blocked.html");

/** Build a fresh RetakeGate bound to the supplied runtime globals. */
function makeGate(globals: {
  state: Record<string, unknown>;
  SCORM: unknown;
  escapeHtml: (s: unknown) => string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "state",
    "SCORM",
    "escapeHtml",
    "loadDesignTemplate",
    `${engineSrc}\n${pluginsSrc}\n${gateSrc}\n;return RetakeGate;`,
  );
  // No template fetch needed: tests preload state.templateLayouts; loadDesignTemplate
  // is a never-called stub here (the real one runs only when layouts are absent).
  return factory(globals.state, globals.SCORM, globals.escapeHtml, () => Promise.resolve(null));
}

const escapeHtml = (s: unknown) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Flush the microtask chain the gate schedules (no real timers involved). The
 * cooldown path may chain two ensureTemplate() loads (cooldown-start → block-wall
 * fallback) when a stub loadDesignTemplate never populates the layouts, so drain
 * generously.
 */
async function flush() {
  for (let i = 0; i < 24; i++) await Promise.resolve();
}

function gatedTestData(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Курс",
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "k", failPolicy: "failOpen" },
    },
    retakePlugin: { runtimeEntry: "suspendDataCooldown", config: {} },
    ...over,
  };
}

beforeAll(() => {
  // templateCore.js assigns window.TestBuilder (with _internal.renderPathOnlyDsl).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(coreSrc)();
  expect((window as any).TestBuilder?._internal?.renderPathOnlyDsl).toBeTypeOf("function");
});

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  // The gate now reads the portal chrome (SECID + the Date header). Offline here:
  // every resolver degrades exactly as it does when the portal is unreachable.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});

describe("PRD-6 gate block page — rendered from the design template", () => {
  it("renders the template system.blocked layout (cooldown branch) with retake.* filled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T10:00:00Z"));
    try {
      const calls: string[] = [];
      const SCORM = {
        getValue: (k: string) =>
          k === "cmi.suspend_data"
            ? JSON.stringify({ retake: { lastCompletedDate: "2026-05-20" } })
            : "",
        init: () => calls.push("initialize"),
      };
      const state: Record<string, unknown> = { templateLayouts: { "system.blocked": blockedLayout } };
      const gate = makeGate({ state, SCORM, escapeHtml });

      let started = false;
      gate.run(gatedTestData(), () => { started = true; });
      await flush();

      const app = document.getElementById("app")!;
      // Template surface (scene layout) — not the built-in fallback.
      expect(app.querySelector(".tb-scene")).toBeTruthy();
      expect(app.querySelector(".retake-wall__card")).toBeNull();

      const cooldown = app.querySelector('[data-retake-branch="cooldown"]') as HTMLElement;
      const error = app.querySelector('[data-retake-branch="error"]') as HTMLElement;
      const dflt = app.querySelector('[data-retake-branch="default"]') as HTMLElement;
      expect(cooldown.style.display).not.toBe("none");
      expect(error.style.display).toBe("none");
      expect(dflt.style.display).toBe("none");

      // path-DSL filled the cooldown period and the humanised next-available date.
      expect(app.querySelector('[data-path="retake.cooldownPeriodDays"]')!.textContent).toBe("30");
      expect(app.querySelector('[data-path="retake.availableDateHuman"]')!.textContent).toBe("19.06.2026");

      // NFR-01/02: blocked path never starts the course / SCORM.
      expect(started).toBe(false);
      expect(calls).not.toContain("initialize");
      expect((state.retake as any)?.allowed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the error branch (failClosed) when the plugin cannot resolve", async () => {
    const SCORM = { getValue: () => "", init: () => {} };
    const state: Record<string, unknown> = { templateLayouts: { "system.blocked": blockedLayout } };
    const gate = makeGate({ state, SCORM, escapeHtml });

    // webtutorCooldown with no resolvable object_id => reject => failClosed => error branch.
    gate.run(
      gatedTestData({
        retakePolicy: {
          enabled: true,
          cooldownPeriodDays: 30,
          eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failClosed" },
        },
        retakePlugin: { runtimeEntry: "webtutorCooldown", config: { objectIdPatterns: ["object_id=(\\d{6,})"] } },
      }),
      () => {},
    );
    await flush();

    const app = document.getElementById("app")!;
    expect(app.querySelector('[data-testid="retake-wall"]')).toBeTruthy();
    const cooldown = app.querySelector('[data-retake-branch="cooldown"]') as HTMLElement;
    const error = app.querySelector('[data-retake-branch="error"]') as HTMLElement;
    expect(error.style.display).not.toBe("none");
    expect(cooldown.style.display).toBe("none");
  });

  it("falls back to the built-in wall when the template has no system.blocked layout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T10:00:00Z"));
    try {
      const SCORM = {
        getValue: (k: string) =>
          k === "cmi.suspend_data"
            ? JSON.stringify({ retake: { lastCompletedDate: "2026-05-20" } })
            : "",
        init: () => {},
      };
      const state: Record<string, unknown> = { templateLayouts: {} }; // no system.blocked
      const gate = makeGate({ state, SCORM, escapeHtml });

      gate.run(gatedTestData(), () => {});
      await flush();

      const app = document.getElementById("app")!;
      expect(app.querySelector(".retake-wall__card")).toBeTruthy();
      // The built-in fallback wall is used, not the template's scene layout.
      expect(app.querySelector(".tb-scene")).toBeNull();
      expect(app.querySelector('[data-testid="retake-wall"]')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
