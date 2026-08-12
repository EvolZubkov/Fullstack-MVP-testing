/**
 * @module features/tests/editor/__tests__/test-editor.mappers.branches.test
 * @description Branch-focused unit tests for `test-editor.mappers`. Complements
 * the reference suite (`test-editor.mappers.test.ts`) by driving each mapper's
 * conditional branches directly: valid vs default vs malformed inputs for every
 * enum guard, `??`/`||` fallback, `if/else` and `switch`. Pure input -> output
 * assertions; no React, no rendering.
 */
import { describe, expect, it } from "vitest";
import {
  apiToEditorModel,
  defaultRetakePolicy,
  editorModelToPayload,
  emptyEditorModel,
  mapApiAdaptiveTopicsToEditor,
  mapApiRouterFlowToEditor,
  mapApiSectionsToEditor,
  mapEditorAdaptiveToPayload,
  mapEditorRouterFlowToPayload,
  mapEditorSectionsToPayload,
} from "../test-editor.mappers";
import type { EditorSection, TestEditorModel } from "../test-editor.types";

// ─── Model builders (for the write path) ──────────────────────────────────────

/** A complete, valid editor model; override any slice for a specific branch. */
function makeModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    id: "test-1",
    version: 3,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: { linear: {} },
    folderId: null,
    basic: {
      title: "Тест",
      description: "",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: false,
      allowReturnToUnanswered: true,
      allowAnswerChange: false,
      showSectionResults: true,
      skipReviewWhenComplete: false,
      quickAdvance: false,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...overrides,
  } as TestEditorModel;
}

/** A complete editor section; override for a specific branch. */
function makeSection(overrides: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "t1",
    topicName: "T1",
    maxQuestions: 10,
    drawCount: 5,
    drawAll: false,
    required: true,
    timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
    ...overrides,
  } as EditorSection;
}

// ─── apiToEditorModel: top-level guard ────────────────────────────────────────

describe("apiToEditorModel — input guard", () => {
  it("throws TypeError for non-object inputs (array/number/null/string)", () => {
    expect(() => apiToEditorModel([])).toThrow(TypeError);
    expect(() => apiToEditorModel(42)).toThrow(/expected an object/);
    expect(() => apiToEditorModel(null)).toThrow(TypeError);
    expect(() => apiToEditorModel("nope")).toThrow(TypeError);
  });
});

// ─── readStatusFromApi ────────────────────────────────────────────────────────

describe("readStatusFromApi — status precedence", () => {
  it("uses an explicit valid status verbatim", () => {
    expect(apiToEditorModel({ status: "published" }).basic.status).toBe("published");
    expect(apiToEditorModel({ status: "archived" }).basic.status).toBe("archived");
  });

  it("ignores an invalid status and falls to the published flag", () => {
    expect(apiToEditorModel({ status: "weird", published: true }).basic.status).toBe("published");
  });

  it("defaults to draft when status invalid and published not true", () => {
    expect(apiToEditorModel({ status: "weird", published: false }).basic.status).toBe("draft");
    expect(apiToEditorModel({}).basic.status).toBe("draft");
  });
});

// ─── mode + flowMode + flow settings ──────────────────────────────────────────

describe("apiToEditorModel — mode / flowMode / flowSettings", () => {
  it("keeps a valid mode and coerces an invalid one to standard", () => {
    expect(apiToEditorModel({ mode: "adaptive", sections: [] }).mode).toBe("adaptive");
    expect(apiToEditorModel({ mode: "nonsense" }).mode).toBe("standard");
    expect(apiToEditorModel({}).mode).toBe("standard");
  });

  it("reads flowMode from a valid flow_policy_json.mode", () => {
    expect(apiToEditorModel({ flowPolicyJson: { mode: "router_by_topics" } }).flowMode).toBe(
      "router_by_topics",
    );
    expect(apiToEditorModel({ flowPolicyJson: { mode: "linear_by_topics" } }).flowMode).toBe(
      "linear_by_topics",
    );
  });

  it("defaults flowMode to linear_flat for invalid/absent flow policy", () => {
    expect(apiToEditorModel({ flowPolicyJson: { mode: "bogus" } }).flowMode).toBe("linear_flat");
    expect(apiToEditorModel({ flowPolicyJson: "not-object" }).flowMode).toBe("linear_flat");
    expect(apiToEditorModel({}).flowMode).toBe("linear_flat");
  });

  it("builds linear flow settings for linear modes and router settings for router mode", () => {
    expect(apiToEditorModel({ flowPolicyJson: { mode: "linear_by_topics" } }).flowSettings).toEqual({
      linear: {},
    });
    const routerModel = apiToEditorModel({
      mode: "standard",
      flowPolicyJson: { mode: "router_by_topics", router: { completionPolicy: "all_required_passed" } },
    });
    expect(routerModel.flowSettings.router).toBeDefined();
    expect(routerModel.flowSettings.router?.completionPolicy).toBe("all_required_passed");
  });
});

// ─── readOverallPassRuleFromApi ───────────────────────────────────────────────

describe("readOverallPassRuleFromApi — pass rule normalization", () => {
  it("forces value to 0 for type none", () => {
    expect(apiToEditorModel({ overallPassRuleJson: { type: "none", value: 55 } }).passRules.overall).toEqual(
      { type: "none", value: 0 },
    );
  });

  it("keeps a numeric value for percent/absolute", () => {
    expect(apiToEditorModel({ overallPassRuleJson: { type: "absolute", value: 12 } }).passRules.overall).toEqual(
      { type: "absolute", value: 12 },
    );
  });

  it("coerces a non-numeric value to 0", () => {
    expect(apiToEditorModel({ overallPassRuleJson: { type: "percent", value: "x" } }).passRules.overall).toEqual(
      { type: "percent", value: 0 },
    );
  });

  it("falls back to percent/70 for an invalid type or non-object", () => {
    expect(apiToEditorModel({ overallPassRuleJson: { type: "bad", value: 5 } }).passRules.overall).toEqual({
      type: "percent",
      value: 70,
    });
    expect(apiToEditorModel({ overallPassRuleJson: 123 }).passRules.overall).toEqual({
      type: "percent",
      value: 70,
    });
    expect(apiToEditorModel({}).passRules.overall).toEqual({ type: "percent", value: 70 });
  });
});

// ─── readPassDecisionPolicyFromApi ────────────────────────────────────────────

