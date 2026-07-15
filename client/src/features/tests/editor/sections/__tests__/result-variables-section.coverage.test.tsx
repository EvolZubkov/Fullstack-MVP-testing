/**
 * @module features/tests/editor/sections/__tests__/result-variables-section.coverage.test
 * @description Coverage-oriented component tests for the «Показатели» tab
 * (PRD-2). Exercises the non-empty accordion list, add/remove/edit of a
 * variable, the formula editor in both modes (Конструктор / DSL), every builder
 * template (Порог / Категория / Взвешенная сумма / Вердикт) with their row
 * CRUD, the «Функции» reference modal insert-at-cursor, the derived-type flip
 * that hides the status select for non-boolean results, live formula validation
 * (success / error banners) and the read-only lockdown. Interactions run against
 * a stateful harness so edits cascade through `updateModel` exactly as they do
 * under `use-test-editor`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResultVariablesSection } from "../result-variables-section";
import type {
  ResultVariableModel,
  ScaleModel,
  TestEditorModel,
} from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true },
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
    name: "flag",
    label: "",
    type: "boolean",
    formula: "",
    showToLearner: false,
    scormTarget: "both",
    controlsStatus: "none",
    sortOrder: 0,
    ...over,
  };
}

/** A scale with two band levels — feeds the «Категория» / «Взвешенная сумма» pickers. */
function scaleWithLevels(): ScaleModel {
  return {
    key: "comp", label: "Компетенция", type: "number", aggregation: "sum",
    normalization: "none", direction: "positive",
    bands: [
      { min: "0", max: "5", label: "Низкий", level: "low" },
      { min: "6", max: "10", label: "Высокий", level: "high" },
    ],
    showToLearner: false, scormTarget: "none", sortOrder: 0,
  };
}

// The validate-formula endpoint's reply is swapped per test.
let validationBody: unknown = { valid: true, returnType: "boolean", errors: [], warnings: [] };

