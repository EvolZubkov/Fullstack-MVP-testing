/**
 * @module features/tests/editor/sections/__tests__/scales-section.coverage.test
 * @description Coverage-oriented component tests for the «Шкалы» tab (PRD-5).
 * Exercises the «Список шкал» pane (empty state, add/remove, per-scale form with
 * aggregation / «Пересчёт итога» / LMS-target selects, the bands editor CRUD, and
 * the blocking key/band validators surfaced as inline errors + the save-block
 * banner), the «Предпросмотр расчёта» modal (loading → demo-answer context →
 * computed result table with errors, plus the empty-context and no-testId
 * branches) and the «Вклады вопросов» matrix (expanding a question card, typing a
 * contribution into a cell to bind a measurement, the matching hint, the
 * no-questions empty state and the load-error banner). Interactions run against a
 * stateful harness so edits cascade through `updateModel` as under
 * `use-test-editor`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScalesSection } from "../scales-section";
import type {
  EditorSection,
  QuestionMeasurementModel,
  ScaleModel,
  TestEditorModel,
} from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1",
    topicName: "Финансы",
    maxQuestions: 12,
    drawCount: 5,
    drawAll: false,
    required: true,
    timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
    ...over,
  };
}

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
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true, skipReviewWhenComplete: false, quickAdvance: false, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [buildSection()],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...overrides,
  };
}

function makeScale(over: Partial<ScaleModel> = {}): ScaleModel {
  return {
    clientKey: "scale-seed",
    key: "comp", label: "Компетенция", type: "number", aggregation: "sum",
    normalization: "none", direction: "positive", bands: [],
    domainMin: null, domainMax: null, displayMax: null, valence: "none",
    learnerVisibility: "hidden", scormTarget: "none", sortOrder: 0,
    ...over,
  };
}

function meas(over: Partial<QuestionMeasurementModel> = {}): QuestionMeasurementModel {
  return { questionId: "q1", scaleKey: "comp", sourceType: "option", sourceKey: "0", value: 2, weight: 1, ...over };
}

// Rich question set usable by BOTH the contributions loader (needs
// topicId/dataJson/correctJson) and the preview loader (needs id/type/prompt).
const dbQuestions = [
  { id: "q1", topicId: "top-1", type: "single", prompt: "Вопрос 1", dataJson: { options: ["Да", "Нет"] }, correctJson: { correctIndex: 0 } },
  { id: "q2", topicId: "top-1", type: "multiple", prompt: "Вопрос 2", dataJson: { options: ["А", "Б"] }, correctJson: { correctIndices: [0] } },
  { id: "q3", topicId: "top-1", type: "matching", prompt: "Вопрос 3", dataJson: { left: ["Л1"], right: ["П1"] }, correctJson: { pairs: [{ left: 0, right: 0 }] } },
];

// ─── Network stubs (swapped per test) ─────────────────────────────────────────

let questionsBody: unknown = dbQuestions;
let measurementsBody: unknown = [];
let previewBody: unknown = { values: {}, errors: [] };
let failQuestions = false;

beforeEach(() => {
  questionsBody = dbQuestions;
  measurementsBody = [];
  previewBody = { values: {}, errors: [] };
  failQuestions = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    let body: unknown = [];
    if (method === "POST" && u.includes("/scales/preview")) body = previewBody;
    else if (u.includes("/measurements")) body = measurementsBody;
    else if (u.includes("/api/questions")) {
      if (failQuestions) throw new Error("network down");
      body = questionsBody;
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

// ─── Harnesses ────────────────────────────────────────────────────────────────

function Harness({
  initial,
  testId,
  readOnly,
}: {
  initial: TestEditorModel;
  testId?: string;
  readOnly?: boolean;
}) {
  const [model, setModel] = useState(initial);
  return (
    <ScalesSection
      model={model}
      testId={testId}
      updateModel={(updater) => setModel((m) => updater(m))}
      readOnly={readOnly}
    />
  );
}

function renderStateful(initial: TestEditorModel, opts: { testId?: string; readOnly?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} testId={opts.testId} readOnly={opts.readOnly} />
    </QueryClientProvider>,
  );
}

function renderControlled(model: TestEditorModel, opts: { testId?: string } = {}) {
  const updateModel = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScalesSection model={model} testId={opts.testId} updateModel={updateModel} />
    </QueryClientProvider>,
  );
  return { updateModel };
}

function runUpdater(updateModel: ReturnType<typeof vi.fn>, model: TestEditorModel): TestEditorModel {
  const updater = updateModel.mock.calls.at(-1)?.[0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

/** Open a DS Select by its wrapper testid, then click the option by visible text. */
function selectOption(selectTestId: string, optionLabel: string | RegExp) {
  const wrap = screen.getByTestId(selectTestId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

// ─── «Список шкал» ──────────────────────────────────────────────────────────────

describe("<ScalesSection /> — «Список шкал»", () => {
  it("shows the empty state and adds a scale (new row errors on the missing key)", () => {
    renderStateful(baseModel({ scales: [] }));
    expect(screen.getByTestId("scales-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("scales-empty-add"));
    // The fresh scale opens expanded with an empty key → save is blocked.
    expect(screen.getByTestId("scales-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("scales-error-banner")).toBeInTheDocument();
    expect(screen.getByText("Укажите ключ шкалы.")).toBeInTheDocument();
  });

  it("renders subtitles: covered scale (ok dot) and a contribution-less scale (warn dot)", () => {
    const model = baseModel({
      scales: [
        makeScale({ clientKey: "a", key: "comp", bands: [
          { min: "0", max: "5", label: "Низкий", level: "low", text: "", tone: "" },
          { min: "6", max: "10", label: "Высокий", level: "high", text: "", tone: "" },
        ] }),
        makeScale({ clientKey: "b", key: "risk", label: "Риск", sortOrder: 1 }),
      ],
      measurements: [meas({ questionId: "q1" }), meas({ questionId: "q2" })],
    });
    renderControlled(model);

    const covered = screen.getByTestId("scales-card-0");
    expect(covered).toHaveTextContent("2 уровня");
    expect(covered).toHaveTextContent("2 вопроса");
    expect(covered.querySelector(".tb-status-dot--ok")).not.toBeNull();

    const bare = screen.getByTestId("scales-card-1");
    expect(bare).toHaveTextContent("без вкладов");
    expect(bare.querySelector(".tb-status-dot--warn")).not.toBeNull();
  });

  it("expands a scale and edits key / aggregation / «Пересчёт итога» / target", () => {
    renderStateful(baseModel({ scales: [makeScale()] }));
    fireEvent.click(screen.getByLabelText("Развернуть шкалу"));

    const keyInput = screen.getByTestId("scales-key-0") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "ee" } });
    expect(keyInput.value).toBe("ee");

    selectOption("scales-agg-0", "Среднее");
    selectOption("scales-recalc-0", "Инверсия");
    expect(screen.getByTestId("scales-card-0")).toHaveTextContent("инверсия");
    selectOption("scales-recalc-0", "Проценты");
    expect(screen.getByTestId("scales-card-0")).toHaveTextContent("проценты");
    selectOption("scales-target-0", "Столбцом в отчёте");
    // Subtitle reflects the new aggregation label.
    expect(screen.getByTestId("scales-card-0")).toHaveTextContent("среднее");
  });

  it("levels editor: add, edit, and remove levels (from the empty state)", () => {
    renderStateful(baseModel({ scales: [makeScale({ bands: [] })] }));
    fireEvent.click(screen.getByLabelText("Развернуть шкалу"));
    expect(screen.getByTestId("scales-levels-empty-0")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("scales-level-add-0"));
    const label = screen.getByLabelText("Название уровня 1") as HTMLInputElement;
    fireEvent.change(label, { target: { value: "Низкий" } });
    fireEvent.change(screen.getByLabelText("Код уровня 1"), { target: { value: "low" } });
    expect(label.value).toBe("Низкий");

    fireEvent.click(screen.getByTestId("scales-level-add-0"));
    expect(screen.getByLabelText("Порог между уровнями 1 и 2")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Удалить уровень 2"));
    // One level left → no threshold field, because a threshold needs two levels.
    expect(screen.queryByLabelText("Порог между уровнями 1 и 2")).toBeNull();
  });

  it("removing a scale also drops its measurements from the draft", () => {
    const model = baseModel({
      scales: [makeScale({ clientKey: "a", key: "comp" }), makeScale({ clientKey: "b", key: "risk", sortOrder: 1 })],
      measurements: [meas({ scaleKey: "comp" }), meas({ questionId: "q2", scaleKey: "risk" })],
    });
    const { updateModel } = renderControlled(model);

    fireEvent.click(screen.getByTestId("scales-remove-0"));
    const next = runUpdater(updateModel, model);
    expect(next.scales.map((s) => s.key)).toEqual(["risk"]);
    expect(next.measurements.some((m) => m.scaleKey === "comp")).toBe(false);
    expect(next.measurements.some((m) => m.scaleKey === "risk")).toBe(true);
  });
});

describe("<ScalesSection /> — validation banners", () => {
  it.each([
    ["non-numeric band", [{ min: "x", max: "1", label: "", level: "hi", text: "", tone: "" as const }], /Укажите число/],
    [
      "descending thresholds",
      [
        { min: "0", max: "42", label: "", level: "a", text: "", tone: "" as const },
        { min: "42", max: "29", label: "", level: "b", text: "", tone: "" as const },
      ],
      /должны идти по возрастанию/,
    ],
  ])("flags %s", (_name, bands, message) => {
    renderStateful(baseModel({ scales: [makeScale({ bands })] }));
    fireEvent.click(screen.getByLabelText("Развернуть шкалу"));
    expect(screen.getByTestId("scales-error-banner")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("accepts touching boundaries — that is what the levels editor writes", () => {
    renderStateful(baseModel({ scales: [makeScale({ bands: [
      { min: "0", max: "15", label: "", level: "low", text: "", tone: "" },
      { min: "15", max: "29", label: "", level: "mid", text: "", tone: "" },
    ] })] }));
    // The save gate must stay open: `bands[i].max === bands[i + 1].min` is what
    // the levels editor writes on every edit, not an overlap.
    expect(screen.queryByTestId("scales-error-banner")).toBeNull();
    fireEvent.click(screen.getByLabelText("Развернуть шкалу"));
    expect(screen.queryByTestId("scales-levels-error-0")).toBeNull();
  });

  it("stays silent about a fully-empty trailing row, exactly as the save gate does", () => {
    renderStateful(baseModel({ scales: [makeScale({ bands: [
      { min: "0", max: "15", label: "", level: "low", text: "", tone: "" },
      { min: "", max: "", label: "", level: "", text: "", tone: "" },
    ] })] }));
    expect(screen.queryByTestId("scales-error-banner")).toBeNull();
  });

  it("stays silent about a fully-empty row in the MIDDLE too — the gate ignores it as well", () => {
    // The card's banner says saving is blocked. The save gate skips an empty row
    // wherever it sits, so a card shouting about one would block nothing and lie.
    renderStateful(baseModel({ scales: [makeScale({ bands: [
      { min: "0", max: "15", label: "", level: "low", text: "", tone: "" },
      { min: "", max: "", label: "", level: "", text: "", tone: "" },
      { min: "15", max: "29", label: "", level: "mid", text: "", tone: "" },
    ] })] }));
    expect(screen.queryByTestId("scales-error-banner")).toBeNull();
  });

  it("flags a bad key grammar", () => {
    renderStateful(baseModel({ scales: [makeScale({ key: "Bad Key" })] }));
    fireEvent.click(screen.getByLabelText("Развернуть шкалу"));
    expect(screen.getByTestId("scales-error-banner")).toBeInTheDocument();
    expect(screen.getByText(/Ключ: строчная буква в начале/)).toBeInTheDocument();
  });

  it("flags a duplicate key on the second scale", () => {
    renderStateful(baseModel({
      scales: [makeScale({ clientKey: "a", key: "comp" }), makeScale({ clientKey: "b", key: "comp", sortOrder: 1 })],
    }));
    expect(screen.getByTestId("scales-error-banner")).toBeInTheDocument();
    // Expand the second card to surface the inline duplicate-key message.
    fireEvent.click(screen.getAllByLabelText("Развернуть шкалу")[1]);
    expect(screen.getByText(/уже используется другой шкалой/)).toBeInTheDocument();
  });
});

// ─── «Предпросмотр расчёта» ──────────────────────────────────────────────────────

describe("<ScalesSection /> — calculation preview", () => {
  it("disables the preview action in create mode (no testId)", () => {
    renderStateful(baseModel({ scales: [makeScale()] }));
    expect(screen.getByTestId("scales-preview-open")).toBeDisabled();
  });

  it("loads the demo-answer context and computes a result table", async () => {
    measurementsBody = [
      { questionId: "q1", sourceType: "option", sourceKey: "0" },
      { questionId: "q2", sourceType: "option", sourceKey: "1" },
      { questionId: "q3", sourceType: "matching_pair", sourceKey: "0:0" },
    ];
    previewBody = {
      values: { comp: { raw: 3.14159, normalized: 3, percent: 60, level: "high", label: "Высокий", hasValue: true } },
      errors: [{ key: "comp", message: "частично" }],
    };
    renderStateful(baseModel({ scales: [makeScale()] }), { testId: "test-1" });

    fireEvent.click(screen.getByTestId("scales-preview-open"));
    // ModalDialog does not forward data-testid, so detect the modal by its content.
    expect(await screen.findByTestId("scales-preview-run")).toBeInTheDocument();
    // Supported single/multiple questions render pickers; matching is flagged unsupported.
    expect(await screen.findByText("Вопрос 1")).toBeInTheDocument();
    expect(screen.getByText("Вопрос 2")).toBeInTheDocument();
    expect(screen.getByText(/Вопросов этих типов со вкладами/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("scales-preview-run"));
    const table = await screen.findByTestId("scales-preview-table");
    expect(table).toHaveTextContent("comp");
    expect(table).toHaveTextContent("3.14"); // rounded raw
    expect(table).toHaveTextContent("Высокий"); // level band label
    expect(screen.getByText(/comp: частично/)).toBeInTheDocument();

    // Both the header «×» and the footer share the «Закрыть» label; either closes.
    fireEvent.click(screen.getAllByRole("button", { name: "Закрыть" })[0]);
    await waitFor(() => expect(screen.queryByTestId("scales-preview-run")).toBeNull());
  });

  it("shows the empty-context banner when no question contributes", async () => {
    measurementsBody = [];
    renderStateful(baseModel({ scales: [makeScale()] }), { testId: "test-1" });

    fireEvent.click(screen.getByTestId("scales-preview-open"));
    expect(await screen.findByText(/Ни один вопрос пока не вносит вклад/)).toBeInTheDocument();
  });
});

// ─── «Вклады вопросов» ───────────────────────────────────────────────────────────

describe("<ScalesSection /> — «Вклады вопросов»", () => {
  function openContributions() {
    fireEvent.click(screen.getByRole("button", { name: "Вклады вопросов" }));
  }

  it("expands a question card and typing a contribution binds a measurement", async () => {
    questionsBody = [dbQuestions[0]]; // single q1 only
    renderStateful(baseModel({ scales: [makeScale()] }));
    openContributions();

    const card = await screen.findByTestId("contrib-card-0");
    expect(card).toHaveTextContent("не привязан");

    fireEvent.click(within(card).getByLabelText("Развернуть вопрос"));
    const grid = await screen.findByTestId("contrib-grid-0");
    // Unit «A. Да» × scale «comp» cell.
    const cell = within(grid).getByLabelText("Вклад «A. Да» в шкалу comp") as HTMLInputElement;
    fireEvent.change(cell, { target: { value: "2" } });

    // Contribution registered → warn resolves to a COMP tag, «не привязан» gone.
    await waitFor(() =>
      expect(screen.getByTestId("contrib-card-0")).not.toHaveTextContent("не привязан"),
    );
    expect(screen.getByTestId("contrib-card-0")).toHaveTextContent("COMP");

    // Clearing the cell removes the measurement again.
    fireEvent.change(cell, { target: { value: "" } });
    await waitFor(() =>
      expect(screen.getByTestId("contrib-card-0")).toHaveTextContent("не привязан"),
    );
  });

  it("shows the answer-unit hint for a matching question", async () => {
    questionsBody = [dbQuestions[2]]; // matching q3 only
    renderStateful(baseModel({ scales: [makeScale()] }));
    openContributions();

    const card = await screen.findByTestId("contrib-card-0");
    fireEvent.click(within(card).getByLabelText("Развернуть вопрос"));
    expect(await screen.findByText(/направленная пара/)).toBeInTheDocument();
  });

  it("renders the no-questions empty state", async () => {
    questionsBody = [];
    renderStateful(baseModel({ scales: [makeScale()] }));
    openContributions();
    expect(await screen.findByTestId("contributions-no-questions")).toBeInTheDocument();
  });

  it("renders the load-error banner when the questions request fails", async () => {
    failQuestions = true;
    renderStateful(baseModel({ scales: [makeScale()] }));
    openContributions();
    expect(await screen.findByText("Не удалось загрузить вопросы теста.")).toBeInTheDocument();
  });
});