describe("readPassDecisionPolicyFromApi — decision policy derivation", () => {
  it("uses an explicit valid policy verbatim", () => {
    expect(
      apiToEditorModel({ passDecisionPolicy: "required_topics_only" }).passRules.decisionPolicy,
    ).toBe("required_topics_only");
    expect(
      apiToEditorModel({ passDecisionPolicy: "all_topics_passed" }).passRules.decisionPolicy,
    ).toBe("all_topics_passed");
  });

  it("derives overall_only when byTopic is empty", () => {
    expect(apiToEditorModel({ sections: [] }).passRules.decisionPolicy).toBe("overall_only");
  });

  it("derives overall_only when every topic rule inherits", () => {
    const model = apiToEditorModel({
      sections: [
        { topicId: "a", topicName: "A", maxQuestions: 3, topicPassRuleJson: { source: "inherit_overall" } },
        { topicId: "b", topicName: "B", maxQuestions: 3 },
      ],
    });
    expect(model.passRules.decisionPolicy).toBe("overall_only");
  });

  it("derives overall_and_required_topics when any topic rule is custom or none", () => {
    const model = apiToEditorModel({
      sections: [
        { topicId: "a", topicName: "A", maxQuestions: 3, topicPassRuleJson: { source: "none" } },
        { topicId: "b", topicName: "B", maxQuestions: 3 },
      ],
    });
    expect(model.passRules.decisionPolicy).toBe("overall_and_required_topics");
  });
});

// ─── readTopicPassRuleFromApi (via sections + byTopic) ─────────────────────────

describe("readTopicPassRuleFromApi — per-topic pass rule", () => {
  const ruleFor = (topicPassRuleJson: unknown) =>
    apiToEditorModel({
      sections: [{ topicId: "t", topicName: "T", maxQuestions: 5, topicPassRuleJson }],
    }).passRules.byTopic["t"];

  it("maps inherit_overall / none", () => {
    expect(ruleFor({ source: "inherit_overall" })).toEqual({ source: "inherit_overall" });
    expect(ruleFor({ source: "none" })).toEqual({ source: "none" });
  });

  it("maps a custom percent rule and defaults its value to 0 when non-numeric", () => {
    expect(ruleFor({ source: "custom", type: "percent", value: 65 })).toEqual({
      source: "custom",
      type: "percent",
      value: 65,
    });
    expect(ruleFor({ source: "custom", type: "absolute", value: "nan" })).toEqual({
      source: "custom",
      type: "absolute",
      value: 0,
    });
  });

  it("defaults to inherit_overall for a custom rule with a bad type", () => {
    expect(ruleFor({ source: "custom", type: "letters", value: 1 })).toEqual({ source: "inherit_overall" });
  });

  it("defaults to inherit_overall for an unknown source or a non-object", () => {
    expect(ruleFor({ source: "??" })).toEqual({ source: "inherit_overall" });
    expect(ruleFor("nope")).toEqual({ source: "inherit_overall" });
    expect(ruleFor(undefined)).toEqual({ source: "inherit_overall" });
  });
});

// ─── buildSectionsFromApi (via mapApiSectionsToEditor) ────────────────────────

describe("mapApiSectionsToEditor — section field defaults", () => {
  it("returns [] when sections is absent, not an array, or empty", () => {
    expect(mapApiSectionsToEditor({})).toEqual([]);
    expect(mapApiSectionsToEditor({ sections: "x" as unknown as unknown[] })).toEqual([]);
    expect(mapApiSectionsToEditor({ sections: [] })).toEqual([]);
  });

  it("skips non-object section entries", () => {
    const out = mapApiSectionsToEditor({ sections: ["bad", 5, null, { topicId: "ok", maxQuestions: 2 }] });
    expect(out).toHaveLength(1);
    expect(out[0].topicId).toBe("ok");
  });

  it("applies every field default for a bare section", () => {
    const [s] = mapApiSectionsToEditor({ sections: [{ topicId: "t", topicName: "T", maxQuestions: 7 }] });
    expect(s.topicCode).toBeNull();
    expect(s.maxPoints).toBe(7); // falls back to maxQuestions
    expect(s.drawCount).toBe(1);
    expect(s.drawAll).toBe(false);
    expect(s.required).toBe(true);
    expect(s.timeLimit).toEqual({ source: "inherit_test" });
    expect(s.defaultPoints).toBeNull();
    expect(s.feedback).toEqual({ format: "plain", text: "" });
  });

  it("reads explicit values for every optional field", () => {
    const [s] = mapApiSectionsToEditor({
      sections: [
        {
          topicId: "t",
          topicName: "T",
          topicCode: "MATH",
          maxQuestions: 7,
          maxPoints: 20,
          drawCount: 4,
          drawAll: true,
          required: false,
          timeLimitMinutes: 15,
          defaultPoints: 3,
        },
      ],
    });
    expect(s.topicCode).toBe("MATH");
    expect(s.maxPoints).toBe(20);
    expect(s.drawCount).toBe(4);
    expect(s.drawAll).toBe(true);
    expect(s.required).toBe(false);
    expect(s.timeLimit).toEqual({ source: "custom", minutes: 15 });
    expect(s.defaultPoints).toBe(3);
  });

  it("treats a non-positive/absent timeLimitMinutes as inherit_test", () => {
    const [zero] = mapApiSectionsToEditor({ sections: [{ topicId: "a", maxQuestions: 1, timeLimitMinutes: 0 }] });
    const [neg] = mapApiSectionsToEditor({ sections: [{ topicId: "b", maxQuestions: 1, timeLimitMinutes: -3 }] });
    expect(zero.timeLimit).toEqual({ source: "inherit_test" });
    expect(neg.timeLimit).toEqual({ source: "inherit_test" });
  });

  it("does not register a byTopic rule for a section with an empty topicId", () => {
    const model = apiToEditorModel({ sections: [{ topicName: "no id", maxQuestions: 1 }] });
    expect(model.sections[0].topicId).toBe("");
    expect(Object.keys(model.passRules.byTopic)).toHaveLength(0);
  });
});

// ─── readDrawBlueprintFromApi (mode branch) ───────────────────────────────────

