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
  emptyEditorModel,
  mapEditorAdaptiveToPayload,
  mapEditorSectionsToPayload,
  applyFormSetChange,
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

  // PRD-24: a per-variant rule must survive the API round-trip intact — its byForm
  // map is what the runtime resolves against the delivered variant.
  it("reads and writes a by_variant topic rule", () => {
    const byForm = { f1: { type: "percent" as const, value: 65 }, f2: { type: "absolute" as const, value: 7 } };
    const model = apiToEditorModel({
      id: "t",
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [apiSection({ topicId: "topic-math", topicPassRuleJson: { source: "by_variant", byForm } })],
    });
    expect(model.passRules.byTopic["topic-math"]).toEqual({ source: "by_variant", byForm });

    const payloads = mapEditorSectionsToPayload(model);
    expect(payloads[0].topicPassRuleJson).toEqual({ source: "by_variant", byForm });
  });

  // PRD-50 §16 (FR-53): индивидуальных порогов подтем больше нет — есть ОДИН флаг теста,
  // и он обязан пережить круг «ответ API → модель → payload». Живёт он в `passRules`:
  // гейт уточняет вердикт ТЕМЫ и стоит рядом с «Тест пройден, если».
  it("PRD-50 FR-53: гейт подтем читается и пишется", () => {
    const model = apiToEditorModel({
      id: "t",
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      breakdownGateEnabled: true,
    });
    expect(model.passRules.breakdownGateEnabled).toBe(true);
    expect(editorModelToPayload(model).breakdownGateEnabled).toBe(true);
  });

  // Тест, сохранённый до §16, судится ровно как судился: колонка `NOT NULL DEFAULT false`,
  // а отсутствие поля в ответе — то же «выключено».
  it("PRD-50 FR-53: отсутствие поля читается как выключено", () => {
    const model = apiToEditorModel({
      id: "t",
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
    });
    expect(model.passRules.breakdownGateEnabled).toBe(false);
    expect(editorModelToPayload(model).breakdownGateEnabled).toBe(false);
  });

  it("drops malformed by_variant entries instead of trusting them", () => {
    const model = apiToEditorModel({
      id: "t",
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [apiSection({
        topicId: "topic-math",
        topicPassRuleJson: {
          source: "by_variant",
          byForm: { ok: { type: "percent", value: 50 }, bad: { type: "weird", value: 1 }, worse: 42 },
        },
      })],
    });
    expect(model.passRules.byTopic["topic-math"]).toEqual({
      source: "by_variant",
      byForm: { ok: { type: "percent", value: 50 } },
    });
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

// ─── PRD-17 (BR-12): variant set round-trip ──────────────────────────────────

describe("PRD-17 form set mapping", () => {
  const formSet = {
    forms: [
      { id: "v1", label: "Вариант 1", questionIds: ["q1", "q2"] },
      { id: "v2", label: "Вариант 2", questionIds: ["q3"] },
    ],
  };
  const variantModel = (formSet: unknown) =>
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
          formSet: formSet as never,
        },
      ],
    });

  it("apiToEditorModel parses a valid formSetJson into section.formSet", () => {
    const api = {
      id: "t",
      version: 1,
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [apiSection({ topicId: "a", formSetJson: formSet })],
    };
    expect(apiToEditorModel(api).sections[0].formSet).toEqual(formSet);
  });

  it("apiToEditorModel returns null for a malformed / single-variant formSetJson", () => {
    const api = {
      id: "t",
      version: 1,
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [
        apiSection({ topicId: "a", formSetJson: { forms: [{ id: "v1", label: "Вариант 1", questionIds: ["q1"] }] } }),
        apiSection({ topicId: "b", topicName: "B", formSetJson: "nope" }),
      ],
    };
    const model = apiToEditorModel(api);
    expect(model.sections[0].formSet).toBeNull();
    expect(model.sections[1].formSet).toBeNull();
  });

  it("mapEditorSectionsToPayload serializes formSet, collapsing absent to null", () => {
    expect(mapEditorSectionsToPayload(variantModel(formSet))[0].formSetJson).toEqual(formSet);
    expect(mapEditorSectionsToPayload(variantModel(null))[0].formSetJson).toBeNull();
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
    // §3.1: linear_flat is written EXPLICITLY — an omitted key means "keep the
    // stored policy" on PUT, which used to strand tests on their old flow mode.
    expect(payload.flowPolicyJson).toEqual({ mode: "linear_flat", router: null });
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

// ─── PRD-24: keeping the per-variant rule in step with the variant set ────────

describe("applyFormSetChange", () => {
  const forms = (...ids: string[]) =>
    ids.map((id, i) => ({ id, label: `Вариант ${i + 1}`, questionIds: [`q${i}`] }));
  const model = (byTopic: Record<string, unknown>, formSet: unknown) =>
    ({
      passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 65 }, byTopic },
      sections: [{ topicId: "t", topicName: "T", maxQuestions: 4, drawCount: 2, formSet }],
    }) as never;

  it("seeds a threshold for a newly added variant, keeping the existing ones", () => {
    const before = model(
      { t: { source: "by_variant", byForm: { v1: { type: "absolute", value: 3 } } } },
      { forms: forms("v1") },
    );
    const after = applyFormSetChange(before, "t", { forms: forms("v1", "v2") });
    expect(after.passRules.byTopic["t"]).toEqual({
      source: "by_variant",
      byForm: {
        v1: { type: "absolute", value: 3 }, // untouched
        v2: { type: "absolute", value: 3 }, // seeded from the existing entry
      },
    });
    expect(after.sections[0].formSet?.forms).toHaveLength(2);
  });

  it("drops the threshold of a removed variant so no orphan blocks the save", () => {
    const before = model(
      { t: { source: "by_variant", byForm: { v1: { type: "percent", value: 50 }, v2: { type: "percent", value: 80 } } } },
      { forms: forms("v1", "v2") },
    );
    const after = applyFormSetChange(before, "t", { forms: forms("v1") });
    expect(after.passRules.byTopic["t"]).toEqual({
      source: "by_variant",
      byForm: { v1: { type: "percent", value: 50 } },
    });
  });

  it("normalises the rule when variants mode is switched off", () => {
    const before = model(
      { t: { source: "by_variant", byForm: { v1: { type: "percent", value: 50 } } } },
      { forms: forms("v1", "v2") },
    );
    const after = applyFormSetChange(before, "t", null);
    expect(after.passRules.byTopic["t"]).toEqual({ source: "inherit_overall" });
    expect(after.sections[0].formSet).toBeNull();
  });

  it("seeds from the overall rule when the topic had no per-variant thresholds yet", () => {
    const before = model({ t: { source: "by_variant", byForm: {} } }, { forms: forms("v1") });
    const after = applyFormSetChange(before, "t", { forms: forms("v1", "v2") });
    expect(after.passRules.byTopic["t"]).toEqual({
      source: "by_variant",
      byForm: { v1: { type: "percent", value: 65 }, v2: { type: "percent", value: 65 } },
    });
  });

  it("leaves other rule sources alone", () => {
    const before = model({ t: { source: "custom", type: "percent", value: 55 } }, { forms: forms("v1") });
    const after = applyFormSetChange(before, "t", { forms: forms("v1", "v2") });
    expect(after.passRules.byTopic["t"]).toEqual({ source: "custom", type: "percent", value: 55 });
  });
});

