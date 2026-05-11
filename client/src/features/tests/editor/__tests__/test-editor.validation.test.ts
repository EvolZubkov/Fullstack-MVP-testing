/**
 * @module features/tests/editor/__tests__/test-editor.validation.test
 * @description Unit tests for `validateTestEditor`.
 *
 * One happy path + one sad path per validation rule:
 *   FR-11 — title required
 *   FR-12 — at least one section
 *   FR-14 — overall percent value in [0, 100]
 *   FR-15a — passDecisionPolicy is a valid enum value
 *   FR-15g — forbidden combination: all_topics_passed + inherit_overall + overall.type=none
 *   FR-20  — webhook URL valid or empty
 */
import { describe, expect, it } from "vitest";
import { validateTestEditor } from "../test-editor.validation";
import type { TestEditorModel } from "../test-editor.types";

// ─── Base fixture ─────────────────────────────────────────────────────────────

/** Minimal valid editor model. All rules pass against this baseline. */
function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    basic: {
      title: "Sample Test",
      description: "",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: false,
    },
    passRules: {
      decisionPolicy: "overall_only",
      overall: { type: "percent", value: 60 },
      byTopic: {},
    },
    sections: [
      {
        topicId: "topic-1",
        topicName: "Topic One",
        maxQuestions: 10,
        drawCount: 5,
        required: true,
        timeLimit: { source: "inherit_test" },
        feedback: { format: "plain", text: "" },
        feedbackLinks: [],
        feedbackAssets: [],
      },
    ],
    adaptive: {
      showDifficultyLevel: false,
      testSettings: { showDifficultyLevel: false },
      topics: [],
    },
    ...overrides,
  };
}

// ─── FR-11: title required ────────────────────────────────────────────────────

describe("FR-11: title required", () => {
  it("happy path — non-empty title passes", () => {
    const result = validateTestEditor(baseModel());
    const titleErrors = result.errors.filter((e) => e.field === "basic.title");
    expect(titleErrors).toHaveLength(0);
  });

  it("sad path — blank title produces required error", () => {
    const model = baseModel({ basic: { ...baseModel().basic, title: "   " } });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: "basic.title", code: "required", severity: "error" }),
    );
  });
});

// ─── FR-12: at least one section ─────────────────────────────────────────────

describe("FR-12: at least one section", () => {
  it("happy path — one section passes", () => {
    const result = validateTestEditor(baseModel());
    const sectionErrors = result.errors.filter((e) => e.field === "sections");
    expect(sectionErrors).toHaveLength(0);
  });

  it("sad path — empty sections produces required error", () => {
    const model = baseModel({ sections: [] });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: "sections", code: "required", severity: "error" }),
    );
  });
});

// ─── FR-14: overall percent value in [0, 100] ─────────────────────────────────

describe("FR-14: overall percent value in [0, 100]", () => {
  it("happy path — value 60 with percent type passes", () => {
    const result = validateTestEditor(baseModel());
    const rangeErrors = result.errors.filter((e) => e.field === "passRules.overall.value");
    expect(rangeErrors).toHaveLength(0);
  });

  it("sad path — value 150 with percent type produces range error", () => {
    const model = baseModel({
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 150 },
        byTopic: {},
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "passRules.overall.value",
        code: "range",
        severity: "error",
      }),
    );
  });
});

// ─── FR-15a: valid passDecisionPolicy ─────────────────────────────────────────

describe("FR-15a: valid passDecisionPolicy", () => {
  it("happy path — 'overall_only' is a valid policy", () => {
    const result = validateTestEditor(baseModel());
    const policyErrors = result.errors.filter(
      (e) => e.field === "passRules.decisionPolicy" && e.code === "required",
    );
    expect(policyErrors).toHaveLength(0);
  });

  it("sad path — unknown policy value produces required error", () => {
    const model = baseModel({
      passRules: {
        // @ts-expect-error intentionally invalid value for test
        decisionPolicy: "unknown_policy",
        overall: { type: "percent", value: 60 },
        byTopic: {},
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "passRules.decisionPolicy",
        code: "required",
        severity: "error",
      }),
    );
  });
});

// ─── FR-15g: forbidden combination ───────────────────────────────────────────

