/**
 * @module features/tests/editor/sections/__tests__/basic-settings-section.coverage.test
 * @description Coverage-oriented tests for the «Настройки» tab that the base
 * suite (`basic-settings-section.test.tsx`) does not reach: the max-attempts
 * field, the PRD-19 in-attempt navigation switches and their disabled banners,
 * per-topic custom pass rules, the adaptive level-card field editors / collapse
 * / validity dot / single-level remove guard / failure feedback, the rail error
 * and warning dots, the test-level feedback trigger, and RetakePane cooldown
 * clamping + plugin selection.
 *
 * Complements — never duplicates — the base file.
 */
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdaptivePane,
  DuringTestPane,
  FeedbackTextsPane,
  LimitsPane,
  NavigationPane,
  ScenarioSettingsPane,
  VerdictPane,
} from "../basic-settings-section";
import { CompositionTab } from "../editor-tabs";
import type { TestEditorModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import { buildFieldErrorIndex, type FieldErrorIndex } from "../../field-errors";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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
      descriptionFormat: "plain",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowFreeSectionNavigation: false, allowAnswerChange: false, showSectionResults: true, skipReviewWhenComplete: false, closeSectionOnLeave: false, quickAdvance: false, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false, lmsAttemptResult: "best" as const },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
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

function buildSection(over: Partial<TestEditorModel["sections"][number]> = {}) {
  return {
    topicId: "t1",
    topicName: "Тема А",
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

function makeLevel(over: Partial<TestEditorModel["adaptive"]["topics"][number]["levels"][number]> = {}) {
  return {
    levelIndex: 0,
    levelName: "L1",
    minDifficulty: 0,
    maxDifficulty: 30,
    questionsCount: 5,
    passThreshold: 60,
    passThresholdType: "percent" as const,
    feedback: null,
    links: [],
    ...over,
  };
}

function runUpdater(
  updateModel: ReturnType<typeof vi.fn>,
  model: TestEditorModel,
  call = 0,
): TestEditorModel {
  const updater = updateModel.mock.calls[call][0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

function renderSettings(
  model: TestEditorModel,
  updateModel: (u: (m: TestEditorModel) => TestEditorModel) => void = () => {},
  opts: {
    fieldErrors?: FieldErrorIndex;
    seedPlugins?: unknown;
    /** Панель нового дерева, на которой живёт проверяемая настройка. */
    pane?: React.ComponentType<{
      model: TestEditorModel;
      updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
      fieldErrors?: FieldErrorIndex;
    }>;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (opts.seedPlugins && model.id) {
    client.setQueryData([`/api/tests/${model.id}/available-eligibility-plugins`], opts.seedPlugins);
  }
  const Pane = opts.pane ?? NavigationPane;
  return render(
    <QueryClientProvider client={client}>
      <Pane model={model} updateModel={updateModel} fieldErrors={opts.fieldErrors} />
    </QueryClientProvider>,
  );
}

/** Open a DS Select by testid wrapper and click the option with `label`. */
function selectOption(selectTestId: string, label: string | RegExp) {
  const wrap = screen.getByTestId(selectTestId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

// ─── Limits pane: max attempts ────────────────────────────────────────────────

describe("<LimitsPane /> — Ограничения: попытки", () => {
  it("sets maxAttempts to the entered number", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    renderSettings(model, updateModel, { pane: LimitsPane });
    fireEvent.change(screen.getByTestId("settings-max-attempts-input"), { target: { value: "3" } });
    expect(runUpdater(updateModel, model).runtime.maxAttempts).toBe(3);
  });

  it("clears maxAttempts to null when set to 0", () => {
    const updateModel = vi.fn();
    const model = baseModel({ runtime: { ...baseModel().runtime, maxAttempts: 3 } });
    renderSettings(model, updateModel, { pane: LimitsPane });
    fireEvent.change(screen.getByTestId("settings-max-attempts-input"), { target: { value: "0" } });
    expect(runUpdater(updateModel, model).runtime.maxAttempts).toBeNull();
  });
});

// ─── Pass-rules pane: PRD-19 navigation switches ──────────────────────────────

describe("<NavigationPane /> — навигация прохождения (PRD-19)", () => {
  it("turning «возврат к неотвеченным» off also clears «изменение ответа»", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      runtime: { ...baseModel().runtime, allowReturnToUnanswered: true, allowFreeSectionNavigation: false, allowAnswerChange: true },
    });
    renderSettings(model, updateModel, { pane: NavigationPane });
    fireEvent.click(screen.getByTestId("settings-allow-return-checkbox"));
    const next = runUpdater(updateModel, model);
    expect(next.runtime.allowReturnToUnanswered).toBe(false);
    expect(next.runtime.allowAnswerChange).toBe(false);
  });

  it("toggles «изменение ответа» on when return is enabled and answers hidden", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    renderSettings(model, updateModel, { pane: NavigationPane });
    fireEvent.click(screen.getByTestId("settings-allow-change-checkbox"));
    expect(runUpdater(updateModel, model).runtime.allowAnswerChange).toBe(true);
  });

  it("disables «изменение ответа» with a banner when return is off", () => {
    const model = baseModel({
      runtime: { ...baseModel().runtime, allowReturnToUnanswered: false },
    });
    renderSettings(model, undefined, { pane: NavigationPane });
    const toggle = screen.getByTestId("settings-allow-change-checkbox");
    expect(toggle).toBeDisabled();
    // Причина ищется В ПОЛЕ этого переключателя, а не по всей панели: ту же причину
    // печатает погашенная «Свободная навигация внутри раздела» (PRD-19 FR-11c), и поиск
    // по одному тексту стал бы неоднозначным.
    const field = toggle.closest(".ou-formfield") as HTMLElement;
    expect(within(field).getByText(/только при включённом возврате/i)).toBeInTheDocument();
  });

  it("disables «изменение ответа» with a banner when correct answers are shown", () => {
    const model = baseModel({
      runtime: { ...baseModel().runtime, allowReturnToUnanswered: true, showCorrectAnswers: true },
    });
    renderSettings(model, undefined, { pane: NavigationPane });
    expect(screen.getByTestId("settings-allow-change-checkbox")).toBeDisabled();
    expect(screen.getByText(/иначе ученик увидит правильный ответ/i)).toBeInTheDocument();
  });

  // Решение владельца 2026-09-20: экран итогов раздела — это ПОКАЗ РЕЗУЛЬТАТА, поэтому
  // переключатель живёт на «Обратная связь и итоги» → «Во время теста», а не в «Сценарии»,
  // где автор искал его среди настроек потока и не находил.
  it("shows and toggles «итоги раздела» for a sectioned (non-flat) test", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      flowMode: "linear_by_topics",
      sections: [buildSection({ topicId: "t1" })],
    });
    renderSettings(model, updateModel, { pane: DuringTestPane });
    fireEvent.click(screen.getByTestId("settings-show-section-results-checkbox"));
    expect(runUpdater(updateModel, model).runtime.showSectionResults).toBe(false);
  });

  it("hides «итоги раздела» for a flat test", () => {
    const model = baseModel({ flowMode: "linear_flat", sections: [buildSection({ topicId: "t1" })] });
    renderSettings(model, undefined, { pane: DuringTestPane });
    expect(screen.queryByTestId("settings-show-section-results-checkbox")).toBeNull();
  });

  it("no longer offers «итоги раздела» in the «Сценарий» pane", () => {
    const model = baseModel({
      flowMode: "linear_by_topics",
      sections: [buildSection({ topicId: "t1" })],
    });
    renderSettings(model, undefined, { pane: ScenarioSettingsPane });
    expect(screen.queryByTestId("settings-show-section-results-checkbox")).toBeNull();
  });
});

