/**
 * @module tests/sim-optimum
 * @description The cheapest way through a scenario (v2-design.md section 2.2): Dijkstra over run
 * states, so conditions are honoured; traps never taken; a field typed by one action; a limit that
 * says «unknown» instead of guessing; route keys passed in order.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cheapestPath, MAX_STATES } from "@shared/sim/optimum";
import { playable } from "@shared/sim/variant";
import type { Scenario, Scene } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));

function graph(scenes: Scene[], extra: Partial<Scenario> = {}): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "G", task: "T" }, media: [],
    fields: [{ id: "f", fill: "keyboard" }],
    goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 100 }, start: scenes[0].id, scenes }],
    ...extra,
  };
}
const z = (id: string, effects: unknown[], more: Record<string, unknown> = {}) =>
  ({ id, role: "path", x: 0, y: 0, w: 1, h: 1, effects, ...more }) as never;

describe("оптимум", () => {
  it("эталонный сценарий: путь найден, его стоимость конечна", () => {
    const found = cheapestPath(playable(v1));
    expect(found.status).toBe("found");
    if (found.status === "found") {
      expect(found.cost).toBeGreaterThan(0);
      expect(found.scenes[0]).toBe(playable(v1).start);
    }
  });

  it("выбирает дешёвый путь из двух", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("long", [{ goto: "b" }]), z("short", [{ goto: "goal" }], { role: "alt", cost: 1.5 })] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    const found = cheapestPath(playable(s));
    expect(found).toMatchObject({ status: "found", cost: 1.5, steps: [{ scene: "a", action: "short" }] });
  });

  it("условие зоны учитывается: сначала заполнить поле", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], fields: [{ field: "f", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("save", [{ goto: "goal" }], { when: { filled: ["f"] }, otherwise: [] })] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 2, steps: [{ scene: "a", action: "field:f" }, { scene: "a", action: "save" }] });
  });

  it("ловушки не берутся, шаги в сторону можно исключить", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [
        z("trap", [{ goto: "goal" }], { role: "trap", error: "E", cost: 0 }),
        z("side", [{ goto: "goal" }], { role: "detour" }),
        z("main", [{ goto: "b" }]),
      ] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 1 });
    expect(cheapestPath(playable(s), { detours: false })).toMatchObject({ status: "found", cost: 2 });
  });

  it("цель с непрошедшей проверкой — не цель", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("go", [{ set: "g", value: "нет" }, { goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ], { fields: [{ id: "g", fill: "effect", check: { rules: [{ kind: "equals", value: "да" }] } as never }], goal: { checks: [{ field: "g" }] } });
    expect(cheapestPath(playable(s)).status).toBe("none");
  });

  it("ключевые действия маршрута проходятся по порядку", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("short", [{ goto: "goal" }]), z("via", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s), { keys: [{ scene: "a", action: "via" }] })).toMatchObject({ status: "found", cost: 2 });
  });

  it("предел состояний — «неизвестно», а не догадка", () => {
    expect(cheapestPath(playable(v1), { maxStates: 2 }).status).toBe("limit");
  });

  it("исследовательский сценарий ищет путь до целевого финала", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("x", [{ goto: "other" }]), z("y", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "found" }])] },
      { id: "other", title: "Не то", elements: [], end: { outcome: "finale", title: "Сдался" } },
      { id: "found", title: "Нашёл", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
    ], { kind: "research", goal: undefined });
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 2, scenes: ["a", "b", "found"] });
  });
});

/** A text rule set the engine really evaluates: the value must be exactly `value`. */
const equals = (value: string) =>
  ({ answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value }] }) as never;
const goalScene = (): Scene => ({ id: "goal", title: "Цель", elements: [], end: { outcome: "success" } });

