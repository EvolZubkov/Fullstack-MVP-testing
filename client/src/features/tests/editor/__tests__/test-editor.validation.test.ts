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
import { TAG_MAX_LENGTH } from "@shared/tags";
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
        maxPoints: 10,
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

// ─── PRD-11 FR-05: Σ quota counts must not exceed drawCount ───────────────────

describe("PRD-11 FR-05: quota sum vs drawCount", () => {
  const withBlueprint = (
    strata: Array<{ tag: string; count: number; mode?: "exact" | "min" }>,
  ) =>
    baseModel({
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
          drawBlueprint: { strata },
        },
      ],
    });

  it("happy path — Σ <= drawCount passes", () => {
    const result = validateTestEditor(
      withBlueprint([{ tag: "a", count: 2 }, { tag: "b", count: 3 }]),
    );
    expect(result.errors.filter((e) => e.field.includes("drawBlueprintJson"))).toHaveLength(0);
  });

  it("sad path — Σ > drawCount produces a section error", () => {
    const result = validateTestEditor(
      withBlueprint([{ tag: "a", count: 3 }, { tag: "b", count: 3 }]),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: "sections[0].drawBlueprintJson", code: "range" }),
    );
  });

  it("no blueprint — no quota error", () => {
    const result = validateTestEditor(baseModel());
    expect(result.errors.filter((e) => e.field.includes("drawBlueprintJson"))).toHaveLength(0);
  });

  // PRD-11: mirror the server drawStratumSchema so a bad tag/count blocks save here
  // (else the author only learns of it as a raw HTTP 400 after «Сохранить»).
  it("empty / blank tag → section error (blocks save)", () => {
    for (const tag of ["", "   "]) {
      const result = validateTestEditor(withBlueprint([{ tag, count: 2 }]));
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: "sections[0].drawBlueprintJson", code: "range" }),
      );
    }
  });

  // Bound to TAG_MAX_LENGTH rather than a literal — see the same note in
  // tests/schema-prd11-blueprint.test.ts. The rule under test is «there is a limit and
  // the editor reports it», not the number of the day.
  it("over-long tag (past TAG_MAX_LENGTH after normalization) → section error", () => {
    const result = validateTestEditor(withBlueprint([{ tag: "x".repeat(TAG_MAX_LENGTH + 1), count: 1 }]));
    expect(result.errors.some((e) => e.field === "sections[0].drawBlueprintJson")).toBe(true);
  });

  it("non-integer / < 1 count → section error", () => {
    expect(
      validateTestEditor(withBlueprint([{ tag: "a", count: 0 }])).errors.some(
        (e) => e.field === "sections[0].drawBlueprintJson",
      ),
    ).toBe(true);
    expect(
      validateTestEditor(withBlueprint([{ tag: "a", count: 1.5 }])).errors.some(
        (e) => e.field === "sections[0].drawBlueprintJson",
      ),
    ).toBe(true);
  });

  it("valid tag + count → no tag error", () => {
    const result = validateTestEditor(withBlueprint([{ tag: "Сети", count: 2 }]));
    expect(result.errors.filter((e) => e.field.includes("drawBlueprintJson"))).toHaveLength(0);
  });
});

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
  it("happy path — overall absolute pass rule <= total points passes", () => {
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

  it("sad path — overall absolute pass rule exceeds total points produces range error", () => {
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

  it("happy path — topic absolute pass rule <= topic max points passes", () => {
    const model = baseModel({
      sections: [
        {
          topicId: "topic-1",
          topicName: "Topic One",
          maxQuestions: 20,
          maxPoints: 30,
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

  // PRD-10: a graded points threshold may exceed the question count — the runtime
  // compares against earned POINTS (e.g. matching = 3 points), so a 15-point bar
  // over 10 questions (16 attainable points) must NOT be rejected.
  it("happy path — topic absolute threshold above question count but within max points passes", () => {
    const model = baseModel({
      sections: [
        {
          topicId: "topic-1",
          topicName: "Topic One",
          maxQuestions: 10,
          maxPoints: 16,
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
    const topicErrors = result.errors.filter((e) => e.field.includes("byTopic"));
    expect(topicErrors).toHaveLength(0);
  });

  it("sad path — topic absolute pass rule exceeds topic max points produces error", () => {
    const model = baseModel({
      sections: [
        {
          topicId: "topic-1",
          topicName: "Topic One",
          maxQuestions: 20,
          maxPoints: 10,
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

// ─── FR-17a: adaptive mode with no enabled topics → error ────────────────────

describe("FR-17a: adaptive mode with no enabled topics is an error", () => {
  it("sad path — adaptive mode, sections present, no enabled topic → no_enabled_topics error", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            enabled: false,
            topicId: "topic-1",
            topicName: "Topic One",
            failureFeedback: null,
            levels: [],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "no_enabled_topics", severity: "error" }),
    );
  });

  it("happy path — at least one enabled topic → no no_enabled_topics error", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            failureFeedback: null,
            levels: [],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors.filter((e) => e.code === "no_enabled_topics")).toHaveLength(0);
  });

  it("standard mode — no no_enabled_topics error even with no enabled topics", () => {
    const model = baseModel({ mode: "standard" });
    const result = validateTestEditor(model);
    expect(result.errors.filter((e) => e.code === "no_enabled_topics")).toHaveLength(0);
  });
});

// ─── FR-17b: adaptive topic with 0 levels → warning ─────────────────────────

describe("FR-17b: adaptive topic with fewer than 2 levels produces warning", () => {
  it("happy path — adaptive topic with two levels produces no missing_levels warning", () => {
    const makeLevel = (idx: number) => ({
      levelIndex: idx,
      levelName: `Level ${idx + 1}`,
      minDifficulty: idx * 50,
      maxDifficulty: idx * 50 + 50,
      questionsCount: 1,
      passThreshold: 50,
      passThresholdType: "percent" as const,
      feedback: null,
      links: [],
    });
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            failureFeedback: null,
            levels: [makeLevel(0), makeLevel(1)],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    const missingWarnings = result.warnings.filter((w) => w.code === "missing_levels");
    expect(missingWarnings).toHaveLength(0);
  });

  it("PRD-4 v1.1: enabled adaptive topic with no levels is now an ERROR (was warning pre-2026-05-28)", () => {
    // Per PRD-4 v1.1 §3.1.2 strict gating: every section in adaptive mode
    // must have a non-empty levels[]. Mixed mode is forbidden — a section
    // without configured levels is not valid for inclusion in an adaptive
    // test. The old behaviour surfaced this as a warning + only-enabled
    // check; the new contract surfaces it as a blocking error.
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            failureFeedback: null,
            levels: [],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "adaptive_section_no_levels",
        severity: "error",
      }),
    );
  });

  it("PRD-4 v1.1: disabled topic with no levels also surfaces strict-gating error", () => {
    // Pre-2026-05-28 behaviour was «disabled topic skipped». PRD-4 v1.1 ends
    // mixed-mode entirely: every section in test.sections[] is part of the
    // adaptive run, regardless of topic.enabled. Without levels[] the topic
    // is not valid for inclusion.
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            enabled: false,
            topicId: "topic-1",
            topicName: "Topic One",
            failureFeedback: null,
            levels: [],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "adaptive_section_no_levels",
        severity: "error",
      }),
    );
  });

  it("sad path — adaptive topic with exactly one level produces missing_levels warning", () => {
    const model = baseModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            failureFeedback: null,
            levels: [
              {
                levelIndex: 0,
                levelName: "Level 1",
                minDifficulty: 0,
                maxDifficulty: 100,
                questionsCount: 1,
                passThreshold: 50,
                passThresholdType: "percent",
                feedback: null,
                links: [],
              },
            ],
          },
        ],
      },
    });
    const result = validateTestEditor(model);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "missing_levels", severity: "warning" }),
    );
    expect(result.errors.filter((e) => e.code === "missing_levels")).toHaveLength(0);
  });

  it("standard mode — no missing_levels warning even with empty adaptive.topics", () => {
    const model = baseModel({ mode: "standard" });
    const result = validateTestEditor(model);
    expect(result.warnings.filter((w) => w.code === "missing_levels")).toHaveLength(0);
  });
});

