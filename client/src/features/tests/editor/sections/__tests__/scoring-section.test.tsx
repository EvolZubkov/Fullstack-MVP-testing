/**
 * @module features/tests/editor/sections/__tests__/scoring-section.test
 * @description Component tests for the «Оценка» tab (PRD-15 block D).
 *
 * Coverage:
 *   - Test-wide default input edits `model.scoring.defaultQuestionPoints`
 *     ("" = inherit, whole >= 0); per-section default edits the section row.
 *   - The questions table shows EFFECTIVE values via the shared resolver and
 *     marks overridden rows (accent bar class) and cells (fill class).
 *   - A stale override (pinned hash diverged) carries «Настройка устарела».
 *   - The reset icon DELETEs the override; the edit icon opens the modal and
 *     «Применить» PUTs the override patch.
 *   - Create mode (no testId) shows the hint banner instead of tables.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScoringSection } from "../scoring-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
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
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false },
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
    scoring: { defaultQuestionPoints: null },
    ...overrides,
  };
}

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

const dbQuestions = [
  {
    id: "q1", topicId: "top-1", type: "multiple", prompt: "Какой документ закрепляет лимиты?",
    dataJson: { options: ["А", "Б", "В"] }, correctJson: { correctIndices: [0, 1] },
    points: 1, difficulty: 50, scoringJson: null, contentHash: "h-new", tags: [],
  },
  {
    id: "q2", topicId: "top-1", type: "single", prompt: "Что входит в расходы?",
    dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 40, scoringJson: null, contentHash: "h2", tags: [],
  },
];

// q1: настроены балл/цена/сложность; пин устарел (h-old vs h-new).
const dbOverrides = [
  {
    id: "ov1", testId: "test-1", questionId: "q1",
    points: 5,
    scoringJson: { kind: "tiered", tiers: [{ when: { all: [{ lhs: "c", op: "==", rhs: "T" }] }, score: 2 }] },
    difficulty: 70,
    pinnedContentHash: "h-old",
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let body: unknown = [];
    if (method === "GET" && String(url).includes("/question-scoring")) body = dbOverrides;
    else if (method === "GET" && String(url).includes("/api/questions")) body = dbQuestions;
    else body = { ok: true };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  // Mirror the app's default queryFn (lib/queryClient): the key IS the URL.
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const res = await fetch(queryKey[0] as string, { credentials: "include" });
          return res.json();
        },
      },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Apply the captured updater to a model (mirrors useTestEditor.updateModel). */
function runUpdater(
  updateModel: ReturnType<typeof vi.fn>,
  model: TestEditorModel,
): TestEditorModel {
  const updater = updateModel.mock.calls.at(-1)?.[0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<ScoringSection />", () => {
  it("edits the test-wide default («» = наследование, целое >= 0)", () => {
    const model = baseModel({ scoring: { defaultQuestionPoints: 2 } });
    const updateModel = vi.fn();
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={updateModel} />);

    const input = screen.getByTestId("scoring-test-default") as HTMLInputElement;
    expect(input.value).toBe("2");

    fireEvent.change(input, { target: { value: "3" } });
    expect(runUpdater(updateModel, model).scoring.defaultQuestionPoints).toBe(3);

    fireEvent.change(input, { target: { value: "" } });
    expect(runUpdater(updateModel, model).scoring.defaultQuestionPoints).toBeNull();
  });

  it("edits the per-section default and shows the inherited placeholder", () => {
    const model = baseModel({
      scoring: { defaultQuestionPoints: 4 },
      sections: [buildSection()],
    });
    const updateModel = vi.fn();
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={updateModel} />);

    const input = screen.getByTestId("scoring-sec-default-top-1") as HTMLInputElement;
    expect(input.placeholder).toBe("4");

    fireEvent.change(input, { target: { value: "7" } });
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].defaultPoints).toBe(7);
  });

  it("shows effective values, marks overridden cells and a stale override", async () => {
    const model = baseModel({ sections: [buildSection()] });
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={() => {}} />);

    const row1 = await screen.findByTestId("scoring-row-q1");
    // Override wins: points 5 / Ступени / difficulty 70; row + cells marked.
    expect(row1).toHaveClass("tb-qscoring__row--override");
    expect(row1).toHaveTextContent("5");
    expect(row1).toHaveTextContent("Ступени");
    expect(row1).toHaveTextContent("70");
    expect(row1.querySelectorAll(".tb-qscoring__cell--override")).toHaveLength(3);
    expect(screen.getByTestId("scoring-stale-q1")).toBeInTheDocument();

    // q2 inherits everything: no marking, no reset icon.
    const row2 = screen.getByTestId("scoring-row-q2");
    expect(row2).not.toHaveClass("tb-qscoring__row--override");
    expect(row2).toHaveTextContent("Точное");
    expect(row2.querySelectorAll(".tb-qscoring__cell--override")).toHaveLength(0);
    expect(screen.queryByTestId("scoring-reset-q2")).toBeNull();
  });

  it("reset icon DELETEs the override", async () => {
    const model = baseModel({ sections: [buildSection()] });
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={() => {}} />);

    fireEvent.click(await screen.findByTestId("scoring-reset-q1"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tests/test-1/question-scoring/q1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("edit icon opens the modal; «Применить» PUTs the override patch", async () => {
    const model = baseModel({ sections: [buildSection()] });
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={() => {}} />);

    fireEvent.click(await screen.findByTestId("scoring-edit-q1"));
    // The modal renders in a portal; assert by its content. Stale override →
    // the warning banner is shown in the modal too.
    expect(await screen.findByTestId("qscoring-stale-banner")).toBeInTheDocument();

    const points = screen.getByTestId("qscoring-points") as HTMLInputElement;
    expect(points.value).toBe("5");
    fireEvent.change(points, { target: { value: "0" } });

    fireEvent.click(screen.getByTestId("qscoring-apply"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tests/test-1/question-scoring/q1",
        expect.objectContaining({ method: "PUT" }),
      );
    });
    const putCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT",
    )!;
    const sent = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(sent.points).toBe(0); // явный 0 — вопрос без баллов в этом тесте
    expect(sent.difficulty).toBe(70);
    expect(sent.scoringJson).toMatchObject({ kind: "tiered" });
  });

  it("create mode: hint banner instead of question tables", () => {
    const model = baseModel({ id: undefined, sections: [buildSection()] });
    renderWithClient(<ScoringSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("scoring-create-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("scoring-row-q1")).toBeNull();
  });
});
