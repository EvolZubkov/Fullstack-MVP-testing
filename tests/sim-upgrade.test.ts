/**
 * @module tests/sim-upgrade
 * @description Version 1 scenarios read as version 2 (`shared/sim/upgrade`, v2-design.md section 1,
 * «Перевод v1 в v2»): the move is mechanical and lossless, a version 2 scenario passes through
 * untouched, and question content is read through one helper.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asScenario, liftV1, scenarioOf, upgradeScenario, withCurrentScenario, ScenarioUpgradeError } from "@shared/sim/upgrade";
import type { ScenarioV1 } from "@shared/sim/contract-v1";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8")) as ScenarioV1;

describe("перевод v1 в v2", () => {
  it("сцены уходят в вариант desktop, проверки цели — в корень, вид — control", () => {
    const { scenario, notes } = upgradeScenario(v1);
    expect(scenario.version).toBe(2);
    expect(scenario.kind).toBe("control");
    expect(scenario.variants).toHaveLength(1);
    const variant = scenario.variants[0];
    expect(variant.device).toBe("desktop");
    expect(variant.start).toBe(v1.start);
    expect(variant.scenes.map((s) => s.id)).toEqual(v1.scenes.map((s) => s.id));
    const goalScene = v1.scenes.find((s) => s.goal?.outcome === "success")!;
    expect(scenario.goal?.checks).toEqual(goalScene.goal!.checks);
    expect(variant.scenes.find((s) => s.id === goalScene.id)!.end).toEqual({ outcome: "success", ...(goalScene.goal!.message ? { message: goalScene.goal!.message } : {}) });
    expect(variant.scenes.some((s) => "goal" in s)).toBe(false);
    expect(notes).toEqual([]);
  });

  it("размер сцены и минимальная ширина окна переезжают в вариант", () => {
    const { scenario } = upgradeScenario({ ...v1, settings: { ...v1.settings, stage: { w: 1600, h: 900 }, minViewportWidth: 1400 } });
    expect(scenario.variants[0].stage).toEqual({ w: 1600, h: 900 });
    expect(scenario.variants[0].minViewportWidth).toBe(1400);
    expect(scenario.settings).not.toHaveProperty("stage");
    expect(scenario.settings).not.toHaveProperty("minViewportWidth");
  });

  it("сцены-провалы становятся end: fail с тем же сообщением", () => {
    const failScene = v1.scenes.find((s) => s.goal?.outcome === "fail")!;
    const { scenario } = upgradeScenario(v1);
    expect(scenario.variants[0].scenes.find((s) => s.id === failScene.id)!.end).toEqual({ outcome: "fail", ...(failScene.goal!.message ? { message: failScene.goal!.message } : {}) });
  });

  it("разные проверки у двух сцен-целей — отказ с объяснением", () => {
    const twin = structuredClone(v1);
    const goal = twin.scenes.find((s) => s.goal?.outcome === "success")!;
    twin.scenes.push({ ...structuredClone(goal), id: "goal-2", title: "Вторая цель", goal: { outcome: "success", checks: [] } });
    expect(() => upgradeScenario(twin)).toThrow(ScenarioUpgradeError);
    expect(() => upgradeScenario(twin)).toThrow(/разные поля/);
  });

  it("views версии 1 не переносятся и называются в заметках", () => {
    const withViews = structuredClone(v1);
    withViews.scenes[0].views = [{ device: "phone" }];
    const { scenario, notes } = upgradeScenario(withViews);
    expect(scenario.variants[0].scenes[0]).not.toHaveProperty("views");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/views/);
  });

  it("v2 проходит без изменений, тем же объектом", () => {
    const v2 = asScenario(v1);
    expect(asScenario(v2)).toBe(v2);
  });

  it("перевод запоминается: тот же вход — тот же объект", () => {
    expect(asScenario(v1)).toBe(asScenario(v1));
  });

  it("неизвестная версия — отказ", () => {
    expect(() => upgradeScenario({ ...v1, version: 7 } as never)).toThrow(/Неизвестная версия/);
  });
});

describe("liftV1 — терпимый перевод для проверок", () => {
  it("не падает на сломанном v1 и сохраняет сломанное как есть", () => {
    const { doc, conflict } = liftV1({ format: "skillum.sim-scenario", version: 1, scenes: "oops", start: 5 });
    expect(conflict).toBeNull();
    expect((doc.variants as Array<Record<string, unknown>>)[0].scenes).toBe("oops");
    expect((doc.variants as Array<Record<string, unknown>>)[0].start).toBe(5);
  });
});

describe("содержимое вопроса", () => {
  it("scenarioOf читает v1 и v2, отдаёт null без сценария", () => {
    expect(scenarioOf({ scenario: v1 })?.version).toBe(2);
    expect(scenarioOf({ scenario: asScenario(v1) })?.version).toBe(2);
    expect(scenarioOf({})).toBeNull();
    expect(scenarioOf(null)).toBeNull();
    expect(scenarioOf({ scenario: { version: 9 } })).toBeNull();
  });

  it("withCurrentScenario подменяет сценарий на v2 и не трогает прочее", () => {
    const data = { scenario: v1, extra: 1 };
    const next = withCurrentScenario(data);
    expect(next.extra).toBe(1);
    expect((next.scenario as { version: number }).version).toBe(2);
    const plain = { options: ["a"] };
    expect(withCurrentScenario(plain)).toBe(plain);
  });
});
