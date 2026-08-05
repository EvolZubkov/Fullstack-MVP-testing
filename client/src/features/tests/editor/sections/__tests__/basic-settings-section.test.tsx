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
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsSection } from "../basic-settings-section";
import type { TestEditorModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

/**
 * Секция ходит в API за каталогом видов отчёта (PRD-27), поэтому провайдер запросов
 * нужен ВСЕМ её тестам, а не только тем, что его помнят. Оборачиваем в одном месте:
 * `rerender` тоже сохраняет провайдера, иначе повторный рендер ронял бы дерево.
 */
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: React.ReactElement) => (
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>
  );
  const utils = rtlRender(wrap(ui));
  return { ...utils, rerender: (node: React.ReactElement) => utils.rerender(wrap(node)) };
}

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
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, quickAdvance: false, showSectionResults: true, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false },
    passRules: {
      decisionPolicy: "overall_only",
      overall: { type: "percent", value: 70 },
      byTopic: {},
    },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
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
    selectOption("settings-flow-mode", "Через страницу-маршрутизатор");
    expect(runUpdater(updateModel, model).flowMode).toBe("router_by_topics");
  });

  // S13.2-G7: «Общая обратная связь теста» card renders in Основное.
  it("renders the «Общая обратная связь теста» card with feedback trigger", () => {
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={vi.fn()} />);
    expect(screen.getByTestId("settings-feedback-card")).toBeInTheDocument();
    expect(screen.getByTestId("settings-feedback-trigger")).toBeInTheDocument();
  });

  // S13.2-G8: «Показывать правильные ответы» switch now lives in Основное
  // (inside the feedback card), not in Ограничения.
  it("toggles showCorrectAnswers from the Основное feedback card", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-show-correct-checkbox"));
    expect(runUpdater(updateModel, model).runtime.showCorrectAnswers).toBe(true);
  });
});

// ─── Mode / flowMode switching preserves data (FR-25h/i; checklist §2.2) ────────
//
// These drive the REAL production onChange handlers (SegmentedControl / Select)
// and apply the captured updater via runUpdater — so they catch regressions
// where a switch handler clears the other mode's data.

const sampleSection: TestEditorModel["sections"][number] = {
  topicId: "topic-1",
  topicName: "Topic A",
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
};

const sampleAdaptiveTopic: TestEditorModel["adaptive"]["topics"][number] = {
  topicId: "topic-1",
  topicName: "Topic A",
  failureFeedback: null,
  enabled: true,
  levels: [
    {
      levelIndex: 0,
      levelName: "Базовый",
      minDifficulty: 0,
      maxDifficulty: 33,
      questionsCount: 5,
      passThreshold: 70,
      passThresholdType: "percent",
      links: [{ title: "Курс", url: "https://e.com/1" }],
    },
  ],
};

