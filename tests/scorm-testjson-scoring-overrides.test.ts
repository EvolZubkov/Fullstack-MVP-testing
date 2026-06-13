/**
 * @module tests/scorm-testjson-scoring-overrides
 *
 * PRD-15 block D (FR-32/FR-34): the SCORM bake resolves the EFFECTIVE per-test
 * scoring into TEST_DATA — `q.points` / `q.scoring` / `q.difficulty` are the
 * resolved values, so the in-package runtime needs no changes. Packages of
 * tests without overrides/defaults must stay byte-identical to the pre-block-D
 * output (FR-02 regression guard).
 */

import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest: any = {
  id: "test-123",
  title: "JS",
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

const dbQuestion: any = {
  id: "q1", topicId: "t1", type: "single", prompt: "What is JS?",
  dataJson: { options: ["A", "B"] },
  correctJson: { correctIndex: 0 },
  points: 5, difficulty: 60, shuffleAnswers: true,
  mediaUrl: null, mediaType: null,
  feedback: null, feedbackMode: "general",
  feedbackCorrect: null, feedbackIncorrect: null,
  scoringJson: null, contentHash: "h1",
};

const dbSection: any = {
  id: "s1", testId: "test-123", topicId: "t1",
  topic: { id: "t1", name: "JavaScript", feedback: null },
  questions: [dbQuestion],
  courses: [], events: [],
  drawCount: 1,
  topicPassRuleJson: null,
};

const exportData: any = { test: baseTest, sections: [dbSection] };

const override = (values: Record<string, unknown>) => ({
  id: "ov1", testId: "test-123", questionId: "q1",
  points: null, scoringJson: null, difficulty: null, pinnedContentHash: null,
  createdAt: new Date(), updatedAt: new Date(),
  ...values,
});

describe("buildTestJson — block D effective scoring bake", () => {
  it("stays byte-identical without overrides (FR-02)", () => {
    const before = buildTestJson(exportData);
    const after = buildTestJson({ ...exportData, questionScoring: [] });
    expect(after).toBe(before);
  });

  it("bakes the override price into q.points", () => {
    const d = { ...exportData, questionScoring: [override({ points: 9 })] };
    const q = JSON.parse(buildTestJson(d)).sections[0].questions[0];
    expect(q.points).toBe(9);
  });

  it("bakes a zero-point override (unscored in this test)", () => {
    const d = { ...exportData, questionScoring: [override({ points: 0 })] };
    const q = JSON.parse(buildTestJson(d)).sections[0].questions[0];
    expect(q.points).toBe(0);
  });

  it("bakes the override graded config into q.scoring", () => {
    const scoring = { kind: "weighted", weights: [2, 0] };
    const d = { ...exportData, questionScoring: [override({ scoringJson: scoring })] };
    const q = JSON.parse(buildTestJson(d)).sections[0].questions[0];
    expect(q.scoring).toEqual(scoring);
  });

  it("an explicit exact override shadows the question's graded config", () => {
    const d = {
      ...exportData,
      sections: [{
        ...dbSection,
        questions: [{ ...dbQuestion, scoringJson: { kind: "weighted", weights: [1, 0] } }],
      }],
      questionScoring: [override({ scoringJson: { kind: "exact" } })],
    };
    const q = JSON.parse(buildTestJson(d)).sections[0].questions[0];
    expect(q.scoring).toEqual({ kind: "exact" });
  });

  it("bakes the effective difficulty into q.difficulty (FR-34)", () => {
    const d = { ...exportData, questionScoring: [override({ difficulty: 95 })] };
    const q = JSON.parse(buildTestJson(d)).sections[0].questions[0];
    expect(q.difficulty).toBe(95);
  });

  it("bakes effective values into the adaptive question pool too", () => {
    const d = {
      ...exportData,
      test: { ...baseTest, mode: "adaptive" },
      questionScoring: [override({ points: 2, difficulty: 85 })],
      adaptiveSettings: {
        topicSettings: [{ id: "ats1", testId: "test-123", topicId: "t1", failureFeedback: null }],
        levels: [{
          id: "lvl1", testId: "test-123", topicId: "t1", levelIndex: 0, levelName: "База",
          minDifficulty: 0, maxDifficulty: 100, questionsCount: 1,
          passThreshold: 50, passThresholdType: "percent", feedback: null, links: [],
        }],
      },
    };
    const q = JSON.parse(buildTestJson(d)).adaptiveTopics[0].questions[0];
    expect(q.points).toBe(2);
    expect(q.difficulty).toBe(85);
  });

  it("bakes the section default when no override is set (T-40: defaults reachable)", () => {
    // After T-40 the question carries no points, so the chain resolves to the
    // section default (which wins over the test default).
    const d = {
      ...exportData,
      test: { ...baseTest, defaultQuestionPoints: 3 },
      sections: [{ ...dbSection, defaultPoints: 4 }],
      questionScoring: [],
    };
    const q = JSON.parse(buildTestJson(d)).sections[0].questions[0];
    expect(q.points).toBe(4);
  });

  it("bakes the test default when neither override nor section default is set", () => {
    const d = {
      ...exportData,
      test: { ...baseTest, defaultQuestionPoints: 3 },
      sections: [{ ...dbSection, defaultPoints: null }],
      questionScoring: [],
    };
    const q = JSON.parse(buildTestJson(d)).sections[0].questions[0];
    expect(q.points).toBe(3);
  });
});
