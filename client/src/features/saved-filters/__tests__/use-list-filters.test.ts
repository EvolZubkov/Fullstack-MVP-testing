/**
 * @module features/saved-filters/__tests__/use-list-filters
 * @description Правила сохранённых фильтров списков: условия набора приводятся к фильтру экрана
 * (незнакомое отбрасывается, недостающее — из пустого фильтра), фильтры сравниваются без учёта
 * порядка значений, применённый набор и его изменение определяются как в аналитике.
 */
import { describe, expect, it } from "vitest";

import { listSetState, mergeShape, stableKey } from "../use-list-filters";
import { contentFilterOf, EMPTY_FILTER } from "@/features/content/content-filters";
import { EMPTY_TEST_FILTER, testFilterOf } from "@/features/tests/list/tests-filters";

describe("mergeShape", () => {
  const EMPTY = { statuses: [] as string[], author: "", scope: "all", flag: false, level: 0 };

  it("берёт известные поля того же рода, остальное — из пустого фильтра", () => {
    expect(mergeShape(EMPTY, { statuses: ["a", 3], author: 5, scope: "mine", extra: 1, level: 40 }))
      .toEqual({ statuses: ["a"], author: "", scope: "mine", flag: false, level: 40 });
  });

  it("не объект — пустой фильтр", () => {
    expect(mergeShape(EMPTY, null)).toEqual(EMPTY);
    expect(mergeShape(EMPTY, ["x"])).toEqual(EMPTY);
  });
});

describe("stableKey", () => {
  it("порядок значений и полей не важен", () => {
    expect(stableKey({ b: ["y", "x"], a: "1" })).toBe(stableKey({ a: "1", b: ["x", "y"] }));
    expect(stableKey({ a: ["x"] })).not.toBe(stableKey({ a: ["y"] }));
  });
});

describe("listSetState", () => {
  const sets = [
    { id: "s1", name: "Один", conditions: "k1" },
    { id: "s2", name: "Два", conditions: "k2" },
  ];
  const keyOfSaved = (s: { conditions: unknown }) => String(s.conditions);

  it("выбранный набор: изменён, когда условия разошлись", () => {
    expect(listSetState(sets, "s1", "k1", keyOfSaved)).toEqual({ activeSetId: "s1", dirty: false });
    expect(listSetState(sets, "s1", "k9", keyOfSaved)).toEqual({ activeSetId: "s1", dirty: true });
  });

  it("не выбирали — набор, совпавший с текущими условиями; иначе никакого", () => {
    expect(listSetState(sets, null, "k2", keyOfSaved)).toEqual({ activeSetId: "s2", dirty: false });
    expect(listSetState(sets, null, "k9", keyOfSaved)).toEqual({ activeSetId: null, dirty: false });
  });
});

describe("условия экранов", () => {
  it("банк: незнакомые значения отбрасываются, сложность — в 0–100", () => {
    const value = contentFilterOf({ types: ["single", "bogus"], diffMin: 30, diffMax: 70, states: ["review", "x"], scope: "nowhere" });
    expect(value).toEqual({ ...EMPTY_FILTER, types: ["single"], diffMin: 30, diffMax: 70, states: ["review"] });
  });

  it("«Тесты»: незнакомые статусы и область отбрасываются", () => {
    expect(testFilterOf({ statuses: ["published", "lost"], scope: "everywhere", author: "u1" }))
      .toEqual({ ...EMPTY_TEST_FILTER, statuses: ["published"], author: "u1" });
  });
});