describe("readDrawBlueprintFromApi — per-tag draw modes", () => {
  const bp = (drawBlueprintJson: unknown) =>
    mapApiSectionsToEditor({ sections: [{ topicId: "t", maxQuestions: 5, drawBlueprintJson }] })[0].drawBlueprint;

  it("keeps min/exact modes and drops the mode key when it is absent/invalid", () => {
    expect(
      bp({
        strata: [
          { tag: "A", count: 2, mode: "min" },
          { tag: "B", count: 1, mode: "exact" },
          { tag: "C", count: 3 }, // no mode → bare {tag,count}
          { tag: "D", count: 1, mode: "weird" }, // invalid → dropped mode
        ],
      }),
    ).toEqual({
      strata: [
        { tag: "A", count: 2, mode: "min" },
        { tag: "B", count: 1, mode: "exact" },
        { tag: "C", count: 3 },
        { tag: "D", count: 1 },
      ],
    });
  });

  it("returns null for a non-object, a missing strata array, or all-invalid strata", () => {
    expect(bp("x")).toBeNull();
    expect(bp({ strata: "not-array" })).toBeNull();
    expect(bp({ strata: [{ tag: "", count: 2 }, { tag: "x", count: 0 }, "junk"] })).toBeNull();
  });
});

// ─── readFormSetFromApi ───────────────────────────────────────────────────────

describe("readFormSetFromApi — fixed-variant set", () => {
  const fs = (formSetJson: unknown) =>
    mapApiSectionsToEditor({ sections: [{ topicId: "t", maxQuestions: 5, formSetJson }] })[0].formSet;

  it("returns null for null and for a schema-invalid blob", () => {
    expect(fs(null)).toBeNull();
    expect(fs({ forms: "nope" })).toBeNull();
  });

  it("parses a valid multi-form set", () => {
    const valid = {
      forms: [
        { id: "v1", label: "Вариант 1", questionIds: ["q1", "q2"] },
        { id: "v2", label: "Вариант 2", questionIds: ["q3"] },
      ],
    };
    expect(fs(valid)).toEqual(valid);
  });
});

// ─── buildAdaptiveFromApi (via mapApiAdaptiveTopicsToEditor) ───────────────────

