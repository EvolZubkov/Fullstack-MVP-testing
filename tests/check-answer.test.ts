import { describe, it, expect } from "vitest";
import { checkAnswer } from "../server/utils/check-answer";
import type { Question } from "../shared/schema";

// Helper to build mock Question objects
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
    createdAt: new Date(),
    ...overrides,
  } as Question;
}

// ─────────────────────────────────────────────
// SINGLE CHOICE
// ─────────────────────────────────────────────
describe("checkAnswer — single", () => {
  const q = makeQuestion({
    type: "single",
    correctJson: { correctIndex: 2 },
  });

  it("returns 1 for correct index", () => {
    expect(checkAnswer(q, 2)).toBe(1);
  });

  it("returns 0 for wrong index", () => {
    expect(checkAnswer(q, 0)).toBe(0);
    expect(checkAnswer(q, 1)).toBe(0);
  });

  it("returns 0 for null answer", () => {
    expect(checkAnswer(q, null)).toBe(0);
  });

  it("returns 0 for undefined answer", () => {
    expect(checkAnswer(q, undefined)).toBe(0);
  });

  it("returns 0 for string answer instead of number", () => {
    expect(checkAnswer(q, "2")).toBe(0);
  });
});

// ─────────────────────────────────────────────
// MULTIPLE CHOICE
// ─────────────────────────────────────────────
describe("checkAnswer — multiple", () => {
  const q = makeQuestion({
    type: "multiple",
    correctJson: { correctIndices: [0, 2] },
  });

  it("returns 1 for exact correct set", () => {
    expect(checkAnswer(q, [0, 2])).toBe(1);
  });

  it("returns 1 for correct set in different order", () => {
    expect(checkAnswer(q, [2, 0])).toBe(1);
  });

  it("returns 0 for partial answer", () => {
    expect(checkAnswer(q, [0])).toBe(0);
  });

  it("returns 0 for extra selection", () => {
    expect(checkAnswer(q, [0, 1, 2])).toBe(0);
  });

  it("returns 0 for wrong answer", () => {
    expect(checkAnswer(q, [1, 3])).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(checkAnswer(q, [])).toBe(0);
  });

  it("returns 0 for null answer", () => {
    expect(checkAnswer(q, null)).toBe(0);
  });

  it("handles single correct index in multiple", () => {
    const q1 = makeQuestion({
      type: "multiple",
      correctJson: { correctIndices: [1] },
    });
    expect(checkAnswer(q1, [1])).toBe(1);
    expect(checkAnswer(q1, [0])).toBe(0);
  });
});

// ─────────────────────────────────────────────
// MATCHING
// ─────────────────────────────────────────────
describe("checkAnswer — matching", () => {
  const q = makeQuestion({
    type: "matching",
    correctJson: {
      pairs: [
        { left: 0, right: 2 },
        { left: 1, right: 0 },
        { left: 2, right: 1 },
      ],
    },
  });

  it("returns 1 for all correct pairs", () => {
    expect(checkAnswer(q, { 0: 2, 1: 0, 2: 1 })).toBe(1);
  });

  it("returns 0 if one pair is wrong", () => {
    expect(checkAnswer(q, { 0: 2, 1: 1, 2: 0 })).toBe(0);
  });

  it("returns 0 for all wrong pairs", () => {
    expect(checkAnswer(q, { 0: 0, 1: 1, 2: 2 })).toBe(0);
  });

  it("returns 0 for empty object", () => {
    expect(checkAnswer(q, {})).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(checkAnswer(q, null)).toBe(0);
  });

  // PRD-12: the server now delegates to the canonical @shared/scoring engine.
  // For a malformed question with no correct pairs, the engine scores an empty
  // answer as a vacuous full match (1) — matching the SCORM runtime. The old
  // server-only guard that returned 0 is intentionally dropped for parity.
  it("scores empty answer as full credit when correctPairs is empty (engine parity)", () => {
    const qEmpty = makeQuestion({
      type: "matching",
      correctJson: { pairs: [] },
    });
    expect(checkAnswer(qEmpty, {})).toBe(1);
  });
});

// ─────────────────────────────────────────────
// RANKING
// ─────────────────────────────────────────────
describe("checkAnswer — ranking", () => {
  const q = makeQuestion({
    type: "ranking",
    correctJson: { correctOrder: [2, 0, 1] },
  });

  it("returns 1 for correct order", () => {
    expect(checkAnswer(q, [2, 0, 1])).toBe(1);
  });

  it("returns 0 for wrong order", () => {
    expect(checkAnswer(q, [0, 1, 2])).toBe(0);
  });

  it("returns 0 for partially correct order", () => {
    expect(checkAnswer(q, [2, 1, 0])).toBe(0);
  });

  it("returns 0 for wrong length", () => {
    expect(checkAnswer(q, [2, 0])).toBe(0);
    expect(checkAnswer(q, [2, 0, 1, 3])).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(checkAnswer(q, [])).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(checkAnswer(q, null)).toBe(0);
  });

  // PRD-12: parity with @shared/scoring — see the matching case above. An empty
  // ranking answer against an empty correctOrder is a vacuous full match (1).
  it("scores empty answer as full credit when correctOrder is empty (engine parity)", () => {
    const qEmpty = makeQuestion({
      type: "ranking",
      correctJson: { correctOrder: [] },
    });
    expect(checkAnswer(qEmpty, [])).toBe(1);
  });
});

// ─────────────────────────────────────────────
// UNKNOWN TYPE
// ─────────────────────────────────────────────
describe("checkAnswer — unknown type", () => {
  it("returns 0 for unknown question type", () => {
    const q = makeQuestion({ type: "unknown" as any, correctJson: {} });
    expect(checkAnswer(q, "anything")).toBe(0);
  });
});
