/**
 * @module features/tests/editor/sections/__tests__/topics-structure-section.test
 * @description Component tests for the «Состав» tab content.
 *
 * Coverage:
 *   - Renders one tb-topic-row per section with name, count, draw-count input.
 *   - Empty state shown when sections array is empty.
 *   - Draw-count input clamps to [1, maxQuestions] and calls `updateModel`.
 *   - Remove icon drops the section from the model.
 *   - «+ Добавить тему» opens the topic picker; clicking a topic appends a
 *     section with the default drawCount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";

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
      description: "",
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

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1",
    topicName: "Основы ИБ",
    maxQuestions: 10,
    drawCount: 3,
    required: false,
    timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [
      { id: "top-1", name: "Основы ИБ", questionCount: 10 },
      { id: "top-2", name: "Сетевая безопасность", questionCount: 6 },
    ],
    text: async () => "[]",
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<CompositionSection />", () => {
  it("shows empty placeholder when sections array is empty", () => {
    renderWithClient(
      <CompositionSection model={baseModel()} updateModel={() => {}} />,
    );
    expect(screen.getByTestId("composition-empty")).toBeInTheDocument();
  });

  it("renders a tb-topic-row per section", () => {
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", topicName: "Основы ИБ", drawCount: 4 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    const row = screen.getByTestId("topic-row-top-1");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent("Основы ИБ");
    expect((screen.getByTestId("topic-drawcount-top-1") as HTMLInputElement).value).toBe("4");
  });

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

  it("clamps draw count above maxQuestions down to maxQuestions", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", maxQuestions: 5, drawCount: 3 })],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.change(screen.getByTestId("topic-drawcount-top-1"), { target: { value: "99" } });
    expect(runUpdater(updateModel, model).sections[0].drawCount).toBe(5);
  });

  it("clamps draw count below 1 up to 1", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", maxQuestions: 5, drawCount: 3 })],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.change(screen.getByTestId("topic-drawcount-top-1"), { target: { value: "0" } });
    expect(runUpdater(updateModel, model).sections[0].drawCount).toBe(1);
  });

  it("passes through valid draw count within range", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", maxQuestions: 5, drawCount: 3 })],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.change(screen.getByTestId("topic-drawcount-top-1"), { target: { value: "4" } });
    expect(runUpdater(updateModel, model).sections[0].drawCount).toBe(4);
  });

  it("remove icon drops the section from the model", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1" }),
        buildSection({ topicId: "top-2", topicName: "T2" }),
      ],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.click(screen.getByTestId("topic-remove-top-1"));
    expect(runUpdater(updateModel, model).sections.map((s) => s.topicId)).toEqual(["top-2"]);
  });

  it("«+ Добавить тему» opens the picker and clicking a topic appends a section", async () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [] });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );

    fireEvent.click(screen.getByTestId("composition-add-topic"));
    await waitFor(() => expect(screen.getByTestId("topic-picker-modal")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("topic-picker-item-top-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("topic-picker-item-top-1"));
    const result = runUpdater(updateModel, model);
    expect(result.sections.map((s) => s.topicId)).toEqual(["top-1"]);
    expect(result.sections[0].drawCount).toBe(5);
    expect(result.sections[0].topicName).toBe("Основы ИБ");
    expect(result.sections[0].maxQuestions).toBe(10);
  });
});