describe("mapApiAdaptiveTopicsToEditor — adaptive defaults and malformed skips", () => {
  it("returns [] when adaptiveSettings is not an array", () => {
    expect(mapApiAdaptiveTopicsToEditor({})).toEqual([]);
    expect(mapApiAdaptiveTopicsToEditor({ adaptiveSettings: "x" })).toEqual([]);
  });

  it("skips non-object topics, non-object levels and non-object links", () => {
    const out = mapApiAdaptiveTopicsToEditor({
      adaptiveSettings: [
        "bad",
        { topicId: "t", topicName: "T", levels: ["nope", { levelName: "L", links: ["x", { url: "u" }] }] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].levels).toHaveLength(1);
    expect(out[0].levels[0].links).toHaveLength(1);
    expect(out[0].levels[0].links[0]).toEqual({ id: undefined, title: "", url: "u" });
  });

  it("applies level defaults for missing numeric/enum fields", () => {
    const out = mapApiAdaptiveTopicsToEditor({
      adaptiveSettings: [{ topicId: "t", topicName: "T", levels: [{}] }],
    });
    const level = out[0].levels[0];
    expect(level.id).toBeUndefined();
    expect(level.levelIndex).toBe(0);
    expect(level.levelName).toBe("");
    expect(level.minDifficulty).toBe(0);
    expect(level.maxDifficulty).toBe(100);
    expect(level.questionsCount).toBe(1);
    expect(level.passThreshold).toBe(0);
    expect(level.passThresholdType).toBe("percent"); // non-"absolute" → percent
    expect(level.feedback).toBeNull();
    expect(level.links).toEqual([]);
  });

  it("honours passThresholdType absolute and topic-level defaults", () => {
    const out = mapApiAdaptiveTopicsToEditor({
      adaptiveSettings: [{ levels: [{ passThresholdType: "absolute" }] }],
    });
    expect(out[0].topicId).toBe("");
    expect(out[0].topicName).toBe("");
    expect(out[0].failureFeedback).toBeNull();
    expect(out[0].enabled).toBe(true);
    expect(out[0].levels[0].passThresholdType).toBe("absolute");
  });

  it("treats a non-array levels field as no levels", () => {
    const out = mapApiAdaptiveTopicsToEditor({ adaptiveSettings: [{ topicId: "t", levels: "x" }] });
    expect(out[0].levels).toEqual([]);
  });
});

// ─── buildRouterFlowFromApi + readSectionUnlockRuleFromApi ────────────────────

describe("mapApiRouterFlowToEditor — router flow settings", () => {
  it("defaults completionPolicy and empty rules when flow policy is absent", () => {
    expect(mapApiRouterFlowToEditor({})).toEqual({
      completionPolicy: "all_required_completed",
      sectionUnlockRules: {},
    });
  });

  it("keeps a valid completionPolicy and defaults an invalid one", () => {
    expect(
      mapApiRouterFlowToEditor({ flowPolicyJson: { router: { completionPolicy: "all_required_passed" } } })
        .completionPolicy,
    ).toBe("all_required_passed");
    expect(
      mapApiRouterFlowToEditor({ flowPolicyJson: { router: { completionPolicy: "bogus" } } }).completionPolicy,
    ).toBe("all_required_completed");
  });

  it("defaults when router or flowPolicyJson is not a plain object", () => {
    expect(mapApiRouterFlowToEditor({ flowPolicyJson: { router: "x" } }).completionPolicy).toBe(
      "all_required_completed",
    );
    expect(mapApiRouterFlowToEditor({ flowPolicyJson: "x" }).completionPolicy).toBe(
      "all_required_completed",
    );
  });

  it("maps each unlock-rule mode and filters non-string sectionIds", () => {
    const rules = mapApiRouterFlowToEditor({
      flowPolicyJson: {
        router: {
          sectionUnlockRules: {
            a: { mode: "always_available" },
            b: { mode: "after_sections_completed", sectionIds: ["s1", 2, "s2", null] },
            c: { mode: "after_sections_passed", sectionIds: "not-array" },
            d: { mode: "unknown-mode" },
            e: "not-an-object",
          },
        },
      },
    }).sectionUnlockRules;

    expect(rules.a).toEqual({ mode: "always_available" });
    expect(rules.b).toEqual({ mode: "after_sections_completed", sectionIds: ["s1", "s2"] });
    expect(rules.c).toEqual({ mode: "after_sections_passed", sectionIds: [] });
    expect(rules.d).toEqual({ mode: "always_available" });
    expect(rules.e).toBeUndefined(); // non-object rawRule skipped
  });
});

// ─── runtime + top-level field defaults ───────────────────────────────────────

describe("apiToEditorModel — runtime and scalar defaults", () => {
  it("uses conservative defaults when runtime fields are absent", () => {
    const m = apiToEditorModel({});
    expect(m.runtime.timeLimitMinutes).toBeNull();
    expect(m.runtime.maxAttempts).toBeNull();
    expect(m.runtime.showCorrectAnswers).toBe(false);
    expect(m.runtime.allowReturnToUnanswered).toBe(false); // legacy load → OFF
    expect(m.runtime.allowAnswerChange).toBe(false);
    expect(m.runtime.showSectionResults).toBe(true);
    expect(m.id).toBeUndefined();
    expect(m.version).toBe(1);
    expect(m.folderId).toBeNull();
    expect(m.basic.title).toBe("");
    expect(m.basic.telemetryEnabled).toBe(false);
    expect(m.adaptive.showDifficultyLevel).toBe(true);
  });

  it("reads explicit runtime and scalar fields", () => {
    const m = apiToEditorModel({
      id: "abc",
      version: 9,
      folderId: "folder-1",
      title: "T",
      description: "D",
      webhookUrl: "https://hook",
      telemetryEnabled: true,
      timeLimitMinutes: 30,
      maxAttempts: 4,
      showCorrectAnswers: true,
      allowReturnToUnanswered: true,
      allowAnswerChange: true,
      showSectionResults: false,
      skipReviewWhenComplete: false,
      quickAdvance: false,
      showDifficultyLevel: false,
    });
    expect(m.id).toBe("abc");
    expect(m.version).toBe(9);
    expect(m.folderId).toBe("folder-1");
    expect(m.basic.description).toBe("D");
    expect(m.basic.webhookUrl).toBe("https://hook");
    expect(m.basic.telemetryEnabled).toBe(true);
    expect(m.runtime.timeLimitMinutes).toBe(30);
    expect(m.runtime.maxAttempts).toBe(4);
    expect(m.runtime.showCorrectAnswers).toBe(true);
    expect(m.runtime.allowReturnToUnanswered).toBe(true);
    expect(m.runtime.allowAnswerChange).toBe(true);
    expect(m.runtime.showSectionResults).toBe(false);
    expect(m.adaptive.showDifficultyLevel).toBe(false);
  });

  it("coerces non-string id/folderId and non-number version to their defaults", () => {
    const m = apiToEditorModel({ id: 5, folderId: 7, version: "x" });
    expect(m.id).toBeUndefined();
    expect(m.folderId).toBeNull();
    expect(m.version).toBe(1);
  });
});

// ─── readFeedbackFromApi / parseFeedbackObject ────────────────────────────────

describe("readFeedbackFromApi — feedback shapes", () => {
  it("reads a rich feedbackJson with links/assets/events", () => {
    const m = apiToEditorModel({
      feedbackJson: {
        format: "html",
        text: "<p>Hi</p>",
        links: [{ title: "L", url: "u" }],
        assets: [{ id: "a1" }],
        events: [{ type: "x" }],
      },
    });
    expect(m.basic.feedback).toEqual({ format: "html", text: "<p>Hi</p>" });
    expect(m.basic.feedbackLinks).toHaveLength(1);
    expect(m.basic.feedbackAssets).toHaveLength(1);
    expect(m.basic.feedbackEvents).toHaveLength(1);
  });

  it("defaults format to plain and empties collections for a malformed feedbackJson", () => {
    const m = apiToEditorModel({ feedbackJson: { format: 99, text: 5, links: "x", assets: 1, events: null } });
    expect(m.basic.feedback).toEqual({ format: "plain", text: "" });
    expect(m.basic.feedbackLinks).toEqual([]);
    expect(m.basic.feedbackAssets).toEqual([]);
    expect(m.basic.feedbackEvents).toEqual([]);
  });

  it("falls back to legacy string feedback and to empty when neither is present", () => {
    expect(apiToEditorModel({ feedback: "legacy" }).basic.feedback).toEqual({
      format: "plain",
      text: "legacy",
    });
    expect(apiToEditorModel({ feedback: 123 }).basic.feedback).toEqual({ format: "plain", text: "" });
    expect(apiToEditorModel({}).basic.feedback).toEqual({ format: "plain", text: "" });
  });
});

// ─── buildResultVariablesFromApi ──────────────────────────────────────────────

describe("apiToEditorModel — result variables", () => {
  it("returns [] when resultVariables is not an array and skips non-object rows", () => {
    expect(apiToEditorModel({}).resultVariables).toEqual([]);
    expect(apiToEditorModel({ resultVariables: "x" }).resultVariables).toEqual([]);
    expect(apiToEditorModel({ resultVariables: ["bad", 3] }).resultVariables).toEqual([]);
  });

  it("maps a full row and applies enum/field defaults for a bare row, ordered by sortOrder", () => {
    const out = apiToEditorModel({
      resultVariables: [
        {
          id: "rv2",
          name: "b",
          label: "B",
          type: "string",
          formula: "1+1",
          learnerVisibility: "level_and_value",
          scormTarget: "interaction",
          controlsStatus: "success",
          sortOrder: 2,
        },
        { badType: true, type: "??", scormTarget: "??", controlsStatus: "??", sortOrder: 0 },
      ],
    }).resultVariables;

    expect(out.map((r) => r.sortOrder)).toEqual([0, 2]); // sorted
    const bare = out[0];
    expect(bare.id).toBeUndefined();
    expect(bare.name).toBe("");
    expect(bare.label).toBe("");
    expect(bare.type).toBe("number"); // invalid → default
    expect(bare.formula).toBe("");
    expect(bare.learnerVisibility).toBe("hidden"); // absent → hidden
    expect(bare.scormTarget).toBe("both"); // invalid → default
    expect(bare.controlsStatus).toBe("none"); // invalid → default

    const full = out[1];
    expect(full.type).toBe("string");
    expect(full.scormTarget).toBe("interaction");
    expect(full.controlsStatus).toBe("success");
    expect(full.learnerVisibility).toBe("level_and_value");
  });

  it("falls back sortOrder to the row index when absent", () => {
    const out = apiToEditorModel({
      resultVariables: [{ name: "x" }, { name: "y" }],
    }).resultVariables;
    expect(out.map((r) => r.sortOrder)).toEqual([0, 1]);
  });
});

// ─── buildScalesFromApi + buildScaleBands ─────────────────────────────────────

describe("apiToEditorModel — scales and bands", () => {
  it("returns [] for a non-array scales field and skips non-object rows", () => {
    expect(apiToEditorModel({}).scales).toEqual([]);
    expect(apiToEditorModel({ scales: "x" }).scales).toEqual([]);
    expect(apiToEditorModel({ scales: [42] }).scales).toEqual([]);
  });

  it("maps a full scale, defaults invalid enums, and reads bands from config_json", () => {
    const [scale] = apiToEditorModel({
      scales: [
        {
          id: "s1",
          key: "attention",
          label: "Внимание",
          type: "category",
          aggregation: "avg",
          normalization: "percent",
          direction: "inverse",
          learnerVisibility: "level_and_value",
          scormTarget: "both",
          sortOrder: 0,
          configJson: {
            bands: [
              { min: 0, max: 10, label: "Low", level: "low" }, // numeric min/max → stringified
              { min: "11", max: "20", label: 5, level: 9 }, // string min/max; bad label/level → ""
              "not-a-band",
            ],
          },
        },
      ],
    }).scales;

    expect(scale.type).toBe("category");
    expect(scale.aggregation).toBe("avg");
    expect(scale.normalization).toBe("percent");
    expect(scale.direction).toBe("inverse");
    expect(scale.learnerVisibility).toBe("level_and_value");
    expect(scale.bands).toEqual([
      { min: "0", max: "10", label: "Low", level: "low", text: "", tone: "" },
      { min: "11", max: "20", label: "", level: "", text: "", tone: "" },
    ]);
  });

  it("defaults invalid scale enums and empty bands, and sorts by sortOrder", () => {
    const scales = apiToEditorModel({
      scales: [
        { key: "b", type: "??", aggregation: "??", normalization: "??", direction: "??", scormTarget: "??", sortOrder: 1 },
        { key: "a", sortOrder: 0, configJson: "not-object" },
      ],
    }).scales;

    expect(scales.map((s) => s.key)).toEqual(["a", "b"]); // sorted by sortOrder
    const bad = scales[1];
    expect(bad.type).toBe("number");
    expect(bad.aggregation).toBe("sum");
    expect(bad.normalization).toBe("none");
    expect(bad.direction).toBe("positive");
    expect(bad.scormTarget).toBe("none");
    expect(bad.learnerVisibility).toBe("hidden");
    expect(scales[0].bands).toEqual([]); // config_json not an object → no bands
  });
});

// ─── buildMeasurementsFromApi ─────────────────────────────────────────────────

describe("apiToEditorModel — measurements (scaleId → key resolution)", () => {
  const base = {
    scales: [{ id: "s1", key: "attention", type: "number", sortOrder: 0 }],
  };

  it("returns [] when measurements is not an array", () => {
    expect(apiToEditorModel({ ...base }).measurements).toEqual([]);
    expect(apiToEditorModel({ ...base, measurements: "x" }).measurements).toEqual([]);
  });

  it("resolves a valid measurement and applies sourceType/weight defaults", () => {
    const [m] = apiToEditorModel({
      ...base,
      measurements: [{ scaleId: "s1", questionId: "q1", valueJson: 5, sourceType: "??" }],
    }).measurements;
    expect(m.scaleKey).toBe("attention");
    expect(m.questionId).toBe("q1");
    expect(m.value).toBe(5);
    expect(m.sourceType).toBe("question"); // invalid → default
    expect(m.sourceKey).toBeNull();
    expect(m.weight).toBe(1); // absent → 1
  });

  it("reads a valid sourceType, sourceKey and weight", () => {
    const [m] = apiToEditorModel({
      ...base,
      measurements: [{ scaleId: "s1", questionId: "q1", valueJson: 2, sourceType: "option", sourceKey: "o3", weight: 4 }],
    }).measurements;
    expect(m.sourceType).toBe("option");
    expect(m.sourceKey).toBe("o3");
    expect(m.weight).toBe(4);
  });

  // Каждый вид источника из перечисления схемы обязан пережить загрузку. Пропуск
  // одного вида не падает, а молча превращается в `question`: матрица вкладов теряет
  // значения, а следующее сохранение переписывает строки чужим видом.
  it.each(["question", "option", "matching_pair", "ranking_position", "option_allocation"])(
    "сохраняет вид источника %s",
    (sourceType) => {
      const [m] = apiToEditorModel({
        ...base,
        measurements: [{ scaleId: "s1", questionId: "q1", valueJson: 1, sourceType, sourceKey: "0" }],
      }).measurements;
      expect(m.sourceType).toBe(sourceType);
    },
  );

  it("drops rows with unresolved scale, non-string scaleId/questionId, non-object, or non-number value", () => {
    const out = apiToEditorModel({
      ...base,
      measurements: [
        "not-object",
        { scaleId: "missing", questionId: "q1", valueJson: 1 }, // scale not in map
        { scaleId: 5, questionId: "q1", valueJson: 1 }, // scaleId not string
        { scaleId: "s1", questionId: 9, valueJson: 1 }, // questionId not string
        { scaleId: "s1", questionId: "q1", valueJson: "x" }, // value not number
      ],
    }).measurements;
    expect(out).toEqual([]);
  });
});

// ─── buildQuestionOverridesFromApi ────────────────────────────────────────────

describe("apiToEditorModel — question scoring overrides", () => {
  it("returns [] for a non-array and skips non-object rows / rows without a questionId", () => {
    expect(apiToEditorModel({}).scoring.questionOverrides).toEqual([]);
    expect(apiToEditorModel({ questionScoring: "x" }).scoring.questionOverrides).toEqual([]);
    expect(
      apiToEditorModel({ questionScoring: ["bad", { points: 1 }] }).scoring.questionOverrides,
    ).toEqual([]);
  });

  it("maps a full override and defaults every optional field for a bare one", () => {
    const out = apiToEditorModel({
      questionScoring: [
        {
          id: "ov1",
          testId: "test-1",
          questionId: "q1",
          points: 3,
          scoringJson: { mode: "graded" },
          difficulty: 42,
          pinnedContentHash: "hash-1",
        },
        { questionId: "q2", scoringJson: "not-object" },
      ],
    }).scoring.questionOverrides;

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "ov1",
      testId: "test-1",
      questionId: "q1",
      points: 3,
      scoringJson: { mode: "graded" },
      difficulty: 42,
      pinnedContentHash: "hash-1",
    });
    expect(out[1]).toEqual({
      id: "",
      testId: "",
      questionId: "q2",
      points: null,
      scoringJson: null, // invalid (non-object, non-null) → null
      difficulty: null,
      pinnedContentHash: null,
    });
  });

  it("preserves an explicit null scoringJson", () => {
    const [o] = apiToEditorModel({
      questionScoring: [{ questionId: "q1", scoringJson: null }],
    }).scoring.questionOverrides;
    expect(o.scoringJson).toBeNull();
  });
});

