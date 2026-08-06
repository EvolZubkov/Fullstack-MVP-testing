/**
 * @module shared/questions/__tests__/allocation
 *
 * Rules of the budget-allocation question (PRD-44 §2, §6), all of them arithmetic and
 * therefore testable without a DOM. Every consumer — the learner renderer, the submit
 * gate, the editor validation, the workbook import — reads them from here, so a rule
 * proven once cannot be re-implemented differently somewhere else.
 */
import { describe, expect, it } from "vitest";
import {
  allocationRemaining,
  allocationSpec,
  allocationTotal,
  isAllocationComplete,
  isAllocationFeasible,
  normalizeAllocation,
  optionCeiling,
  seedAllocation,
  setAllocationValue,
} from "../allocation";

/** The reference shape: four statements, budget 7, no floor (опросник ЧИЛ). */
const SPEC = { options: ["a", "b", "c", "d"], budget: 7, minPerOption: 0, maxPerOption: 7 };

describe("чтение спецификации из dataJson", () => {
  it("читает бюджет и домен", () => {
    const spec = allocationSpec({ options: ["a", "b"], budget: 7, minPerOption: 1, maxPerOption: 4 });
    expect(spec).toEqual({ options: ["a", "b"], budget: 7, minPerOption: 1, maxPerOption: 4 });
  });

  it("подставляет умолчания домена: минимум 0, максимум равен бюджету (FR-04)", () => {
    const spec = allocationSpec({ options: ["a", "b"], budget: 5 });
    expect(spec.minPerOption).toBe(0);
    expect(spec.maxPerOption).toBe(5);
  });

  it("не падает на мусорном dataJson — колонка jsonb приходит как unknown", () => {
    expect(allocationSpec(null).budget).toBe(0);
    expect(allocationSpec(undefined).options).toEqual([]);
    expect(allocationSpec({ options: "не список", budget: "семь" }).budget).toBe(0);
  });

  it("срезает дробные и отрицательные значения", () => {
    const spec = allocationSpec({ options: ["a", "b"], budget: 7.9, minPerOption: -3, maxPerOption: 4.7 });
    expect(spec).toMatchObject({ budget: 7, minPerOption: 0, maxPerOption: 4 });
  });
});

describe("выполнимость распределения (FR-05)", () => {
  it("обычная конфигурация выполнима", () => {
    expect(isAllocationFeasible(SPEC)).toEqual({ ok: true });
  });

  it("минимум 2 на вариант при четырёх вариантах и бюджете 7 невыполним", () => {
    // Ровно тот случай, который обсуждался методологом на референсе: 8 > 7.
    expect(isAllocationFeasible({ ...SPEC, minPerOption: 2 })).toEqual({
      ok: false,
      kind: "min",
      required: 8,
      available: 7,
    });
  });

  it("бюджет недостижим, когда максимумов вариантов не хватает", () => {
    expect(isAllocationFeasible({ ...SPEC, maxPerOption: 1 })).toEqual({
      ok: false,
      kind: "max",
      required: 7,
      available: 4,
    });
  });

  it("граничный случай сходится: 4 варианта по минимуму 1 при бюджете 4", () => {
    expect(isAllocationFeasible({ ...SPEC, budget: 4, minPerOption: 1, maxPerOption: 1 })).toEqual({ ok: true });
  });
});

describe("предзаполнение (FR-30)", () => {
  it("при нулевом минимуме предзаполнения нет", () => {
    expect(seedAllocation(SPEC)).toEqual({});
  });

  it("при ненулевом минимуме каждый вариант стартует с минимума", () => {
    const withMin = { ...SPEC, minPerOption: 1 };
    expect(seedAllocation(withMin)).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
    // Иначе учащийся попадает в тупик: распределил весь бюджет, а один вариант нулевой.
    expect(allocationRemaining(withMin, seedAllocation(withMin))).toBe(3);
  });
});

