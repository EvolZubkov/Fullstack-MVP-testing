/**
 * @module features/tests/editor/sections/__tests__/basic-settings-section.test
 * @description Component tests for the «Настройки» tab content
 * (PRD-7 wireframe `prd7-editor-settings-tab.html`).
 *
 * Coverage:
 *   - Side-rail renders 5 sub-sections; clicking switches the active pane.
 *   - Basic pane: title / description / mode toggle / flowMode select bind to
 *     the editor draft via updateModel.
 *   - Limits pane: timeLimitMinutes / maxAttempts (number or null) +
 *     showCorrectAnswers checkbox.
 *   - Integration pane: webhookUrl + telemetryEnabled.
 *   - Pass-rules pane: decisionPolicy / overall rule / per-topic source.
 *   - Adaptive pane: mode warning, master toggle, per-topic accordion +
 *     level CRUD (add / edit / remove) + level links CRUD.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsSection } from "../basic-settings-section";
import type { TestEditorModel } from "../../test-editor.types";

function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample",
      description: "Desc",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false },
    passRules: {
      decisionPolicy: "overall_only",
      overall: { type: "percent", value: 70 },
      byTopic: {},
    },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    ...overrides,
  };
}

function runUpdater(
  updateModel: ReturnType<typeof vi.fn>,
  model: TestEditorModel,
  call = 0,
): TestEditorModel {
  const updater = updateModel.mock.calls[call][0] as (
    m: TestEditorModel,
  ) => TestEditorModel;
  return updater(model);
}

/**
 * Open a ui-kit Select identified by its testid wrapper, then click the option
 * whose visible text matches `optionLabel`. The DS Select renders the testid on
 * the wrapper `<div>` (via `...rest`) while the actual click target is the
 * inner `<button>`.
 */
function selectOption(selectTestId: string, optionLabel: string | RegExp) {
  const wrap = screen.getByTestId(selectTestId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

// ─── Side-rail navigation ─────────────────────────────────────────────────────

describe("<SettingsSection /> — side rail", () => {
  it("renders 4 sub-sections in standard mode (adaptive is hidden)", () => {
    render(<SettingsSection model={baseModel()} updateModel={() => {}} />);
    expect(screen.getByTestId("settings-rail-basic")).toBeInTheDocument();
    expect(screen.getByTestId("settings-rail-pass-rules")).toBeInTheDocument();
    expect(screen.getByTestId("settings-rail-limits")).toBeInTheDocument();
    expect(screen.getByTestId("settings-rail-integration")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-rail-adaptive")).toBeNull();
  });

  it("reveals «Адаптивный режим» rail item only when mode === adaptive", () => {
    render(
      <SettingsSection
        model={baseModel({ mode: "adaptive" })}
        updateModel={() => {}}
      />,
    );
    expect(screen.getByTestId("settings-rail-adaptive")).toBeInTheDocument();
  });

  it("opens the «Основное» pane by default", () => {
    render(<SettingsSection model={baseModel()} updateModel={() => {}} />);
    expect(screen.getByTestId("settings-pane-basic")).toBeInTheDocument();
  });

  it("switches pane when a rail item is clicked", () => {
    render(<SettingsSection model={baseModel()} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    expect(screen.getByTestId("settings-pane-limits")).toBeInTheDocument();
  });
});

// ─── Basic pane bindings ──────────────────────────────────────────────────────

describe("<SettingsSection /> — Основное pane", () => {
  it("updates basic.title on input change", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.change(screen.getByTestId("settings-title-input"), {
      target: { value: "Свежий тест" },
    });
    expect(runUpdater(updateModel, model).basic.title).toBe("Свежий тест");
  });

  it("updates basic.description on textarea change", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.change(screen.getByTestId("settings-description-input"), {
      target: { value: "Новое описание" },
    });
    expect(runUpdater(updateModel, model).basic.description).toBe("Новое описание");
  });

  it("toggles mode to adaptive when segmented button is clicked", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByRole("button", { name: "Адаптивный" }));
    expect(runUpdater(updateModel, model).mode).toBe("adaptive");
  });

  it("updates flowMode via select", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    selectOption("settings-flow-mode", "Маршрутизатор по темам");
    expect(runUpdater(updateModel, model).flowMode).toBe("router_by_topics");
  });
});

