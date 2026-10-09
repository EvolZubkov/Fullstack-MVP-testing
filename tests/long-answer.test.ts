/**
 * @module tests/long-answer
 * @description Развёрнутый ответ (PRD-57 §5) и закладка под ручную проверку (§5.6).
 *
 * Главное различие, на котором стоит вся аналитика: измерительный ответ не оценивается
 * НИКОГДА, а развёрнутый — ЖДЁТ оценки. Булево «оценено или нет» этого не различает.
 */
import { describe, it, expect } from "vitest";

import { aggregateStandardResult } from "../shared/scoring/aggregate";
import { QUESTION_TYPES, isMeasurementOnly, isOpenText, isTextEntry } from "../shared/questions/question-type";
import { renderLongAnswer } from "../shared/template/question-interaction";

describe("тип «Развёрнутый ответ»", () => {
  it("объявлен в перечне типов", () => {
    expect(QUESTION_TYPES).toContain("long");
  });

  it("не путается с коротким ответом", () => {
    expect(isOpenText("long")).toBe(true);
    expect(isOpenText("short")).toBe(false);
    expect(isTextEntry("long")).toBe(false);
  });

  it("никогда не оценивается автоматически", () => {
    expect(isMeasurementOnly({ type: "long", correctJson: {} })).toBe(true);
  });
});

describe("поле участника", () => {
  it("многострочное, а не однострочное (FR-11)", () => {
    const html = renderLongAnswer({ type: "long", dataJson: {} }, null);
    expect(html).toContain("<textarea");
    expect(html).not.toContain('type="text"');
  });

  it("подставляет подсказку-заполнитель и предел длины (FR-12)", () => {
    const html = renderLongAnswer({ type: "long", dataJson: { placeholder: "Ответьте своими словами", maxLength: 4000 } }, null);
    expect(html).toContain('placeholder="Ответьте своими словами"');
    expect(html).toContain('maxlength="4000"');
  });

  it("печатает ответ участника и экранирует его", () => {
    const html = renderLongAnswer({ type: "long", dataJson: {} }, "<b>жирный</b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>жирный");
  });

  it("в разборе поле заперто, а блока «правильный ответ» нет (FR-17)", () => {
    const html = renderLongAnswer({ type: "long", dataJson: {} }, "ответ", { readonly: true });
    expect(html).toContain("disabled");
    expect(html).not.toContain("правильный");
  });
});

describe("исход и результат попытки (FR-35 — FR-37)", () => {
  const result = () =>
    aggregateStandardResult({
      sections: [
        {
          topicId: "t1",
          topicName: "Тема",
          topicPassRule: null,
          questions: [
            { id: "q-open", type: "long", correct: {}, points: 5, answer: "Мой развёрнутый ответ" },
            { id: "q-choice", type: "single", correct: { correctIndex: 0 }, points: 1, answer: 0 },
          ],
        },
      ],
      overallPassRule: null,
    });

  it("развёрнутый ответ ЖДЁТ проверки, а не «не требует оценки»", () => {
    const outcome = (result().questionOutcomes ?? []).find((o) => o.questionId === "q-open");
    expect(outcome?.result).toBe("pending");
  });

  it("не приносит баллов и не входит в знаменатель (FR-15, FR-37)", () => {
    const out = result();
    expect(out.possiblePoints).toBe(1);
    expect(out.earnedPoints).toBe(1);
    expect(out.percent).toBe(100);
  });

  it("попытка с таким ответом — ПРЕДВАРИТЕЛЬНАЯ (FR-36)", () => {
    expect(result().gradingComplete).toBe(false);
  });

  it("без открытых ответов попытка окончательная", () => {
    const out = aggregateStandardResult({
      sections: [
        {
          topicId: "t1",
          topicName: "Тема",
          topicPassRule: null,
          questions: [{ id: "q1", type: "single", correct: { correctIndex: 0 }, points: 1, answer: 0 }],
        },
      ],
      overallPassRule: null,
    });
    expect(out.gradingComplete).toBe(true);
  });

  it("измерительный ответ остаётся нейтральным, а не ждущим", () => {
    const out = aggregateStandardResult({
      sections: [
        {
          topicId: "t1",
          topicName: "Тема",
          topicPassRule: null,
          questions: [{ id: "q-scale", type: "scale", correct: {}, points: 1, answer: 2 }],
        },
      ],
      overallPassRule: null,
    });
    expect((out.questionOutcomes ?? [])[0]?.result).toBe("neutral");
    expect(out.gradingComplete).toBe(true);
  });
});

describe("второй контракт результата (грабля Э3, Э9)", () => {
  it("схема хранения принимает четвёртое состояние и признак завершённости", async () => {
    const { attemptResultSchema } = await import("../shared/schema");
    const parsed = attemptResultSchema.parse({
      totalCorrect: 1,
      totalQuestions: 2,
      overallPercent: 100,
      totalEarnedPoints: 1,
      totalPossiblePoints: 1,
      overallPassed: true,
      topicResults: [],
      questionOutcomes: [{ questionId: "q1", result: "pending", earned: 0, possible: 0 }],
      gradingComplete: false,
    });
    // Поле, не объявленное в СХЕМЕ хранения, срезается молча — как это уже случалось.
    expect(parsed.gradingComplete).toBe(false);
    expect(parsed.questionOutcomes?.[0].result).toBe("pending");
  });
});