// ─── readRetakePolicyFromApi ──────────────────────────────────────────────────

describe("apiToEditorModel — retake policy", () => {
  it("returns the disabled default for an absent/non-object policy", () => {
    expect(apiToEditorModel({}).retakePolicy).toEqual(defaultRetakePolicy());
    expect(apiToEditorModel({ retakePolicyJson: "x" }).retakePolicy).toEqual(defaultRetakePolicy());
  });

  it("reads enabled + plugin (failClosed) + configId + blockedPageId", () => {
    const p = apiToEditorModel({
      retakePolicyJson: {
        enabled: true,
        cooldownPeriodDays: 40,
        blockedPageId: "page-9",
        eligibilityPlugin: { key: "wt", configId: "cfg-1", failPolicy: "failClosed" },
      },
    }).retakePolicy;
    expect(p.enabled).toBe(true);
    expect(p.cooldownPeriodDays).toBe(40);
    expect(p).toMatchObject({ blockedPageId: "page-9" });
    expect(p.eligibilityPlugin).toEqual({ key: "wt", configId: "cfg-1", failPolicy: "failClosed" });
  });

  it("defaults failPolicy to failOpen and omits configId when it is not a string", () => {
    const p = apiToEditorModel({
      retakePolicyJson: { enabled: true, eligibilityPlugin: { key: "wt", failPolicy: "??", configId: 5 } },
    }).retakePolicy;
    expect(p.eligibilityPlugin).toEqual({ key: "wt", failPolicy: "failOpen" });
  });

  it("nulls the plugin when eligibilityPlugin lacks a key or is not an object", () => {
    expect(
      apiToEditorModel({ retakePolicyJson: { enabled: true, eligibilityPlugin: { failPolicy: "failOpen" } } })
        .retakePolicy.eligibilityPlugin,
    ).toBeNull();
    expect(
      apiToEditorModel({ retakePolicyJson: { enabled: true, eligibilityPlugin: "x" } }).retakePolicy
        .eligibilityPlugin,
    ).toBeNull();
  });

  it("clamps cooldown low, uses the cooldownDays alias, and defaults to 30", () => {
    expect(
      apiToEditorModel({ retakePolicyJson: { enabled: false, cooldownPeriodDays: 0 } }).retakePolicy
        .cooldownPeriodDays,
    ).toBe(1); // clamped up to 1
    expect(
      apiToEditorModel({ retakePolicyJson: { enabled: true, cooldownDays: 7.6 } }).retakePolicy
        .cooldownPeriodDays,
    ).toBe(8); // alias + rounding
    expect(
      apiToEditorModel({ retakePolicyJson: { enabled: true } }).retakePolicy.cooldownPeriodDays,
    ).toBe(30); // neither field → 30
  });
});

