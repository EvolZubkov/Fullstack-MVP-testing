// @vitest-environment node
/**
 * @module server/scorm/__tests__/test-json-prd50
 * @description PRD-50 FR-15/FR-17: a question's tags reach the package for ADAPTIVE
 * sections too. Standard sections have baked them since PRD-11 (the stratified draw needs
 * them); without the adaptive ones there is nothing to compute an adaptive breakdown from.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../builders/test-json";

const baseTest = {
  id: "t1",
  title: "Маслач",
  description: null,
  mode: "adaptive",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

/** Parse the baked TEST_DATA (buildTestJson returns the serialized JSON). */
function bake(data: unknown): any {
  return JSON.parse(buildTestJson(data as never));
}

function adaptiveFixtureWithTaggedQuestion() {
  return {
    test: baseTest,
    sections: [
      {
        id: "sec-1",
        topicId: "t1",
        drawCount: 1,
        required: true,
        feedbackJson: null,
        topic: { id: "t1", name: "Право", feedback: null, feedbackJson: null },
        questions: [
          {
            id: "q1",
            type: "single",
            prompt: "?",
            dataJson: {},
            correctJson: { correctIndex: 0 },
            points: 1,
            difficulty: 50,
            tags: ["ПДн"],
          },
        ],
        courses: [],
        events: [],
      },
    ],
    adaptiveSettings: { topicSettings: [], levels: [] },
  } as never;
}

describe("buildTestJson: теги адаптивных разделов", () => {
  it("выпекает tags у вопроса адаптивного раздела", () => {
    const json = bake(adaptiveFixtureWithTaggedQuestion());
    expect(json.adaptiveTopics[0].questions[0].tags).toEqual(["ПДн"]);
  });
});

/** Стандартный тест с ОДНОЙ секцией и одним тегированным вопросом. */
function standardFixture(testOver: Record<string, unknown> = {}) {
  return {
    test: { ...baseTest, mode: "standard", ...testOver },
    sections: [
      {
        id: "sec-1",
        topicId: "t1",
        drawCount: 1,
        required: true,
        feedbackJson: null,
        topic: { id: "t1", name: "Право", feedback: null, feedbackJson: null },
        questions: [
          {
            id: "q1",
            type: "single",
            prompt: "?",
            dataJson: {},
            correctJson: { correctIndex: 0 },
            points: 1,
            difficulty: 50,
            tags: ["ПДн"],
          },
        ],
        courses: [],
        events: [],
      },
    ],
  } as never;
}

describe("buildTestJson: гейт подтем в пакете (PRD-50 FR-53)", () => {
  it("включённый переключатель выпекается флагом", () => {
    const json = bake(standardFixture({ breakdownGateEnabled: true }));
    expect(json.breakdownGateEnabled).toBe(true);
  });

  it("выключенный переключатель в пакет не попадает — пакет остаётся байт-в-байт прежним", () => {
    // Рантайм читает отсутствие как «выключено», поэтому тест, который переключателя не
    // трогал, собирается ровно в тот же пакет, что и до §16.
    expect("breakdownGateEnabled" in bake(standardFixture())).toBe(false);
    expect("breakdownGateEnabled" in bake(standardFixture({ breakdownGateEnabled: false }))).toBe(false);
  });
});

describe("buildTestJson: список ключей разреза (PRD-36 FR-02)", () => {
  it("ключи собираются из тегов вопросов — их адресом станет НОМЕР в этом списке", () => {
    const json = bake(standardFixture());
    expect(json.breakdownKeys).toEqual(["ПДн"]);
  });

  it("тест без тегов и порогов списка не несёт — пакет остаётся прежним", () => {
    const noTags = {
      test: { ...baseTest, mode: "standard" },
      sections: [
        {
          id: "sec-1", topicId: "t1", drawCount: 1, required: true, feedbackJson: null,
          topic: { id: "t1", name: "Право", feedback: null, feedbackJson: null },
          questions: [
            { id: "q1", type: "single", prompt: "?", dataJson: {}, correctJson: { correctIndex: 0 },
              points: 1, difficulty: 50, tags: [] },
          ],
          courses: [], events: [],
        },
      ],
    } as never;
    expect("breakdownKeys" in bake(noTags)).toBe(false);
  });
});
