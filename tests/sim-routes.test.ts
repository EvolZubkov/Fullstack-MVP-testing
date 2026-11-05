/**
 * @module tests/sim-routes
 * @description Declared routes (v2-design.md section 2.3): a run follows a route when it contains
 * the keys in order; the best rating wins, then the cheaper route; route checks name what is wrong.
 */
import { describe, it, expect } from "vitest";
import { createRun } from "@shared/sim/engine";
import { followsRoute, recognizeRoute, routeProblems, actedSteps } from "@shared/sim/routes";
import { playable } from "@shared/sim/variant";
import type { Route, Scenario } from "@shared/sim/contract";

const z = (id: string, x: number, effects: unknown[], role = "path") => ({ id, role, x, y: 0, w: 5, h: 5, effects }) as never;

function scenario(routes: Route[]): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "R", task: "T" }, media: [], goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 10 }, start: "a", routes, scenes: [
      { id: "a", title: "A", elements: [], zones: [z("menu", 0, [{ goto: "m" }]), z("plus", 10, [{ goto: "card" }], "alt")] },
      { id: "m", title: "Меню", elements: [], zones: [z("new", 0, [{ goto: "card" }])] },
      { id: "card", title: "Карточка", elements: [], zones: [z("save", 0, [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ] }],
  };
}

const viaMenu: Route = { id: "menu", title: "Через меню", rating: 0.8, keys: [{ scene: "a", action: "menu" }, { scene: "m", action: "new" }] };
const viaPlus: Route = { id: "plus", title: "Кнопка «+»", rating: 1, keys: [{ scene: "a", action: "plus" }] };

describe("распознавание маршрута", () => {
  it("ключи по порядку, лишние действия между ними не мешают", () => {
    const steps = [{ scene: "a", action: "menu" }, { scene: "m", action: "x" }, { scene: "m", action: "new" }];
    expect(followsRoute(steps, viaMenu)).toBe(true);
    expect(followsRoute([steps[2], steps[0]], viaMenu)).toBe(false);
  });

  it("прогон через «+» распознаётся как маршрут «+»", () => {
    const s = scenario([viaMenu, viaPlus]);
    const run = createRun(s, { now: () => 0 });
    run.click(12, 2);
    run.click(2, 2);
    expect(actedSteps(run.result()).map((x) => x.action)).toEqual(["plus", "save"]);
    const costs = new Map([["menu", 3], ["plus", 2]]);
    expect(recognizeRoute(playable(s), run.result(), costs)?.route.id).toBe("plus");
  });

  it("при равной оценке выигрывает более дешёвый маршрут", () => {
    const a: Route = { ...viaMenu, id: "a", rating: 1, keys: [{ scene: "card", action: "save" }] };
    const b: Route = { ...viaPlus, id: "b", rating: 1, keys: [{ scene: "a", action: "plus" }] };
    const s = scenario([a]);
    const run = createRun(s, { now: () => 0 });
    run.click(12, 2); run.click(2, 2);
    expect(recognizeRoute({ ...playable(s), routes: [b, a] }, run.result(), new Map([["a", 2], ["b", 5]]))?.route.id).toBe("a");
  });
});

describe("проверки маршрутов", () => {
  it("правильные маршруты — без ошибок; нет оценки 1 — предупреждение", () => {
    expect(routeProblems(playable(scenario([viaMenu, viaPlus])))).toEqual({ errors: [], warnings: [] });
    expect(routeProblems(playable(scenario([viaMenu]))).warnings).toEqual(["Ни у одного маршрута нет оценки 1: максимум балла меньше 100%"]);
  });

  it("ссылка в никуда, негодная оценка, одинаковые ключи, недостижимая цель", () => {
    const broken: Route[] = [
      { id: "r1", title: "Р1", rating: 1, keys: [{ scene: "a", action: "ghost" }] },
      { id: "r2", title: "Р2", rating: 1.5, keys: [{ scene: "a", action: "plus" }] },
      { id: "r3", title: "Р3", rating: 1, keys: [{ scene: "a", action: "plus" }] },
      { id: "r4", title: "Р4", rating: 1, keys: [{ scene: "card", action: "save" }, { scene: "a", action: "menu" }] },
    ];
    const { errors } = routeProblems(playable(scenario(broken)));
    expect(errors).toContain("Маршрут «Р1»: на сцене «A» нет действия ghost");
    expect(errors).toContain("Маршрут «Р2»: оценка должна быть больше 0 и не больше 1");
    expect(errors).toContain("Маршруты «Р2» и «Р3»: одинаковые ключевые действия");
    expect(errors).toContain("Маршрут «Р4»: до цели нельзя дойти через его ключевые действия по порядку");
  });
});
