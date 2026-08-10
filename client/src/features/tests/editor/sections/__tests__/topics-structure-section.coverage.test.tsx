/**
 * @module features/tests/editor/sections/__tests__/topics-structure-section.coverage.test
 * @description Coverage-oriented tests for the «Состав» tab that the base suite
 * (`topics-structure-section.test.tsx`) leaves untouched: the adaptive banner
 * and forced «draw all», the PRD-11 QuotaEditor (enable / add / remove / edit /
 * overflow / shortfall / locked states), draw-count validation errors, and the
 * topic-picker empty / filter branches.
 *
 * These complement — never duplicate — the base file; they focus on the
 * TopicRow body controls and the QuotaEditor sub-component.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import { buildFieldErrorIndex } from "../../field-errors";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOPICS = [
  { id: "top-1", name: "Основы ИБ", questionCount: 10 },
  { id: "top-2", name: "Сетевая безопасность", questionCount: 6 },
];

// Questions carry both the quota-editor shape ({topicId, tags}) and the
// variants-editor shape ({id, type, prompt}). Only top-1 has tagged questions.
const QUESTIONS = [
  { id: "q1", topicId: "top-1", type: "single", prompt: "Q1", tags: ["Крипто"] },
  { id: "q2", topicId: "top-1", type: "single", prompt: "Q2", tags: ["Крипто", "Сети"] },
  { id: "q3", topicId: "top-1", type: "single", prompt: "Q3", tags: ["Сети"] },
];

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
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true, skipReviewWhenComplete: false, quickAdvance: false, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false },
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

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1",
    topicName: "Основы ИБ",
    maxQuestions: 10,
    drawCount: 3,
    drawAll: false,
    required: false,
    timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => TOPICS,
    text: async () => "[]",
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["/api/questions"], QUESTIONS);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function runUpdater(
  updateModel: ReturnType<typeof vi.fn>,
  model: TestEditorModel,
  call = 0,
): TestEditorModel {
  const updater = updateModel.mock.calls[call][0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

/** Open a DS Select by testid wrapper and click the option with `label`. */
function selectOption(selectTestId: string, label: string | RegExp) {
  const wrap = screen.getByTestId(selectTestId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

// ─── Adaptive mode: banner + forced draw all ──────────────────────────────────

describe("<CompositionSection /> — adaptive mode", () => {
  it("shows the adaptive banner and locks «draw all» on for a topic", () => {
    const model = baseModel({
      mode: "adaptive",
      sections: [buildSection({ topicId: "top-1", drawAll: false, maxQuestions: 10 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("composition-adaptive-banner")).toBeInTheDocument();

    const drawAll = screen.getByTestId("topic-drawall-top-1") as HTMLInputElement;
    expect(drawAll.checked).toBe(true);
    expect(drawAll).toBeDisabled();
    expect(screen.getByText(/включено адаптивным режимом/i)).toBeInTheDocument();
    // The count field is locked while adaptive draws the whole topic.
    expect(screen.getByTestId("topic-drawcount-top-1")).toBeDisabled();
  });
});

// ─── Draw-all toggle (standard) ───────────────────────────────────────────────

describe("<CompositionSection /> — draw all toggle", () => {
  it("turning «draw all» on snapshots maxQuestions into drawCount", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", drawAll: false, maxQuestions: 7, drawCount: 3 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("topic-drawall-top-1"));
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].drawAll).toBe(true);
    expect(next.sections[0].drawCount).toBe(7);
  });
});

// ─── QuotaEditor (PRD-11) ─────────────────────────────────────────────────────

describe("<CompositionSection /> — QuotaEditor", () => {
  it("shows the «no tags» hint and a disabled toggle for an untagged topic", () => {
    // top-2 has no seeded (tagged) questions.
    const model = baseModel({
      sections: [buildSection({ topicId: "top-2", topicName: "Сетевая безопасность", maxQuestions: 6 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("topic-quota-notags-top-2")).toBeInTheDocument();
    expect(screen.getByTestId("topic-quota-toggle-top-2")).toBeDisabled();
  });

  it("enabling quotas seeds a first stratum from the topic's tags", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection({ topicId: "top-1" })] });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("topic-quota-toggle-top-1"));
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].drawBlueprint?.strata).toHaveLength(1);
    expect(next.sections[0].drawBlueprint?.strata[0].count).toBe(1);
  });

  it("renders the overflow error banner when Σ quotas exceed the draw count", () => {
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawCount: 3,
          drawBlueprint: { strata: [{ tag: "Крипто", count: 5, mode: "exact" }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("topic-quota-block-top-1")).toBeInTheDocument();
    expect(screen.getByTestId("topic-quota-error-top-1")).toBeInTheDocument();
  });

  it("renders the shortfall warning when a tag has fewer questions than its quota", () => {
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawCount: 5,
          // «Крипто» has 2 available; a quota of 3 is a non-blocking shortfall.
          drawBlueprint: { strata: [{ tag: "Крипто", count: 3, mode: "exact" }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("topic-quota-warning-top-1")).toBeInTheDocument();
  });

  it("adds a stratum for an unused tag", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawCount: 5,
          drawBlueprint: { strata: [{ tag: "Крипто", count: 1, mode: "exact" }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("quota-add-top-1"));
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].drawBlueprint?.strata).toHaveLength(2);
  });

  it("removes a stratum via its trash icon", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawCount: 5,
          drawBlueprint: {
            strata: [
              { tag: "Крипто", count: 1, mode: "exact" },
              { tag: "Сети", count: 1, mode: "exact" },
            ],
          },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("quota-remove-top-1-0"));
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].drawBlueprint?.strata).toHaveLength(1);
    expect(next.sections[0].drawBlueprint?.strata[0].tag).toBe("Сети");
  });

  it("updates a stratum count via the number input", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawCount: 5,
          drawBlueprint: { strata: [{ tag: "Крипто", count: 1, mode: "exact" }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.change(screen.getByTestId("quota-count-top-1-0"), { target: { value: "3" } });
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].drawBlueprint?.strata[0].count).toBe(3);
  });

  it("switches a stratum tag via the Select", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawCount: 5,
          drawBlueprint: { strata: [{ tag: "Крипто", count: 1, mode: "exact" }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    selectOption("quota-tag-top-1-0", "Сети");
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].drawBlueprint?.strata[0].tag).toBe("Сети");
  });

  it("switches a stratum mode to «Не менее» via the SegmentedControl", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawCount: 5,
          drawBlueprint: { strata: [{ tag: "Крипто", count: 1, mode: "exact" }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByRole("button", { name: "Не менее" }));
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].drawBlueprint?.strata[0].mode).toBe("min");
  });

  it("locks the quota editor with the variants reason when a form set is present", () => {
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawBlueprint: { strata: [{ tag: "Крипто", count: 1, mode: "exact" }] },
          formSet: { forms: [{ id: "f1", label: "Вариант 1", questionIds: ["q1"] }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    const locked = screen.getByTestId("topic-quota-locked-top-1");
    expect(locked).toHaveTextContent(/Варианты теста/i);
  });

  it("locks the quota editor with the «whole topic» reason when draw-all is on", () => {
    const model = baseModel({
      sections: [
        buildSection({
          topicId: "top-1",
          drawAll: true,
          drawBlueprint: { strata: [{ tag: "Крипто", count: 1, mode: "exact" }] },
        }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("topic-quota-locked-top-1")).toHaveTextContent(/вся тема/i);
  });
});

// ─── Draw-count validation error ──────────────────────────────────────────────

describe("<CompositionSection /> — draw count error", () => {
  it("renders the inline draw-count error from fieldErrors", () => {
    const fieldErrors = buildFieldErrorIndex([
      { field: "sections[0].drawCount", message: "Слишком много вопросов", code: "x", severity: "error" },
    ]);
    const model = baseModel({ sections: [buildSection({ topicId: "top-1", drawAll: false })] });
    renderWithClient(
      <CompositionSection model={model} updateModel={() => {}} fieldErrors={fieldErrors} />,
    );
    expect(screen.getByTestId("topic-drawcount-error-top-1")).toHaveTextContent(
      "Слишком много вопросов",
    );
  });
});

// ─── Topic picker branches ────────────────────────────────────────────────────

describe("<CompositionSection /> — topic picker", () => {
  it("shows «all topics added» when every visible topic is already in the test", async () => {
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1", topicName: "Основы ИБ" }),
        buildSection({ topicId: "top-2", topicName: "Сетевая безопасность", maxQuestions: 6 }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    // Wait until /api/topics has loaded so availableTopics is computed.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("composition-add-topic"));
    await waitFor(() =>
      expect(screen.getByText("Все темы уже добавлены в тест")).toBeInTheDocument(),
    );
  });

  it("filters the picker list and shows «Ничего не найдено» for no match", async () => {
    const model = baseModel({ sections: [] });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("composition-add-topic"));
    await waitFor(() => expect(screen.getByTestId("topic-picker-item-top-2")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("topic-picker-search"), { target: { value: "Сет" } });
    expect(screen.getByTestId("topic-picker-item-top-2")).toBeInTheDocument();
    expect(screen.queryByTestId("topic-picker-item-top-1")).toBeNull();
    fireEvent.change(screen.getByTestId("topic-picker-search"), { target: { value: "zzz" } });
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });
});

// ─── Remove section cascades to pass rules ────────────────────────────────────

describe("<CompositionSection /> — remove section", () => {
  it("dropping a section also removes its per-topic pass rule", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1" })],
      passRules: {
        decisionPolicy: "overall_only",
        overall: { type: "percent", value: 70 },
        byTopic: { "top-1": { source: "custom", type: "percent", value: 80 } },
      },
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("topic-remove-top-1"));
    const next = runUpdater(updateModel, model);
    expect(next.sections).toHaveLength(0);
    expect(next.passRules.byTopic["top-1"]).toBeUndefined();
  });
});