// ─── editorModelToPayload (write path) ────────────────────────────────────────

describe("editorModelToPayload — flow policy branch", () => {
  it("emits {mode:linear_flat, router:null} for linear_flat", () => {
    const payload = editorModelToPayload(makeModel({ flowMode: "linear_flat" }));
    expect(payload.flowPolicyJson).toEqual({ mode: "linear_flat", router: null });
  });

  // Regression: switching an existing router test back to «Линейный» must send an
  // explicit policy. Omitting the key made PUT /api/tests/:id a no-op for the
  // column (undefined = "don't touch"), so the test stayed on router_by_topics.
  it("overwrites a router policy when the author switches back to linear_flat", () => {
    const routerModel = makeModel({
      flowMode: "router_by_topics",
      flowSettings: {
        router: {
          completionPolicy: "all_required_passed",
          sectionUnlockRules: { s1: { mode: "always_available" } },
        },
      },
    });
    const payload = editorModelToPayload({ ...routerModel, flowMode: "linear_flat" });
    expect(payload.flowPolicyJson).toEqual({ mode: "linear_flat", router: null });
  });

  it("emits {mode, router:null} for linear_by_topics", () => {
    const payload = editorModelToPayload(makeModel({ flowMode: "linear_by_topics" }));
    expect(payload.flowPolicyJson).toEqual({ mode: "linear_by_topics", router: null });
  });

  it("emits a router policy for router_by_topics with the model's router settings", () => {
    const payload = editorModelToPayload(
      makeModel({
        flowMode: "router_by_topics",
        flowSettings: {
          router: {
            completionPolicy: "all_required_passed",
            sectionUnlockRules: { s1: { mode: "always_available" } },
          },
        },
      }),
    );
    expect(payload.flowPolicyJson).toEqual({
      mode: "router_by_topics",
      router: {
        completionPolicy: "all_required_passed",
        sectionUnlockRules: { s1: { mode: "always_available" } },
      },
    });
  });

  it("uses the default router when router_by_topics has no router sub-object", () => {
    const payload = editorModelToPayload(makeModel({ flowMode: "router_by_topics", flowSettings: {} }));
    expect(payload.flowPolicyJson).toEqual({
      mode: "router_by_topics",
      router: { completionPolicy: "all_required_completed", sectionUnlockRules: {} },
    });
  });
});

describe("editorModelToPayload — scalar fields, normalization and scoring", () => {
  it("normalizes empty description/webhookUrl to null and keeps non-empty verbatim", () => {
    const empty = editorModelToPayload(makeModel());
    expect(empty.description).toBeNull();
    expect(empty.webhookUrl).toBeNull();

    const filled = editorModelToPayload(
      makeModel({
        basic: { ...makeModel().basic, description: "desc", webhookUrl: "https://hook" },
      }),
    );
    expect(filled.description).toBe("desc");
    expect(filled.webhookUrl).toBe("https://hook");
  });

  it("strips scormHref from feedback assets", () => {
    const payload = editorModelToPayload(
      makeModel({
        basic: {
          ...makeModel().basic,
          feedbackAssets: [
            { id: "a1", title: "T", fileName: "f.pdf", mimeType: "application/pdf", scormHref: "feedback/f.pdf" },
          ],
        },
      }),
    );
    expect(payload.feedbackJson.assets[0]).not.toHaveProperty("scormHref");
    expect(payload.feedbackJson.assets[0]).toMatchObject({ id: "a1", fileName: "f.pdf" });
  });

  it("keeps the canonical url on feedback assets", () => {
    const payload = editorModelToPayload(
      makeModel({
        basic: {
          ...makeModel().basic,
          feedbackAssets: [
            {
              id: "a1",
              title: "T",
              fileName: "f.pdf",
              mimeType: "application/pdf",
              url: "/api/media/33333333-3333-3333-3333-333333333333",
              scormHref: "feedback/f.pdf",
            },
          ],
        },
      }),
    );
    expect(payload.feedbackJson.assets[0]).not.toHaveProperty("scormHref");
    expect(payload.feedbackJson.assets[0].url).toBe("/api/media/33333333-3333-3333-3333-333333333333");
  });

  it("persists retakePolicyJson as null when disabled and the full object when enabled", () => {
    expect(editorModelToPayload(makeModel()).retakePolicyJson).toBeNull();
    const enabled = editorModelToPayload(
      makeModel({
        retakePolicy: {
          enabled: true,
          cooldownPeriodDays: 15,
          gateMode: "before_internal_start",
          eligibilityPlugin: null,
        },
      }),
    );
    expect(enabled.retakePolicyJson).toMatchObject({ enabled: true, cooldownPeriodDays: 15 });
  });

  it("reads defaultQuestionPoints from scoring, defaulting a missing slice to null", () => {
    expect(
      editorModelToPayload(makeModel({ scoring: { defaultQuestionPoints: 5, questionOverrides: [] } }))
        .defaultQuestionPoints,
    ).toBe(5);

    const noScoring = makeModel();
    delete (noScoring as { scoring?: unknown }).scoring;
    expect(editorModelToPayload(noScoring).defaultQuestionPoints).toBeNull();
  });

  it("carries version → expectedVersion and folderId, and writes status not published", () => {
    const payload = editorModelToPayload(makeModel({ version: 12, folderId: "f9" }));
    expect(payload.expectedVersion).toBe(12);
    expect(payload.folderId).toBe("f9");
    expect(payload.status).toBe("draft");
    expect(payload).not.toHaveProperty("published");
  });
});

