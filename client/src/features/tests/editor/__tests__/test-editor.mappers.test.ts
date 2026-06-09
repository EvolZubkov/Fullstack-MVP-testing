/**
 * @module features/tests/editor/__tests__/test-editor.mappers.test
 * @description Unit tests for `apiToEditorModel` and `editorModelToPayload`.
 *
 * Covers all 10 items from docs/prd-7-implementation-todo.md §1.13.1:
 *   1.  apiToEditorModel — standard test (with sections + pass rules).
 *   2.  apiToEditorModel — adaptive test (topics/levels/links).
 *   3.  apiToEditorModel — legacy published=true → status='published'.
 *   4.  apiToEditorModel — legacy published=false → status='draft'.
 *   5.  apiToEditorModel — startPageContent present (no auto-creation, decisions §7.5).
 *   6.  apiToEditorModel — feedbackJson without `format` → format='plain'.
 *   7.  editorModelToPayload — create standard.
 *   8.  editorModelToPayload — update adaptive (adaptive payload present only for adaptive mode).
 *   9.  editorModelToPayload — required taken from sections[], not passRules.byTopic (FR-45).
 *  10.  editorModelToPayload — hidden draft adaptive settings excluded for standard mode (FR-25h).
 */
import { describe, expect, it } from "vitest";
import {
  apiToEditorModel,
  defaultRetakePolicy,
  editorModelToPayload,
  mapEditorAdaptiveToPayload,
  mapEditorSectionsToPayload,
} from "../test-editor.mappers";
import type { TestEditorModel } from "../test-editor.types";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** A minimal standard-mode API section. */
const apiSection = (overrides: Record<string, unknown> = {}) => ({
  topicId: "topic-math",
  topicName: "Математика",
  drawCount: 10,
  required: true,
  timeLimitMinutes: null,
  topicPassRuleJson: { source: "inherit_overall" },
  feedbackJson: null,
  maxQuestions: 25,
  ...overrides,
});

/** A minimal adaptive level. */
const apiLevel = (overrides: Record<string, unknown> = {}) => ({
  id: "level-1",
  levelIndex: 0,
  levelName: "Базовый",
  minDifficulty: 0,
  maxDifficulty: 40,
  questionsCount: 5,
  passThreshold: 60,
  passThresholdType: "percent",
  feedback: null,
  links: [],
  ...overrides,
});

/** A minimal adaptive topic setting. */
const apiAdaptiveTopic = (overrides: Record<string, unknown> = {}) => ({
  topicId: "topic-math",
  topicName: "Математика",
  failureFeedback: null,
  levels: [apiLevel()],
  ...overrides,
});

/** A minimal complete editor model (standard). */
function makeStandardModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    id: "test-1",
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: { linear: {} },
    basic: {
      title: "Тест",
      description: "",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: {
      showDifficultyLevel: true,
      testSettings: { showDifficultyLevel: true },
      topics: [],
    },
    retakePolicy: defaultRetakePolicy(),
    ...overrides,
  };
}

// ─── 1. apiToEditorModel — standard test with sections ────────────────────────

describe("1. apiToEditorModel — standard test with sections", () => {
  it("maps sections, byTopic, and section timeLimit correctly", () => {
    const api = {
      id: "test-std-1",
      version: 2,
      title: "Стандартный тест",
      description: "Описание",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [
        apiSection({
          topicId: "topic-math",
          required: true,
          timeLimitMinutes: 20,
          topicPassRuleJson: { source: "custom", type: "percent", value: 60 },
        }),
        apiSection({
          topicId: "topic-history",
          topicName: "История",
          required: false,
          topicPassRuleJson: { source: "none" },
          maxQuestions: 15,
        }),
      ],
    };

    const model = apiToEditorModel(api);

    // Sections
    expect(model.sections).toHaveLength(2);
    expect(model.sections[0].topicId).toBe("topic-math");
    expect(model.sections[0].required).toBe(true);
    expect(model.sections[0].timeLimit).toEqual({ source: "custom", minutes: 20 });
    expect(model.sections[0].feedback).toEqual({ format: "plain", text: "" });

    expect(model.sections[1].topicId).toBe("topic-history");
    expect(model.sections[1].required).toBe(false);
    expect(model.sections[1].timeLimit).toEqual({ source: "inherit_test" });

    // byTopic pass rules populated from section data
    expect(model.passRules.byTopic["topic-math"]).toEqual({
      source: "custom",
      type: "percent",
      value: 60,
    });
    expect(model.passRules.byTopic["topic-history"]).toEqual({ source: "none" });

    // §2.4: at least one "none" → overall_and_required_topics
    expect(model.passRules.decisionPolicy).toBe("overall_and_required_topics");
  });
});

