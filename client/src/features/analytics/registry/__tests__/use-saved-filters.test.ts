/**
 * @module features/analytics/registry/__tests__/use-saved-filters
 * @description Сохранённые фильтры (решение владельца 2026-10-05): какой набор применён и изменён
 * ли он, критерии без теста на уровне теста, понятный текст ошибки сервера.
 */
import { describe, expect, it } from "vitest";

import { EMPTY_FILTER } from "../filter-state";
import { conditionsOf, errorText, savedSetState, testLevelFilters, withoutTests } from "../use-saved-filters";

const SAVED = [
  { id: "f1", name: "Импорт", conditions: { sources: ["import"] } },
  { id: "f2", name: "Не сдали", conditions: { outcomes: ["failed"], testIds: ["t1"] } },
];

describe("savedSetState", () => {
  it("набор, совпавший с текущими критериями, считается применённым и не изменённым", () => {
    expect(savedSetState(SAVED, null, { ...EMPTY_FILTER, sources: ["import"] })).toEqual({ activeSetId: "f1", dirty: false });
  });

  it("применённый набор после правки критериев — «изменён»", () => {
    expect(savedSetState(SAVED, "f1", { ...EMPTY_FILTER, sources: ["import", "web"] })).toEqual({ activeSetId: "f1", dirty: true });
  });

  it("ничего не выбрано и ничего не совпало — набора нет", () => {
    expect(savedSetState(SAVED, null, { ...EMPTY_FILTER, groupIds: ["g1"] })).toEqual({ activeSetId: null, dirty: false });
  });

  it("удалённый набор больше не применён", () => {
    expect(savedSetState(SAVED, "gone", { ...EMPTY_FILTER, groupIds: ["g1"] })).toEqual({ activeSetId: null, dirty: false });
  });
});

describe("критерии сохранённого фильтра", () => {
  it("критерии набора — фильтр реестра; на уровне теста — без теста", () => {
    const conditions = conditionsOf(SAVED[1]);
    expect(conditions).toMatchObject({ outcomes: ["failed"], testIds: ["t1"] });
    expect(withoutTests(conditions).testIds).toEqual([]);
  });

  it("ошибка сервера читается словами, а не кодом", () => {
    expect(errorText(new Error('409: {"error":"Запись с таким именем уже есть"}'))).toBe("Запись с таким именем уже есть");
    expect(errorText(new Error("500: Internal Server Error"))).toBe("500: Internal Server Error");
  });
});

describe("пустой отбор и уровень теста", () => {
  // На уровне теста условие по тесту отбрасывается: набор «только тест» становился пустым и
  // выдавал себя за применённый на странице без условий (найдено на снимке 2026-10-05).
  const ONLY_TEST = [{ id: "t", name: "Тест: Базовые технологии", conditions: { testIds: ["t1"] } }];

  it("пустые критерии не совпадают ни с одним набором", () => {
    const sets = ONLY_TEST.map(item => ({ ...item, conditions: withoutTests(conditionsOf(item)) }));
    expect(savedSetState(sets, null, withoutTests(EMPTY_FILTER))).toEqual({ activeSetId: null, dirty: false });
  });

  it("на уровне теста набор без условий кроме тестов не предлагается", () => {
    const withGroup = { id: "g", name: "Группа", conditions: { testIds: ["t1"], groupIds: ["g1"] } };
    expect(testLevelFilters([...ONLY_TEST, withGroup]).map(item => item.id)).toEqual(["g"]);
  });
});