// ─── Pass-rules pane: overall type=none + per-topic custom rules ───────────────

describe("<VerdictPane /> — правила прохождения тем", () => {
  it("switches the overall rule type to «Не задано» and hides the value input", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    renderSettings(model, updateModel, { pane: VerdictPane });
    selectOption("pass-overall-type", "Не задано");
    expect(runUpdater(updateModel, model).passRules.overall.type).toBe("none");
  });

  function customModel() {
    return baseModel({
      sections: [buildSection({ topicId: "t1", topicName: "Тема А" })],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 70 },
        byTopic: { t1: { source: "custom", type: "percent", value: 80 } },
      },
    });
  }

  it("updates a custom per-topic threshold value", () => {
    const updateModel = vi.fn();
    const model = customModel();
    renderSettings(model, updateModel, { pane: VerdictPane });
    fireEvent.change(screen.getByTestId("pass-topic-custom-value-t1"), { target: { value: "90" } });
    const rule = runUpdater(updateModel, model).passRules.byTopic.t1;
    expect(rule.source === "custom" && rule.value).toBe(90);
  });

  it("switches a custom per-topic rule type to «Сумма баллов»", () => {
    const updateModel = vi.fn();
    const model = customModel();
    renderSettings(model, updateModel, { pane: VerdictPane });
    selectOption("pass-topic-custom-type-t1", "Сумма баллов");
    const rule = runUpdater(updateModel, model).passRules.byTopic.t1;
    expect(rule.source === "custom" && rule.type).toBe("absolute");
  });

  it("switches a per-topic source to «Не проверять отдельно» (none)", () => {
    const updateModel = vi.fn();
    const model = customModel();
    renderSettings(model, updateModel, { pane: VerdictPane });
    selectOption("pass-topic-source-t1", "Не проверять отдельно");
    expect(runUpdater(updateModel, model).passRules.byTopic.t1).toEqual({ source: "none" });
  });

  it("switches a per-topic source back to «Как у теста» (inherit)", () => {
    const updateModel = vi.fn();
    const model = customModel();
    renderSettings(model, updateModel, { pane: VerdictPane });
    selectOption("pass-topic-source-t1", "Как у теста");
    expect(runUpdater(updateModel, model).passRules.byTopic.t1).toEqual({ source: "inherit_overall" });
  });
});

