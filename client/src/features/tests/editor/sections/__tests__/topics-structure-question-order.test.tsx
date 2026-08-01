/**
 * @module features/tests/editor/sections/__tests__/topics-structure-question-order.test
 * @description PRD-30 Э5: the topic card's delivery-order switch («Случайный
 * порядок вопросов»), its hints and the `linear_flat` warning.
 *
 * Wireframe: docs/wireframes/approved/prd30-question-order.html (states fixed /
 * random / variants / flat). The switch reads «Случайный порядок вопросов», so
 * ON = `random` (today's behaviour) and OFF = `fixed` — the inversion between
 * label and stored value is exactly what these tests pin.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_by_topics",
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
    runtime: {
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true,
    },
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: "top-1", name: "Основы ИБ", questionCount: 10 }],
    text: async () => "[]",
  })));
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const SWITCH = "topic-question-order-top-1";
const WARNING = "topic-question-order-flat-warning-top-1";

describe("delivery-order switch — state (PRD-30 FR-02)", () => {
  it("is ON for a legacy section that has no setting at all", () => {
    const model = baseModel({ sections: [buildSection()] });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.getByTestId(SWITCH)).toBeChecked();
  });

  it("is ON for an explicit random section", () => {
    const model = baseModel({ sections: [buildSection({ questionOrder: "random" })] });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.getByTestId(SWITCH)).toBeChecked();
  });

  it("is OFF for a fixed section, and explains what the order comes from", () => {
    const model = baseModel({ sections: [buildSection({ questionOrder: "fixed" })] });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.getByTestId(SWITCH)).not.toBeChecked();
    expect(screen.getByText(/по индексу, заданному в теме/)).toBeInTheDocument();
  });

  it("in variants mode the hint points at the variant's list, not the index (FR-07)", () => {
    const model = baseModel({
      sections: [buildSection({
        questionOrder: "fixed",
        formSet: { forms: [
          { id: "f1", label: "Вариант 1", questionIds: ["q1"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q2"] },
        ] },
      })],
    });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.getByText(/в порядке списка варианта/)).toBeInTheDocument();
  });

  it("shows no hint while the order is random — the card stays as it is today", () => {
    const model = baseModel({ sections: [buildSection()] });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.queryByText(/по индексу, заданному в теме/)).not.toBeInTheDocument();
  });
});

describe("delivery-order switch — editing", () => {
  it("turning it OFF stores fixed", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection({ questionOrder: "random" })] });

    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId(SWITCH));

    const patched = updateModel.mock.calls[0][0](model) as TestEditorModel;
    expect(patched.sections[0].questionOrder).toBe("fixed");
  });

  it("turning it ON stores random", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection({ questionOrder: "fixed" })] });

    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId(SWITCH));

    const patched = updateModel.mock.calls[0][0](model) as TestEditorModel;
    expect(patched.sections[0].questionOrder).toBe("random");
  });
});

describe("flat-stream warning (PRD-30 FR-12)", () => {
  it("warns when a fixed topic sits in a linear_flat test", () => {
    const model = baseModel({
      flowMode: "linear_flat",
      sections: [buildSection({ questionOrder: "fixed" })],
    });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.getByTestId(WARNING)).toHaveTextContent(/не сохранится/);
  });

  it("stays silent while the topic delivers at random — nothing is lost there", () => {
    const model = baseModel({ flowMode: "linear_flat", sections: [buildSection()] });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.queryByTestId(WARNING)).not.toBeInTheDocument();
  });

  it("stays silent in a sectional flow, where the order does survive", () => {
    const model = baseModel({
      flowMode: "linear_by_topics",
      sections: [buildSection({ questionOrder: "fixed" })],
    });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.queryByTestId(WARNING)).not.toBeInTheDocument();
  });
});