describe("<SettingsSection /> — mode/flowMode switch preserves data", () => {
  it("switching standard → adaptive keeps title/sections and scaffolds adaptive topics", () => {
    const updateModel = vi.fn();
    const model = baseModel({ mode: "standard", sections: [sampleSection] });
    render(<SettingsSection model={model} updateModel={updateModel} />);

    fireEvent.click(screen.getByRole("button", { name: "Адаптивный" }));

    const next = runUpdater(updateModel, model);
    expect(next.mode).toBe("adaptive");
    expect(next.basic.title).toBe(model.basic.title); // standard data not lost
    expect(next.sections).toEqual(model.sections);
    // adaptive scaffold built for the existing section
    expect(next.adaptive.topics.some((t) => t.topicId === "topic-1")).toBe(true);
  });

  it("switching adaptive → standard keeps adaptive topics in the draft (hidden, not deleted)", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      mode: "adaptive",
      sections: [sampleSection],
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [sampleAdaptiveTopic],
      },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);

    fireEvent.click(screen.getByRole("button", { name: "Стандартный" }));

    const next = runUpdater(updateModel, model);
    expect(next.mode).toBe("standard");
    // Hidden adaptive levels/links survive so returning to adaptive restores them.
    expect(next.adaptive.topics).toEqual(model.adaptive.topics);
  });

  it("switching flowMode away from router keeps router flowSettings (restored on return)", () => {
    const updateModel = vi.fn();
    const router = {
      completionPolicy: "all_required_passed" as const,
      sectionUnlockRules: {},
    };
    const model = baseModel({ flowMode: "router_by_topics", flowSettings: { router } });
    render(<SettingsSection model={model} updateModel={updateModel} />);

    selectOption("settings-flow-mode", "Линейный");

    const next = runUpdater(updateModel, model);
    expect(next.flowMode).toBe("linear_flat");
    // Incompatible router settings are retained in the draft, not cleared.
    expect(next.flowSettings.router).toEqual(router);
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
    const model = baseModel({ runtime: { timeLimitMinutes: 30, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false } });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    fireEvent.change(screen.getByTestId("settings-time-limit-input"), {
      target: { value: "" },
    });
    expect(runUpdater(updateModel, model).runtime.timeLimitMinutes).toBeNull();
  });

  // Note: S13.2-G8 (2026-05-28) moved «Показывать правильные ответы» from
  // Ограничения to Основное → «Общая обратная связь теста» card. The new
  // location is covered by the Основное-pane describe block below.

  // S13.3-G9: per-topic «Индивидуальные лимиты» switch + table.
  it("shows the per-topic switch + no-topics info when sections is empty", () => {
    const model = baseModel({ sections: [] });
    render(<SettingsSection model={model} updateModel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    expect(screen.getByTestId("settings-per-topic-no-topics")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-per-topic-switch")).toBeNull();
  });

  it("shows the per-topic switch (OFF) when sections exist but all inherit_test", () => {
    const model = baseModel({ sections: [sampleSection] });
    render(<SettingsSection model={model} updateModel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    expect(screen.getByTestId("settings-per-topic-switch")).toBeInTheDocument();
    // Table is hidden until the author opts into a custom limit.
    expect(screen.queryByTestId("settings-per-topic-table")).toBeNull();
  });

  it("renders the per-topic table when any section has a non-inherit limit", () => {
    const model = baseModel({
      sections: [
        { ...sampleSection, timeLimit: { source: "custom", minutes: 15 } },
      ],
    });
    render(<SettingsSection model={model} updateModel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    expect(screen.getByTestId("settings-per-topic-table")).toBeInTheDocument();
    expect(
      screen.getByTestId(`settings-per-topic-limit-${sampleSection.topicId}`),
    ).toBeInTheDocument();
  });

  it("typing a positive minutes value switches the section to custom limit", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        { ...sampleSection, timeLimit: { source: "custom", minutes: 15 } },
      ],
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    fireEvent.change(
      screen.getByTestId(`settings-per-topic-limit-${sampleSection.topicId}`),
      { target: { value: "25" } },
    );
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].timeLimit).toEqual({ source: "custom", minutes: 25 });
  });

  it("clearing the input drops the section to source='none' (unlimited)", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        { ...sampleSection, timeLimit: { source: "custom", minutes: 15 } },
      ],
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    fireEvent.change(
      screen.getByTestId(`settings-per-topic-limit-${sampleSection.topicId}`),
      { target: { value: "" } },
    );
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].timeLimit).toEqual({ source: "none" });
  });

  it("turning the switch ON flips every inherit_test section to none and reveals the table", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        sampleSection,
        { ...sampleSection, topicId: "topic-2", topicName: "Topic B" },
      ],
    });
    const { rerender } = render(
      <SettingsSection model={model} updateModel={updateModel} />,
    );
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    // Switch starts OFF (all sections inherit_test) and the table is hidden.
    expect(screen.queryByTestId("settings-per-topic-table")).toBeNull();
    fireEvent.click(screen.getByTestId("settings-per-topic-switch"));
    const next = runUpdater(updateModel, model);
    // Every section becomes `none` so the derived switch stays ON.
    expect(next.sections.every((s) => s.timeLimit.source === "none")).toBe(true);
    // Re-rendering with the produced model now shows the per-topic table.
    rerender(<SettingsSection model={next} updateModel={updateModel} />);
    expect(screen.getByTestId("settings-per-topic-table")).toBeInTheDocument();
  });

  it("turning the switch OFF resets every section back to inherit_test", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        { ...sampleSection, timeLimit: { source: "custom", minutes: 15 } },
        {
          ...sampleSection,
          topicId: "topic-2",
          topicName: "Topic B",
          timeLimit: { source: "none" },
        },
      ],
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-limits"));
    fireEvent.click(screen.getByTestId("settings-per-topic-switch"));
    const next = runUpdater(updateModel, model);
    expect(next.sections.every((s) => s.timeLimit.source === "inherit_test")).toBe(true);
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
      drawAll: false,
      required: false,
      timeLimit: { source: "inherit_test" as const },
      feedback: { format: "plain" as const, text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      defaultPoints: null,
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

  it("renders a row per topic", () => {
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1", topicName: "Topic 1", required: false }),
        buildSection({ topicId: "top-2", topicName: "Topic 2", required: true }),
      ],
    });
    render(<SettingsSection model={model} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    expect(screen.getByTestId("pass-topic-row-top-1")).toBeInTheDocument();
    expect(screen.getByTestId("pass-topic-row-top-2")).toBeInTheDocument();
    // The «Обязательная» toggle lives in the «Состав» tab, not here.
    expect(screen.queryByTestId("pass-topic-required-top-1")).toBeNull();
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

  // ─── PRD-43: quick-advance toggle ─────────────────────────────────────────

  it("quickAdvance is independent of allowReturnToUnanswered", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      runtime: { ...baseModel().runtime, allowReturnToUnanswered: false, quickAdvance: false },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    const toggle = screen.getByTestId("settings-quick-advance-checkbox");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    const updated = runUpdater(updateModel, model);
    expect(updated.runtime.quickAdvance).toBe(true);
    // allowReturnToUnanswered must be untouched by toggling quickAdvance.
    expect(updated.runtime.allowReturnToUnanswered).toBe(false);
  });

  it("quickAdvance is disabled when showCorrectAnswers is on", () => {
    const model = baseModel({
      runtime: { ...baseModel().runtime, showCorrectAnswers: true, quickAdvance: true },
    });
    render(<SettingsSection model={model} updateModel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));
    const toggle = screen.getByTestId("settings-quick-advance-checkbox");
    expect(toggle).toBeDisabled();
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
      drawAll: false,
      required: false,
      timeLimit: { source: "inherit_test" as const },
      feedback: { format: "plain" as const, text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      defaultPoints: null,
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
    // Open the feedback editor modal for level 0 (non-empty → pencil opens it).
    fireEvent.click(screen.getByTestId("adaptive-level-t1-0-feedback-edit"));
    // Remove the only link inside the modal
    fireEvent.click(screen.getByTestId("feedback-editor-link-remove-0"));
    // Save closes the modal and propagates the new links array via onSave
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    const next = runUpdater(updateModel, model);
    expect(next.adaptive.topics[0].levels[0].links).toHaveLength(0);
  });
});