// ─── quickAdvance (PRD-43) ─────────────────────────────────────────────────────

describe("quickAdvance (PRD-43)", () => {
  it("emptyEditorModel defaults quickAdvance to false", () => {
    const model = emptyEditorModel({ folderId: null });
    expect(model.runtime.quickAdvance).toBe(false);
  });

  it("apiToEditorModel reads an explicit quickAdvance verbatim", () => {
    const model = apiToEditorModel({ quickAdvance: true, allowReturnToUnanswered: true });
    expect(model.runtime.quickAdvance).toBe(true);
  });

  it("apiToEditorModel falls back to NOT allowReturnToUnanswered when quickAdvance is absent", () => {
    expect(apiToEditorModel({ allowReturnToUnanswered: true }).runtime.quickAdvance).toBe(false);
    expect(apiToEditorModel({ allowReturnToUnanswered: false }).runtime.quickAdvance).toBe(true);
    // allowReturnToUnanswered itself also absent here → its own fallback (false), then negated.
    expect(apiToEditorModel({}).runtime.quickAdvance).toBe(true);
  });

  it("editorModelToPayload round-trips quickAdvance", () => {
    const model = emptyEditorModel({ folderId: null });
    model.runtime.quickAdvance = true;
    expect(editorModelToPayload(model).quickAdvance).toBe(true);
  });
});

// ─── Свободная навигация внутри раздела (PRD-19 FR-11a) ───────────────────────

