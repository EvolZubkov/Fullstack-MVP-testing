/**
 * @module tests/sim-validate-v2
 * @description Checks version 2 adds (v2-design.md sections 1 and 2.6): kinds, ends, stages, routes,
 * costs, device actions; a version 1 scenario is checked as its upgrade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateScenario } from "@shared/sim/validate";
import { asScenario } from "@shared/sim/upgrade";
import type { Scenario } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));
const stored = (s: Scenario) => {
  const c = structuredClone(s);
  c.media.forEach((m, i) => { m.file = `/api/media/00000000-0000-0000-0000-00000000000${i % 10}`; });
  return validateScenario(c, { mode: "stored" });
};
const v2 = (): Scenario => structuredClone(asScenario(v1));

function research(): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "research",
    meta: { title: "R", task: "T" }, media: [],
    stages: [{ id: "find", title: "Поиск" }],
    variants: [{ device: "desktop", stage: { w: 10, h: 10 }, start: "a", scenes: [
      { id: "a", title: "A", elements: [], stage: "find", zones: [{ id: "go", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "b" }] }] },
      { id: "b", title: "B", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
    ] }],
  };
}

describe("перевод и версии", () => {
  it("эталон v1 и его перевод в v2 проходят одинаково", () => {
    expect(stored(v2()).errors).toEqual([]);
    expect(stored(v1 as never).errors).toEqual([]);
  });
  it("версия новее 2 — «новее»", () => {
    expect(stored({ ...v2(), version: 3 } as never).errors[0]).toMatch(/новее/);
  });
});

describe("вид сценария", () => {
  it("исследовательский сценарий без ролей и цели проходит", () => {
    expect(validateScenario(research(), { mode: "stored" })).toEqual({ errors: [], warnings: [] });
  });
  it("у исследовательского сценария нет проверок цели и концов success", () => {
    const s = research();
    s.goal = { checks: [] };
    s.variants[0].scenes[1].end = { outcome: "success" };
    const { errors } = validateScenario(s, { mode: "stored" });
    expect(errors).toContain("У исследовательского сценария не бывает проверок цели");
    expect(errors).toContain("Сцена «B»: конец success бывает только у контрольного сценария");
  });
  it("у контрольного сценария роль обязательна, финалов нет", () => {
    const s = v2();
    delete s.variants[0].scenes[0].zones![0].role;
    s.variants[0].scenes[0].end = undefined;
    const tail = s.variants[0].scenes.at(-1)!;
    tail.end = { outcome: "finale", title: "Х" };
    const { errors } = stored(s);
    expect(errors.some((e) => /неизвестная роль undefined/.test(e))).toBe(true);
    expect(errors).toContain(`Сцена «${tail.title}»: финал бывает только у исследовательского сценария`);
  });
  it("неизвестный вид", () => {
    expect(validateScenario({ ...research(), kind: "quiz" }, { mode: "stored" }).errors).toContain("Вид сценария должен быть control или research");
  });
});

describe("этапы, стоимость, устройство", () => {
  it("сцена ссылается на необъявленный этап", () => {
    const s = research();
    s.variants[0].scenes[0].stage = "ghost";
    expect(validateScenario(s, { mode: "stored" }).errors).toContain("Сцена «A»: этап ghost не объявлен");
  });
  it("отрицательная стоимость и чужое устройству действие", () => {
    const s = research();
    Object.assign(s.variants[0].scenes[0].zones![0], { cost: -1, action: "tap" });
    const { errors } = validateScenario(s, { mode: "stored" });
    expect(errors).toContain("Сцена «A»: зона go — стоимость должна быть числом не меньше нуля");
    expect(errors).toContain("Сцена «A»: зона go: действие tap не бывает на устройстве «десктоп»");
  });
  it("два варианта одного устройства", () => {
    const s = research();
    s.variants.push(structuredClone(s.variants[0]));
    expect(validateScenario(s, { mode: "stored" }).errors).toContain("Вариант для устройства «десктоп» объявлен дважды");
  });
});

describe("маршруты в проверке", () => {
  it("ошибки маршрутов попадают в ошибки сценария", () => {
    const s = v2();
    s.variants[0].routes = [{ id: "r", title: "Р", rating: 2, keys: [{ scene: s.variants[0].start, action: "ghost" }] }];
    const { errors } = stored(s);
    expect(errors.some((e) => e.startsWith("Маршрут «Р»: оценка"))).toBe(true);
  });
});

/** A zone of the review scenarios: a 5 × 5 square at `x`. */
const zz = (id: string, x: number, effects: unknown[], more: Record<string, unknown> = {}) =>
  ({ id, role: "path", x, y: 0, w: 5, h: 5, effects, ...more }) as never;
const check = (s: unknown) => validateScenario(s, { mode: "stored" });