beforeEach(() => {
  validationBody = { valid: true, returnType: "boolean", errors: [], warnings: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = String(url).includes("validate-formula") ? validationBody : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

// ─── Harnesses ────────────────────────────────────────────────────────────────

/**
 * Stateful host: holds the editor model and applies `updateModel` updaters, so a
 * click that appends/edits a variable actually re-renders the cascaded UI (the
 * builder effect writing the generated DSL, derived-type flips, etc.).
 */
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
    <ResultVariablesSection
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
      <ResultVariablesSection model={model} testId={opts.testId} updateModel={updateModel} />
    </QueryClientProvider>,
  );
  return { updateModel };
}

/** Apply the last captured updater to a model (mirrors useTestEditor.updateModel). */
function runUpdater(updateModel: ReturnType<typeof vi.fn>, model: TestEditorModel): TestEditorModel {
  const updater = updateModel.mock.calls.at(-1)?.[0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

/** Open a DS Select via its `label` text, then click the option by visible text. */
function pickLabeledOption(labelText: string, optionLabel: string | RegExp) {
  fireEvent.click(screen.getByLabelText(labelText));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

/** Expand the first card (headers start collapsed — expandedKey is null on mount). */
function expandFirstCard() {
  fireEvent.click(screen.getByLabelText("Развернуть показатель"));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<ResultVariablesSection /> — list & cards", () => {
  it("renders the non-empty list with the ordering label and per-card headers", () => {
    const model = baseModel({
      resultVariables: [
        makeVar({ clientKey: "a", name: "burnout", label: "Выгорание", controlsStatus: "success" }),
        makeVar({ clientKey: "b", name: "verdict", type: "number", sortOrder: 1 }),
      ],
    });
    renderControlled(model);

    expect(screen.getByTestId("metrics-section")).toBeInTheDocument();
    // >1 variable → the header gains the «порядок вычисления» affordance + add btn.
    expect(screen.getByText(/порядок вычисления/)).toBeInTheDocument();
    expect(screen.getByTestId("metrics-add")).toBeInTheDocument();

    const card0 = screen.getByTestId("metrics-card-0");
    // heading = name — label; subtitle carries the derived type + order + status.
    expect(card0).toHaveTextContent("burnout — Выгорание");
    expect(card0).toHaveTextContent("булево");
    expect(card0).toHaveTextContent("управляет статусом");
    expect(screen.getByTestId("metrics-card-1")).toHaveTextContent("число");
  });

  it("expands and collapses a card via the chevron", () => {
    renderControlled(baseModel({ resultVariables: [makeVar()] }));
    expect(screen.queryByTestId("metrics-name-0")).toBeNull();

    expandFirstCard();
    expect(screen.getByTestId("metrics-name-0")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Свернуть показатель"));
    expect(screen.queryByTestId("metrics-name-0")).toBeNull();
  });

  it("adds a first variable from the empty state and opens it expanded", async () => {
    renderStateful(baseModel());
    fireEvent.click(screen.getByTestId("metrics-empty-add"));

    // A card appears already expanded (builder mode for a fresh, empty formula).
    expect(await screen.findByTestId("metrics-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("metrics-name-0")).toBeInTheDocument();
    // The «новый показатель» placeholder heading before a name is typed.
    expect(screen.getByTestId("metrics-card-0")).toHaveTextContent("новый показатель");
  });

  it("adds another variable from the header action", async () => {
    renderStateful(baseModel({ resultVariables: [makeVar({ clientKey: "a" })] }));
    fireEvent.click(screen.getByTestId("metrics-add"));
    expect(await screen.findByTestId("metrics-card-1")).toBeInTheDocument();
  });

  it("edits name and label, updating the card heading", () => {
    renderStateful(baseModel({ resultVariables: [makeVar({ name: "" })] }));
    expandFirstCard();

    fireEvent.change(screen.getByTestId("metrics-name-0"), { target: { value: "readiness" } });
    fireEvent.change(screen.getByTestId("metrics-label-0"), { target: { value: "Готовность" } });
    expect(screen.getByTestId("metrics-card-0")).toHaveTextContent("readiness — Готовность");
  });

  it("removes a variable and re-indexes sortOrder", () => {
    const model = baseModel({
      resultVariables: [
        makeVar({ clientKey: "a", name: "a", sortOrder: 0 }),
        makeVar({ clientKey: "b", name: "b", sortOrder: 1 }),
      ],
    });
    const { updateModel } = renderControlled(model);
    fireEvent.click(screen.getByTestId("metrics-remove-0"));

    const next = runUpdater(updateModel, model);
    expect(next.resultVariables).toHaveLength(1);
    expect(next.resultVariables[0].name).toBe("b");
    expect(next.resultVariables[0].sortOrder).toBe(0);
  });

  it("read-only hides the add / remove / drag affordances", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ResultVariablesSection
          model={baseModel({ resultVariables: [makeVar()] })}
          testId="test-1"
          updateModel={() => {}}
          readOnly
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("metrics-add")).toBeNull();
    expect(screen.queryByTestId("metrics-remove-0")).toBeNull();
    expect(screen.queryByLabelText("Перетащить показатель")).toBeNull();
  });
});

describe("<ResultVariablesSection /> — formula builder", () => {
  it("switches across all four templates and flips the derived result type", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar()] }));
    expandFirstCard();

    // Threshold (default, boolean) → the «Управление статусом» select is shown.
    expect(screen.getByTestId("metrics-status-0")).toBeInTheDocument();

    // Категория → string result → status select disappears, «Добавить уровень» shows.
    pickLabeledOption("Шаблон", "Категория по уровням шкалы");
    expect(screen.queryByTestId("metrics-status-0")).toBeNull();
    expect(screen.getByRole("button", { name: /Добавить уровень/ })).toBeInTheDocument();

    // Взвешенная сумма → number result → «Добавить слагаемое».
    pickLabeledOption("Шаблон", "Взвешенная сумма");
    expect(screen.queryByTestId("metrics-status-0")).toBeNull();
    expect(screen.getByRole("button", { name: /Добавить слагаемое/ })).toBeInTheDocument();

    // Сертификация / вердикт → boolean again → status select returns, «Добавить условие».
    pickLabeledOption("Шаблон", "Сертификация / вердикт");
    expect(screen.getByTestId("metrics-status-0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить условие/ })).toBeInTheDocument();
  });

  it("threshold: edits the condition value input", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar()] }));
    expandFirstCard();
    const value = screen.getByLabelText("Значение") as HTMLInputElement;
    fireEvent.change(value, { target: { value: "85" } });
    expect(value.value).toBe("85");
  });

  it("category: adds and removes a level row", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar()] }));
    expandFirstCard();
    pickLabeledOption("Шаблон", "Категория по уровням шкалы");

    fireEvent.click(screen.getByRole("button", { name: /Добавить уровень/ }));
    const removers = screen.getAllByLabelText("Удалить уровень");
    expect(removers.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(removers[0]);
    // Back to a single (non-removable) level row → no more delete buttons.
    expect(screen.queryAllByLabelText("Удалить уровень")).toHaveLength(0);
  });

  it("weighted: adds/removes a term and edits its weight", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar()] }));
    expandFirstCard();
    pickLabeledOption("Шаблон", "Взвешенная сумма");

    fireEvent.click(screen.getByRole("button", { name: /Добавить слагаемое/ }));
    const weights = screen.getAllByLabelText("Вес") as HTMLInputElement[];
    fireEvent.change(weights[0], { target: { value: "2.5" } });
    expect(weights[0].value).toBe("2.5");

    fireEvent.click(screen.getAllByLabelText("Удалить слагаемое")[0]);
    expect(screen.queryAllByLabelText("Удалить слагаемое")).toHaveLength(0);
  });

  it("verdict: adds and removes a condition row", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar()] }));
    expandFirstCard();
    pickLabeledOption("Шаблон", "Сертификация / вердикт");

    fireEvent.click(screen.getByRole("button", { name: /Добавить условие/ }));
    const removers = screen.getAllByLabelText("Удалить условие");
    expect(removers.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(removers[0]);
    expect(screen.queryAllByLabelText("Удалить условие")).toHaveLength(0);
  });
});

