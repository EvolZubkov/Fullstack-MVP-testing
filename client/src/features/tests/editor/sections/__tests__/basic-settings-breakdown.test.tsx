/**
 * @module features/tests/editor/sections/__tests__/basic-settings-breakdown.test
 * @description PRD-50 FR-13: the «Подытоги по подтемам» control in the «Состав итогов»
 * pane — visibility selector present, defaults to «Не показывать», and reports
 * `{ visibility, basis }` through `updateModel` on change.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BreakdownDisplayPane } from "../basic-settings-section";
import type { TestEditorModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

/** Same wrapper the neighbouring settings-section tests use: the pane fetches
 *  the PRD-27 report-variant catalog, so every render needs a query provider. */
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
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
      description: "",
      descriptionFormat: "plain",
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
      allowFreeSectionNavigation: false,
      allowAnswerChange: false,
      quickAdvance: false,
      showSectionResults: true,
      skipReviewWhenComplete: false, closeSectionOnLeave: false,
      copyProtection: true,
      protectionWatermark: false,
      protectionHideOnBlur: false,
      lmsAttemptResult: "best" as const,
    },
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
  const updater = updateModel.mock.calls[call][0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

/** Opens the ui-kit Select identified by its wrapper testid, then clicks the
 *  option with the given visible label (same helper as the neighbouring test). */
function selectOption(selectTestId: string, optionLabel: string | RegExp) {
  const wrap = screen.getByTestId(selectTestId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("<BreakdownDisplayPane /> — Подытоги по подтемам (PRD-50 FR-13)", () => {
  it("рендерит селектор видимости в панели «Состав итогов»", () => {
    render(<BreakdownDisplayPane model={baseModel()} updateModel={() => {}} />);
    expect(screen.getByTestId("settings-breakdown-visibility-select")).toBeInTheDocument();
  });

  it("умолчание — «Не показывать», и селектор базы скрыт", () => {
    render(<BreakdownDisplayPane model={baseModel()} updateModel={() => {}} />);
    expect(
      within(screen.getByTestId("settings-breakdown-visibility-select")).getByRole("button"),
    ).toHaveTextContent("Не показывать");
    expect(screen.queryByTestId("settings-breakdown-basis-select")).not.toBeInTheDocument();
  });

  it("выбор «Полоса» отдаёт наверх { visibility: \"bar\", basis: \"units\" }", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<BreakdownDisplayPane model={model} updateModel={updateModel} />);
    selectOption("settings-breakdown-visibility-select", "Полоса");
    expect(runUpdater(updateModel, model).runtime.breakdownDisplay).toEqual({
      visibility: "bar",
      basis: "units",
    });
  });

  it("показывает селектор базы, когда видимость не «hidden»", () => {
    render(
      <BreakdownDisplayPane
        model={baseModel({
          runtime: {
            timeLimitMinutes: null,
            maxAttempts: null,
            showCorrectAnswers: false,
            allowReturnToUnanswered: true,
            allowFreeSectionNavigation: false,
            allowAnswerChange: false,
            quickAdvance: false,
            showSectionResults: true,
            skipReviewWhenComplete: false, closeSectionOnLeave: false,
            copyProtection: true,
            protectionWatermark: false,
            protectionHideOnBlur: false,
            lmsAttemptResult: "best" as const,
            breakdownDisplay: { visibility: "bar", basis: "units" },
          },
        })}
        updateModel={() => {}}
      />,
    );
    expect(screen.getByTestId("settings-breakdown-basis-select")).toBeInTheDocument();
  });
});

/**
 * PRD-50 FR-28/FR-44 (Э4): положение показа — там же, где видимость, отдельным полем.
 * Настройка, сохранённая до Э4, положения не несёт и обязана читаться как «В карточках
 * тем», то есть ровно как сегодня.
 */
describe("<BreakdownDisplayPane /> — где показывать подытоги (PRD-50 FR-44)", () => {
  const withDisplay = (breakdownDisplay?: Record<string, string>) =>
    baseModel({
      runtime: {
        timeLimitMinutes: null,
        maxAttempts: null,
        showCorrectAnswers: false,
        allowReturnToUnanswered: true,
        allowFreeSectionNavigation: false,
        allowAnswerChange: false,
        quickAdvance: false,
        showSectionResults: true,
        skipReviewWhenComplete: false, closeSectionOnLeave: false,
        copyProtection: true,
        protectionWatermark: false,
        protectionHideOnBlur: false,
        lmsAttemptResult: "best" as const,
        ...(breakdownDisplay ? { breakdownDisplay } : {}),
      },
    } as Partial<TestEditorModel>);

  it("селектора нет, пока разрез не показывается", () => {
    render(<BreakdownDisplayPane model={withDisplay()} updateModel={() => {}} />);
    expect(screen.queryByTestId("settings-breakdown-placement-select")).not.toBeInTheDocument();
  });

  it("настройка без положения читается как «В карточках тем»", () => {
    render(<BreakdownDisplayPane model={withDisplay({ visibility: "bar", basis: "units" })} updateModel={() => {}} />);
    expect(
      within(screen.getByTestId("settings-breakdown-placement-select")).getByRole("button"),
    ).toHaveTextContent("В карточках тем");
  });

  it("выбор сводного блока отдаёт наверх placement, не трогая остальное", () => {
    const updateModel = vi.fn();
    const model = withDisplay({ visibility: "bar_and_value", basis: "points" });
    render(<BreakdownDisplayPane model={model} updateModel={updateModel} />);
    selectOption("settings-breakdown-placement-select", "Отдельным блоком в итогах");
    expect(runUpdater(updateModel, model).runtime.breakdownDisplay).toEqual({
      visibility: "bar_and_value",
      basis: "points",
      placement: "block",
    });
  });
});

describe("Показ толкований подтем", () => {
  const withDisplay = (breakdownDisplay?: TestEditorModel["runtime"]["breakdownDisplay"]) =>
    baseModel({
      runtime: {
        timeLimitMinutes: null,
        maxAttempts: null,
        showCorrectAnswers: false,
        allowReturnToUnanswered: true,
        allowFreeSectionNavigation: false,
        allowAnswerChange: false,
        quickAdvance: false,
        showSectionResults: true,
        skipReviewWhenComplete: false, closeSectionOnLeave: false,
        copyProtection: true,
        protectionWatermark: false,
        protectionHideOnBlur: false,
        lmsAttemptResult: "best" as const,
        ...(breakdownDisplay ? { breakdownDisplay } : {}),
      },
    } as Partial<TestEditorModel>);

  it("переключателя нет, пока подытоги не показываются: толкованию не под чем стоять", () => {
    render(<BreakdownDisplayPane model={withDisplay()} updateModel={() => {}} />);
    expect(screen.queryByTestId("settings-breakdown-interpretation-switch")).not.toBeInTheDocument();
  });

  it("по умолчанию выключен", () => {
    render(
      <BreakdownDisplayPane
        model={withDisplay({ visibility: "bar", basis: "units" })}
        updateModel={() => {}}
      />,
    );
    expect(screen.getByTestId("settings-breakdown-interpretation-switch")).not.toBeChecked();
  });

  it("включение отдаёт наверх признак, не трогая остальное", () => {
    const updateModel = vi.fn();
    const model = withDisplay({ visibility: "bar_and_value", basis: "points", placement: "block" });
    render(<BreakdownDisplayPane model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-breakdown-interpretation-switch"));
    expect(runUpdater(updateModel, model).runtime.breakdownDisplay).toEqual({
      visibility: "bar_and_value",
      basis: "points",
      placement: "block",
      showInterpretation: true,
    });
  });

  it("выключение СНИМАЕТ ключ, а не пишет false: настройка возвращается к прежнему виду", () => {
    const updateModel = vi.fn();
    const model = withDisplay({
      visibility: "bar_and_value",
      basis: "points",
      showInterpretation: true,
    });
    render(<BreakdownDisplayPane model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("settings-breakdown-interpretation-switch"));
    expect(runUpdater(updateModel, model).runtime.breakdownDisplay).toEqual({
      visibility: "bar_and_value",
      basis: "points",
    });
  });
});