/** A clean control scenario: «+» to the card, or the menu and «Новый»; the card saves to the goal. */
function control(extra: Partial<Scenario> = {}): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "C", task: "T" }, media: [], goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 10 }, start: "a", scenes: [
      { id: "a", title: "A", elements: [], zones: [zz("plus", 0, [{ goto: "card" }]), zz("menu", 10, [{ goto: "m" }], { role: "alt" })] },
      { id: "m", title: "Меню", elements: [], zones: [zz("new", 0, [{ goto: "card" }])] },
      { id: "card", title: "Карточка", elements: [], zones: [zz("save", 0, [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ] }],
    ...extra,
  };
}

/** A detour that is cheaper than the main path: «side» goes to the goal at once, the path takes two steps. */
function detourShortcut(): Scenario {
  const s = control();
  s.variants[0].scenes = [
    { id: "a", title: "A", elements: [], zones: [zz("long", 0, [{ goto: "b" }]), zz("side", 10, [{ goto: "goal" }], { role: "detour" })] },
    { id: "b", title: "B", elements: [], zones: [zz("b-go", 0, [{ goto: "goal" }])] },
    { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
  ];
  return s;
}

/** The scenario with a phone variant copied from the desktop one; zone actions set to `action`. */
function withPhone(s: Scenario, action?: string): Scenario {
  const phone = structuredClone(s.variants[0]);
  phone.device = "phone";
  for (const scene of phone.scenes) {
    for (const zone of scene.zones ?? []) if (action) (zone as { action?: string }).action = action;
  }
  s.variants.push(phone);
  return s;
}

describe("проверки v2: случаи ревью W3-validate", () => {
  it("эталон v1 и его перевод в v2 — без ошибок и без предупреждений", () => {
    expect(stored(v1 as never)).toEqual({ errors: [], warnings: [] });
    expect(stored(v2())).toEqual({ errors: [], warnings: [] });
  });

  it("две сцены-цели v1 с разными проверками — отказ перевода с объяснением", () => {
    const twin = structuredClone(v1);
    const goal = twin.scenes.find((s: { goal?: { outcome: string } }) => s.goal?.outcome === "success");
    twin.scenes.push({ ...structuredClone(goal), id: "goal-2", title: "Вторая цель", goal: { outcome: "success", checks: [] } });
    expect(validateScenario(twin, { mode: "archive", files: new Map() }).errors).toEqual([
      `Сцены-цели «${goal.title}», «Вторая цель» проверяют разные поля: в версии 2 у сценария одна цель — оставьте у них одинаковые проверки`,
    ]);
  });

  it("контрольный образец без маршрутов — без ошибок и предупреждений", () => {
    expect(check(control())).toEqual({ errors: [], warnings: [] });
  });

  it("маршруты: одинаковые ключи, сцены и действия нет, цель недостижима через ключи", () => {
    const s = control();
    s.variants[0].routes = [
      { id: "r1", title: "Р1", rating: 1, keys: [{ scene: "a", action: "plus" }] },
      { id: "r2", title: "Р2", rating: 1, keys: [{ scene: "a", action: "plus" }] },
      { id: "r3", title: "Р3", rating: 1, keys: [{ scene: "ghost", action: "x" }] },
      { id: "r4", title: "Р4", rating: 1, keys: [{ scene: "a", action: "ghost" }] },
      { id: "r5", title: "Р5", rating: 1, keys: [{ scene: "card", action: "save" }, { scene: "a", action: "menu" }] },
    ];
    expect(check(s)).toEqual({
      errors: [
        "Маршруты «Р1» и «Р2»: одинаковые ключевые действия",
        "Маршрут «Р3»: сцены ghost нет",
        "Маршрут «Р4»: на сцене «A» нет действия ghost",
        "Маршрут «Р5»: до цели нельзя дойти через его ключевые действия по порядку",
      ],
      warnings: [],
    });
  });

  it("маршруты без оценки 1 — предупреждение, не ошибка", () => {
    const s = control();
    s.variants[0].routes = [{ id: "r", title: "Через меню", rating: 0.5, keys: [{ scene: "a", action: "menu" }] }];
    expect(check(s)).toEqual({ errors: [], warnings: ["Ни у одного маршрута нет оценки 1: максимум балла меньше 100%"] });
  });

  it("шаг в сторону дешевле основного пути — предупреждение", () => {
    expect(check(detourShortcut())).toEqual({ errors: [], warnings: ["Шаг в сторону даёт путь дешевле основного: проверьте роли зон"] });
  });

  it("несколько вариантов — у сообщений префикс устройства", () => {
    expect(check(withPhone(detourShortcut(), "tap"))).toEqual({
      errors: [],
      warnings: [
        "Вариант «десктоп»: Шаг в сторону даёт путь дешевле основного: проверьте роли зон",
        "Вариант «телефон»: Шаг в сторону даёт путь дешевле основного: проверьте роли зон",
      ],
    });
  });

  it("предел поиска оптимума — предупреждение, сценарий принимается", () => {
    const n = 17;
    const ids = Array.from({ length: n }, (_, i) => `e${i + 1}`);
    const s = control({ media: [{ id: "m", file: "/api/media/00000000-0000-0000-0000-000000000001", w: 1, h: 1 }] });
    s.variants[0].scenes = [
      {
        id: "a", title: "A",
        elements: ids.map((id) => ({ id, media: "m", x: 0, y: 0, hidden: true })),
        zones: [
          ...ids.map((id, i) => zz(`t${i + 1}`, i * 5, [{ toggle: id }])),
          zz("go", 90, [{ goto: "goal" }], { when: { all: ids.map((id) => ({ visible: id })) }, otherwise: [] }),
        ],
      },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ];
    expect(check(s)).toEqual({
      errors: [],
      warnings: ["Сценарий слишком велик: оптимальный путь не посчитан, эффективность — только по маршрутам"],
    });
  }, 60_000);

  it("исследовательский без «Я закончил»: нужен финал, и до него должен вести путь", () => {
    const loop = research();
    loop.settings = { finishButton: false };
    loop.variants[0].scenes = [
      { id: "a", title: "A", elements: [], zones: [zz("go", 0, [{ goto: "b" }], { role: undefined })] },
      { id: "b", title: "B", elements: [], zones: [zz("back", 0, [{ goto: "a" }], { role: undefined })] },
    ];
    expect(check(loop).errors).toEqual(["Исследовательскому сценарию нужен финал или кнопка «Я закончил»"]);

    const trapOnly = research();
    trapOnly.settings = { finishButton: false };
    trapOnly.variants[0].scenes = [
      { id: "a", title: "A", elements: [], zones: [zz("oops", 0, [{ goto: "b" }], { role: "trap", error: "Не туда" })] },
      { id: "b", title: "Нашёл", elements: [], end: { outcome: "finale", title: "Нашёл" } },
    ];
    expect(check(trapOnly).errors).toEqual(["До финалов «Нашёл» нельзя дойти"]);

    trapOnly.settings = {};
    expect(check(trapOnly).errors).toEqual([]);
  });

  it("настройки, этапы, устройства и ширина окна", () => {
    expect(check(control({ settings: { costs: { jump: 1, click: -1 } as never } })).errors).toEqual([
      "Стоимость по умолчанию: неизвестный вид действия jump",
      "Стоимость по умолчанию для click должна быть числом не меньше нуля",
    ]);
    expect(check(control({ settings: { otherRouteRating: 0 } })).errors).toEqual(["Оценка прочих путей должна быть больше 0 и не больше 1"]);
    expect(check(control({ settings: { otherRouteRating: 1.5 } })).errors).toEqual(["Оценка прочих путей должна быть больше 0 и не больше 1"]);
    expect(check(control({ settings: { otherRouteRating: 1 } })).errors).toEqual([]);
    expect(check(control({ stages: [{ id: "s", title: "Поиск" }, { id: "s", title: "Ещё раз" }, { id: "t", title: " " }] })).errors).toEqual([
      "Этап s объявлен дважды",
      "Этап t: нет названия",
    ]);
    const watch = control();
    watch.variants[0].device = "watch" as never;
    expect(check(watch).errors).toEqual(["Неизвестное устройство варианта watch"]);
    const narrow = control();
    narrow.variants[0].minViewportWidth = 0;
    expect(check(narrow).errors).toEqual(["Минимальная ширина окна должна быть больше нуля"]);
  });

  it("телефон: жесты проходят, сочетания клавиш и мышь — нет, действие зоны задаётся явно", () => {
    expect(check(withPhone(research(), "tap"))).toEqual({ errors: [], warnings: [] });

    expect(check(withPhone(research())).errors).toEqual([
      "Вариант «телефон»: Сцена «A»: зона go: на устройстве «телефон» действие зоны задаётся явно — click по умолчанию здесь не бывает",
    ]);

    expect(check(withPhone(research(), "dblclick")).errors).toEqual([
      "Вариант «телефон»: Сцена «A»: зона go: действие dblclick не бывает на устройстве «телефон»",
    ]);

    const keys = withPhone(research(), "tap");
    keys.variants[1].scenes[0].keys = [{ id: "find", keys: "Ctrl+F", effects: [{ goto: "b" }] }];
    expect(check(keys).errors).toEqual([
      "Вариант «телефон»: Сцена «A»: сочетание find: сочетаний клавиш не бывает на устройстве «телефон»",
    ]);

    const desktopKeys = research();
    desktopKeys.variants[0].scenes[0].keys = [{ id: "find", keys: "Ctrl+F", effects: [{ goto: "b" }] }];
    expect(check(desktopKeys)).toEqual({ errors: [], warnings: [] });
  });
});