// ─── Adaptive pane: banners, hints, level card ────────────────────────────────

describe("<AdaptivePane /> — Адаптивный режим (доп. ветки)", () => {
  function adaptive(over: Partial<TestEditorModel> = {}) {
    return baseModel({ mode: "adaptive", ...over });
  }

  it("shows the «no enabled topics» error banner", () => {
    const model = adaptive({ sections: [buildSection({ topicId: "t1" })] });
    renderSettings(model, undefined, { pane: AdaptivePane });
    expect(screen.getByTestId("adaptive-no-enabled-topics")).toBeInTheDocument();
  });

  it("shows the «add levels» hint for an enabled topic with no levels", () => {
    const model = adaptive({
      sections: [buildSection({ topicId: "t1" })],
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [{ topicId: "t1", topicName: "Тема А", failureFeedback: null, enabled: true, levels: [] }],
      },
    });
    renderSettings(model, undefined, { pane: AdaptivePane });
    expect(screen.getByTestId("adaptive-topic-hint-t1")).toHaveTextContent(/Добавьте уровни/i);
  });

  it("shows the «add one more level» hint for an enabled topic with a single level", () => {
    const model = adaptive({
      sections: [buildSection({ topicId: "t1" })],
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [{ topicId: "t1", topicName: "Тема А", failureFeedback: null, enabled: true, levels: [makeLevel()] }],
      },
    });
    renderSettings(model, undefined, { pane: AdaptivePane });
    expect(screen.getByTestId("adaptive-topic-hint-t1")).toHaveTextContent(/ещё один уровень/i);
  });

  function withOneLevel(levelOver = {}) {
    return adaptive({
      sections: [buildSection({ topicId: "t1" })],
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          { topicId: "t1", topicName: "Тема А", failureFeedback: null, enabled: true, levels: [makeLevel(levelOver)] },
        ],
      },
    });
  }

  function openTopicBody(model: TestEditorModel, updateModel = vi.fn()) {
    renderSettings(model, updateModel, { pane: AdaptivePane });
    fireEvent.click(screen.getByTestId("adaptive-topic-toggle-t1"));
    return updateModel;
  }

  it("edits the level name / difficulty range / question count", () => {
    const model = withOneLevel();
    const updateModel = openTopicBody(model);
    fireEvent.change(screen.getByTestId("adaptive-level-t1-0-name"), { target: { value: "Средний" } });
    expect(runUpdater(updateModel, model).adaptive.topics[0].levels[0].levelName).toBe("Средний");

    fireEvent.change(screen.getByTestId("adaptive-level-t1-0-min"), { target: { value: "10" } });
    expect(runUpdater(updateModel, model, 1).adaptive.topics[0].levels[0].minDifficulty).toBe(10);

    fireEvent.change(screen.getByTestId("adaptive-level-t1-0-max"), { target: { value: "80" } });
    expect(runUpdater(updateModel, model, 2).adaptive.topics[0].levels[0].maxDifficulty).toBe(80);

    fireEvent.change(screen.getByTestId("adaptive-level-t1-0-questions"), { target: { value: "8" } });
    expect(runUpdater(updateModel, model, 3).adaptive.topics[0].levels[0].questionsCount).toBe(8);
  });

  it("switches the level threshold type to «Сумма баллов»", () => {
    const model = withOneLevel();
    const updateModel = openTopicBody(model);
    selectOption("adaptive-level-t1-0-threshold-type", "Сумма баллов");
    expect(runUpdater(updateModel, model).adaptive.topics[0].levels[0].passThresholdType).toBe("absolute");
  });

  it("collapses a level card via its chevron", () => {
    const model = withOneLevel();
    openTopicBody(model);
    const chev = screen.getByTestId("adaptive-level-t1-0-toggle");
    expect(chev).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chev);
    expect(chev).toHaveAttribute("aria-expanded", "false");
  });

  it("marks a level invalid when min exceeds max", () => {
    const model = withOneLevel({ minDifficulty: 50, maxDifficulty: 10 });
    openTopicBody(model);
    expect(screen.getByTestId("adaptive-level-t1-0-status")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/невалидно/i),
    );
  });

  it("disables the remove button for the only level", () => {
    const model = withOneLevel();
    openTopicBody(model);
    expect(screen.getByTestId("adaptive-level-t1-0-remove")).toBeDisabled();
  });

  // Текст темы «при не пройденном уровне» и тексты уровней правятся не здесь: с Э2.5 они
  // живут карточкой «По уровням» на вкладке обратной связи. Проверки — в
  // `level-feedback-card.test.tsx`.
});

