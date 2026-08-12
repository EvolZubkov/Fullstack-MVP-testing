/**
 * @module shared/__tests__/schema-allocation
 *
 * Zod contract of the allocation question (PRD-44 FR-02 - FR-05). The type needs NO
 * database migration — `questions.type`, `scorm_answers.question_type` and
 * `question_measurements.source_type` are all plain `text NOT NULL` with no `CHECK`
 * (verified against `drizzle/0000_baseline.sql`), so the enumeration lives only in
 * TypeScript and Zod, and these tests are what actually guards it.
 */
import { describe, expect, it } from "vitest";
import { allocationDataSchema, detailedAnswerSchema, questionStatsSchema } from "../schema";

describe("dataJson распределения", () => {
  it("принимает полную конфигурацию", () => {
    const parsed = allocationDataSchema.parse({
      options: ["a", "b", "c", "d"],
      budget: 7,
      minPerOption: 0,
      maxPerOption: 7,
    });
    expect(parsed).toEqual({ options: ["a", "b", "c", "d"], budget: 7, minPerOption: 0, maxPerOption: 7 });
  });

  it("подставляет умолчания домена: минимум 0, максимум равен бюджету (FR-04)", () => {
    const parsed = allocationDataSchema.parse({ options: ["a", "b"], budget: 5 });
    expect(parsed.minPerOption).toBe(0);
    expect(parsed.maxPerOption).toBe(5);
  });

  it("бюджет ограничен диапазоном 1..1000", () => {
    expect(() => allocationDataSchema.parse({ options: ["a", "b"], budget: 0 })).toThrow();
    expect(() => allocationDataSchema.parse({ options: ["a", "b"], budget: 1001 })).toThrow();
    expect(() => allocationDataSchema.parse({ options: ["a", "b"], budget: 3.5 })).toThrow();
  });

  it("утверждений от двух до десяти", () => {
    expect(() => allocationDataSchema.parse({ options: ["a"], budget: 3 })).toThrow();
    expect(() =>
      allocationDataSchema.parse({ options: Array.from({ length: 11 }, (_, i: number) => `s${i}`), budget: 20 }),
    ).toThrow();
  });

  it("подписи утверждений непустые", () => {
    expect(() => allocationDataSchema.parse({ options: ["a", "   "], budget: 3 })).toThrow();
  });

  it("домен упорядочен: 0 <= min <= max <= budget", () => {
    expect(() => allocationDataSchema.parse({ options: ["a", "b"], budget: 7, minPerOption: 5, maxPerOption: 3 })).toThrow();
    expect(() => allocationDataSchema.parse({ options: ["a", "b"], budget: 7, maxPerOption: 9 })).toThrow();
    expect(() => allocationDataSchema.parse({ options: ["a", "b"], budget: 7, minPerOption: -1 })).toThrow();
  });

  it("невыполнимая конфигурация отвергается с числами в сообщении (FR-05)", () => {
    // Референсный случай: 4 варианта по минимуму 2 при бюджете 7 требуют 8 из 7.
    const result = allocationDataSchema.safeParse({
      options: ["a", "b", "c", "d"],
      budget: 7,
      minPerOption: 2,
      maxPerOption: 7,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join(" ");
      expect(message).toContain("8");
      expect(message).toContain("7");
    }
  });

  it("бюджет, недостижимый максимумами вариантов, отвергается", () => {
    const result = allocationDataSchema.safeParse({
      options: ["a", "b", "c", "d"],
      budget: 7,
      minPerOption: 0,
      maxPerOption: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("тип allocation в перечислениях", () => {
  it("допустим в детальном ответе попытки", () => {
    const parsed = detailedAnswerSchema.parse({
      questionId: "q1",
      questionPrompt: "Распределите баллы",
      questionType: "allocation",
      topicId: "t1",
      topicName: "Тема",
      userAnswer: { 0: 3, 1: 4 },
      correctAnswer: {},
      isCorrect: false,
      earnedPoints: 0,
      possiblePoints: 0,
    });
    expect(parsed.questionType).toBe("allocation");
  });

  it("допустим в статистике по вопросу", () => {
    expect(questionStatsSchema.shape.questionType.parse("allocation")).toBe("allocation");
  });
});
