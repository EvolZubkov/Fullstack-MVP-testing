// @vitest-environment jsdom
/**
 * @module client/pages/author/__tests__/analytics-short-answer.test
 *
 * PRD-57 §6.5 и FR-17: как разбор показывает написанный ответ и его эталон.
 *
 * Эталон короткого ответа — набор правил, и адресован он АВТОРУ: ему важно видеть, что
 * именно правило ловит. Пустой набор эталона не даёт вовсе — пустая рамка читается как
 * потеря данных.
 */
import { describe, it, expect } from "vitest";
import { formatUserAnswer, formatCorrectAnswer } from "@/features/analytics/attempt/attempt-details-dialog";

const answer = (over: Record<string, unknown>) => ({ questionType: "short", ...over }) as never;

describe("разбор короткого ответа", () => {
  it("печатает ответ участника как есть", () => {
    expect(formatUserAnswer(answer({ userAnswer: "  Ростехнадзор " }))).toBe("  Ростехнадзор ");
  });

  it("неотвеченный вопрос читается как «нет ответа»", () => {
    expect(formatUserAnswer(answer({ userAnswer: null }))).toBe("Нет ответа");
  });

  it("эталоном показывает правила", () => {
    const correctAnswer = {
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "wildcard", value: "Ростехнадзор" },
        { kind: "text", match: "wildcard", value: "РТН" },
      ],
    };
    expect(formatCorrectAnswer(answer({ correctAnswer }))).toBe("Ростехнадзор, РТН");
  });

  it("у задания без правил эталона нет", () => {
    expect(formatCorrectAnswer(answer({ correctAnswer: { answerKind: "text", join: "any", rules: [] } }))).toBe("—");
  });

  it("числовое правило читается условием, а не сырым объектом", () => {
    const correctAnswer = {
      answerKind: "number",
      join: "any",
      unit: "°C",
      rules: [{ kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } }],
    };
    expect(formatCorrectAnswer(answer({ correctAnswer }))).toBe("равно -25 ±2 °C");
  });
});