describe("FR-15g: forbidden combination all_topics_passed + inherit_overall + overall.type=none", () => {
  it("happy path — all_topics_passed with overall.type=percent passes", () => {
    const model = baseModel({
      passRules: {
        decisionPolicy: "all_topics_passed",
        overall: { type: "percent", value: 60 },
        byTopic: { "topic-1": { source: "inherit_overall" } },
      },
    });
    const result = validateTestEditor(model);
    const forbidden = result.errors.filter((e) => e.code === "forbidden_combination");
    expect(forbidden).toHaveLength(0);
  });

  it("sad path — all_topics_passed + overall.type=none + inherit_overall produces forbidden_combination", () => {
    const model = baseModel({
      passRules: {
        decisionPolicy: "all_topics_passed",
        overall: { type: "none", value: 0 },
        byTopic: { "topic-1": { source: "inherit_overall" } },
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "passRules.decisionPolicy",
        code: "forbidden_combination",
        severity: "error",
      }),
    );
  });
});

// ─── FR-20: webhook URL valid or empty ───────────────────────────────────────

describe("FR-20: webhook URL valid or empty", () => {
  it("happy path — empty webhook URL passes", () => {
    const result = validateTestEditor(baseModel());
    const urlErrors = result.errors.filter((e) => e.field === "basic.webhookUrl");
    expect(urlErrors).toHaveLength(0);
  });

  it("happy path — valid HTTPS URL passes", () => {
    const model = baseModel({
      basic: { ...baseModel().basic, webhookUrl: "https://example.com/hook" },
    });
    const result = validateTestEditor(model);
    const urlErrors = result.errors.filter((e) => e.field === "basic.webhookUrl");
    expect(urlErrors).toHaveLength(0);
  });

  it("sad path — malformed URL produces invalid_url error", () => {
    const model = baseModel({
      basic: { ...baseModel().basic, webhookUrl: "not-a-url" },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "basic.webhookUrl",
        code: "invalid_url",
        severity: "error",
      }),
    );
  });
});

// ─── FR-13: drawCount must be between 1 and maxQuestions ─────────────────────

describe("FR-13: drawCount range", () => {
  it("happy path — drawCount within [1, maxQuestions] passes", () => {
    const result = validateTestEditor(baseModel());
    const drawErrors = result.errors.filter((e) => e.field.includes("drawCount"));
    expect(drawErrors).toHaveLength(0);
  });

  it("sad path — drawCount exceeds maxQuestions produces range error", () => {
    const model = baseModel({
      sections: [
        {
          topicId: "topic-1",
          topicName: "Topic One",
          maxQuestions: 10,
          drawCount: 15,
          required: true,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
        },
      ],
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "sections[0].drawCount",
        code: "range",
        severity: "error",
      }),
    );
  });
});

// ─── FR-15c-f: absolute pass rule constraints ──────────────────────────────

describe("FR-15: absolute pass rule constraints", () => {
  it("happy path — absolute pass rule <= total questions passes", () => {
    const model = baseModel({
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "absolute", value: 5 },
        byTopic: {},
      },
    });
    const result = validateTestEditor(model);
    const rangeErrors = result.errors.filter(
      (e) => e.field === "passRules.overall.value" && e.code === "range",
    );
    expect(rangeErrors).toHaveLength(0);
  });

  it("sad path — absolute pass rule exceeds total questions produces range error", () => {
    const model = baseModel({
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "absolute", value: 100 },
        byTopic: {},
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "passRules.overall.value",
        code: "range",
        severity: "error",
      }),
    );
  });

  it("happy path — topic absolute pass rule <= topic drawCount passes", () => {
    const model = baseModel({
      sections: [
        {
          topicId: "topic-1",
          topicName: "Topic One",
          maxQuestions: 20,
          drawCount: 10,
          required: true,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
        },
      ],
      passRules: {
        decisionPolicy: "overall_and_required_topics",
        overall: { type: "percent", value: 60 },
        byTopic: { "topic-1": { source: "custom", type: "absolute", value: 8 } },
      },
    });
    const result = validateTestEditor(model);
    const topicErrors = result.errors.filter((e) => e.field.includes("byTopic"));
    expect(topicErrors).toHaveLength(0);
  });

  it("sad path — topic absolute pass rule exceeds topic drawCount produces error", () => {
    const model = baseModel({
      sections: [
        {
          topicId: "topic-1",
          topicName: "Topic One",
          maxQuestions: 20,
          drawCount: 10,
          required: true,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
        },
      ],
      passRules: {
        decisionPolicy: "overall_and_required_topics",
        overall: { type: "percent", value: 60 },
        byTopic: { "topic-1": { source: "custom", type: "absolute", value: 15 } },
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "passRules.byTopic[topic-1].value",
        code: "range",
        severity: "error",
      }),
    );
  });
});

