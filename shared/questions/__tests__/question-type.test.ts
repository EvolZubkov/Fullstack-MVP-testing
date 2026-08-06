/**
 * @module shared/questions/__tests__/question-type
 *
 * Trait matrix for the question-type classifier — the guard PRD-44 (R-1) demands.
 *
 * Answer handling branches on the question type in roughly forty places, and those
 * branches are NOT exhaustive `switch`es: they are chains of `if (type === '...')`
 * closed by a `default`. A new type therefore compiles cleanly while silently taking
 * the wrong branch. Asserting EVERY trait on EVERY type turns that silence into a
 * failing test: a type added to `QUESTION_TYPES` without a decision on each trait
 * fails here before it can reach a consumer.
 */
import { describe, expect, it } from "vitest";
import {
  QUESTION_TYPES,
  distributesBudget,
  hasFixedOptionOrder,
  hasOptionList,
  isMeasurementOnly,
  isSingleIndexChoice,
} from "../question-type";

interface Traits {
  hasOptionList: boolean;
  isSingleIndexChoice: boolean;
  hasFixedOptionOrder: boolean;
  distributesBudget: boolean;
}

/** One row per supported type — every trait decided explicitly, none inherited. */
const TRAITS: Record<string, Traits> = {
  single: { hasOptionList: true, isSingleIndexChoice: true, hasFixedOptionOrder: false, distributesBudget: false },
  multiple: { hasOptionList: true, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false },
  matching: { hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false },
  ranking: { hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false },
  scale: { hasOptionList: true, isSingleIndexChoice: true, hasFixedOptionOrder: true, distributesBudget: false },
  allocation: { hasOptionList: true, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: true },
};

describe("признаки типа вопроса", () => {
  it("матрица покрывает ровно поддерживаемые типы", () => {
    expect([...QUESTION_TYPES].sort()).toEqual(Object.keys(TRAITS).sort());
  });

  for (const [type, traits] of Object.entries(TRAITS)) {
    it(`${type}: все четыре признака`, () => {
      expect(hasOptionList(type)).toBe(traits.hasOptionList);
      expect(isSingleIndexChoice(type)).toBe(traits.isSingleIndexChoice);
      expect(hasFixedOptionOrder(type)).toBe(traits.hasFixedOptionOrder);
      expect(distributesBudget(type)).toBe(traits.distributesBudget);
    });
  }

  it("неизвестный тип не получает ни одного признака", () => {
    expect(hasOptionList("nope")).toBe(false);
    expect(isSingleIndexChoice("nope")).toBe(false);
    expect(hasFixedOptionOrder("nope")).toBe(false);
    expect(distributesBudget("nope")).toBe(false);
  });
});

describe("измерительный вопрос", () => {
  it("шкала без верной градации измерительная", () => {
    expect(isMeasurementOnly({ type: "scale", correctJson: {} })).toBe(true);
  });

  it("шкала с верной градацией проверяемая", () => {
    expect(isMeasurementOnly({ type: "scale", correctJson: { correctIndex: 1 } })).toBe(false);
  });

  it("распределение измерительное ВСЕГДА — эталона у метода нет (PRD-44 FR-09)", () => {
    // Not «has no correct key yet» but «cannot have one»: a stray correctIndex left by
    // a type switch in the editor must not make the question checkable.
    expect(isMeasurementOnly({ type: "allocation", correctJson: {} })).toBe(true);
    expect(isMeasurementOnly({ type: "allocation", correctJson: { correctIndex: 1 } })).toBe(true);
  });

  it("остальные типы проверяемые", () => {
    expect(isMeasurementOnly({ type: "single", correctJson: {} })).toBe(false);
    expect(isMeasurementOnly({ type: "multiple", correctJson: {} })).toBe(false);
    expect(isMeasurementOnly({ type: "matching", correctJson: {} })).toBe(false);
    expect(isMeasurementOnly({ type: "ranking", correctJson: {} })).toBe(false);
  });
});