// ─── Точки состояния рейла (FR-20c) ──────────────────────────────────────────

/**
 * После перестройки ящика рейл принадлежит ВКЛАДКЕ, а не секции настроек: точки
 * состояния проверяются на «Составе и сценарии», где живут адаптивные уровни. Ошибка
 * названия теста показывается точкой самой вкладки «Основное» — рейла у неё нет.
 */
describe("<CompositionTab /> — точки состояния рейла", () => {
  function renderTab(model: TestEditorModel) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    return render(
      <QueryClientProvider client={client}>
        <CompositionTab
          model={model}
          updateModel={() => {}}
          savedFlowMode={null}
        />
      </QueryClientProvider>,
    );
  }

  it("отмечает ошибкой «Адаптивные уровни», когда не включена ни одна тема", () => {
    renderTab(baseModel({ mode: "adaptive", sections: [buildSection({ topicId: "t1" })] }));
    expect(within(screen.getByTestId("composition-rail-adaptive")).getByLabelText("Ошибка")).toBeInTheDocument();
  });

  it("отмечает замечанием тему, у которой меньше двух уровней", () => {
    renderTab(
      baseModel({
        mode: "adaptive",
        sections: [buildSection({ topicId: "t1" })],
        adaptive: {
          showDifficultyLevel: true,
          testSettings: { showDifficultyLevel: true },
          topics: [{ topicId: "t1", topicName: "Тема А", failureFeedback: null, enabled: true, levels: [makeLevel()] }],
        },
      }),
    );
    expect(
      within(screen.getByTestId("composition-rail-adaptive")).getByLabelText("Требует внимания"),
    ).toBeInTheDocument();
  });

  it("не показывает «Адаптивные уровни» стандартному тесту", () => {
    renderTab(baseModel());
    expect(screen.queryByTestId("composition-rail-adaptive")).toBeNull();
  });
});