// ─── PRD-4 v1.1: (adaptive, linear_flat) is blocked at validation level ──────

describe("PRD-4 v1.1: adaptive + linear_flat blocked (deferred to future PRD)", () => {
  it("error fires when mode=adaptive AND flowMode=linear_flat", () => {
    const model = baseModel({
      mode: "adaptive",
      flowMode: "linear_flat",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            enabled: true,
            topicId: "topic-1",
            topicName: "Topic One",
            failureFeedback: null,
            levels: [
              {
                levelIndex: 0,
                levelName: "Базовый",
                minDifficulty: 0,
                maxDifficulty: 33,
                questionsCount: 5,
                passThreshold: 70,
                passThresholdType: "percent",
                links: [],
              },
              {
                levelIndex: 1,
                levelName: "Средний",
                minDifficulty: 34,
                maxDifficulty: 66,
                questionsCount: 5,
                passThreshold: 70,
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
        code: "adaptive_flat_unsupported",
        field: "flowMode",
        severity: "error",
      }),
    );
  });

  it("no error for the other 5 valid combinations", () => {
    const baseAdaptive = {
      showDifficultyLevel: false,
      testSettings: { showDifficultyLevel: false },
      topics: [
        {
          enabled: true,
          topicId: "topic-1",
          topicName: "Topic One",
          failureFeedback: null,
          levels: [
            {
              levelIndex: 0,
              levelName: "Базовый",
              minDifficulty: 0,
              maxDifficulty: 50,
              questionsCount: 5,
              passThreshold: 70,
              passThresholdType: "percent" as const,
              links: [],
            },
            {
              levelIndex: 1,
              levelName: "Средний",
              minDifficulty: 51,
              maxDifficulty: 100,
              questionsCount: 5,
              passThreshold: 70,
              passThresholdType: "percent" as const,
              links: [],
            },
          ],
        },
      ],
    };
    const validCombos: Array<{ mode: "standard" | "adaptive"; flowMode: TestEditorModel["flowMode"] }> = [
      { mode: "standard", flowMode: "linear_flat" },
      { mode: "standard", flowMode: "linear_by_topics" },
      { mode: "standard", flowMode: "router_by_topics" },
      { mode: "adaptive", flowMode: "linear_by_topics" },
      { mode: "adaptive", flowMode: "router_by_topics" },
    ];
    for (const combo of validCombos) {
      const model = baseModel({
        ...combo,
        adaptive: combo.mode === "adaptive" ? baseAdaptive : {
          showDifficultyLevel: false,
          testSettings: { showDifficultyLevel: false },
          topics: [],
        },
      });
      const result = validateTestEditor(model);
      expect(
        result.errors.filter((e) => e.code === "adaptive_flat_unsupported"),
      ).toHaveLength(0);
    }
  });
});

// ─── PRD-17 (BR-12): variants validation ──────────────────────────────────────

describe("PRD-17: variants mode validation", () => {
  const baseSection = baseModel().sections[0];
  const withForms = (forms: Array<{ id: string; label: string; questionIds: string[] }>) =>
    baseModel({ sections: [{ ...baseSection, formSet: { forms } }] });
  const variantErrors = (m: ReturnType<typeof baseModel>) =>
    validateTestEditor(m).errors.filter((e) => e.field === "sections[0].formSetJson");

  it("fewer than 2 variants → section error", () => {
    expect(variantErrors(withForms([{ id: "v1", label: "Вариант 1", questionIds: ["q1"] }]))).toHaveLength(1);
  });

  it("a variant with no questions → section error", () => {
    const errs = variantErrors(
      withForms([
        { id: "v1", label: "Вариант 1", questionIds: ["q1"] },
        { id: "v2", label: "Вариант 2", questionIds: [] },
      ]),
    );
    expect(errs).toHaveLength(1);
  });

  it("≥2 non-empty variants pass", () => {
    expect(
      variantErrors(
        withForms([
          { id: "v1", label: "Вариант 1", questionIds: ["q1"] },
          { id: "v2", label: "Вариант 2", questionIds: ["q2"] },
        ]),
      ),
    ).toHaveLength(0);
  });

  it("variants mode skips the drawCount range check (control is hidden)", () => {
    // drawCount 99 > maxQuestions 10 would normally error, but variants hide it.
    const model = baseModel({
      sections: [
        {
          ...baseSection,
          drawCount: 99,
          formSet: {
            forms: [
              { id: "v1", label: "Вариант 1", questionIds: ["q1"] },
              { id: "v2", label: "Вариант 2", questionIds: ["q2"] },
            ],
          },
        },
      ],
    });
    expect(validateTestEditor(model).errors.filter((e) => e.field === "sections[0].drawCount")).toHaveLength(0);
  });

  it("adaptive ignores variants (not validated)", () => {
    const model = baseModel({
      mode: "adaptive",
      sections: [{ ...baseSection, formSet: { forms: [{ id: "v1", label: "Вариант 1", questionIds: [] }] } }],
    });
    expect(validateTestEditor(model).errors.filter((e) => e.field === "sections[0].formSetJson")).toHaveLength(0);
  });
});

// ─── PRD-24: per-variant pass thresholds ─────────────────────────────────────

describe("PRD-24: by_variant topic pass rule", () => {
  const baseSection = baseModel().sections[0];
  const forms = [
    { id: "v1", label: "Вариант 1", questionIds: ["q1", "q2"] },
    { id: "v2", label: "Вариант 2", questionIds: ["q3"] },
  ];
  /** Model with a variants topic + a by_variant rule, plus optional scoring overrides. */
  const withRule = (
    byForm: Record<string, { type: "percent" | "absolute"; value: number }>,
    opts: { formSet?: boolean; overrides?: Array<{ questionId: string; points: number }> } = {},
  ) =>
    baseModel({
      sections: [{ ...baseSection, ...(opts.formSet === false ? {} : { formSet: { forms } }) }],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 60 },
        byTopic: { [baseSection.topicId]: { source: "by_variant", byForm } },
      },
      scoring: {
        defaultQuestionPoints: null,
        questionOverrides: (opts.overrides ?? []).map((o) => ({
          questionId: o.questionId,
          points: o.points,
          scoringJson: null,
          difficulty: null,
          pinnedContentHash: null,
        })),
      },
    } as never);
  const ruleErrors = (m: ReturnType<typeof baseModel>) =>
    validateTestEditor(m).errors.filter((e) => e.field.startsWith(`passRules.byTopic[${baseSection.topicId}]`));

  it("happy path — every variant covered, values in range", () => {
    expect(ruleErrors(withRule({ v1: { type: "percent", value: 60 }, v2: { type: "absolute", value: 1 } }))).toHaveLength(0);
  });

  it("is rejected for a topic that is not in variants mode (FR-02)", () => {
    const errs = ruleErrors(withRule({ v1: { type: "percent", value: 60 } }, { formSet: false }));
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("forbidden_combination");
  });

  it("requires a threshold for EVERY variant, else the topic would silently ungate", () => {
    const errs = ruleErrors(withRule({ v1: { type: "percent", value: 60 } }));
    expect(errs).toHaveLength(1);
    expect(errs[0].field).toContain("v2");
  });

  it("rejects a threshold pointing at a variant that no longer exists", () => {
    const errs = ruleErrors(withRule({
      v1: { type: "percent", value: 60 },
      v2: { type: "percent", value: 60 },
      gone: { type: "percent", value: 60 },
    }));
    expect(errs).toHaveLength(1);
    expect(errs[0].field).toContain("gone");
  });

  it("keeps a percent threshold within 0..100", () => {
    expect(ruleErrors(withRule({ v1: { type: "percent", value: 101 }, v2: { type: "percent", value: 60 } }))).toHaveLength(1);
    expect(ruleErrors(withRule({ v1: { type: "percent", value: -1 }, v2: { type: "percent", value: 60 } }))).toHaveLength(1);
  });

  // The cap is Σ EFFECTIVE prices of THAT variant, not its question count: with a
  // 5-point override on q1, variant v1 (q1+q2) can attain 6, so 6 is valid and 7 is not.
  // A count-based cap would have wrongly rejected 6.
  it("caps an absolute threshold by the variant's attainable POINTS", () => {
    const overrides = [{ questionId: "q1", points: 5 }];
    expect(ruleErrors(withRule({ v1: { type: "absolute", value: 6 }, v2: { type: "absolute", value: 1 } }, { overrides }))).toHaveLength(0);
    const errs = ruleErrors(withRule({ v1: { type: "absolute", value: 7 }, v2: { type: "absolute", value: 1 } }, { overrides }));
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("range");
  });
});
