/**
 * @module features/tests/editor/sections/__tests__/result-variables-section.branches.test
 * @description Extra branch-coverage tests for the «Показатели» tab
 * ({@link module:features/tests/editor/sections/result-variables-section}) that
 * the primary coverage suite left open: the read-only empty state, the DSL
 * inferred-type flip (number/boolean) and its `controlsStatus` reset, the
 * validation banner variants (warnings / null return type / empty-error
 * fallback / create-mode no-op), the `ConditionRow` unit matrix (num / level /
 * bool) with and without scale levels, the builder's «нет шкал» selects and its
 * mount behaviour for a pre-existing formula, plus the `rowKey` and topic-code
 * edge inputs. Interactions run against the same stateful harness the reference
 * suite uses so builder-driven `updateModel` cascades re-render the card.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResultVariablesSection } from "../result-variables-section";
import type {
  EditorSection,
  ResultVariableModel,
  ScaleModel,
  TestEditorModel,
} from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

// ─── Fixtures ────────────────────────────────────────────────────────────────

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
    name: "flag",
    label: "",
    type: "boolean",
    formula: "",
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

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1",
    topicName: "Тема А",
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
    ...over,
  };
}

/** Scale carrying two named band levels — feeds level pickers. */
function scaleWithLevels(over: Partial<ScaleModel> = {}): ScaleModel {
  return {
    key: "comp", label: "Компетенция", type: "number", aggregation: "sum",
    normalization: "none", direction: "positive",
    bands: [
      { min: "0", max: "5", label: "Низкий", level: "low", text: "", tone: "" },
      { min: "6", max: "10", label: "Высокий", level: "high", text: "", tone: "" },
    ],
    domainMin: null, domainMax: null, valence: "none",
    learnerVisibility: "hidden", scormTarget: "none", sortOrder: 0,
    ...over,
  };
}