// ─── Limits pane bindings ─────────────────────────────────────────────────────

describe("<SettingsSection /> — Ограничения pane", () => {
  it("updates timeLimitMinutes to number when entered", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    fireEvent.change(screen.getByTestId("settings-time-limit-input"), {
      target: { value: "30" },
    });
    expect(runUpdater(updateModel, model).runtime.timeLimitMinutes).toBe(30);
  });

  it("sets timeLimitMinutes back to null when input is cleared", () => {
    const updateModel = vi.fn();
    const model = baseModel({ runtime: { timeLimitMinutes: 30, maxAttempts: null, showCorrectAnswers: false } });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    fireEvent.change(screen.getByTestId("settings-time-limit-input"), {
      target: { value: "" },
    });
    expect(runUpdater(updateModel, model).runtime.timeLimitMinutes).toBeNull();
  });

  it("toggles showCorrectAnswers via checkbox", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    fireEvent.click(screen.getByTestId("settings-show-correct-checkbox"));
    expect(runUpdater(updateModel, model).runtime.showCorrectAnswers).toBe(true);
  });
});

// ─── Integration pane bindings ────────────────────────────────────────────────

describe("<SettingsSection /> — Интеграция pane", () => {
  it("updates webhookUrl from input", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-integration"));
    fireEvent.change(screen.getByTestId("settings-webhook-input"), {
      target: { value: "https://example.com/webhook" },
    });
    expect(runUpdater(updateModel, model).basic.webhookUrl).toBe(
      "https://example.com/webhook",
    );
  });

  it("toggles telemetryEnabled via checkbox", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-integration"));
    fireEvent.click(screen.getByTestId("settings-telemetry-checkbox"));
    expect(runUpdater(updateModel, model).basic.telemetryEnabled).toBe(true);
  });
});

// ─── Pass-rules pane bindings ─────────────────────────────────────────────────

describe("<SettingsSection /> — Правила прохождения pane", () => {
  function buildSection(over: Partial<import("../../test-editor.types").EditorSection> = {}) {
    return {
      topicId: "top-1",
      topicName: "Topic 1",
      maxQuestions: 10,
      drawCount: 3,
      required: false,
      timeLimit: { source: "inherit_test" as const },
      feedback: { format: "plain" as const, text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      ...over,
    };
  }

  it("renders all 4 decision-policy radio options", () => {
    render(<SettingsSection model={baseModel()} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    expect(
      screen.getByRole("radio", { name: /достигнут общий проходной порог теста/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", {
        name: /достигнут общий проходной порог и пройдены все обязательные темы/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /^пройдены все обязательные темы$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /пройдена каждая выбранная тема/i }),
    ).toBeInTheDocument();
  });

  it("changes decisionPolicy when a radio is selected", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    fireEvent.click(
      screen.getByRole("radio", { name: /пройдена каждая выбранная тема/i }),
    );
    expect(runUpdater(updateModel, model).passRules.decisionPolicy).toBe(
      "all_topics_passed",
    );
  });

  it("changes overall rule type, keeping the value where possible", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    selectOption("pass-overall-type", "Сумма баллов");
    const next = runUpdater(updateModel, model).passRules.overall;
    expect(next.type).toBe("absolute");
    expect(next.value).toBe(70);
  });

  it("hides overall value input when type=none", () => {
    render(
      <SettingsSection
        model={baseModel({
          passRules: {
            decisionPolicy: "overall_only",
            overall: { type: "none", value: 0 },
            byTopic: {},
          },
        })}
        updateModel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    expect(screen.queryByTestId("pass-overall-value")).toBeNull();
  });

  it("updates overall.value on number input change", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    fireEvent.change(screen.getByTestId("pass-overall-value"), {
      target: { value: "85" },
    });
    expect(runUpdater(updateModel, model).passRules.overall.value).toBe(85);
  });

  it("shows a «нет тем» banner when sections array is empty", () => {
    render(<SettingsSection model={baseModel()} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    expect(screen.getByTestId("pass-rules-no-topics")).toBeInTheDocument();
    expect(screen.queryByTestId("pass-rules-topics-table")).toBeNull();
  });

  it("renders a row per topic and toggles required via checkbox", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1", topicName: "Topic 1", required: false }),
        buildSection({ topicId: "top-2", topicName: "Topic 2", required: true }),
      ],
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    expect(screen.getByTestId("pass-topic-row-top-1")).toBeInTheDocument();
    expect(screen.getByTestId("pass-topic-row-top-2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pass-topic-required-top-1"));
    expect(runUpdater(updateModel, model).sections[0].required).toBe(true);
  });

  it("expands custom-rule detail row when source = custom", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", topicName: "Topic 1" })],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 70 },
        byTopic: {
          "top-1": { source: "custom", type: "percent", value: 80 },
        },
      },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    expect(screen.getByTestId("pass-topic-detail-top-1")).toBeInTheDocument();
    const valInput = screen.getByTestId("pass-topic-custom-value-top-1") as HTMLInputElement;
    expect(valInput.value).toBe("80");
  });

  it("switching source to custom builds default percent/70 rule", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1" })],
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    selectOption("pass-topic-source-top-1", "Индивидуальное правило");
    const rule = runUpdater(updateModel, model).passRules.byTopic["top-1"];
    expect(rule).toEqual({ source: "custom", type: "percent", value: 70 });
  });
});