// ─── PRD-11: draw blueprint (de)serialization ────────────────────────────────

describe("PRD-11 draw blueprint mapping", () => {
  const blueprintModel = (drawBlueprint: unknown) =>
    makeStandardModel({
      sections: [
        {
          topicId: "a",
          topicName: "A",
          maxQuestions: 10,
          drawCount: 5,
          required: true,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
          drawBlueprint: drawBlueprint as never,
        },
      ],
    });

  it("apiToEditorModel parses a valid blueprint and drops malformed strata", () => {
    const api = {
      id: "t",
      version: 1,
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [
        apiSection({
          topicId: "topic-math",
          drawBlueprintJson: {
            strata: [
              { tag: "Базовые понятия", count: 2, mode: "exact" },
              { tag: "Протоколы", count: 1, mode: "min" },
              { tag: "", count: 3 }, // dropped — empty tag
              { tag: "x", count: 0 }, // dropped — count < 1
            ],
          },
        }),
        apiSection({ topicId: "topic-history", topicName: "История", drawBlueprintJson: null }),
      ],
    };
    const model = apiToEditorModel(api);
    expect(model.sections[0].drawBlueprint).toEqual({
      strata: [
        { tag: "Базовые понятия", count: 2, mode: "exact" },
        { tag: "Протоколы", count: 1, mode: "min" },
      ],
    });
    expect(model.sections[1].drawBlueprint).toBeNull();
  });

  it("apiToEditorModel returns null for non-object / empty-strata blueprints", () => {
    const api = {
      id: "t",
      version: 1,
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [
        apiSection({ topicId: "a", drawBlueprintJson: { strata: [] } }),
        apiSection({ topicId: "b", topicName: "B", drawBlueprintJson: "nope" }),
      ],
    };
    const model = apiToEditorModel(api);
    expect(model.sections[0].drawBlueprint).toBeNull();
    expect(model.sections[1].drawBlueprint).toBeNull();
  });

  it("mapEditorSectionsToPayload serializes a blueprint, collapsing empty/null to null", () => {
    expect(
      mapEditorSectionsToPayload(blueprintModel({ strata: [{ tag: "T", count: 2, mode: "min" }] }))[0]
        .drawBlueprintJson,
    ).toEqual({ strata: [{ tag: "T", count: 2, mode: "min" }] });
    expect(mapEditorSectionsToPayload(blueprintModel({ strata: [] }))[0].drawBlueprintJson).toBeNull();
    expect(mapEditorSectionsToPayload(blueprintModel(null))[0].drawBlueprintJson).toBeNull();
  });
});

// ─── 2. apiToEditorModel — adaptive test ─────────────────────────────────────

