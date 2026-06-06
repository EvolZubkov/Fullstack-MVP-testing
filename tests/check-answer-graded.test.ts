/**
 * @module tests/check-answer-graded
 *
 * Verifies that the server answer checker (server/utils/check-answer) now flows
 * PRD-10 graded scoring ("цена ответа") through to the web runtime after being
 * routed to @shared/scoring (PRD-12 task 2-1): a question carrying `scoringJson`
 * yields a partial ratio, while a question without it keeps the legacy exact 0/1.
 * The full exact-mode matrix stays covered by tests/check-answer.test.ts.
 */

import { describe, it, expect } from "vitest";
import { checkAnswer } from "../server/utils/check-answer";
import type { Question } from "../shared/schema";

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: "q1",
    topicId: "t1",
    type: "single",
    prompt: "Test question",
    dataJson: {},
    correctJson: {},
    points: 1,
    difficulty: 50,
    shuffleAnswers: true,
    feedbackMode: "general",
    feedback: null,
    feedbackCorrect: null,
    feedbackIncorrect: null,
    mediaUrl: null,
    mediaType: null,
    scoringJson: null,
    createdAt: new Date(),
    ...overrides,
  } as Question;
}

describe("checkAnswer — graded scoring passthrough (PRD-10)", () => {
  it("returns a partial ratio for a weighted single question", () => {
    // weights [0, 1, 2] -> sMax defaults to max = 2.
    const q = makeQuestion({
      type: "single",
      correctJson: { correctIndex: 2 },
      scoringJson: { kind: "weighted", weights: [0, 1, 2] } as any,
    });
    expect(checkAnswer(q, 2)).toBe(1); // 2 / 2
    expect(checkAnswer(q, 1)).toBeCloseTo(0.5); // 1 / 2
    expect(checkAnswer(q, 0)).toBe(0); // 0 / 2
  });

  it("keeps the legacy exact 0/1 when scoringJson is absent", () => {
    const q = makeQuestion({ type: "single", correctJson: { correctIndex: 2 } });
    expect(checkAnswer(q, 2)).toBe(1);
    expect(checkAnswer(q, 1)).toBe(0);
    expect(checkAnswer(q, null)).toBe(0);
  });
});
