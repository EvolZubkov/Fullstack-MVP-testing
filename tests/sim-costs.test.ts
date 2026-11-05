/**
 * @module tests/sim-costs
 * @description Cost of an action (v2-design.md section 2.1): the action's own cost, else the
 * scenario's default for its kind, else the system default.
 */
import { describe, it, expect } from "vitest";
import { actionCost, fieldCost, DEFAULT_ACTION_COSTS } from "@shared/sim/costs";

describe("стоимость действия", () => {
  it("умолчания системы по виду", () => {
    expect(actionCost({ id: "a" })).toBe(1);
    expect(actionCost({ id: "a", action: "hover" })).toBe(0.5);
    expect(actionCost({ id: "a", action: "drag" })).toBe(1.5);
    expect(actionCost({ id: "k", keys: "Ctrl+S" })).toBe(0.5);
    expect(fieldCost()).toBe(1);
    expect(DEFAULT_ACTION_COSTS.tap).toBe(1);
  });

  it("умолчание сценария сильнее системного, своя стоимость сильнее обоих", () => {
    expect(actionCost({ id: "a" }, { click: 2 })).toBe(2);
    expect(actionCost({ id: "a", cost: 3 }, { click: 2 })).toBe(3);
    expect(actionCost({ id: "k", keys: "F2" }, { key: 0.25 })).toBe(0.25);
    expect(fieldCost({ field: 2 })).toBe(2);
  });

  it("негодные числа не принимаются", () => {
    expect(actionCost({ id: "a", cost: -1 })).toBe(1);
    expect(actionCost({ id: "a" }, { click: Number.NaN })).toBe(1);
  });
});