describe("оптимум: случаи спецификации 2.2–2.3", () => {
  it("два ключа маршрута: по порядку и с лишним действием между ними", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("k1", [{ goto: "b" }]), z("direct", [{ goto: "goal" }])] },
      { id: "b", title: "B", elements: [], zones: [z("mid", [{ goto: "c" }])] },
      { id: "c", title: "C", elements: [], zones: [z("k2", [{ goto: "goal" }])] },
      goalScene(),
    ]);
    const play = playable(s);
    expect(cheapestPath(play)).toMatchObject({ status: "found", cost: 1, steps: [{ scene: "a", action: "direct" }] });
    expect(cheapestPath(play, { keys: [{ scene: "a", action: "k1" }, { scene: "c", action: "k2" }] })).toMatchObject({
      status: "found",
      cost: 3,
      steps: [{ scene: "a", action: "k1" }, { scene: "b", action: "mid" }, { scene: "c", action: "k2" }],
      scenes: ["a", "b", "c", "goal"],
    });
    expect(cheapestPath(play, { keys: [{ scene: "c", action: "k2" }, { scene: "a", action: "k1" }] }).status).toBe("none");
  });

  it("сочетание клавиш — действие пути и ключ маршрута, стоимость по виду key", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("btn", [{ goto: "goal" }])],
        keys: [{ id: "save", keys: "Ctrl+S", role: "path", effects: [{ goto: "goal" }] }] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 0.5, steps: [{ scene: "a", action: "save" }] });
    expect(cheapestPath(playable(s), { keys: [{ scene: "a", action: "btn" }] })).toMatchObject({ status: "found", cost: 1 });
    expect(cheapestPath(playable(s), { keys: [{ scene: "a", action: "save" }] })).toMatchObject({ status: "found", cost: 0.5 });
    const dear = graph(s.variants[0].scenes, { settings: { costs: { key: 2 } } });
    expect(cheapestPath(playable(dear))).toMatchObject({ status: "found", cost: 1, steps: [{ scene: "a", action: "btn" }] });
  });

  it("toggle и visible: пункт меню доступен только после того, как меню открыто", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "menu", media: "m", x: 0, y: 0, hidden: true }],
        zones: [z("open", [{ toggle: "menu" }]), z("item", [{ goto: "goal" }], { when: { visible: "menu" }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "open" }, { scene: "a", action: "item" }],
    });
  });

  it("hide и not: переход открывается, когда баннер скрыт", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "banner", media: "m", x: 0, y: 0 }],
        zones: [z("close", [{ hide: "banner" }]), z("go", [{ goto: "goal" }], { when: { not: { visible: "banner" } }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "close" }, { scene: "a", action: "go" }],
    });
  });

  it("show и all: нужны и открытый диалог, и заполненное поле", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "dlg", media: "m", x: 0, y: 0, hidden: true }],
        fields: [{ field: "f", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("show", [{ show: "dlg" }]), z("ok", [{ goto: "goal" }], { when: { all: [{ visible: "dlg" }, { filled: ["f"] }] }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 3,
      steps: [{ scene: "a", action: "show" }, { scene: "a", action: "field:f" }, { scene: "a", action: "ok" }],
    });
  });

  it("any: хватает одной ветки условия, если другую не выполнить", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "x", media: "m", x: 0, y: 0, hidden: true }],
        fields: [{ field: "f", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("go", [{ goto: "goal" }], { when: { any: [{ visible: "x" }, { filled: ["f"] }] }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "field:f" }, { scene: "a", action: "go" }],
    });
  });

  it("условие field с проверкой: дешёвое неверное значение путь не открывает", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [
        z("bad", [{ set: "code", value: "нет" }]),
        z("good", [{ set: "code", value: "да" }], { cost: 3 }),
        z("go", [{ goto: "goal" }], { when: { field: "code", check: equals("да") }, otherwise: [] }),
      ] },
      goalScene(),
    ], { fields: [{ id: "code", fill: "effect" }] });
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 4, steps: [{ scene: "a", action: "good" }, { scene: "a", action: "go" }],
    });
  });

  it("проверка цели по полю с клавиатуры: фиксация поля плюс переход", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], fields: [{ field: "num", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("submit", [{ goto: "goal" }])] },
      goalScene(),
    ], { fields: [{ id: "num", fill: "keyboard", check: equals("42") }], goal: { checks: [{ field: "num" }] } });
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "field:num" }, { scene: "a", action: "submit" }],
    });
  });

  it("проверка цели по полю, заполняемому эффектом: годится только верное значение", () => {
    const scenes = (value: string): Scene[] => [
      { id: "a", title: "A", elements: [], zones: [z("go", [{ set: "g", value }, { goto: "goal" }])] },
      goalScene(),
    ];
    const extra = { fields: [{ id: "g", fill: "effect" as const, check: equals("да") }], goal: { checks: [{ field: "g" }] } };
    expect(cheapestPath(playable(graph(scenes("нет"), extra))).status).toBe("none");
    expect(cheapestPath(playable(graph(scenes("да"), extra)))).toMatchObject({ status: "found", cost: 1 });
  });

  it("концы: success в исследовательском и финал в контрольном — не цель; пустые проверки — цель", () => {
    const research = graph([
      { id: "a", title: "A", elements: [], zones: [z("go", [{ goto: "goal" }])] },
      goalScene(),
    ], { kind: "research", goal: undefined });
    expect(cheapestPath(playable(research)).status).toBe("none");

    const control = graph([
      { id: "a", title: "A", elements: [], zones: [z("fin", [{ goto: "f" }]), z("go", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "f", title: "Финал", elements: [], end: { outcome: "finale", title: "Финал", target: true } },
      goalScene(),
    ]);
    expect(cheapestPath(playable(control))).toMatchObject({ status: "found", cost: 2, scenes: ["a", "b", "goal"] });

    const direct = [{ id: "a", title: "A", elements: [], zones: [z("go", [{ goto: "goal" }])] }, goalScene()];
    expect(cheapestPath(playable(graph(direct, { goal: { checks: [] } })))).toMatchObject({ status: "found", cost: 1 });
    expect(cheapestPath(playable(graph(direct, { goal: undefined })))).toMatchObject({ status: "found", cost: 1 });
  });

  it("предел: maxStates — число раскрытых состояний, граница включительно; умолчание 100 000", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("ab", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("bc", [{ goto: "c" }])] },
      { id: "c", title: "C", elements: [], zones: [z("cg", [{ goto: "goal" }])] },
      goalScene(),
    ]);
    // Three states are expanded (a, b, c); the target is taken off the heap without expanding it.
    expect(cheapestPath(playable(s), { maxStates: 3 })).toMatchObject({ status: "found", cost: 3 });
    expect(cheapestPath(playable(s), { maxStates: 2 }).status).toBe("limit");
    expect(MAX_STATES).toBe(100_000);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 3 });
  });

  it("равная цена: путь всегда один и тот же — через первую по порядку зону", () => {
    const scenes = (first: string, second: string): Scene[] => [
      { id: "a", title: "A", elements: [], zones: [z(first, [{ goto: first === "p1" ? "b" : "c" }]), z(second, [{ goto: second === "p1" ? "b" : "c" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "c", title: "C", elements: [], zones: [z("c-go", [{ goto: "goal" }])] },
      goalScene(),
    ];
    const once = cheapestPath(playable(graph(scenes("p1", "p2"))));
    const again = cheapestPath(playable(graph(scenes("p1", "p2"))));
    expect(once).toMatchObject({ status: "found", cost: 2, steps: [{ scene: "a", action: "p1" }, { scene: "b", action: "b-go" }] });
    expect(again).toEqual(once);
    expect(cheapestPath(playable(graph(scenes("p2", "p1"))))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "p2" }, { scene: "c", action: "c-go" }],
    });
  });
});
