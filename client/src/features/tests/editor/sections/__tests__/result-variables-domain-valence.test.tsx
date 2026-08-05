/**
 * @module features/tests/editor/sections/__tests__/result-variables-domain-valence.test
 * @description PRD-29+: the numeric indicator's domain (min/max) and favourable
 * direction (valence) in the «Показатели» tab, added via the shared
 * `DomainFields` component the «Шкалы» tab already uses. Covers: the fields
 * render only for a NUMERIC indicator (a string/boolean one interprets through
 * outcomes, not an interval), the manual-bounds toggle seeds from the band span
 * (mirrors the scale behaviour), and edits reach the model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResultVariablesSection } from "../result-variables-section";
import type { ResultVariableModel, TestEditorModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    id: "test-1",
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample", description: "", status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [], feedbackAssets: [], feedbackEvents: [],
      webhookUrl: "", telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true, quickAdvance: false, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false },
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

function makeVar(over: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    clientKey: "rv-seed",
    name: "score",
    label: "",
    type: "number",
    formula: "percent",
    learnerVisibility: "hidden",
    scormTarget: "both",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [], text: async () => "[]" })));
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ initial }: { initial: TestEditorModel }) {
  const [model, setModel] = useState(initial);
  return (
    <ResultVariablesSection model={model} updateModel={(updater) => setModel((m) => updater(m))} />
  );
}

function renderStateful(initial: TestEditorModel) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

function expandFirstCard() {
  fireEvent.click(screen.getByLabelText("Развернуть показатель"));
}

function pickLabeledOption(labelText: string, optionLabel: string | RegExp) {
  const el = screen.getByLabelText(labelText);
  const trigger = el.tagName === "BUTTON" ? el : within(el).getByRole("button");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("<ResultVariablesSection /> — домен и направление числового показателя (PRD-29+)", () => {
  it("числовой показатель показывает переключатель границ и направление", () => {
    renderStateful(baseModel({ resultVariables: [makeVar()] }));
    expandFirstCard();
    expect(screen.getByTestId("metrics-domain-manual-0")).toBeInTheDocument();
    expect(screen.getByTestId("metrics-valence-0")).toBeInTheDocument();
  });

  it("строковый показатель НЕ показывает границы/направление — только исходы", () => {
    renderStateful(
      baseModel({ resultVariables: [makeVar({ type: "string", formula: '"a"' })] }),
    );
    expandFirstCard();
    expect(screen.queryByTestId("metrics-domain-manual-0")).toBeNull();
    expect(screen.queryByTestId("metrics-valence-0")).toBeNull();
    expect(screen.getByTestId("metrics-outcomes-0")).toBeInTheDocument();
  });

  it("включение ручных границ подставляет охват уже введённых диапазонов", () => {
    renderStateful(
      baseModel({
        resultVariables: [
          makeVar({
            bands: [
              { min: "0", max: "14", label: "Низкий", level: "low", text: "", tone: "" },
              { min: "15", max: "45", label: "Высокий", level: "high", text: "", tone: "" },
            ],
          }),
        ],
      }),
    );
    expandFirstCard();
    fireEvent.click(screen.getByTestId("metrics-domain-manual-0"));
    expect(screen.getByTestId("metrics-domain-min-0")).toHaveValue("0");
    expect(screen.getByTestId("metrics-domain-max-0")).toHaveValue("45");
  });

  it("выбор направления обновляет модель", () => {
    renderStateful(baseModel({ resultVariables: [makeVar()] }));
    expandFirstCard();
    pickLabeledOption("Благоприятное направление", "Чем больше, тем лучше");
    expect(screen.getByTestId("metrics-card-0")).toBeInTheDocument();
  });
});