describe("свободная навигация внутри раздела (PRD-19 FR-11a)", () => {
  it("новый тест заводится с выключенной свободой", () => {
    expect(emptyEditorModel({ folderId: null }).runtime.allowFreeSectionNavigation).toBe(false);
  });

  it("тест без этой колонки читается как ВЫКЛ, а не как «неизвестно» (FR-11c)", () => {
    // Существующий тест обязан сохранить нынешнее поведение без правок автора, поэтому
    // отсутствие поля — это «выключено», и таким же оно уедет обратно на сервер.
    expect(apiToEditorModel({}).runtime.allowFreeSectionNavigation).toBe(false);
  });

  it("явное значение читается дословно и переживает круг до полезной нагрузки", () => {
    expect(
      apiToEditorModel({ allowFreeSectionNavigation: true }).runtime.allowFreeSectionNavigation,
    ).toBe(true);
    const model = emptyEditorModel({ folderId: null });
    model.runtime.allowFreeSectionNavigation = true;
    expect(editorModelToPayload(model).allowFreeSectionNavigation).toBe(true);
  });
});

// ─── PRD-50 FR-11/FR-12: section-group (block) round-trip ────────────────────

describe("PRD-50 FR-44 положение показа разреза (Э4)", () => {
  const apiTest = (breakdownDisplayJson?: unknown) => ({
    id: "t",
    title: "T",
    mode: "standard",
    status: "draft",
    overallPassRuleJson: { type: "percent", value: 70 },
    sections: [apiSection({ topicId: "a" })],
    ...(breakdownDisplayJson === undefined ? {} : { breakdownDisplayJson }),
  });

  it("читает положение и возвращает его в тело запроса без изменений", () => {
    const model = apiToEditorModel(
      apiTest({ visibility: "bar", basis: "points", placement: "both" }),
    );
    expect(model.runtime.breakdownDisplay).toEqual({
      visibility: "bar",
      basis: "points",
      placement: "both",
    });
    expect(editorModelToPayload(model).breakdownDisplayJson).toEqual({
      visibility: "bar",
      basis: "points",
      placement: "both",
    });
  });

  it("настройка, сохранённая до Э4, поля НЕ приобретает: пусто и есть «в карточках тем»", () => {
    const model = apiToEditorModel(apiTest({ visibility: "bar", basis: "units" }));
    expect(model.runtime.breakdownDisplay).toEqual({ visibility: "bar", basis: "units" });
    // Открытие и сохранение теста не должно переписывать настройку автора.
    expect(editorModelToPayload(model).breakdownDisplayJson).toEqual({
      visibility: "bar",
      basis: "units",
    });
  });

  it("чужое значение положения игнорируется, а не уезжает на сервер", () => {
    const model = apiToEditorModel(apiTest({ visibility: "bar", basis: "units", placement: "card" }));
    expect(model.runtime.breakdownDisplay).toEqual({ visibility: "bar", basis: "units" });
  });
});

describe("PRD-50 FR-11 section groups mapping", () => {
  const groups = [
    { key: "intro", label: "Вводный блок", order: 0 },
    { key: "core", label: "Основной блок", order: 1 },
  ];

  it("apiToEditorModel reads sectionGroupsJson into model.sectionGroups", () => {
    const api = {
      id: "t",
      version: 1,
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sectionGroupsJson: groups,
      sections: [apiSection({ topicId: "a", groupKey: "core" })],
    };
    const model = apiToEditorModel(api);
    expect(model.sectionGroups).toEqual(groups);
    expect(model.sections[0].groupKey).toBe("core");
  });

  it("apiToEditorModel defaults to an empty list for absent/malformed sectionGroupsJson", () => {
    const withoutField = apiToEditorModel({
      id: "t",
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [apiSection({ topicId: "a" })],
    });
    expect(withoutField.sectionGroups).toEqual([]);
    // A section without groupKey (legacy row) reads as "no block".
    expect(withoutField.sections[0].groupKey).toBeNull();

    const malformed = apiToEditorModel({
      id: "t",
      title: "T",
      mode: "standard",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sectionGroupsJson: [{ key: "", label: "Пустой ключ" }], // invalid: empty key
      sections: [],
    });
    expect(malformed.sectionGroups).toEqual([]);
  });

  it("editorModelToPayload collapses an empty block list to null; a non-empty one round-trips", () => {
    const empty = emptyEditorModel({ folderId: null });
    expect(editorModelToPayload(empty).sectionGroupsJson).toBeNull();

    const withGroups = emptyEditorModel({ folderId: null });
    withGroups.sectionGroups = groups;
    expect(editorModelToPayload(withGroups).sectionGroupsJson).toEqual(groups);
  });

  it("mapEditorSectionsToPayload sends groupKey, defaulting a missing value to null", () => {
    const model = makeStandardModel({
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
          groupKey: "core",
        } as never,
        {
          topicId: "b",
          topicName: "B",
          maxQuestions: 10,
          drawCount: 5,
          required: true,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
        } as never,
      ],
    });
    const payloads = mapEditorSectionsToPayload(model);
    expect(payloads[0].groupKey).toBe("core");
    expect(payloads[1].groupKey).toBeNull();
  });
});

