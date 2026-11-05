/**
 * @module tests/sim-analysis
 * @description Efficiency, lostness and the four axes (v2-design.md sections 2.4, 2.5, 4.2).
 */
import { describe, it, expect } from "vitest";
import { analyzeRun, axesOf, axesRatio, efficiency, lostness, timeAxis } from "@shared/sim/analysis";
import { createRun } from "@shared/sim/engine";
import { DEFAULT_SIM_PENALTIES } from "@shared/sim/scoring";
import type { Scenario, SimResult } from "@shared/sim/contract";

describe("эффективность", () => {
  it("маршрут: оценка × чистота прохождения", () => {
    expect(efficiency(10, 6, { rating: 0.8, cost: 8 }, undefined)).toBeCloseTo(0.64);
    expect(efficiency(8, 6, { rating: 0.8, cost: 8 }, undefined)).toBeCloseTo(0.8);
  });
  it("без маршрута — по оптимуму; с «прочими путями» — их оценка × оптимум", () => {
    expect(efficiency(12, 6, null, undefined)).toBeCloseTo(0.5);
    expect(efficiency(12, 6, null, 0.5)).toBeCloseTo(0.25);
  });
  it("оптимум неизвестен и маршрута нет — ось не участвует", () => {
    expect(efficiency(12, null, null, undefined)).toBeNull();
  });
});

describe("потерянность и время", () => {
  it("индекс потерянности Смита: идеальный прогон — 0", () => {
    const run = { events: [{ t: 0, type: "enter", scene: "a" }, { t: 1, type: "enter", scene: "b" }] } as Pick<SimResult, "events">;
    expect(lostness(run, 2)).toBe(0);
  });
  it("ось времени — норма к факту, не больше 1", () => {
    expect(timeAxis(120_000, 60)).toBeCloseTo(0.5);
    expect(timeAxis(30_000, 60)).toBe(1);
    expect(timeAxis(30_000, undefined)).toBe(1);
  });
});

describe("оси и их произведение", () => {
  const s: Scenario = {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "A", task: "T" }, media: [], goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 10 }, start: "a", scenes: [
      { id: "a", title: "A", elements: [], zones: [
        { id: "side", role: "detour", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "b" }] },
        { id: "go", role: "path", x: 10, y: 0, w: 5, h: 5, effects: [{ goto: "goal" }] },
      ] },
      { id: "b", title: "B", elements: [], zones: [{ id: "back", role: "path", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "a" }] }] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ] }],
  };

  it("шаг в сторону снижает эффективность, но не точность", () => {
    const run = createRun(s, { now: () => 0 });
    run.click(2, 2); run.click(2, 2); run.click(12, 2);
    const result = run.result();
    const analysis = analyzeRun(s, result);
    expect(analysis).toMatchObject({ cost: 3, optimum: 1, route: null });
    expect(analysis.efficiency).toBeCloseTo(1 / 3);
    const axes = axesOf(result, analysis, { countPartial: true, penalties: DEFAULT_SIM_PENALTIES, efficiency: true, time: false });
    expect(axes).toEqual({ result: 1, efficiency: analysis.efficiency, accuracy: 1, time: 1 });
    expect(axesRatio(axes)).toBeCloseTo(1 / 3);
  });
});
