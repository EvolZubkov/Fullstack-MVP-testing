/**
 * @module server/services/analytics/__tests__/question-answers
 * @description PRD-57 FR-32: ответы одного задания списком.
 */
import { describe, expect, it } from "vitest";

import { buildQuestionAnswerRows, type AnswerObservation } from "../question-answers";
import type { AnswerFact } from "../answers";

const fact = (over: Partial<AnswerFact>): AnswerFact => ({
  questionId: "q1",
  attemptId: "a1",
  result: "neutral",
  source: "web",
  latencyMs: null,
  earnedPoints: null,
  possiblePoints: null,
  answer: "Мой ответ",
  ...over,
});

const seen = (over: Partial<AnswerObservation>): AnswerObservation => ({
  participant: "Иванов",
  finishedAt: new Date("2026-09-19T10:00:00.000Z"),
  startedAt: new Date("2026-09-19T09:00:00.000Z"),
  source: "web",
  ...over,
});

const question = { type: "long", dataJson: {} };

describe("список ответов задания", () => {
  it("несёт ответ, участника, дату и время на задании", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question,
      facts: [fact({ latencyMs: 42_000 })],
      observations: new Map([["a1", seen({})]]),
    });
    expect(rows).toEqual([{
      attemptId: "a1",
      source: "web",
      participant: "Иванов",
      at: "2026-09-19T10:00:00.000Z",
      answer: "Мой ответ",
      length: 9,
      result: "neutral",
      outcome: "neutral",
      latencyMs: 42_000,
    }]);
  });

  it("берёт только ответы ЭТОГО задания", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question,
      facts: [fact({}), fact({ questionId: "q2", answer: "Чужой" })],
      observations: new Map([["a1", seen({})]]),
    });
    expect(rows).toHaveLength(1);
  });

  it("пустые ответы в список не идут: «не отвечал» — это статистика, а не работа", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question,
      facts: [fact({ answer: "   " }), fact({ answer: null }), fact({ answer: "" })],
      observations: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it("свежие сверху, прохождения без даты — в конец", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question,
      facts: [
        fact({ attemptId: "старый", answer: "раз" }),
        fact({ attemptId: "новый", answer: "два" }),
        fact({ attemptId: "безвестный", answer: "три" }),
      ],
      observations: new Map([
        ["старый", seen({ finishedAt: new Date("2026-09-01T00:00:00.000Z") })],
        ["новый", seen({ finishedAt: new Date("2026-09-19T00:00:00.000Z") })],
        ["безвестный", seen({ finishedAt: null, startedAt: null })],
      ]),
    });
    expect(rows.map((row) => row.attemptId)).toEqual(["новый", "старый", "безвестный"]);
  });

  it("прохождение без известной даты завершения подписывается началом", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question,
      facts: [fact({})],
      observations: new Map([["a1", seen({ finishedAt: null })]]),
    });
    expect(rows[0].at).toBe("2026-09-19T09:00:00.000Z");
  });

  it("ответ на задание с пропусками печатается по именам полей", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question: { type: "blanks", dataJson: {} },
      facts: [fact({ answer: { city: "Москва", year: "1703" } })],
      observations: new Map([["a1", seen({})]]),
    });
    expect(rows[0].answer).toBe("city: Москва, year: 1703");
  });

  it("прохождение, о котором справочник молчит, не теряется", () => {
    // Строка телеметрии, не назвавшая прохождения, — данные всё равно есть, и терять их
    // из-за неизвестного участника нельзя.
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question,
      facts: [fact({ attemptId: "", source: "telemetry" })],
      observations: new Map(),
    });
    expect(rows[0]).toMatchObject({ participant: "Неизвестный участник", source: "telemetry", at: null });
  });
});

describe("список ответов задания — Э4а", () => {
  it("называет частичный кредит: «неверно» с баллами — это «частично»", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question,
      facts: [
        fact({ attemptId: "a1", result: "incorrect", earnedPoints: 1, possiblePoints: 2 }),
        fact({ attemptId: "a2", result: "incorrect", earnedPoints: 0, possiblePoints: 2 }),
        fact({ attemptId: "a3", result: "correct", earnedPoints: 2, possiblePoints: 2 }),
      ],
      observations: new Map(),
    });
    expect(rows.map(row => row.outcome)).toEqual(["partial", "incorrect", "correct"]);
  });

  it("пропуски подписывает по порядку в тексте, пустой — называет", () => {
    const rows = buildQuestionAnswerRows({
      questionId: "q1",
      question: { type: "blanks", dataJson: {}, prompt: "Столица — {{city}}, основана в {{year}} году." },
      facts: [fact({ answer: { year: "1147", city: "Москва" } }), fact({ attemptId: "a2", answer: { city: "Питер" } }), fact({ attemptId: "a3", answer: {} })],
      observations: new Map(),
    });
    expect(rows.map(row => row.answer)).toEqual([
      "1-й пропуск: «Москва» · 2-й пропуск: «1147»",
      "1-й пропуск: «Питер» · 2-й пропуск: (нет ответа)",
    ]);
  });
});