// ─── Вводный текст по исходу (PRD-61) ─────────────────────────────────────────

describe("<FeedbackTextsPane /> — вводный текст по исходу", () => {
  // Здесь была правка общей обратной связи ТЕСТА: её сняли (PRD-61 §10), и вместо неё
  // страница правит три вводных текста. Проверяется самое хрупкое место — правка текста
  // ИСХОДА не должна задевать общий текст и наоборот.
  it("текст исхода пишется в свою ветвь и не трогает общий", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    renderSettings(model, updateModel, { pane: FeedbackTextsPane });
    fireEvent.click(screen.getByTestId("settings-intro-results-failed-trigger"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), { target: { value: "Не хватило баллов." } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    const next = runUpdater(updateModel, model);
    expect(next.intro?.results?.failed?.text).toBe("Не хватило баллов.");
    expect(next.intro?.results?.text).toBe("");
  });

  it("общий текст пишется рядом с текстом исхода, не стирая его", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    model.intro = { results: { format: "plain", text: "", failed: { format: "plain", text: "Не хватило." } } };
    renderSettings(model, updateModel, { pane: FeedbackTextsPane });
    fireEvent.click(screen.getByTestId("settings-intro-results-trigger"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), { target: { value: "Спасибо." } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    const next = runUpdater(updateModel, model);
    expect(next.intro?.results?.text).toBe("Спасибо.");
    expect(next.intro?.results?.failed?.text).toBe("Не хватило.");
  });
});

// ─── Retake pane: cooldown clamp + plugin selection ───────────────────────────

describe("<LimitsPane /> — Повторное прохождение (доп. ветки)", () => {
  const plugins = {
    plugins: [
      { key: "webtutor_cooldown", name: "WebTutor", version: "1", description: "", bestEffort: false, configs: [] },
    ],
  };

  function enabledModel(over: Partial<TestEditorModel["retakePolicy"]> = {}) {
    return baseModel({
      id: "test-1",
      retakePolicy: {
        enabled: true,
        cooldownPeriodDays: 30,
        cooldownByOutcome: false,
        gateMode: "before_internal_start",
        eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
        ...over,
      },
    });
  }

  it("updates the cooldown period from the number input", () => {
    const updateModel = vi.fn();
    const model = enabledModel();
    renderSettings(model, updateModel, { pane: LimitsPane, seedPlugins: plugins });
    fireEvent.change(screen.getByTestId("settings-retake-cooldown-input"), { target: { value: "45" } });
    expect(runUpdater(updateModel, model).retakePolicy.cooldownPeriodDays).toBe(45);
  });

  it("clamps an over-large cooldown down to 3650 days", () => {
    const updateModel = vi.fn();
    const model = enabledModel();
    renderSettings(model, updateModel, { pane: LimitsPane, seedPlugins: plugins });
    fireEvent.change(screen.getByTestId("settings-retake-cooldown-input"), { target: { value: "5000" } });
    expect(runUpdater(updateModel, model).retakePolicy.cooldownPeriodDays).toBe(3650);
  });
});
