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
  hasBlanks,
  hasFixedOptionOrder,
  hasGradedContent,
  hasOptionList,
  isMeasurementOnly,
  isOpenText,
  isSimulation,
  isSingleIndexChoice,
  isTextEntry,
} from "../question-type";

interface Traits {
  hasOptionList: boolean;
  isSingleIndexChoice: boolean;
  hasFixedOptionOrder: boolean;
  distributesBudget: boolean;
  isTextEntry: boolean;
  hasBlanks: boolean;
  isOpenText: boolean;
  isSimulation: boolean;
}

/**
 * One row per supported type — every trait decided explicitly, none inherited.
 *
 * `Traits` requires EVERY field, choice types included, and that is the whole point:
 * a type added to `QUESTION_TYPES` cannot be listed here without an answer for each
 * predicate, and a predicate added to the module cannot be listed in `Traits` without
 * an answer for each type. A row of «what is true», with the rest inferred false,
 * would let both slip through silently.
 */
const TRAITS: Record<string, Traits> = {
  single: {
    hasOptionList: true, isSingleIndexChoice: true, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: false, hasBlanks: false, isOpenText: false, isSimulation: false,
  },
  multiple: {
    hasOptionList: true, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: false, hasBlanks: false, isOpenText: false, isSimulation: false,
  },
  matching: {
    hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: false, hasBlanks: false, isOpenText: false, isSimulation: false,
  },
  ranking: {
    hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: false, hasBlanks: false, isOpenText: false, isSimulation: false,
  },
  scale: {
    hasOptionList: true, isSingleIndexChoice: true, hasFixedOptionOrder: true, distributesBudget: false,
    isTextEntry: false, hasBlanks: false, isOpenText: false, isSimulation: false,
  },
  allocation: {
    hasOptionList: true, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: true,
    isTextEntry: false, hasBlanks: false, isOpenText: false, isSimulation: false,
  },
  // PRD-57. The three text types share every choice trait (all false) and differ only
  // in WHICH text trait they carry — see the module doc for why they are three traits
  // and not one: one answer key per task, one per blank, none at all.
  short: {
    hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: true, hasBlanks: false, isOpenText: false, isSimulation: false,
  },
  blanks: {
    hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: false, hasBlanks: true, isOpenText: false, isSimulation: false,
  },
  long: {
    hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: false, hasBlanks: false, isOpenText: true, isSimulation: false,
  },
  // «Сценарий в ИС»: ни вариантов, ни текста — прогон в плеере; свой признак, ничего больше.
  simulation: {
    hasOptionList: false, isSingleIndexChoice: false, hasFixedOptionOrder: false, distributesBudget: false,
    isTextEntry: false, hasBlanks: false, isOpenText: false, isSimulation: true,
  },
};

describe("признаки типа вопроса", () => {
  it("матрица покрывает ровно поддерживаемые типы", () => {
    expect([...QUESTION_TYPES].sort()).toEqual(Object.keys(TRAITS).sort());
  });

  for (const [type, traits] of Object.entries(TRAITS)) {
    it(`${type}: все восемь признаков`, () => {
      expect(hasOptionList(type)).toBe(traits.hasOptionList);
      expect(isSingleIndexChoice(type)).toBe(traits.isSingleIndexChoice);
      expect(hasFixedOptionOrder(type)).toBe(traits.hasFixedOptionOrder);
      expect(distributesBudget(type)).toBe(traits.distributesBudget);
      expect(isTextEntry(type)).toBe(traits.isTextEntry);
      expect(hasBlanks(type)).toBe(traits.hasBlanks);
      expect(isOpenText(type)).toBe(traits.isOpenText);
      expect(isSimulation(type)).toBe(traits.isSimulation);
    });
  }

  it("неизвестный тип не получает ни одного признака", () => {
    expect(hasOptionList("nope")).toBe(false);
    expect(isSingleIndexChoice("nope")).toBe(false);
    expect(hasFixedOptionOrder("nope")).toBe(false);
    expect(distributesBudget("nope")).toBe(false);
    expect(isTextEntry("nope")).toBe(false);
    expect(hasBlanks("nope")).toBe(false);
    expect(isOpenText("nope")).toBe(false);
    expect(isSimulation("nope")).toBe(false);
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

describe("оценивает ли тест хоть что-нибудь", () => {
  it("методика целиком из распределений и шкал без эталона — не оценивает", () => {
    expect(
      hasGradedContent([
        { type: "allocation", correctJson: {} },
        { type: "scale", correctJson: {} },
      ]),
    ).toBe(false);
  });

  it("один проверяемый вопрос среди измерительных — оценивает", () => {
    expect(
      hasGradedContent([
        { type: "allocation", correctJson: {} },
        { type: "single", correctJson: { correctIndex: 0 } },
      ]),
    ).toBe(true);
  });

  it("шкала с верной градацией — уже оценивает", () => {
    expect(hasGradedContent([{ type: "scale", correctJson: { correctIndex: 2 } }])).toBe(true);
  });

  it("пустой набор не оценивает — порогу нечего мерить", () => {
    expect(hasGradedContent([])).toBe(false);
  });
});
