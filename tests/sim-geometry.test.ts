/**
 * @module tests/sim-geometry
 * @description Zone shapes of the scenario contract: the hit test of a rectangle (plain and
 * rounded), an ellipse and a polygon, the polygon validity rule the import relies on, and the
 * engine resolving clicks by shape rather than by bounding box.
 */
import { describe, it, expect } from "vitest";
import { boundsOf, contains, insidePolygon, polygonProblem, radiusOf, type Point } from "@shared/sim/geometry";
import { createRun } from "@shared/sim/engine";
import type { Scenario } from "@shared/sim/contract";

describe("прямоугольник", () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 };

  it("попадание внутри и на границе, промах снаружи", () => {
    expect(contains(rect, 200, 150)).toBe(true);
    expect(contains(rect, 100, 100)).toBe(true);
    expect(contains(rect, 300, 200)).toBe(true);
    expect(contains(rect, 99, 150)).toBe(false);
    expect(contains(rect, 200, 201)).toBe(false);
  });

  it("скруглённый: срезанный угол — промах, дуга и середина стороны — попадание", () => {
    const round = { ...rect, radius: 20 };
    expect(contains(round, 101, 101)).toBe(false);
    expect(contains(round, 299, 199)).toBe(false);
    // On the arc: 45 degrees from the top-left corner centre (120, 120).
    const d = 20 / Math.SQRT2;
    expect(contains(round, 120 - d, 120 - d)).toBe(true);
    expect(contains(round, 100, 150)).toBe(true);
    expect(contains(round, 200, 100)).toBe(true);
  });

  it("радиус больше половины стороны усекается до «таблетки»", () => {
    const pill = { x: 0, y: 0, w: 200, h: 40, radius: 999 };
    expect(radiusOf(pill)).toBe(20);
    expect(contains(pill, 20, 0)).toBe(true);
    expect(contains(pill, 2, 2)).toBe(false);
  });
});

describe("эллипс", () => {
  const ellipse = { shape: "ellipse" as const, x: 0, y: 0, w: 200, h: 100 };

  it("вписан в прямоугольник: центр и края осей — попадание, угол — промах", () => {
    expect(contains(ellipse, 100, 50)).toBe(true);
    expect(contains(ellipse, 0, 50)).toBe(true);
    expect(contains(ellipse, 100, 0)).toBe(true);
    expect(contains(ellipse, 5, 5)).toBe(false);
    expect(contains(ellipse, 195, 95)).toBe(false);
  });

  it("круг при w = h", () => {
    const circle = { shape: "ellipse" as const, x: 0, y: 0, w: 100, h: 100 };
    expect(contains(circle, 50 + 49, 50)).toBe(true);
    expect(contains(circle, 50 + 36, 50 + 36)).toBe(false);
  });

  it("у эллипса нет радиуса скругления", () => {
    expect(radiusOf(ellipse)).toBe(0);
  });
});

describe("многоугольник", () => {
  // A trapezoid tab: wide bottom, narrow top.
  const tab: Point[] = [[20, 0], [80, 0], [100, 40], [0, 40]];

  it("внутри, на стороне и в вершине — попадание; в срезанном углу габарита — промах", () => {
    expect(insidePolygon(tab, 50, 20)).toBe(true);
    expect(insidePolygon(tab, 50, 0)).toBe(true);
    expect(insidePolygon(tab, 20, 0)).toBe(true);
    expect(insidePolygon(tab, 10, 20)).toBe(true);
    expect(insidePolygon(tab, 2, 2)).toBe(false);
    expect(insidePolygon(tab, 98, 2)).toBe(false);
  });

  it("невыпуклый: выемка — промах", () => {
    const l: Point[] = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]];
    expect(insidePolygon(l, 10, 90)).toBe(true);
    expect(insidePolygon(l, 90, 10)).toBe(true);
    expect(insidePolygon(l, 60, 60)).toBe(false);
  });

  it("габарит вычисляется по вершинам", () => {
    expect(boundsOf({ shape: "polygon", points: tab })).toEqual({ x: 0, y: 0, w: 100, h: 40 });
  });

  it("негодные многоугольники называются, годный — нет", () => {
    expect(polygonProblem(tab)).toBeNull();
    expect(polygonProblem([[0, 0], [10, 0]])).toMatch(/трёх/);
    expect(polygonProblem([[0, 0], [10, 0], [10, 10], [0, 0]])).toMatch(/повторяется/);
    // A bow tie: edges (0,0)-(10,10) and (10,0)-(0,10) cross.
    expect(polygonProblem([[0, 0], [10, 10], [10, 0], [0, 10]])).toMatch(/пересекаются/);
  });
});

describe("движок разбирает клик по форме зоны", () => {
  const scenario: Scenario = {
    format: "skillum.sim-scenario",
    version: 1,
    meta: { title: "Формы", task: "Нажмите вкладку" },
    settings: { stage: { w: 400, h: 300 }, hints: { enabled: true, afterMisses: 1 } },
    media: [],
    start: "s",
    scenes: [
      {
        id: "s",
        title: "Сцена",
        elements: [],
        zones: [
          { id: "tab", shape: "polygon", points: [[20, 0], [80, 0], [100, 40], [0, 40]], role: "path", hint: "Вкладка", effects: [{ goto: "done" }] },
          { id: "avatar", shape: "ellipse", x: 200, y: 100, w: 100, h: 100, role: "detour", effects: [] },
        ],
      },
      { id: "done", title: "Готово", elements: [], goal: { outcome: "success" } },
    ],
  };

  it("клик в габарите, но вне формы — промах; внутри формы — действие", () => {
    const run = createRun(scenario, { now: () => 0 });
    expect(run.click(2, 2).kind).toBe("miss");
    expect(run.click(205, 105).kind).toBe("miss");
    expect(run.click(250, 150).kind).toBe("action");
    expect(run.click(50, 20).kind).toBe("done");
    expect(run.result().counts.misses).toBe(2);
  });

  it("подсказка несёт форму зоны и её габарит", () => {
    const run = createRun(scenario, { now: () => 0 });
    run.click(2, 2);
    const hint = run.hint();
    expect(hint?.target).toBe("tab");
    expect(hint?.box).toEqual({ x: 0, y: 0, w: 100, h: 40 });
    expect(hint?.shape).toEqual({ shape: "polygon", points: [[20, 0], [80, 0], [100, 40], [0, 40]] });
  });
});