/** Scale whose bands carry no level names → empty `levels` array. */
function scaleNoLevels(): ScaleModel {
  return scaleWithLevels({
    key: "flat", label: "", // empty label → exercises the `label || key` fallback
    bands: [{ min: "0", max: "10", label: "—", level: "", text: "", tone: "" }],
  });
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

function renderControlled(model: TestEditorModel, opts: { testId?: string; readOnly?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResultVariablesSection model={model} testId={opts.testId} updateModel={() => {}} readOnly={opts.readOnly} />
    </QueryClientProvider>,
  );
}

/**
 * Open a DS Select and pick an option. Selects declared with the `label` prop
 * associate the trigger button directly (getByLabelText → button); those using
 * `aria-label` put it on a wrapper div, so drill into the button inside.
 */
function pickLabeledOption(labelText: string, optionLabel: string | RegExp) {
  const el = screen.getByLabelText(labelText);
  const trigger = el.tagName === "BUTTON" ? el : within(el).getByRole("button");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

function expandFirstCard() {
  fireEvent.click(screen.getByLabelText("Развернуть показатель"));
}

// ─── Edge inputs: rowKey & topic codes ─────────────────────────────────────

describe("<ResultVariablesSection /> — edge inputs", () => {
  it("renders a card even when both id and clientKey are absent (row-index key)", () => {
    renderControlled(
      baseModel({ resultVariables: [makeVar({ clientKey: undefined, name: "x" })] }),
    );
    expect(screen.getByTestId("metrics-card-0")).toBeInTheDocument();
  });

  it("maps sections with and without a topic code into the element catalog", () => {
    renderControlled(
      baseModel({
        resultVariables: [makeVar()],
        sections: [
          buildSection({ topicId: "t1", topicName: "С кодом", topicCode: "FIN" }),
          buildSection({ topicId: "t2", topicName: "Без кода", topicCode: null }),
        ],
      }),
    );
    // The memo over sections ran (both topicCode branches) — the section renders.
    expect(screen.getByTestId("metrics-section")).toBeInTheDocument();
  });

  it("read-only empty state hides the add action", () => {
    renderControlled(baseModel(), { readOnly: true });
    expect(screen.getByTestId("metrics-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("metrics-empty-add")).toBeNull();
  });
});

// ─── DSL inferred-type flip ─────────────────────────────────────────────────

describe("<ResultVariablesSection /> — DSL inferred type", () => {
  it("adopts a number return type and clears controlsStatus", async () => {
    validationBody = { valid: true, returnType: "number", errors: [], warnings: [] };
    renderStateful(
      baseModel({ resultVariables: [makeVar({ formula: "score", type: "boolean", controlsStatus: "success" })] }),
      { testId: "test-1" },
    );
    expandFirstCard();
    // Type derives to «число»; the status control (boolean-only) disappears. Both
    // land in the same commit, but assert them together inside waitFor so the
    // check never races the debounced validation → effect → re-render chain.
    await waitFor(
      () => {
        expect(screen.getByTestId("metrics-card-0")).toHaveTextContent("число");
        expect(screen.queryByTestId("metrics-status-0")).toBeNull();
      },
      { timeout: 2500 },
    );
  });

  it("adopts a boolean return type and keeps the status control", async () => {
    validationBody = { valid: true, returnType: "boolean", errors: [], warnings: [] };
    renderStateful(
      baseModel({ resultVariables: [makeVar({ formula: "passed", type: "number" })] }),
      { testId: "test-1" },
    );
    expandFirstCard();
    await waitFor(
      () => {
        expect(screen.getByTestId("metrics-status-0")).toBeInTheDocument();
        expect(screen.getByTestId("metrics-card-0")).toHaveTextContent("булево");
      },
      { timeout: 2500 },
    );
  });
});

// ─── Validation banner variants ─────────────────────────────────────────────

describe("<ResultVariablesSection /> — validation banners", () => {
  it("shows an info banner carrying the first warning", async () => {
    validationBody = { valid: true, returnType: "boolean", errors: [], warnings: [{ message: "Тема не используется" }] };
    renderStateful(baseModel({ resultVariables: [makeVar({ formula: "percent >= 70" })] }), { testId: "test-1" });
    expandFirstCard();
    expect(await screen.findByText("Тема не используется")).toBeInTheDocument();
  });

  it("falls back to the expected type when the validator omits a return type", async () => {
    validationBody = { valid: true, returnType: null, errors: [], warnings: [] };
    renderStateful(baseModel({ resultVariables: [makeVar({ formula: "percent >= 70", type: "boolean" })] }), { testId: "test-1" });
    expandFirstCard();
    expect(await screen.findByText(/Синтаксис корректен/)).toHaveTextContent("булево");
  });

  it("uses the generic message when an invalid result has no error entries", async () => {
    validationBody = { valid: false, returnType: "boolean", errors: [], warnings: [] };
    renderStateful(baseModel({ resultVariables: [makeVar({ formula: "???" })] }), { testId: "test-1" });
    expandFirstCard();
    expect(await screen.findByText("Невалидная формула.")).toBeInTheDocument();
  });

  it("skips validation entirely in create mode (no testId → no banner)", async () => {
    renderStateful(baseModel({ resultVariables: [makeVar({ formula: "percent >= 70" })] }));
    expandFirstCard();
    // Give the (skipped) debounce a chance — no banner should ever appear.
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText(/Синтаксис корректен/)).toBeNull();
    expect(screen.queryByText(/Невалидная формула/)).toBeNull();
  });
});

// ─── FormulaBuilder — mount behaviour & «нет шкал» ─────────────────────────

describe("<ResultVariablesSection /> — builder mount & empty scales", () => {
  it("read-only builder renders the template select without write affordances", () => {
    renderStateful(
      baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar({ formula: "" })] }),
      { readOnly: true },
    );
    expandFirstCard();
    expect(screen.getByLabelText("Шаблон")).toBeInTheDocument();
    // Threshold is the default; read-only removes any add-condition affordance.
    expect(screen.queryByRole("button", { name: /Добавить/ })).toBeNull();
  });

  it("keeps an existing formula when the builder mounts for it (switch DSL → Конструктор)", async () => {
    renderStateful(baseModel({ resultVariables: [makeVar({ formula: "percent >= 70" })] }));
    expandFirstCard(); // existing formula → opens in DSL mode
    expect(screen.getByTestId("metrics-formula-0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Конструктор" }));
    // Builder mounts; the DSL textarea is replaced by the template select.
    await waitFor(() => expect(screen.getByLabelText("Шаблон")).toBeInTheDocument());
    expect(screen.queryByTestId("metrics-formula-0")).toBeNull();
  });

  it("category & weighted show «Нет шкал» and add rows when no scales exist", async () => {
    renderStateful(baseModel({ scales: [], resultVariables: [makeVar({ formula: "" })] }));
    expandFirstCard();

    pickLabeledOption("Шаблон", "Категория по уровням шкалы");
    expect(screen.getAllByText("Нет шкал").length).toBeGreaterThanOrEqual(1);

    pickLabeledOption("Шаблон", "Взвешенная сумма");
    expect(screen.getAllByText("Нет шкал").length).toBeGreaterThanOrEqual(1);
    // Adding a term with no scales seeds an empty scaleKey (the `?? ""` path).
    fireEvent.click(screen.getByRole("button", { name: /Добавить слагаемое/ }));
    expect(screen.getAllByLabelText("Удалить слагаемое").length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Category rows — levels present vs absent ──────────────────────────────

describe("<ResultVariablesSection /> — category level rows", () => {
  it("offers scale levels and supports add/remove of level rows", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar({ formula: "" })] }));
    expandFirstCard();
    pickLabeledOption("Шаблон", "Категория по уровням шкалы");

    // A single (non-removable) row initially.
    expect(screen.queryAllByLabelText("Удалить уровень")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Добавить уровень/ }));
    const removers = screen.getAllByLabelText("Удалить уровень");
    expect(removers.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(removers[0]);
    expect(screen.queryAllByLabelText("Удалить уровень")).toHaveLength(0);
  });

  it("renders the «—» level placeholder when the chosen scale has no levels", () => {
    renderStateful(baseModel({ scales: [scaleNoLevels()], resultVariables: [makeVar({ formula: "" })] }));
    expandFirstCard();
    pickLabeledOption("Шаблон", "Категория по уровням шкалы");
    // The level select falls back to a single «—» option.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});

// ─── ConditionRow — unit matrix (num / level / bool) ───────────────────────

describe("<ResultVariablesSection /> — condition unit matrix", () => {
  it("switches a scale condition to the level unit (level operators + level value)", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar({ formula: "" })] }));
    expandFirstCard();
    // Threshold default condition targets the first scale with a numeric property.
    expect(screen.getByLabelText("Значение")).toBeInTheDocument();
    // Switch the property to «уровень» → the value becomes a level Select.
    pickLabeledOption("Свойство", "уровень");
    expect(screen.getByLabelText("Уровень")).toBeInTheDocument();
    // Level operators are only = / ≠ — open the operator select and pick «≠».
    pickLabeledOption("Оператор", "≠");
  });

  it("falls back to the «—» level option in a threshold condition without scale levels", () => {
    renderStateful(baseModel({ scales: [scaleNoLevels()], resultVariables: [makeVar({ formula: "" })] }));
    expandFirstCard();
    // Threshold's default condition targets the level-less scale; the level unit
    // then renders a Select whose only option is the «—» placeholder.
    pickLabeledOption("Свойство", "уровень");
    expect(screen.getByLabelText("Уровень")).toBeInTheDocument();
  });

  it("hides operator and value inputs for a boolean topic property", () => {
    renderStateful(
      baseModel({
        sections: [buildSection({ topicId: "t1", topicName: "Тема А" })],
        scales: [],
        resultVariables: [makeVar({ formula: "" })],
      }),
    );
    expandFirstCard();
    // Point the condition at a topic, then choose the boolean «пройдена» property.
    pickLabeledOption("Элемент", "Тема А");
    pickLabeledOption("Свойство", "пройдена");
    // Boolean unit → no operator select and no numeric/level value control.
    expect(screen.queryByLabelText("Оператор")).toBeNull();
    expect(screen.queryByLabelText("Значение")).toBeNull();
    expect(screen.queryByLabelText("Уровень")).toBeNull();
  });
});

// ─── Verdict — remove affordance toggles with row count ────────────────────

describe("<ResultVariablesSection /> — verdict conditions", () => {
  it("enables per-row removal only when more than one condition exists", () => {
    renderStateful(baseModel({ scales: [scaleWithLevels()], resultVariables: [makeVar({ formula: "" })] }));
    expandFirstCard();
    pickLabeledOption("Шаблон", "Сертификация / вердикт");
    // Single condition → no remove button.
    expect(screen.queryAllByLabelText("Удалить условие")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Добавить условие/ }));
    const removers = screen.getAllByLabelText("Удалить условие");
    expect(removers.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(removers[0]);
    expect(screen.queryAllByLabelText("Удалить условие")).toHaveLength(0);
  });
});