// ─── mapEditorSectionsToPayload ───────────────────────────────────────────────

describe("mapEditorSectionsToPayload — section write branches", () => {
  it("resolves topicPassRuleJson from byTopic and defaults to inherit_overall otherwise", () => {
    const model = makeModel({
      sections: [makeSection({ topicId: "with-rule" }), makeSection({ topicId: "no-rule" })],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 70 },
        byTopic: { "with-rule": { source: "custom", type: "percent", value: 80 } },
      },
    });
    const [a, b] = mapEditorSectionsToPayload(model);
    expect(a.topicPassRuleJson).toEqual({ source: "custom", type: "percent", value: 80 });
    expect(b.topicPassRuleJson).toEqual({ source: "inherit_overall" });
  });

  it("encodes timeLimit custom → minutes and inherit/none → null", () => {
    const custom = mapEditorSectionsToPayload(
      makeModel({ sections: [makeSection({ timeLimit: { source: "custom", minutes: 25 } })] }),
    )[0];
    const inherit = mapEditorSectionsToPayload(
      makeModel({ sections: [makeSection({ timeLimit: { source: "inherit_test" } })] }),
    )[0];
    const none = mapEditorSectionsToPayload(
      makeModel({ sections: [makeSection({ timeLimit: { source: "none" } })] }),
    )[0];
    expect(custom.timeLimitMinutes).toBe(25);
    expect(inherit.timeLimitMinutes).toBeNull();
    expect(none.timeLimitMinutes).toBeNull();
  });

  it("collapses an empty/absent drawBlueprint to null and keeps a non-empty one", () => {
    expect(
      mapEditorSectionsToPayload(makeModel({ sections: [makeSection({ drawBlueprint: { strata: [] } })] }))[0]
        .drawBlueprintJson,
    ).toBeNull();
    expect(
      mapEditorSectionsToPayload(makeModel({ sections: [makeSection({ drawBlueprint: null })] }))[0]
        .drawBlueprintJson,
    ).toBeNull();
    expect(
      mapEditorSectionsToPayload(
        makeModel({ sections: [makeSection({ drawBlueprint: { strata: [{ tag: "T", count: 2 }] } })] }),
      )[0].drawBlueprintJson,
    ).toEqual({ strata: [{ tag: "T", count: 2 }] });
  });

  it("defaults formSet and defaultPoints to null when absent and keeps explicit values", () => {
    const bare = mapEditorSectionsToPayload(makeModel({ sections: [makeSection()] }))[0];
    expect(bare.formSetJson).toBeNull();
    expect(bare.defaultPoints).toBeNull();

    const set = { forms: [{ id: "v1", label: "V1", questionIds: ["q1"] }, { id: "v2", label: "V2", questionIds: ["q2"] }] };
    const withValues = mapEditorSectionsToPayload(
      makeModel({ sections: [makeSection({ formSet: set as never, defaultPoints: 4 })] }),
    )[0];
    expect(withValues.formSetJson).toEqual(set);
    expect(withValues.defaultPoints).toBe(4);
  });

  it("copies required from the section, not from byTopic (FR-45)", () => {
    const [p] = mapEditorSectionsToPayload(makeModel({ sections: [makeSection({ required: false })] }));
    expect(p.required).toBe(false);
  });
});

// ─── mapEditorAdaptiveToPayload ───────────────────────────────────────────────

describe("mapEditorAdaptiveToPayload — mode gate + enabled filter", () => {
  it("returns null for standard mode", () => {
    expect(mapEditorAdaptiveToPayload(makeModel({ mode: "standard" }))).toBeNull();
  });

  it("returns only enabled topics with the enabled flag stripped for adaptive mode", () => {
    const payload = mapEditorAdaptiveToPayload(
      makeModel({
        mode: "adaptive",
        adaptive: {
          showDifficultyLevel: false,
          testSettings: { showDifficultyLevel: false },
          topics: [
            { topicId: "on", topicName: "On", enabled: true, levels: [] },
            { topicId: "off", topicName: "Off", enabled: false, levels: [] },
          ],
        },
      }),
    );
    expect(payload).not.toBeNull();
    expect(payload!.showDifficultyLevel).toBe(false);
    expect(payload!.topics).toHaveLength(1);
    expect(payload!.topics[0].topicId).toBe("on");
    expect(payload!.topics[0]).not.toHaveProperty("enabled");
  });
});

// ─── mapEditorRouterFlowToPayload ─────────────────────────────────────────────

describe("mapEditorRouterFlowToPayload — router presence branch", () => {
  it("returns the default router when the model has no router sub-object", () => {
    expect(mapEditorRouterFlowToPayload(makeModel({ flowSettings: {} }))).toEqual({
      completionPolicy: "all_required_completed",
      sectionUnlockRules: {},
    });
  });

  it("returns the model's router settings when present", () => {
    const model = makeModel({
      flowSettings: {
        router: {
          completionPolicy: "all_required_passed",
          sectionUnlockRules: { s1: { mode: "after_sections_completed", sectionIds: ["a"] } },
        },
      },
    });
    expect(mapEditorRouterFlowToPayload(model)).toEqual({
      completionPolicy: "all_required_passed",
      sectionUnlockRules: { s1: { mode: "after_sections_completed", sectionIds: ["a"] } },
    });
  });
});