// ─── PRD-4 v1.1 L1: flowMode `linear_flat` blocked in adaptive mode ──────────

describe("PRD-4 v1.1 L1: adaptive+linear_flat UI guard", () => {
  it("opens flowMode select and marks linear_flat option disabled when mode=adaptive", () => {
    const model = baseModel({ mode: "adaptive", flowMode: "linear_by_topics" });
    render(<SettingsSection model={model} updateModel={vi.fn()} />);
    // DS Select renders the listbox lazily — click to open. The trigger is
    // marked with the parent test id; option text appears inside the popup.
    const trigger = screen
      .getByTestId("settings-flow-mode")
      .querySelector('[role="combobox"], button');
    if (trigger) fireEvent.click(trigger);
    // The augmented label «Линейный — недоступно в адаптивном режиме» is now
    // visible in the open listbox.
    expect(
      screen.queryByText(/недоступно в адаптивном режиме/i),
    ).toBeInTheDocument();
  });

  it("renders warning banner when an invalid (adaptive, linear_flat) state slips through", () => {
    // This combo should never occur once L4 auto-fix runs, but if a user
    // forces it via mode-switch in the UI we surface a recovery banner.
    const model = baseModel({ mode: "adaptive", flowMode: "linear_flat" });
    render(<SettingsSection model={model} updateModel={vi.fn()} />);
    expect(
      screen.getByTestId("settings-flow-mode-adaptive-flat-warning"),
    ).toBeInTheDocument();
  });

  it("does not render the warning for any valid (mode, flowMode) combination", () => {
    const validCombos: Array<{
      mode: "standard" | "adaptive";
      flowMode: TestEditorModel["flowMode"];
    }> = [
      { mode: "standard", flowMode: "linear_flat" },
      { mode: "standard", flowMode: "linear_by_topics" },
      { mode: "standard", flowMode: "router_by_topics" },
      { mode: "adaptive", flowMode: "linear_by_topics" },
      { mode: "adaptive", flowMode: "router_by_topics" },
    ];
    for (const combo of validCombos) {
      const { unmount } = render(
        <SettingsSection model={baseModel(combo)} updateModel={vi.fn()} />,
      );
      expect(
        screen.queryByTestId("settings-flow-mode-adaptive-flat-warning"),
      ).toBeNull();
      unmount();
    }
  });
});