describe("<ResultVariablesSection /> — DSL mode & functions", () => {
  it("switches to DSL, opens the «Функции» modal and inserts a snippet at the cursor", async () => {
    renderStateful(baseModel({ resultVariables: [makeVar()] }));
    expandFirstCard();

    fireEvent.click(screen.getByRole("button", { name: "DSL" }));
    const textarea = screen.getByTestId("metrics-formula-0") as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("metrics-fn-open-0"));
    const modal = await screen.findByTestId("metrics-fn-modal");
    // First reference entry is `percent`; «Вставить» splices it into the editor.
    fireEvent.click(within(modal).getAllByRole("button", { name: "Вставить" })[0]);

    await waitFor(() =>
      expect((screen.getByTestId("metrics-formula-0") as HTMLTextAreaElement).value).toContain("percent"),
    );
    // Modal closes after an insert.
    expect(screen.queryByTestId("metrics-fn-modal")).toBeNull();
  });

  it("closes the «Функции» modal without inserting", async () => {
    renderStateful(baseModel({ resultVariables: [makeVar({ formula: "percent >= 70" })] }));
    expandFirstCard(); // existing formula → opens directly in DSL mode
    fireEvent.click(screen.getByTestId("metrics-fn-open-0"));
    expect(await screen.findByTestId("metrics-fn-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("metrics-fn-close"));
    await waitFor(() => expect(screen.queryByTestId("metrics-fn-modal")).toBeNull());
  });
});

describe("<ResultVariablesSection /> — live validation", () => {
  it("shows the success banner for a valid formula (DSL mode)", async () => {
    validationBody = { valid: true, returnType: "boolean", errors: [], warnings: [] };
    renderStateful(
      baseModel({ resultVariables: [makeVar({ formula: "percent >= 70" })] }),
      { testId: "test-1" },
    );
    expandFirstCard();
    expect(await screen.findByText(/Синтаксис корректен/)).toBeInTheDocument();
  });

  it("shows an error banner when the validator rejects the formula", async () => {
    validationBody = { valid: false, errors: [{ message: "Неизвестная функция foo" }], warnings: [] };
    renderStateful(
      baseModel({ resultVariables: [makeVar({ formula: "foo()" })] }),
      { testId: "test-1" },
    );
    expandFirstCard();
    expect(await screen.findByText("Неизвестная функция foo")).toBeInTheDocument();
  });

  it("edits the DSL textarea directly", () => {
    renderStateful(baseModel({ resultVariables: [makeVar({ formula: "percent >= 70" })] }));
    expandFirstCard();
    const textarea = screen.getByTestId("metrics-formula-0") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'IF(percent >= 80, "A", "B")' } });
    expect(textarea.value).toBe('IF(percent >= 80, "A", "B")');
  });
});