describe("вводный текст по исходу (PRD-61)", () => {
  it("поднимает тексты исхода вместе с общим вступлением", () => {
    const model = apiToEditorModel({
      introJson: {
        results: {
          format: "plain",
          text: "Общее",
          passed: { format: "html", text: "<p>Поздравляем</p>" },
          failed: { format: "plain", text: "Не хватило" },
        },
      },
    });
    expect(model.intro?.results?.text).toBe("Общее");
    expect(model.intro?.results?.passed).toEqual({ format: "html", text: "<p>Поздравляем</p>" });
    expect(model.intro?.results?.failed).toEqual({ format: "plain", text: "Не хватило" });
  });

  it("поднимает тексты исхода, ДАЖЕ когда общее вступление пусто", () => {
    // Иначе тексты, заведённые книгой или через API, не доедут до модели, и первое же
    // сохранение теста из ящика молча их сотрёт.
    const model = apiToEditorModel({
      introJson: {
        report: { format: "plain", text: "", failed: { format: "plain", text: "Не хватило" } },
      },
    });
    expect(model.intro?.report?.failed?.text).toBe("Не хватило");
    expect(model.intro?.report?.text).toBe("");
  });

  it("ветвь без единого текста не поднимается вовсе", () => {
    const model = apiToEditorModel({
      introJson: { results: { format: "plain", text: "  ", passed: { format: "plain", text: " " } } },
    });
    expect(model.intro?.results).toBeUndefined();
  });

  it("старая форма читается как раньше", () => {
    const model = apiToEditorModel({ introJson: { results: { format: "richText", text: "Об итогах" } } });
    expect(model.intro?.results).toEqual({ format: "richText", text: "Об итогах" });
  });
});

// ─── «Сценарий в ИС»: тест «Сценарий» ────────────────────────────────────────

describe("apiToEditorModel — тест «Сценарий»", () => {
  it("читает режим и пункт-сценарий; темы при этом не теряются (FR-40)", () => {
    const model = apiToEditorModel({
      id: "t-sim",
      version: 3,
      title: "Регистрация документов",
      mode: "scenario",
      status: "draft",
      overallPassRuleJson: { type: "percent", value: 70 },
      sections: [apiSection({ topicId: "old-topic" })],
      scenarios: [{ id: "i1", topicId: "bank", topicName: "Работа в СЭД", questionId: "q-fixed" }],
    });
    expect(model.mode).toBe("scenario");
    expect(model.scenarioItems).toEqual([{ id: "i1", topicId: "bank", topicName: "Работа в СЭД", questionId: "q-fixed", title: null, required: true }]);
    expect(model.sections.map((s) => s.topicId)).toEqual(["old-topic"]);
  });

  it("порог пункта-сценария — в passRules.byTopic под ключом пункта; без порога — «Как у теста» (техдолг №8)", () => {
    const model = apiToEditorModel({
      id: "t",
      version: 1,
      title: "x",
      mode: "standard",
      sections: [apiSection({ topicId: "t1" })],
      scenarios: [
        { id: "s1", topicId: "bank", passRuleJson: { source: "custom", type: "percent", value: 80 } },
        { id: "s2", topicId: "bank", passRuleJson: null },
      ],
    });
    expect(model.passRules.byTopic["scenario:s1"]).toEqual({ source: "custom", type: "percent", value: 80 });
    expect(model.passRules.byTopic["scenario:s2"]).toEqual({ source: "inherit_overall" });
  });

  it("тест без пунктов — пункта нет; случайная выдача читается как questionId = null", () => {
    expect(apiToEditorModel({ id: "t", version: 1, title: "x", mode: "standard", sections: [] }).scenarioItems).toEqual([]);
    const random = apiToEditorModel({ id: "t", version: 1, title: "x", mode: "scenario", sections: [], scenarios: [{ topicId: "bank", questionId: null }] });
    expect(random.scenarioItems).toEqual([{ topicId: "bank", topicName: "", questionId: null, title: null, required: true }]);
  });
});
