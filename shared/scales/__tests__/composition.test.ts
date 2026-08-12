/**
 * @module shared/scales/__tests__/composition
 *
 * PRD-46 §5. The predicate that decides whether a test's scales form a DISTRIBUTION of one
 * whole — the precondition for drawing the profile as a rose instead of a radar.
 *
 * The reference case is the ЧИЛ questionnaire (PRD-44): its four styles share one budget per
 * block, so their sum is 98 whatever the respondent answers. The counter-cases matter just as
 * much — a rose drawn over scales that do NOT sum to a whole is a diagram that lies.
 */
import { describe, expect, it } from "vitest";
import { isIpsativeModel } from "../composition";
import {
  CHIL_BUDGETS,
  CHIL_MEASUREMENTS,
  CHIL_SCALE_KEYS,
  CHIL_TYPES,
} from "./fixtures/chil-reference";
import type { MeasurementSpec } from "../engine";
import type { QuestionType } from "../../questions/question-type";
import type { AllocationSpec } from "../../questions/allocation";

const SPEC: AllocationSpec = { options: ["a", "b", "c", "d"], budget: 7, minPerOption: 0, maxPerOption: 7 };

/** One allocation question whose four statements feed four scales one-to-one. */
function balancedRows(questionId: string, scaleKeys: string[]): MeasurementSpec[] {
  return scaleKeys.map((scaleKey, index) => ({
    questionId,
    scaleKey,
    sourceType: "option_allocation" as const,
    sourceKey: String(index),
    value: 1,
    weight: 1,
  }));
}

describe("isIpsativeModel", () => {
  it("признаёт опросник ЧИЛ: четыре стиля делят один бюджет", () => {
    expect(
      isIpsativeModel({
        measurements: CHIL_MEASUREMENTS,
        scaleKeys: [...CHIL_SCALE_KEYS],
        questionTypes: CHIL_TYPES,
        budgets: CHIL_BUDGETS,
      }),
    ).toBe(true);
  });

  it("отвергает обычные шкалы: вклад приходит от вариантов, а не от распределения", () => {
    const measurements: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "a", sourceType: "option", sourceKey: "0", value: 3, weight: 1 },
      { questionId: "q1", scaleKey: "b", sourceType: "option", sourceKey: "1", value: 3, weight: 1 },
    ];
    expect(
      isIpsativeModel({
        measurements,
        scaleKeys: ["a", "b"],
        questionTypes: { q1: "single" as QuestionType },
        budgets: {},
      }),
    ).toBe(false);
  });

  it("отвергает смешанную модель: одна шкала дополнительно кормится обычным вопросом", () => {
    const measurements: MeasurementSpec[] = [
      ...balancedRows("q1", ["a", "b", "c", "d"]),
      { questionId: "q2", scaleKey: "a", sourceType: "question", sourceKey: null, value: 5, weight: 1 },
    ];
    expect(
      isIpsativeModel({
        measurements,
        scaleKeys: ["a", "b", "c", "d"],
        questionTypes: { q1: "allocation" as QuestionType, q2: "single" as QuestionType },
        budgets: { q1: SPEC },
      }),
    ).toBe(false);
  });

  it("отвергает перекос веса: один вариант вносит вдвое больше остальных", () => {
    const measurements = balancedRows("q1", ["a", "b", "c", "d"]);
    measurements[0] = { ...measurements[0], weight: 2 };
    expect(
      isIpsativeModel({
        measurements,
        scaleKeys: ["a", "b", "c", "d"],
        questionTypes: { q1: "allocation" as QuestionType },
        budgets: { q1: SPEC },
      }),
    ).toBe(false);
  });

  it("отвергает вопрос, у которого один вариант не кормит ни одной шкалы", () => {
    const measurements = balancedRows("q1", ["a", "b", "c"]);
    expect(
      isIpsativeModel({
        measurements,
        scaleKeys: ["a", "b", "c"],
        questionTypes: { q1: "allocation" as QuestionType },
        budgets: { q1: SPEC },
      }),
    ).toBe(false);
  });

  it("отвергает единственную шкалу: раскладывать нечего", () => {
    expect(
      isIpsativeModel({
        measurements: balancedRows("q1", ["a"]),
        scaleKeys: ["a"],
        questionTypes: { q1: "allocation" as QuestionType },
        budgets: { q1: { ...SPEC, options: ["a"] } },
      }),
    ).toBe(false);
  });

  it("отвергает пустую модель: вкладов нет вовсе", () => {
    expect(
      isIpsativeModel({ measurements: [], scaleKeys: ["a", "b", "c"], questionTypes: {}, budgets: {} }),
    ).toBe(false);
  });
});