describe("остаток и доступный максимум (FR-29)", () => {
  it("остаток равен бюджету за вычетом распределённого", () => {
    expect(allocationTotal({ 0: 3, 1: 1 })).toBe(4);
    expect(allocationRemaining(SPEC, { 0: 3, 1: 1, 2: 0, 3: 0 })).toBe(3);
    expect(allocationRemaining(SPEC, {})).toBe(7);
  });

  it("доступный максимум варианта равен его значению плюс остаток", () => {
    const answer = { 0: 3, 1: 1, 2: 0, 3: 0 };
    expect(optionCeiling(SPEC, answer, 0)).toBe(6);
    expect(optionCeiling(SPEC, answer, 2)).toBe(3);
  });

  it("доступный максимум не превышает максимум домена", () => {
    const spec = { ...SPEC, maxPerOption: 2 };
    expect(optionCeiling(spec, { 0: 0, 1: 0, 2: 0, 3: 0 }, 0)).toBe(2);
  });
});

describe("ввод значения (FR-29, FR-30)", () => {
  it("превышение бюджета невозможно: ввод срезается по остатку", () => {
    expect(setAllocationValue(SPEC, { 0: 3, 1: 1, 2: 0, 3: 0 }, 2, 99)).toEqual({ 0: 3, 1: 1, 2: 3, 3: 0 });
  });

  it("после первого взаимодействия ответ содержит запись для КАЖДОГО утверждения", () => {
    // Аналитике важно отличать «поставил ноль» от «не дошёл до варианта» (FR-06).
    expect(setAllocationValue(SPEC, {}, 1, 2)).toEqual({ 0: 0, 1: 2, 2: 0, 3: 0 });
  });

  it("ввод не опускается ниже минимума", () => {
    const withMin = { ...SPEC, minPerOption: 1 };
    expect(setAllocationValue(withMin, seedAllocation(withMin), 0, 0)).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
  });

  it("нечисловой и дробный ввод приводится к целому", () => {
    expect(setAllocationValue(SPEC, {}, 0, Number.NaN)).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
    expect(setAllocationValue(SPEC, {}, 0, 2.7)).toEqual({ 0: 2, 1: 0, 2: 0, 3: 0 });
  });

  it("индекс вне списка утверждений ответ не меняет", () => {
    expect(setAllocationValue(SPEC, { 0: 1, 1: 0, 2: 0, 3: 0 }, 9, 3)).toEqual({ 0: 1, 1: 0, 2: 0, 3: 0 });
  });
});

describe("готовность ответа (FR-31)", () => {
  it("сумма ровно равна бюджету — отвечен", () => {
    expect(isAllocationComplete(SPEC, { 0: 3, 1: 1, 2: 3, 3: 0 })).toBe(true);
  });

  it("недобор — не отвечен", () => {
    expect(isAllocationComplete(SPEC, { 0: 3, 1: 1, 2: 0, 3: 0 })).toBe(false);
  });

  it("нетронутый вопрос — не отвечен", () => {
    expect(isAllocationComplete(SPEC, {})).toBe(false);
    expect(isAllocationComplete(SPEC, undefined)).toBe(false);
  });

  it("нулевой бюджет не считается отвеченным", () => {
    // Иначе испорченная конфигурация молча пропускала бы вопрос как готовый.
    expect(isAllocationComplete({ ...SPEC, budget: 0 }, {})).toBe(false);
  });
});

describe("нормализация ответа", () => {
  it("дополняет пропущенные утверждения минимумом и отбрасывает лишние ключи", () => {
    const withMin = { ...SPEC, minPerOption: 1 };
    expect(normalizeAllocation(withMin, { 0: 4, 9: 3 })).toEqual({ 0: 4, 1: 1, 2: 1, 3: 1 });
  });

  it("не-объектный ответ даёт чистое предзаполнение", () => {
    expect(normalizeAllocation(SPEC, 5)).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
  });
});