describe("2. apiToEditorModel — adaptive test", () => {
  it("maps adaptive topics, levels and links; skips adaptive for standard", () => {
    const api = {
      id: "test-adaptive-1",
      version: 1,
      title: "Адаптивный тест",
      mode: "adaptive",
      status: "draft",
      showDifficultyLevel: true,
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [apiSection()],
      adaptiveSettings: [
        apiAdaptiveTopic({
          levels: [
            apiLevel({
              id: "lvl-1",
              levelIndex: 0,
              levelName: "Базовый",
              minDifficulty: 0,
              maxDifficulty: 40,
              questionsCount: 5,
              passThreshold: 60,
              passThresholdType: "percent",
              feedback: "Попробуй ещё раз",
              links: [{ id: "lnk-1", title: "Учебник", url: "https://example.com/book" }],
            }),
            apiLevel({
              levelIndex: 1,
              levelName: "Продвинутый",
              minDifficulty: 41,
              maxDifficulty: 100,
              questionsCount: 8,
              passThreshold: 4,
              passThresholdType: "absolute",
              links: [],
            }),
          ],
        }),
      ],
    };

    const model = apiToEditorModel(api);

    expect(model.mode).toBe("adaptive");
    expect(model.adaptive.showDifficultyLevel).toBe(true);
    expect(model.adaptive.topics).toHaveLength(1);

    const topic = model.adaptive.topics[0];
    expect(topic.topicId).toBe("topic-math");
    expect(topic.topicName).toBe("Математика");
    expect(topic.enabled).toBe(true);
    expect(topic.levels).toHaveLength(2);

    const lvl0 = topic.levels[0];
    expect(lvl0.id).toBe("lvl-1");
    expect(lvl0.levelName).toBe("Базовый");
    expect(lvl0.minDifficulty).toBe(0);
    expect(lvl0.maxDifficulty).toBe(40);
    expect(lvl0.questionsCount).toBe(5);
    expect(lvl0.passThreshold).toBe(60);
    expect(lvl0.passThresholdType).toBe("percent");
    expect(lvl0.feedback).toBe("Попробуй ещё раз");
    expect(lvl0.links).toEqual([{ id: "lnk-1", title: "Учебник", url: "https://example.com/book" }]);

    const lvl1 = topic.levels[1];
    expect(lvl1.passThresholdType).toBe("absolute");
    expect(lvl1.passThreshold).toBe(4);
  });

  it("leaves adaptive.topics empty when mode is standard", () => {
    const model = apiToEditorModel({
      mode: "standard",
      overallPassRuleJson: { type: "percent", value: 70 },
      adaptiveSettings: [apiAdaptiveTopic()],
    });
    expect(model.adaptive.topics).toEqual([]);
  });
});

// ─── 3. apiToEditorModel — legacy published=true → status='published' ─────────