// ─── FR-16: adaptive level difficulty range ────────────────────────────────

describe("FR-16: adaptive level difficulty range", () => {
  it("happy path — valid difficulty range [0, 100] with min < max passes", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 3,
                passThresholdType: "absolute",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    const diffErrors = result.errors.filter((e) =>
      e.field.includes("Difficulty"),
    );
    expect(diffErrors).toHaveLength(0);
  });

  it("sad path — minDifficulty >= maxDifficulty produces range error", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 50,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 3,
                passThresholdType: "absolute",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "adaptive.topics[0].levels[0].minDifficulty",
        code: "range",
        severity: "error",
      }),
    );
  });
});

// ─── FR-17: adaptive level questions count ──────────────────────────────────

describe("FR-17: adaptive level questions count >= 1", () => {
  it("happy path — questionsCount >= 1 passes", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 1,
                passThreshold: 1,
                passThresholdType: "absolute",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    const countErrors = result.errors.filter((e) =>
      e.field.includes("questionsCount"),
    );
    expect(countErrors).toHaveLength(0);
  });

  it("sad path — questionsCount < 1 produces range error", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 0,
                passThreshold: 0,
                passThresholdType: "absolute",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "adaptive.topics[0].levels[0].questionsCount",
        code: "range",
        severity: "error",
      }),
    );
  });
});

// ─── FR-18: adaptive level pass threshold type validation ────────────────────

describe("FR-18: adaptive level pass threshold", () => {
  it("happy path — percent threshold [0, 100] passes", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 75,
                passThresholdType: "percent",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    const threshErrors = result.errors.filter((e) =>
      e.field.includes("passThreshold"),
    );
    expect(threshErrors).toHaveLength(0);
  });

  it("sad path — percent threshold > 100 produces range error", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 150,
                passThresholdType: "percent",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "adaptive.topics[0].levels[0].passThreshold",
        code: "range",
        severity: "error",
      }),
    );
  });

  it("happy path — absolute threshold [0, questionsCount] passes", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 10,
                passThreshold: 8,
                passThresholdType: "absolute",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    const threshErrors = result.errors.filter((e) =>
      e.field.includes("passThreshold"),
    );
    expect(threshErrors).toHaveLength(0);
  });

  it("sad path — absolute threshold > questionsCount produces range error", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 10,
                passThresholdType: "absolute",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "adaptive.topics[0].levels[0].passThreshold",
        code: "range",
        severity: "error",
      }),
    );
  });
});

// ─── FR-19: adaptive link completeness ─────────────────────────────────────

describe("FR-19: adaptive link title and URL completeness", () => {
  it("happy path — link with both title and URL passes", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 3,
                passThresholdType: "absolute",
                links: [{ title: "Learn More", url: "https://example.com" }],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    const linkErrors = result.errors.filter((e) => e.field.includes("links"));
    expect(linkErrors).toHaveLength(0);
  });

  it("happy path — empty links array passes", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 3,
                passThresholdType: "absolute",
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    const linkErrors = result.errors.filter((e) => e.field.includes("links"));
    expect(linkErrors).toHaveLength(0);
  });

  it("sad path — link with title but no URL produces required error", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            levels: [
              {
                levelIndex: 0,
                levelName: "Easy",
                minDifficulty: 10,
                maxDifficulty: 40,
                questionsCount: 5,
                passThreshold: 3,
                passThresholdType: "absolute",
                links: [{ title: "Learn More", url: "" }],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "adaptive.topics[0].levels[0].links[0]",
        code: "required",
        severity: "error",
      }),
    );
  });
});
