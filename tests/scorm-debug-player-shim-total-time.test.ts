/**
 * @module tests/scorm-debug-player-shim-total-time
 * @description The RTE shim of both players (CLI `scorm:player` and the in-service debug player)
 * keeps `cmi.total_time` the way an LMS does: the sum of the sessions' `cmi.session_time`,
 * credited when the next session starts. Without it a package of a TIMED test cannot write its
 * PRD-20 active-time anchor, so every relaunch dropped the attempt (`start_fresh`) and offered
 * «Начать тестирование заново» — while the target LMS (WebTutor) resumes it.
 */
import { describe, it, expect } from "vitest";
import { readDebugPlayerAssets } from "../server/scorm/debug-player/player-assets.mjs";

type Api = {
  Initialize: (s: string) => string;
  Terminate: (s: string) => string;
  GetValue: (k: string) => string;
  SetValue: (k: string, v: string) => string;
  Commit: (s: string) => string;
  GetLastError: () => string;
};

interface Shim {
  api: Api;
  restore: (key: string) => void;
  reset: () => void;
}

/** Runs the shim source in a fake window sharing one localStorage between «page loads». */
function loadShim(store: Map<string, string>): Shim {
  const { shimJs } = readDebugPlayerAssets();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const win: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("window", "localStorage", shimJs)(win, localStorage);
  return { api: win.API_1484_11, restore: win.__scorm.restore, reset: win.__scorm.reset };
}

describe("RTE shim: cmi.total_time", () => {
  it("a fresh registration reads zero time", () => {
    const { api } = loadShim(new Map());
    api.Initialize("");
    expect(api.GetValue("cmi.total_time")).toBe("PT0H0M0S");
  });

  it("the committed session time is credited when the next session starts", () => {
    const store = new Map<string, string>();
    const first = loadShim(store);
    first.restore("pkg");
    first.api.Initialize("");
    first.api.SetValue("cmi.suspend_data", '{"v":2}');
    first.api.SetValue("cmi.session_time", "PT1M30S");
    first.api.Commit(""); // a killed tab never reaches Terminate — the commit is what counts

    const second = loadShim(store);
    second.restore("pkg");
    second.api.Initialize("");
    expect(second.api.GetValue("cmi.total_time")).toBe("PT0H1M30S");
    expect(second.api.GetValue("cmi.entry")).toBe("resume");
  });

  it("sessions add up, and a relaunch in the same window is a new session too", () => {
    const shim = loadShim(new Map());
    shim.restore("pkg");
    shim.api.Initialize("");
    shim.api.SetValue("cmi.session_time", "PT1H0M5S");
    shim.api.Terminate("");
    shim.api.Initialize(""); // the SCO frame reloaded: the RTE window stayed
    shim.api.SetValue("cmi.session_time", "PT20.5S");
    shim.api.Terminate("");
    shim.api.Initialize("");
    expect(shim.api.GetValue("cmi.total_time")).toBe("PT1H0M25.5S");
  });

  it("a session is credited once, however many times Initialize runs", () => {
    const shim = loadShim(new Map());
    shim.api.Initialize("");
    shim.api.SetValue("cmi.session_time", "PT10S");
    shim.api.Terminate("");
    shim.api.Initialize("");
    shim.api.Terminate("");
    shim.api.Initialize("");
    expect(shim.api.GetValue("cmi.total_time")).toBe("PT0H0M10S");
  });

  it("total_time is read-only for the SCO, and the attempt reset zeroes it", () => {
    const shim = loadShim(new Map());
    shim.api.Initialize("");
    expect(shim.api.SetValue("cmi.total_time", "PT5H")).toBe("false");
    expect(shim.api.GetLastError()).toBe("404");
    shim.api.SetValue("cmi.session_time", "PT10S");
    shim.api.Terminate("");
    shim.reset();
    shim.api.Initialize("");
    expect(shim.api.GetValue("cmi.total_time")).toBe("PT0H0M0S");
  });
});