// ─── Повторное прохождение pane (PRD-6) ───────────────────────────────────────

describe("<SettingsSection /> — Повторное прохождение pane (PRD-6)", () => {
  function renderRetake(model: TestEditorModel, updateModel: () => void = () => {}) {
    const utils = render(<SettingsSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-rail-retake"));
    return utils;
  }

  const enabledPolicy = (over: Partial<TestEditorModel["retakePolicy"]> = {}) => ({
    ...baseModel(),
    retakePolicy: {
      enabled: true,
      cooldownPeriodDays: 30,
      cooldownByOutcome: false,
      gateMode: "before_internal_start" as const,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" as const },
      ...over,
    },
  });

  it("shows only the switch when retake is disabled", () => {
    renderRetake(baseModel());
    expect(screen.getByTestId("settings-retake-switch")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-retake-cooldown-input")).toBeNull();
    expect(screen.queryByTestId("settings-retake-plugin")).toBeNull();
  });

  it("enabling seeds an eligibility plugin (failOpen) and reveals the fields", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    renderRetake(model, updateModel);
    fireEvent.click(screen.getByTestId("settings-retake-switch"));
    const next = runUpdater(updateModel, model);
    expect(next.retakePolicy.enabled).toBe(true);
    expect(next.retakePolicy.eligibilityPlugin?.key).toBeTruthy();
    expect(next.retakePolicy.eligibilityPlugin?.failPolicy).toBe("failOpen");
  });

  it("renders cooldown / plugin / failPolicy and no warning for webtutor", () => {
    renderRetake(enabledPolicy());
    expect(screen.getByTestId("settings-retake-cooldown-input")).toBeInTheDocument();
    expect(screen.getByTestId("settings-retake-plugin")).toBeInTheDocument();
    expect(screen.getByTestId("settings-retake-failpolicy-group")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-retake-besteffort-warning")).toBeNull();
  });

  it("shows the outcome-split switch off by default, only the single field visible", () => {
    renderRetake(enabledPolicy());
    expect(screen.getByTestId("settings-retake-outcome-switch")).toBeInTheDocument();
    expect(screen.getByTestId("settings-retake-cooldown-input")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-retake-cooldown-passed-input")).toBeNull();
    expect(screen.queryByTestId("settings-retake-cooldown-failed-input")).toBeNull();
  });

  it("turning the outcome-split switch on swaps the single field for two", () => {
    const updateModel = vi.fn();
    const model = enabledPolicy();
    renderRetake(model, updateModel);
    fireEvent.click(screen.getByTestId("settings-retake-outcome-switch"));
    const next = runUpdater(updateModel, model);
    expect(next.retakePolicy.cooldownByOutcome).toBe(true);
  });

  it("renders both split fields once the switch is on, seeded from defaults", () => {
    renderRetake(
      enabledPolicy({ cooldownByOutcome: true, cooldownPeriodDaysPassed: 90, cooldownPeriodDaysFailed: 7 }),
    );
    expect(screen.queryByTestId("settings-retake-cooldown-input")).toBeNull();
    const passedInput = screen.getByTestId("settings-retake-cooldown-passed-input") as HTMLInputElement;
    const failedInput = screen.getByTestId("settings-retake-cooldown-failed-input") as HTMLInputElement;
    expect(passedInput.value).toBe("90");
    expect(failedInput.value).toBe("7");
  });

  it("edits the passed/failed periods independently and clamps into [1, 3650]", () => {
    const updateModel = vi.fn();
    const model = enabledPolicy({
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
    });
    renderRetake(model, updateModel);
    fireEvent.change(screen.getByTestId("settings-retake-cooldown-passed-input"), { target: { value: "5000" } });
    expect(runUpdater(updateModel, model).retakePolicy.cooldownPeriodDaysPassed).toBe(3650);
    fireEvent.change(screen.getByTestId("settings-retake-cooldown-failed-input"), { target: { value: "0" } });
    expect(runUpdater(updateModel, model, 1).retakePolicy.cooldownPeriodDaysFailed).toBe(1);
  });

  it("toggles failPolicy to failClosed via the segmented control", () => {
    const updateModel = vi.fn();
    const model = enabledPolicy();
    renderRetake(model, updateModel);
    fireEvent.click(screen.getByRole("button", { name: "Заблокировать" }));
    const next = runUpdater(updateModel, model);
    expect(next.retakePolicy.eligibilityPlugin?.failPolicy).toBe("failClosed");
  });

  // ─── PRD-31: интервал между попытками ────────────────────────────────────
  //
  // Второй барьер НЕЗАВИСИМ от кулдауна (FR-03): он должен настраиваться и при
  // выключенном «Ограничить повторное прохождение» — это и есть новый случай,
  // ради которого `cooldownPeriodDays` перестал быть обязательным.

  it("shows the interval switch even when the cooldown is off", () => {
    renderRetake(baseModel());
    expect(screen.getByTestId("settings-attempt-interval-switch")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-attempt-interval-input")).toBeNull();
  });

  it("enabling the interval seeds 24 hours and reveals the field", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    renderRetake(model, updateModel);
    fireEvent.click(screen.getByTestId("settings-attempt-interval-switch"));
    const next = runUpdater(updateModel, model);
    expect(next.retakePolicy.attemptInterval).toEqual({ enabled: true, hours: 24 });
    // Включение интервала НЕ включает кулдаун: барьеры независимы.
    expect(next.retakePolicy.enabled).toBe(false);
  });

  it("renders the hours field when the interval is on", () => {
    renderRetake({
      ...baseModel(),
      retakePolicy: {
        ...baseModel().retakePolicy,
        attemptInterval: { enabled: true, hours: 12 },
      },
    });
    const input = screen.getByTestId("settings-attempt-interval-input") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("12");
  });

  it("clamps the interval into [1, 8760]", () => {
    const updateModel = vi.fn();
    const model = {
      ...baseModel(),
      retakePolicy: {
        ...baseModel().retakePolicy,
        attemptInterval: { enabled: true, hours: 24 },
      },
    };
    renderRetake(model, updateModel);
    const input = screen.getByTestId("settings-attempt-interval-input");
    fireEvent.change(input, { target: { value: "9000" } });
    expect(runUpdater(updateModel, model).retakePolicy.attemptInterval?.hours).toBe(8760);
    // `runUpdater` reads the FIRST recorded call unless told otherwise, so the
    // second change has to be addressed by index — otherwise this would silently
    // re-assert the previous one.
    fireEvent.change(input, { target: { value: "0" } });
    expect(runUpdater(updateModel, model, 1).retakePolicy.attemptInterval?.hours).toBe(1);
  });

  it("turning the interval off keeps the hours value for a later re-enable", () => {
    const updateModel = vi.fn();
    const model = {
      ...baseModel(),
      retakePolicy: {
        ...baseModel().retakePolicy,
        attemptInterval: { enabled: true, hours: 48 },
      },
    };
    renderRetake(model, updateModel);
    fireEvent.click(screen.getByTestId("settings-attempt-interval-switch"));
    const next = runUpdater(updateModel, model);
    expect(next.retakePolicy.attemptInterval).toEqual({ enabled: false, hours: 48 });
  });
});

// ─── PRD-24: «По вариантам» ──────────────────────────────────────────────────

describe("<SettingsSection /> — правило «По вариантам» (PRD-24)", () => {
  const forms = [
    { id: "v1", label: "Вариант 1", questionIds: ["q1", "q2"] },
    { id: "v2", label: "Вариант 2", questionIds: ["q3"] },
  ];
  const section = (over: Record<string, unknown> = {}) => ({
    topicId: "top-1",
    topicName: "Topic 1",
    maxQuestions: 10,
    drawCount: 3,
    drawAll: false,
    required: false,
    timeLimit: { source: "inherit_test" as const },
    feedback: { format: "plain" as const, text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
    ...over,
  });
  const variantsModel = (byTopic: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
    baseModel({
      sections: [section({ formSet: { forms } })],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 65 },
        byTopic,
      },
      ...over,
    } as never);

  const openPane = () => fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));

  it("offers «По вариантам» only for a topic delivered as variants", () => {
    render(<SettingsSection model={variantsModel()} updateModel={() => {}} />);
    openPane();
    fireEvent.click(within(screen.getByTestId("pass-topic-source-top-1")).getByRole("button"));
    expect(screen.getByRole("option", { name: "По вариантам" })).toBeInTheDocument();
  });

  it("hides «По вариантам» for a topic without variants", () => {
    const model = baseModel({ sections: [section()] } as never);
    render(<SettingsSection model={model} updateModel={() => {}} />);
    openPane();
    fireEvent.click(within(screen.getByTestId("pass-topic-source-top-1")).getByRole("button"));
    expect(screen.queryByRole("option", { name: "По вариантам" })).not.toBeInTheDocument();
  });

  it("seeds a threshold for every variant when the source is picked", () => {
    const updateModel = vi.fn();
    const model = variantsModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    openPane();
    selectOption("pass-topic-source-top-1", "По вариантам");
    // seeded from the test's overall percent so the rule is valid immediately
    expect(runUpdater(updateModel, model).passRules.byTopic["top-1"]).toEqual({
      source: "by_variant",
      byForm: { v1: { type: "percent", value: 65 }, v2: { type: "percent", value: 65 } },
    });
  });

  it("renders one row per variant with its own threshold", () => {
    const model = variantsModel({
      "top-1": { source: "by_variant", byForm: { v1: { type: "percent", value: 60 }, v2: { type: "absolute", value: 1 } } },
    });
    render(<SettingsSection model={model} updateModel={() => {}} />);
    openPane();
    expect(screen.getByTestId("pass-topic-variants-top-1")).toBeInTheDocument();
    expect(screen.getByTestId("pass-variant-value-top-1-v1")).toBeInTheDocument();
    expect(screen.getByTestId("pass-variant-value-top-1-v2")).toBeInTheDocument();
    expect(screen.getByText("Вариант 1")).toBeInTheDocument();
    expect(screen.getByText("Вариант 2")).toBeInTheDocument();
  });

  it("hints the attainable points an absolute threshold is capped by", () => {
    const model = variantsModel(
      { "top-1": { source: "by_variant", byForm: { v1: { type: "absolute", value: 2 }, v2: { type: "percent", value: 60 } } } },
      { scoring: { defaultQuestionPoints: null, questionOverrides: [{ questionId: "q1", points: 5, scoringJson: null, difficulty: null, pinnedContentHash: null }] } },
    );
    render(<SettingsSection model={model} updateModel={() => {}} />);
    openPane();
    // q1 overridden to 5 + q2 at the system default 1 → 6, not "2 questions"
    expect(screen.getByText(/макс\. 6 баллов/)).toBeInTheDocument();
  });

  // One shared hint under the block read as belonging to the LAST variant row.
  // The ceiling belongs to a single variant's threshold, so it is printed under
  // that variant — and only where it means something (an absolute threshold).
  it("prints the ceiling under each variant with an absolute threshold", () => {
    const model = variantsModel(
      { "top-1": { source: "by_variant", byForm: { v1: { type: "absolute", value: 2 }, v2: { type: "absolute", value: 1 } } } },
      { scoring: { defaultQuestionPoints: null, questionOverrides: [{ questionId: "q1", points: 5, scoringJson: null, difficulty: null, pinnedContentHash: null }] } },
    );
    render(<SettingsSection model={model} updateModel={() => {}} />);
    openPane();
    // v1 = q1(5) + q2(1) = 6, v2 = q3(1) = 1
    expect(screen.getByTestId("pass-variant-max-top-1-v1")).toHaveTextContent("макс. 6 баллов");
    expect(screen.getByTestId("pass-variant-max-top-1-v2")).toHaveTextContent("макс. 1 баллов");
  });

  it("prints no ceiling for a variant judged by percent", () => {
    const model = variantsModel({
      "top-1": { source: "by_variant", byForm: { v1: { type: "absolute", value: 2 }, v2: { type: "percent", value: 60 } } },
    });
    render(<SettingsSection model={model} updateModel={() => {}} />);
    openPane();
    expect(screen.getByTestId("pass-variant-max-top-1-v1")).toBeInTheDocument();
    expect(screen.queryByTestId("pass-variant-max-top-1-v2")).not.toBeInTheDocument();
  });

  it("patches only the edited variant's threshold", () => {
    const updateModel = vi.fn();
    const model = variantsModel({
      "top-1": { source: "by_variant", byForm: { v1: { type: "percent", value: 60 }, v2: { type: "percent", value: 80 } } },
    });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    openPane();
    selectOption("pass-variant-type-top-1-v1", "Сумма баллов");
    expect(runUpdater(updateModel, model).passRules.byTopic["top-1"]).toEqual({
      source: "by_variant",
      byForm: { v1: { type: "absolute", value: 60 }, v2: { type: "percent", value: 80 } },
    });
  });
});
