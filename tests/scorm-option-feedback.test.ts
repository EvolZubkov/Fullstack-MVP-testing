/**
 * @module tests/scorm-option-feedback
 *
 * Per-option feedback texts in the SCORM package. The texts must be baked into TEST_DATA
 * for both delivery modes (only when some option has one, so untouched packages stay
 * byte-identical), and every runtime call of the shared `feedbackTextFor` must pass the
 * learner's answer — without it the rule cannot know which option was chosen and silently
 * falls back to the question's text, a divergence no shared-engine test would see.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  optionFeedbackJson: null,
  contentHash: "h1",
  tags: [],
  ...values,
});

const exportData = (question: any): any => ({
  test: baseTest,
  sections: [
    {
      id: "s1",
      testId: "test-1",
      topicId: "t1",
      topic: { id: "t1", name: "Topic", feedback: null },
      questions: [question],
      courses: [],
      events: [],
      drawCount: 1,
      topicPassRuleJson: null,
    },
  ],
});

describe("buildTestJson — option feedback texts reach the package", () => {
  it("bakes the texts when some option has one", () => {
    const q = JSON.parse(buildTestJson(exportData(dbQuestion({ optionFeedbackJson: [null, "Почему B"] }))))
      .sections[0].questions[0];
    expect(q.optionFeedbackJson).toEqual([null, "Почему B"]);
  });

  it("omits the field when no option has a text, so packages stay byte-identical", () => {
    const q = JSON.parse(buildTestJson(exportData(dbQuestion({})))).sections[0].questions[0];
    expect(q).not.toHaveProperty("optionFeedbackJson");
  });

  it("bakes the texts for adaptive topics too", () => {
    const data = {
      ...exportData(dbQuestion({ optionFeedbackJson: ["Почему A"] })),
      test: { ...baseTest, mode: "adaptive" },
      adaptiveSettings: { topicSettings: [], levels: [] },
    };
    const q = JSON.parse(buildTestJson(data)).adaptiveTopics[0].questions[0];
    expect(q.optionFeedbackJson).toEqual(["Почему A"]);
  });
});

describe("runtime — every feedbackTextFor call passes the learner's answer", () => {
  const files = [
    "server/scorm/template/app/feedback/feedback.js",
    "server/scorm/template/app/render/mainRender.js",
    "server/scorm/template/app/render/adaptiveRender.js",
  ];

  it.each(files)("%s", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    const calls = src.match(/feedbackTextFor\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.split(",").length).toBe(3);
    }
  });
});
