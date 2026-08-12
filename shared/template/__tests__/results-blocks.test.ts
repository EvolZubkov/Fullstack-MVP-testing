import { describe, it, expect } from "vitest";
import { resolveResultsBlocks } from "../results-blocks";

const STATE = { hasPassThreshold: true, hasVisibleScales: true, hasVisibleIndicators: true };

describe("resolveResultsBlocks", () => {
  it("при auto включает сводку, когда у теста есть порог", () => {
    const b = resolveResultsBlocks({}, STATE);
    expect(b.scoreSummary).toBe(true);
  });

  it("при auto выключает сводку у теста без порога", () => {
    const b = resolveResultsBlocks({}, { ...STATE, hasPassThreshold: false });
    expect(b.scoreSummary).toBe(false);
  });

  it("при auto включает шкалы и показатели по их наличию", () => {
    const b = resolveResultsBlocks({}, { ...STATE, hasVisibleScales: false });
    expect(b.scales).toBe(false);
    expect(b.indicators).toBe(true);
  });

  it("show перебивает автоматику", () => {
    const b = resolveResultsBlocks({ scoreSummary: "show" }, { ...STATE, hasPassThreshold: false });
    expect(b.scoreSummary).toBe(true);
  });

  it("hide перебивает автоматику", () => {
    const b = resolveResultsBlocks({ scales: "hide" }, STATE);
    expect(b.scales).toBe(false);
  });

  it("неизвестное значение настройки читается как auto", () => {
    const b = resolveResultsBlocks({ scales: "maybe" } as never, STATE);
    expect(b.scales).toBe(true);
  });
});