// ─── emptyEditorModel + PRD-4 auto-fix ────────────────────────────────────────

describe("emptyEditorModel + adaptive/linear_flat auto-fix", () => {
  it("builds a fresh model carrying the picked folderId (null and string)", () => {
    expect(emptyEditorModel({ folderId: null }).folderId).toBeNull();
    expect(emptyEditorModel({ folderId: "f1" }).folderId).toBe("f1");
    const m = emptyEditorModel({ folderId: null });
    expect(m.version).toBe(0);
    expect(m.mode).toBe("standard");
    expect(m.runtime.allowReturnToUnanswered).toBe(true); // new test → ON
  });

  it("coerces the legacy (adaptive, linear_flat) pair to linear_by_topics", () => {
    const m = apiToEditorModel({ mode: "adaptive", flowPolicyJson: { mode: "linear_flat" }, sections: [] });
    expect(m.mode).toBe("adaptive");
    expect(m.flowMode).toBe("linear_by_topics");
  });

  it("leaves a valid (standard, linear_flat) pair untouched", () => {
    const m = apiToEditorModel({ mode: "standard", flowPolicyJson: { mode: "linear_flat" } });
    expect(m.flowMode).toBe("linear_flat");
  });
});

// ─── residual branch coverage (false sides of type guards) ────────────────────

describe("residual type-guard branches", () => {
  it("draw blueprint tolerates a non-string tag and a non-number count", () => {
    const bp = mapApiSectionsToEditor({
      sections: [
        { topicId: "t", maxQuestions: 5, drawBlueprintJson: { strata: [{ tag: 123, count: "no" }] } },
      ],
    })[0].drawBlueprint;
    expect(bp).toBeNull(); // tag→"", count→0 → dropped
  });

  it("section maxQuestions coerces a non-number to 0", () => {
    const [s] = mapApiSectionsToEditor({ sections: [{ topicId: "t", maxQuestions: "x" }] });
    expect(s.maxQuestions).toBe(0);
  });

  it("adaptive link url coerces a non-string to empty", () => {
    const out = mapApiAdaptiveTopicsToEditor({
      adaptiveSettings: [{ topicId: "t", levels: [{ links: [{ id: "l1", title: "T", url: 5 }] }] }],
    });
    expect(out[0].levels[0].links[0]).toEqual({ id: "l1", title: "T", url: "" });
  });

  it("adaptive topic reads a string failureFeedback", () => {
    const out = mapApiAdaptiveTopicsToEditor({
      adaptiveSettings: [{ topicId: "t", failureFeedback: "Не сдал", levels: [] }],
    });
    expect(out[0].failureFeedback).toBe("Не сдал");
  });

  it("scale band coerces min/max that are neither number nor string to empty", () => {
    const [scale] = apiToEditorModel({
      scales: [{ id: "s1", key: "k", sortOrder: 0, configJson: { bands: [{ min: true, max: null, label: "L", level: "v" }] } }],
    }).scales;
    expect(scale.bands).toEqual([{ min: "", max: "", label: "L", level: "v", text: "", tone: "" }]);
  });

  it("scale coerces a non-string key and a missing sortOrder (falls back to index)", () => {
    const scales = apiToEditorModel({ scales: [{ key: 99 }] }).scales;
    expect(scales[0].key).toBe("");
    expect(scales[0].sortOrder).toBe(0); // absent → row index
  });

  it("reads a numeric defaultQuestionPoints from the API into scoring", () => {
    expect(apiToEditorModel({ defaultQuestionPoints: 3 }).scoring.defaultQuestionPoints).toBe(3);
    expect(apiToEditorModel({ defaultQuestionPoints: "x" }).scoring.defaultQuestionPoints).toBeNull();
  });
});

describe("report settings — legacy branch without a variant key", () => {
  // Settings saved before the report had variants (PRD-35) carry values and no key. The
  // hosts render from them (an absent key resolves to the `isDefault` variant), so the
  // editor has to show them — dropping the branch left the author looking at an empty card
  // while the report kept printing a radar.
  it("keeps a keyless branch that still carries values", () => {
    const model = apiToEditorModel({
      reportSettingsJson: { standard: { values: { showCompetencyRadar: true } } },
    });
    expect(model.report.standard?.variantKey).toBeUndefined();
    expect(model.report.standard?.values).toEqual({ showCompetencyRadar: true });
  });

  it("drops a branch that carries neither a key nor values", () => {
    const model = apiToEditorModel({ reportSettingsJson: { standard: { values: {} }, adaptive: {} } });
    expect(model.report.standard).toBeUndefined();
    expect(model.report.adaptive).toBeUndefined();
  });

  it("keeps reading a normal branch with a key", () => {
    const model = apiToEditorModel({
      reportSettingsJson: { standard: { variantKey: "report.standard", values: { headline: "X" } } },
    });
    expect(model.report.standard).toEqual({ variantKey: "report.standard", values: { headline: "X" } });
  });
});

// ─── round-trip sanity ────────────────────────────────────────────────────────

describe("round-trip — apiToEditorModel then editorModelToPayload", () => {
  it("preserves core fields through a load → save cycle", () => {
    const api = {
      id: "t-rt",
      version: 4,
      title: "RT",
      description: "d",
      mode: "standard",
      status: "published",
      flowPolicyJson: { mode: "linear_by_topics" },
      overallPassRuleJson: { type: "absolute", value: 8 },
      passDecisionPolicy: "overall_only",
      timeLimitMinutes: 45,
      maxAttempts: 3,
      folderId: "fold-1",
      sections: [{ topicId: "topic-a", topicName: "A", maxQuestions: 10, required: true }],
    };
    const payload = editorModelToPayload(apiToEditorModel(api));
    expect(payload.title).toBe("RT");
    expect(payload.description).toBe("d");
    expect(payload.status).toBe("published");
    expect(payload.mode).toBe("standard");
    expect(payload.flowMode).toBe("linear_by_topics");
    expect(payload.overallPassRuleJson).toEqual({ type: "absolute", value: 8 });
    expect(payload.timeLimitMinutes).toBe(45);
    expect(payload.maxAttempts).toBe(3);
    expect(payload.expectedVersion).toBe(4);
    expect(payload.folderId).toBe("fold-1");
    expect(payload.flowPolicyJson).toEqual({ mode: "linear_by_topics", router: null });
  });
});
