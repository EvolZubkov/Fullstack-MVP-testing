/**
 * @module tests/debug-player-snapshot
 * @description PRD-18 Phase 4 — unit tests for the pure inspector snapshot adapter
 * (`client/src/features/tests/debug-player/inspector-snapshot.ts`). It maps the
 * shared `window.TBInspector` compute output + the RTE `__scorm` mirror into the
 * immutable view-model the DS panels render. The compute layer itself is mocked
 * here (its logic is covered by the CLI parity path); this asserts the React-side
 * derivations: progress, published grade/verdict, the formula-error alarm, watch
 * source selection, and CSV export.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildSnapshot, protocolToCsv,
  type ProtocolRow, type TBInspectorApi, type ScormBridge,
} from "../client/src/features/tests/debug-player/inspector-snapshot";

function row(over: Partial<ProtocolRow>): ProtocolRow {
  return {
    idx: 1, topicName: "", prompt: "", type: "single", typeLabel: "Один ответ", answerStr: "",
    answered: false, verdict: "none", ratio: 0, ratioPct: 0, score: null, sMax: null,
    earned: 0, points: 1, difficulty: null, levelName: null, contribs: [], ...over,
  };
}

const PKG = { hasData: true, mode: "standard", state: { answers: { q1: 0 } }, scaleErrors: [], resultErrors: [] };

function mockTB(over: Partial<TBInspectorApi> = {}): TBInspectorApi {
  return {
    readPkg: vi.fn(() => PKG),
    parseInteractions: vi.fn(() => []),
    buildProtocolRows: vi.fn(() => ({ rows: [row({ idx: 1, answered: true }), row({ idx: 2, answered: false })], note: "" })),
    buildScaleRows: vi.fn(() => []),
    buildResultRows: vi.fn(() => []),
    buildAdaptiveBar: vi.fn(() => ({ visible: false })),
    buildScore: vi.fn(() => ({ available: true, adaptive: false, percent: 50, passed: false })),
    buildDraw: vi.fn(() => ({ available: false, adaptive: false })),
    applyReference: vi.fn(),
    clearReference: vi.fn(),
    humanizeTraffic: vi.fn(() => []),
    flattenLimited: vi.fn((o: unknown) => Object.keys(o as object).map((k) => ({ path: k, disp: "x" }))),
    safeJson: vi.fn(() => "{}"),
    getSuspendAttempts: vi.fn(() => []),
    ...over,
  };
}

function bridge(cmi: Record<string, string>): ScormBridge {
  return { getCmi: () => cmi, getTraffic: () => [], subscribe: () => {}, restore: () => {}, reset: () => {} };
}

beforeEach(() => { window.TBInspector = mockTB(); });

describe("buildSnapshot", () => {
  it("returns the empty snapshot when TBInspector is absent", () => {
    window.TBInspector = undefined;
    const s = buildSnapshot(null, null, { protocolMode: "live", watchSource: "state" });
    expect(s.hasData).toBe(false);
    expect(s.protocol.rows).toEqual([]);
    expect(s.attempts).toEqual([{ value: "live", label: "Текущая (live)" }]);
  });

  it("derives progress from answered vs drawn protocol rows", () => {
    const s = buildSnapshot(null, bridge({}), { protocolMode: "live", watchSource: "state" });
    expect(s.status.drawn).toBe(2);
    expect(s.status.answered).toBe(1);
    expect(s.status.percentDone).toBe(50);
  });

  it("surfaces the published grade and verdict only once the LMS has them", () => {
    const s = buildSnapshot(null, bridge({
      "cmi.score.raw": "8", "cmi.score.max": "10", "cmi.score.scaled": "0.8", "cmi.success_status": "passed",
    }), { protocolMode: "live", watchSource: "state" });
    expect(s.status.score).toEqual({ raw: "8", max: "10", scaledPct: 80 });
    expect(s.status.verdict).toBe("passed");
    expect(s.status.alarm).toBeNull();
  });

  it("has no grade before the module reports a score", () => {
    const s = buildSnapshot(null, bridge({ "cmi.success_status": "unknown" }), { protocolMode: "live", watchSource: "state" });
    expect(s.status.score).toBeNull();
    expect(s.status.verdict).toBe("unknown");
  });

  it("raises the calculation alarm on an engine error", () => {
    window.TBInspector = mockTB({ readPkg: vi.fn(() => ({ ...PKG, engineError: "boom" })) });
    const s = buildSnapshot(null, bridge({}), { protocolMode: "live", watchSource: "state" });
    expect(s.status.alarm).toBe("boom");
  });

  it("raises the calculation alarm when a scale/indicator formula errored", () => {
    window.TBInspector = mockTB({ readPkg: vi.fn(() => ({ ...PKG, scaleErrors: [{ key: "k", message: "bad" }] })) });
    const s = buildSnapshot(null, bridge({}), { protocolMode: "live", watchSource: "state" });
    expect(s.status.alarm).toContain("Ошибка расчёта");
  });

  it("selects the cmi store as the watch source", () => {
    const tb = mockTB();
    window.TBInspector = tb;
    const s = buildSnapshot(null, bridge({ "cmi.location": "3" }), { protocolMode: "live", watchSource: "cmi" });
    expect(tb.flattenLimited).toHaveBeenCalledWith({ "cmi.location": "3" });
    expect(s.watch.count).toBeGreaterThan(0);
  });

  it("passes the score and draw view-models through from the compute layer", () => {
    const s = buildSnapshot(null, bridge({}), { protocolMode: "live", watchSource: "state" });
    expect(s.score.available).toBe(true);
    expect(s.score.percent).toBe(50);
    expect(s.draw.available).toBe(false);
  });

  it("lists prior attempts from suspend_data after the live run", () => {
    window.TBInspector = mockTB({ getSuspendAttempts: vi.fn(() => [{ attemptNumber: 1, percent: 75 }]) });
    const s = buildSnapshot(null, bridge({}), { protocolMode: "live", watchSource: "state" });
    expect(s.attempts).toHaveLength(2);
    expect(s.attempts[1]).toEqual({ value: "att:0", label: "#1 — 75%" });
  });
});

describe("protocolToCsv", () => {
  it("writes a header and one line per row, escaping separators", () => {
    const rows = [
      row({ idx: 1, topicName: "Тема; A", prompt: "2+2?", type: "single", answerStr: "4", verdict: "correct", ratio: 1, score: 1, sMax: 1, earned: 1, points: 1, contribs: [{ scaleKey: "S", delta: 2 }] }),
    ];
    const csv = protocolToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Вопрос");
    expect(lines[1]).toContain('"Тема; A"'); // quoted because it has a separator
    expect(lines[1]).toContain("S +2");
  });

  it("leaves price columns blank when the question has no score", () => {
    const csv = protocolToCsv([row({ idx: 1, score: null, sMax: null })]);
    expect(csv.split("\n")[1]).toContain(";;"); // empty score/sMax cells
  });
});