describe("3. apiToEditorModel — legacy published=true → status='published'", () => {
  it("uses published=true when no status field is present", () => {
    const model = apiToEditorModel({
      title: "Опубликованный тест",
      published: true,
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    expect(model.basic.status).toBe("published");
  });

  it("explicit status wins over published flag (already in 2A, sanity check)", () => {
    const model = apiToEditorModel({
      title: "Архивный",
      published: true,
      status: "archived",
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    expect(model.basic.status).toBe("archived");
  });
});

// ─── 4. apiToEditorModel — legacy published=false → status='draft' ────────────

describe("4. apiToEditorModel — legacy published=false → status='draft'", () => {
  it("maps published=false (no status) to draft", () => {
    const model = apiToEditorModel({
      title: "Черновик",
      published: false,
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    expect(model.basic.status).toBe("draft");
  });

  it("maps published=null (no status) to draft", () => {
    const model = apiToEditorModel({
      title: "Черновик",
      published: null,
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    expect(model.basic.status).toBe("draft");
  });
});

// ─── 5. apiToEditorModel — startPageContent present (decisions §7.5) ──────────

describe("5. apiToEditorModel — startPageContent present", () => {
  it("does not crash and does not auto-create sections (decisions §7.5: banner only)", () => {
    const model = apiToEditorModel({
      title: "Тест со стартовой страницей",
      startPageContent: "<h1>Добро пожаловать</h1>",
      overallPassRuleJson: { type: "percent", value: 70 },
    });

    // Mapper succeeds — UI layer shows the migration banner
    expect(model).toBeDefined();
    // startPageContent is not exposed on the editor model (deprecated field)
    expect(model).not.toHaveProperty("startPageContent");
    // No auto-created section from legacy start page
    expect(model.sections).toEqual([]);
  });
});

// ─── 6. apiToEditorModel — feedbackJson without format → format='plain' ───────

describe("6. apiToEditorModel — feedbackJson without format field", () => {
  it("defaults format to 'plain' when feedbackJson has no format key", () => {
    const model = apiToEditorModel({
      title: "Тест",
      feedbackJson: { text: "Спасибо!" },
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    expect(model.basic.feedback.format).toBe("plain");
    expect(model.basic.feedback.text).toBe("Спасибо!");
  });

  it("defaults format to 'plain' for legacy feedback string", () => {
    const model = apiToEditorModel({
      title: "Тест",
      feedback: "Легаси-текст",
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    expect(model.basic.feedback.format).toBe("plain");
    expect(model.basic.feedback.text).toBe("Легаси-текст");
  });
});

// ─── 7. editorModelToPayload — create standard ───────────────────────────────

describe("7. editorModelToPayload — create standard", () => {
  it("produces §6-compliant TestSettingsPayload from a published model", () => {
    const model: TestEditorModel = {
      id: "test-new-published",
      version: 12,
      mode: "standard",
      flowMode: "linear_flat",
      flowSettings: { linear: {} },
      basic: {
        title: "Опубликованный тест",
        description: "",
        status: "published",
        feedback: { format: "html", text: "<p>Готово!</p>" },
        feedbackLinks: [{ title: "Курс", url: "https://example.com/course" }],
        feedbackAssets: [
          {
            id: "asset-9",
            title: "Сертификат",
            fileName: "cert.pdf",
            mimeType: "application/pdf",
            scormHref: "feedback/cert.pdf",
          },
        ],
        webhookUrl: "",
        telemetryEnabled: true,
      },
      runtime: { timeLimitMinutes: 60, maxAttempts: 2, showCorrectAnswers: true },
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 80 },
        byTopic: {},
      },
      sections: [],
      adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
      retakePolicy: defaultRetakePolicy(),
    };

    const payload = editorModelToPayload(model);

    expect(payload.title).toBe("Опубликованный тест");
    expect(payload.description).toBeNull(); // §6.8
    expect(payload.webhookUrl).toBeNull();  // §6.8
    expect(payload.status).toBe("published");
    expect(payload).not.toHaveProperty("published");
    expect(payload.mode).toBe("standard");
    expect(payload.flowMode).toBe("linear_flat");
    expect(payload).not.toHaveProperty("flowPolicyJson"); // §3.1: omitted for linear_flat
    expect(payload.overallPassRuleJson).toEqual({ type: "percent", value: 80 });
    expect(payload.passDecisionPolicy).toBe("overall_only");
    expect(payload.timeLimitMinutes).toBe(60);
    expect(payload.maxAttempts).toBe(2);
    expect(payload.showCorrectAnswers).toBe(true);
    expect(payload.telemetryEnabled).toBe(true);
    expect(payload.expectedVersion).toBe(12);

    // §6.5: scormHref stripped from outgoing assets
    expect(payload.feedbackJson.assets[0]).not.toHaveProperty("scormHref");
    expect(payload.feedbackJson.assets[0]).toMatchObject({
      id: "asset-9",
      title: "Сертификат",
      fileName: "cert.pdf",
      mimeType: "application/pdf",
    });
  });
});

// ─── 8. editorModelToPayload — update adaptive ───────────────────────────────

describe("8. editorModelToPayload — update adaptive", () => {
  it("mapEditorAdaptiveToPayload includes enabled topics for adaptive mode", () => {
    const model = makeStandardModel({
      mode: "adaptive",
      adaptive: {
        showDifficultyLevel: false,
        testSettings: { showDifficultyLevel: false },
        topics: [
          {
            topicId: "topic-math",
            topicName: "Математика",
            failureFeedback: "Ошибка",
            enabled: true,
            levels: [
              {
                levelIndex: 0,
                levelName: "Базовый",
                minDifficulty: 0,
                maxDifficulty: 50,
                questionsCount: 5,
                passThreshold: 60,
                passThresholdType: "percent" as const,
                links: [],
              },
            ],
          },
          {
            topicId: "topic-disabled",
            topicName: "Отключённая тема",
            enabled: false,
            levels: [],
          },
        ],
      },
    });

    const adaptivePayload = mapEditorAdaptiveToPayload(model);

    expect(adaptivePayload).not.toBeNull();
    expect(adaptivePayload!.showDifficultyLevel).toBe(false);
    // Only enabled topics included in payload (FR-25h)
    expect(adaptivePayload!.topics).toHaveLength(1);
    expect(adaptivePayload!.topics[0].topicId).toBe("topic-math");
    expect(adaptivePayload!.topics[0]).not.toHaveProperty("enabled");
  });

  it("editorModelToPayload itself still returns TestSettingsPayload for adaptive test", () => {
    const model = makeStandardModel({ mode: "adaptive" });
    const payload = editorModelToPayload(model);
    expect(payload.mode).toBe("adaptive");
  });
});

// ─── 9. editorModelToPayload — required from sections[], not byTopic (FR-45) ──

describe("9. editorModelToPayload — required from sections[] only (FR-45)", () => {
  it("uses sections[].required regardless of passRules.byTopic content", () => {
    const model = makeStandardModel({
      sections: [
        {
          topicId: "topic-math",
          topicName: "Математика",
          maxQuestions: 20,
          drawCount: 10,
          required: false, // explicitly NOT required in the section
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
        },
      ],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 70 },
        byTopic: {
          // byTopic has no `required` field — FR-45 forbids it here, it's only in sections[]
          "topic-math": { source: "custom", type: "percent", value: 80 },
        },
      },
    });

    const sectionPayloads = mapEditorSectionsToPayload(model);

    expect(sectionPayloads).toHaveLength(1);
    // required must come from sections[].required (false), not invented from byTopic
    expect(sectionPayloads[0].required).toBe(false);
    // topicPassRuleJson comes from byTopic
    expect(sectionPayloads[0].topicPassRuleJson).toEqual({
      source: "custom",
      type: "percent",
      value: 80,
    });
  });

  it("topicPassRuleJson defaults to inherit_overall when topic not in byTopic", () => {
    const model = makeStandardModel({
      sections: [
        {
          topicId: "topic-no-rule",
          topicName: "Без правила",
          maxQuestions: 10,
          drawCount: 5,
          required: true,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
        },
      ],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 70 },
        byTopic: {}, // empty — no entry for topic-no-rule
      },
    });

    const sectionPayloads = mapEditorSectionsToPayload(model);
    expect(sectionPayloads[0].topicPassRuleJson).toEqual({ source: "inherit_overall" });
  });
});

// ─── 10. editorModelToPayload — hidden draft adaptive excluded (FR-25h) ────────

describe("10. editorModelToPayload — hidden draft adaptive excluded from standard payload (FR-25h)", () => {
  it("mapEditorAdaptiveToPayload returns null for standard mode even if topics are populated", () => {
    const model = makeStandardModel({
      mode: "standard",
      // Simulate a draft that had adaptive topics before the user switched to standard
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            topicId: "topic-old-adaptive",
            topicName: "Старая адаптивная тема",
            enabled: true,
            levels: [
              {
                levelIndex: 0,
                levelName: "Базовый",
                minDifficulty: 0,
                maxDifficulty: 100,
                questionsCount: 5,
                passThreshold: 60,
                passThresholdType: "percent" as const,
                links: [],
              },
            ],
          },
        ],
      },
    });

    // FR-25h: adaptive payload must be null for standard mode
    const adaptivePayload = mapEditorAdaptiveToPayload(model);
    expect(adaptivePayload).toBeNull();

    // The test-level payload does not mention adaptive data either
    const testPayload = editorModelToPayload(model);
    expect(testPayload.mode).toBe("standard");
    expect(testPayload).not.toHaveProperty("adaptiveSettings");
  });
});

// ─── PRD-4 v1.1 L4: legacy auto-fix for (adaptive, linear_flat) ──────────────

describe("PRD-4 v1.1 L4: apiToEditorModel auto-fixes (adaptive, linear_flat) → linear_by_topics", () => {
  it("rewrites flowMode to linear_by_topics for legacy adaptive+flat tests", () => {
    const api = {
      id: "legacy-test",
      version: 7,
      mode: "adaptive",
      // Pre-PRD-4 v1.1 saves could persist this now-invalid combo.
      flowPolicyJson: { mode: "linear_flat" },
      title: "Legacy",
      sections: [],
      adaptiveSettings: [],
    };
    const model = apiToEditorModel(api);
    expect(model.mode).toBe("adaptive");
    expect(model.flowMode).toBe("linear_by_topics");
  });

  it("does not touch (standard, linear_flat) — that combo is valid", () => {
    const api = {
      id: "standard-flat",
      version: 1,
      mode: "standard",
      flowPolicyJson: { mode: "linear_flat" },
      title: "Standard",
      sections: [],
    };
    const model = apiToEditorModel(api);
    expect(model.mode).toBe("standard");
    expect(model.flowMode).toBe("linear_flat");
  });

  it("does not touch (adaptive, linear_by_topics) — already valid", () => {
    const api = {
      id: "adaptive-by-topics",
      version: 1,
      mode: "adaptive",
      flowPolicyJson: { mode: "linear_by_topics" },
      title: "Adaptive",
      sections: [],
      adaptiveSettings: [],
    };
    const model = apiToEditorModel(api);
    expect(model.flowMode).toBe("linear_by_topics");
  });

  it("does not touch (adaptive, router_by_topics) — also valid", () => {
    const api = {
      id: "adaptive-router",
      version: 1,
      mode: "adaptive",
      flowPolicyJson: { mode: "router_by_topics" },
      title: "Adaptive+Router",
      sections: [],
      adaptiveSettings: [],
    };
    const model = apiToEditorModel(api);
    expect(model.flowMode).toBe("router_by_topics");
  });
});

// ─── PRD-6 retake policy round-trip ───────────────────────────────────────────

describe("PRD-6 — retakePolicy mapping", () => {
  it("defaults to a disabled policy when retakePolicyJson is absent", () => {
    const model = makeStandardModel();
    const fresh = apiToEditorModel({ id: "t", mode: "standard", sections: [] });
    expect(fresh.retakePolicy.enabled).toBe(false);
    expect(model.retakePolicy.enabled).toBe(false);
  });

  it("reads an enabled policy with plugin + failPolicy from the API", () => {
    const model = apiToEditorModel({
      id: "t",
      mode: "standard",
      sections: [],
      retakePolicyJson: {
        enabled: true,
        cooldownPeriodDays: 45,
        eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failClosed" },
      },
    });
    expect(model.retakePolicy.enabled).toBe(true);
    expect(model.retakePolicy.cooldownPeriodDays).toBe(45);
    expect(model.retakePolicy.eligibilityPlugin).toMatchObject({
      key: "webtutor_cooldown",
      failPolicy: "failClosed",
    });
  });

  it("normalizes the legacy cooldownDays alias and clamps out-of-range days", () => {
    const legacy = apiToEditorModel({
      id: "t",
      mode: "standard",
      sections: [],
      retakePolicyJson: { enabled: true, cooldownDays: 14 },
    });
    expect(legacy.retakePolicy.cooldownPeriodDays).toBe(14);

    const clamped = apiToEditorModel({
      id: "t",
      mode: "standard",
      sections: [],
      retakePolicyJson: { enabled: true, cooldownPeriodDays: 99999 },
    });
    expect(clamped.retakePolicy.cooldownPeriodDays).toBe(3650);
  });

  it("persists null when disabled (FR-02) and the full object when enabled", () => {
    const off = editorModelToPayload(makeStandardModel());
    expect(off.retakePolicyJson).toBeNull();

    const on = editorModelToPayload(
      makeStandardModel({
        retakePolicy: {
          enabled: true,
          cooldownPeriodDays: 30,
          gateMode: "before_internal_start",
          eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
        },
      }),
    );
    expect(on.retakePolicyJson).toMatchObject({
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
    });
  });
});
