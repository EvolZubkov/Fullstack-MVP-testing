/**
 * @module tests/sim-engine-v2
 * @description What version 2 adds to the engine: research scenarios (actions without a role,
 * finales, «Я закончил»), the cost of a run, the device of the result.
 */
import { describe, it, expect } from "vitest";
import { createRun } from "@shared/sim/engine";
import type { Scenario } from "@shared/sim/contract";

/** Two scenes: «home» with a zone to «found», a target finale, and a field on «home». */
function research(extra: Partial<Scenario> = {}): Scenario {
  return {
    format: "skillum.sim-scenario",
    version: 2,
    kind: "research",
    meta: { title: "Поиск функции", task: "Найдите экспорт" },
    media: [{ id: "bg", file: "media/bg.png", w: 100, h: 100 }],
    fields: [{ id: "q", fill: "keyboard" }],
    variants: [{
      device: "desktop",
      stage: { w: 100, h: 100 },
      start: "home",
      scenes: [
        {
          id: "home", title: "Главная", elements: [{ id: "bg", media: "bg", x: 0, y: 0 }],
          fields: [{ field: "q", x: 0, y: 80, w: 50, h: 10, editable: true }],
          zones: [
            { id: "menu", x: 0, y: 0, w: 10, h: 10, effects: [{ goto: "found" }] },
            { id: "logo", x: 50, y: 0, w: 10, h: 10, cost: 4, effects: [{ show: "bg" }] },
          ],
          keys: [{ id: "find", keys: "Ctrl+F", effects: [{ goto: "found" }] }],
        },
        { id: "found", title: "Экспорт", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
      ],
    }],
    ...extra,
  };
}

describe("исследовательский сценарий", () => {
  it("действие без роли засчитывается и ведёт к финалу", () => {
    const run = createRun(research(), { now: () => 0 });
    run.click(5, 5);
    const r = run.result();
    expect(r.outcome).toBe("finale");
    expect(r.finale).toEqual({ scene: "found", title: "Нашёл", target: true });
    expect(r.counts.actions).toBe(1);
    const action = r.events.find((e) => e.type === "action");
    expect(action).toEqual({ t: 0, type: "action", scene: "home", id: "menu" });
    expect(r.events.at(-1)).toEqual({ t: 0, type: "goal", scene: "found", outcome: "finale", finale: "found" });
  });

  it("«Я закончил» завершает прогон исходом declared", () => {
    const run = createRun(research(), { now: () => 0 });
    expect(run.declare()).toEqual({ kind: "done", outcome: "declared" });
    expect(run.result().outcome).toBe("declared");
    expect(run.result().events.at(-1)).toEqual({ t: 0, type: "declare" });
  });

  it("«Я закончил» выключен настройкой — ничего не делает", () => {
    const run = createRun(research({ settings: { finishButton: false } }));
    expect(run.declare()).toEqual({ kind: "none" });
    expect(run.done()).toBe(false);
  });
});

describe("стоимость прогона", () => {
  it("складывается из принятых действий и фиксаций полей", () => {
    const run = createRun(research(), { now: () => 0 });
    run.commitField("q", "экспорт");   // field: 1
    run.click(55, 5);                  // own cost: 4
    run.click(90, 50);                 // miss — not a cost
    run.key("Ctrl+F");                 // key: 0.5, ends the run
    expect(run.result().cost).toBe(5.5);
  });

  it("результат несёт устройство и версию 2", () => {
    const r = createRun(research()).result();
    expect(r.variant).toBe("desktop");
    expect(r.version).toBe(2);
  });
});

describe("контрольный сценарий", () => {
  it("«Я закончил» у контрольного сценария не работает", () => {
    const run = createRun({ ...research(), kind: "control" });
    expect(run.declare()).toEqual({ kind: "none" });
  });
});
