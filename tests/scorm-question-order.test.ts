/**
 * @module tests/scorm-question-order
 *
 * PRD-30 in the SCORM package: the topic's delivery-order setting
 * (`test_sections.question_order`) and the author's per-question index
 * (`questions.order_index`) must reach TEST_DATA, and ONLY when they are
 * actually in use — a test that never touched the setting has to keep
 * producing a byte-identical package (FR-14).
 *
 * The regression this pins is the one PRD-16 hit before: a delivery switch that
 * lives in the database, is honoured by the web host, and never reaches the
 * package — so the same test plays in author order on the web and shuffled in
 * the LMS, a host divergence no shared-engine test can see.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest: any = {
  id: "test-1",
  title: "T",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

const dbQuestion = (values: Record<string, unknown>): any => ({
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "Q",
  dataJson: { options: ["A", "B", "C"] },
  correctJson: { correctIndex: 0 },
  difficulty: 50,
  shuffleAnswers: true,
  mediaUrl: null,
  mediaType: null,
  feedback: null,
  feedbackMode: "general",
  feedbackCorrect: null,
  feedbackIncorrect: null,
  contentHash: "h1",
  tags: [],
  orderIndex: null,
  ...values,
});

const exportData = (section: Record<string, unknown>, questions: any[]): any => ({
  test: baseTest,
  sections: [
    {
      id: "s1",
      testId: "test-1",
      topicId: "t1",
      topic: { id: "t1", name: "Topic", feedback: null },
      questions,
      courses: [],
      events: [],
      drawCount: questions.length,
      topicPassRuleJson: null,
      ...section,
    },
  ],
});

const bake = (section: Record<string, unknown>, questions: any[]) =>
  JSON.parse(buildTestJson(exportData(section, questions))).sections[0];

describe("buildTestJson — the section's order setting (FR-02/FR-14)", () => {
  it("bakes questionOrder: fixed when the author turned the shuffle off", () => {
    const section = bake({ questionOrder: "fixed" }, [dbQuestion({})]);

    expect(section.questionOrder).toBe("fixed");
  });

  it("omits the field for the default (random) so untouched packages stay byte-identical", () => {
    const section = bake({ questionOrder: "random" }, [dbQuestion({})]);

    expect("questionOrder" in section).toBe(false);
  });

  it("omits the field for a legacy section that has no setting at all", () => {
    const section = bake({}, [dbQuestion({})]);

    expect("questionOrder" in section).toBe(false);
  });
});

describe("buildTestJson — the question's index (FR-01/FR-14)", () => {
  it("bakes orderIndex when the section orders by it", () => {
    const section = bake({ questionOrder: "fixed" }, [dbQuestion({ orderIndex: 20 })]);

    expect(section.questions[0].orderIndex).toBe(20);
  });

  it("bakes zero — it is an ordinary index, not «unset»", () => {
    const section = bake({ questionOrder: "fixed" }, [dbQuestion({ orderIndex: 0 })]);

    expect(section.questions[0].orderIndex).toBe(0);
  });

  it("omits the index of a question that has none, even in a fixed section", () => {
    const section = bake({ questionOrder: "fixed" }, [dbQuestion({ orderIndex: null })]);

    expect("orderIndex" in section.questions[0]).toBe(false);
  });

  it("omits indices entirely when the section delivers at random — they change nothing there", () => {
    const section = bake({ questionOrder: "random" }, [dbQuestion({ orderIndex: 20 })]);

    expect("orderIndex" in section.questions[0]).toBe(false);
  });
});

describe("buildTestJson — a whole ordered topic", () => {
  it("carries every index through, in the bank's order", () => {
    const section = bake({ questionOrder: "fixed" }, [
      dbQuestion({ id: "a", orderIndex: 10 }),
      dbQuestion({ id: "b", orderIndex: 20 }),
      dbQuestion({ id: "c", orderIndex: null }),
    ]);

    expect(section.questions.map((q: any) => [q.id, q.orderIndex ?? null])).toEqual([
      ["a", 10],
      ["b", 20],
      ["c", null],
    ]);
  });
});