// ─── Adaptive pane bindings ───────────────────────────────────────────────────

describe("<SettingsSection /> — Адаптивный режим pane (mode = adaptive)", () => {
  function buildSection(over: Partial<import("../../test-editor.types").EditorSection> = {}) {
    return {
      topicId: "top-1",
      topicName: "Topic 1",
      maxQuestions: 10,
      drawCount: 3,
      required: false,
      timeLimit: { source: "inherit_test" as const },
      feedback: { format: "plain" as const, text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      ...over,
    };
  }
  /** Shorthand for `baseModel({ mode: "adaptive", ... })` used by every test. */
  function adaptiveModel(over: Partial<TestEditorModel> = {}): TestEditorModel {
    return baseModel({ mode: "adaptive", ...over });
  }

  it("toggles adaptive.showDifficultyLevel via master checkbox", () => {
    const updateModel = vi.fn();
    const model = adaptiveModel({
      adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    fireEvent.click(screen.getByTestId("adaptive-show-difficulty"));
    const next = runUpdater(updateModel, model);
    expect(next.adaptive.showDifficultyLevel).toBe(false);
    expect(next.adaptive.testSettings.showDifficultyLevel).toBe(false);
  });

  it("shows the «нет тем» banner when there are no sections", () => {
    render(<SettingsSection model={adaptiveModel()} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    expect(screen.getByTestId("adaptive-no-topics")).toBeInTheDocument();
    expect(screen.queryByTestId("adaptive-topics-list")).toBeNull();
  });

  it("renders an accordion per topic", () => {
    const model = adaptiveModel({
      sections: [
        buildSection({ topicId: "t1", topicName: "Тема А" }),
        buildSection({ topicId: "t2", topicName: "Тема Б" }),
      ],
    });
    render(<SettingsSection model={model} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    expect(screen.getByTestId("adaptive-topic-t1")).toBeInTheDocument();
    expect(screen.getByTestId("adaptive-topic-t2")).toBeInTheDocument();
  });

  it("toggles per-topic enabled flag without expanding the accordion", () => {
    const updateModel = vi.fn();
    const model = adaptiveModel({
      sections: [buildSection({ topicId: "t1", topicName: "Тема А" })],
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    fireEvent.click(screen.getByTestId("adaptive-topic-enabled-t1"));
    const next = runUpdater(updateModel, model);
    const topic = next.adaptive.topics.find((t) => t.topicId === "t1");
    expect(topic?.enabled).toBe(true);
  });

  it("opens the topic body and adds a default level when «+ Добавить уровень» is clicked", () => {
    const updateModel = vi.fn();
    const model = adaptiveModel({
      sections: [buildSection({ topicId: "t1", topicName: "Тема А" })],
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    fireEvent.click(screen.getByTestId("adaptive-topic-toggle-t1"));
    expect(screen.getByTestId("adaptive-topic-body-t1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("adaptive-add-level-t1"));
    const next = runUpdater(updateModel, model);
    const topic = next.adaptive.topics.find((t) => t.topicId === "t1");
    expect(topic?.levels).toHaveLength(1);
    expect(topic?.levels[0].levelIndex).toBe(0);
    expect(topic?.levels[0].passThresholdType).toBe("percent");
  });

  it("updates a level field via the card input", () => {
    const updateModel = vi.fn();
    const model = adaptiveModel({
      sections: [buildSection({ topicId: "t1", topicName: "Тема А" })],
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            topicId: "t1",
            topicName: "Тема А",
            failureFeedback: null,
            enabled: true,
            levels: [
              {
                levelIndex: 0,
                levelName: "L1",
                minDifficulty: 0,
                maxDifficulty: 30,
                questionsCount: 5,
                passThreshold: 60,
                passThresholdType: "percent",
                feedback: null,
                links: [],
              },
            ],
          },
        ],
      },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    fireEvent.click(screen.getByTestId("adaptive-topic-toggle-t1"));
    fireEvent.change(screen.getByTestId("adaptive-level-t1-0-threshold"), {
      target: { value: "75" },
    });
    const next = runUpdater(updateModel, model);
    expect(next.adaptive.topics[0].levels[0].passThreshold).toBe(75);
  });

  it("removes a level when its «×» button is clicked and reindexes remaining levels", () => {
    const updateModel = vi.fn();
    const model = adaptiveModel({
      sections: [buildSection({ topicId: "t1", topicName: "Тема А" })],
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            topicId: "t1",
            topicName: "Тема А",
            failureFeedback: null,
            enabled: true,
            levels: [
              { levelIndex: 0, levelName: "L1", minDifficulty: 0, maxDifficulty: 30, questionsCount: 5, passThreshold: 60, passThresholdType: "percent", feedback: null, links: [] },
              { levelIndex: 1, levelName: "L2", minDifficulty: 31, maxDifficulty: 70, questionsCount: 5, passThreshold: 70, passThresholdType: "percent", feedback: null, links: [] },
            ],
          },
        ],
      },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    fireEvent.click(screen.getByTestId("adaptive-topic-toggle-t1"));
    fireEvent.click(screen.getByTestId("adaptive-level-t1-0-remove"));
    const next = runUpdater(updateModel, model);
    expect(next.adaptive.topics[0].levels).toHaveLength(1);
    expect(next.adaptive.topics[0].levels[0].levelName).toBe("L2");
    expect(next.adaptive.topics[0].levels[0].levelIndex).toBe(0);
  });

  it("removes a per-level material link via the unified Feedback editor modal", () => {
    const updateModel = vi.fn();
    const model = adaptiveModel({
      sections: [buildSection({ topicId: "t1", topicName: "Тема А" })],
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            topicId: "t1",
            topicName: "Тема А",
            failureFeedback: null,
            enabled: true,
            levels: [
              { levelIndex: 0, levelName: "L1", minDifficulty: 0, maxDifficulty: 30, questionsCount: 5, passThreshold: 60, passThresholdType: "percent", feedback: null, links: [{ title: "Doc", url: "https://example.com" }] },
            ],
          },
        ],
      },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-adaptive"));
    fireEvent.click(screen.getByTestId("adaptive-topic-toggle-t1"));
    // Open the feedback editor modal for level 0
    fireEvent.click(screen.getByTestId("adaptive-level-t1-0-feedback"));
    // Remove the only link inside the modal
    fireEvent.click(screen.getByTestId("feedback-editor-link-remove-0"));
    // Save closes the modal and propagates the new links array via onSave
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    const next = runUpdater(updateModel, model);
    expect(next.adaptive.topics[0].levels[0].links).toHaveLength(0);
  });
});
