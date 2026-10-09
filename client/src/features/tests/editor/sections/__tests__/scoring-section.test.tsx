/**
 * @module features/tests/editor/sections/__tests__/scoring-section.test
 * @description Component tests for the «Оценка» tab (PRD-15 block D).
 *
 * Coverage:
 *   - Test-wide default input edits `model.scoring.defaultQuestionPoints`
 *     ("" = inherit, whole >= 0); per-section default edits the section row.
 *   - The questions table shows EFFECTIVE values via the shared resolver and
 *     marks overridden rows (accent bar class) and cells (fill class); overrides
 *     are read from the draft (`model.scoring.questionOverrides`).
 *   - A stale override (pinned hash diverged) carries «Настройка устарела».
 *   - The reset icon removes the override from the draft (no network); the edit
 *     icon opens the modal and «Применить» writes the override into the draft,
 *     re-pinning the question's current contentHash.
 *   - Folding: a section header toggle hides its questions; «Свернуть все» /
 *     «Развернуть все» fold and unfold every section.
 *   - Create mode (no testId) shows the hint banner instead of tables.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScoringSection } from "../scoring-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import type { QuestionScoringOverride } from "../../scoring-api";
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

// q1: настроены балл/цена/сложность; пин устарел (h-old vs h-new). Overrides are
// now draft-managed — fed through the model, NOT fetched.
const dbOverrides: QuestionScoringOverride[] = [
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
    if (method === "GET" && String(url).includes("/api/questions")) body = dbQuestions;
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
    const model = baseModel({ scoring: { defaultQuestionPoints: 2, questionOverrides: [] } });
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
      scoring: { defaultQuestionPoints: 4, questionOverrides: [] },
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
    const model = baseModel({
      sections: [buildSection()],
      scoring: { defaultQuestionPoints: null, questionOverrides: dbOverrides },
    });
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

  it("a row that only carries the delivery exclusion is not an override", async () => {
    // Analytics creates the row to exclude the question from delivery; scoring stays empty.
    // Marking it «задано в тесте» and offering «Сбросить» used to return the question to
    // delivery on save (the reset deleted the whole row).
    const exclusionOnly: QuestionScoringOverride = {
      id: "ov2", testId: "test-1", questionId: "q2",
      points: null, scoringJson: null, difficulty: null, pinnedContentHash: null,
    };
    const model = baseModel({
      sections: [buildSection()],
      scoring: { defaultQuestionPoints: null, questionOverrides: [exclusionOnly] },
    });
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={() => {}} />);

    const row2 = await screen.findByTestId("scoring-row-q2");
    expect(row2).not.toHaveClass("tb-qscoring__row--override");
    expect(screen.queryByTestId("scoring-override-q2")).toBeNull();
    expect(screen.queryByTestId("scoring-reset-q2")).toBeNull();
    expect(screen.getByTestId("scoring-edit-q2")).toHaveAttribute("aria-label", "Настроить оценку вопроса");
  });

  it("reset icon removes the override from the draft (no network)", async () => {
    const model = baseModel({
      sections: [buildSection()],
      scoring: { defaultQuestionPoints: null, questionOverrides: dbOverrides },
    });
    const updateModel = vi.fn();
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={updateModel} />);

    fireEvent.click(await screen.findByTestId("scoring-reset-q1"));
    const next = runUpdater(updateModel, model);
    expect(next.scoring.questionOverrides.some((o) => o.questionId === "q1")).toBe(false);
    // Deferred: nothing is persisted until the drawer «Сохранить».
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/tests/test-1/question-scoring/q1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("edit icon opens the modal; «Применить» writes the override into the draft", async () => {
    const model = baseModel({
      sections: [buildSection()],
      scoring: { defaultQuestionPoints: null, questionOverrides: dbOverrides },
    });
    const updateModel = vi.fn();
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={updateModel} />);

    fireEvent.click(await screen.findByTestId("scoring-edit-q1"));
    // The modal renders in a portal; assert by its content. Stale override →
    // the warning banner is shown in the modal too.
    expect(await screen.findByTestId("qscoring-stale-banner")).toBeInTheDocument();

    const points = screen.getByTestId("qscoring-points") as HTMLInputElement;
    expect(points.value).toBe("5");
    fireEvent.change(points, { target: { value: "0" } });

    fireEvent.click(screen.getByTestId("qscoring-apply"));
    const next = runUpdater(updateModel, model);
    const ov = next.scoring.questionOverrides.find((o) => o.questionId === "q1")!;
    expect(ov.points).toBe(0); // явный 0 — вопрос без баллов в этом тесте
    expect(ov.difficulty).toBe(70);
    expect(ov.scoringJson).toMatchObject({ kind: "tiered" });
    // Re-pinned to the question's CURRENT content (clears the stale tag, FR-30).
    expect(ov.pinnedContentHash).toBe("h-new");
    // Deferred: no PUT on apply.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/tests/test-1/question-scoring/q1",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("«Предпросмотр балла» scores a demo answer against the open config (issue #31)", async () => {
    const model = baseModel({
      sections: [buildSection()],
      scoring: { defaultQuestionPoints: null, questionOverrides: dbOverrides },
    });
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={() => {}} />);

    fireEvent.click(await screen.findByTestId("scoring-edit-q1"));
    fireEvent.click(await screen.findByTestId("qscoring-preview"));

    // q1: ключ [0,1] из трёх вариантов, ступень «c = T» платит 2. Первый демо-ответ —
    // полностью верный, поэтому строка срабатывает и балл максимальный.
    const table = await screen.findByTestId("score-preview-table");
    expect(table).toHaveTextContent("А, Б (T = 2)");
    expect(screen.getByTestId("score-preview-verdict")).toHaveTextContent("Правильно");

    // Возврат оставляет конструктор открытым — предпросмотр ничего не применяет.
    fireEvent.click(screen.getByTestId("score-preview-back"));
    await waitFor(() => expect(screen.queryByTestId("score-preview-table")).toBeNull());
    expect(screen.getByTestId("qscoring-apply")).toBeInTheDocument();
  });

  it("folds a section: the header toggle hides its question table", async () => {
    const model = baseModel({
      sections: [buildSection()],
      scoring: { defaultQuestionPoints: null, questionOverrides: dbOverrides },
    });
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={() => {}} />);
    expect(await screen.findByTestId("scoring-row-q1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("scoring-sec-toggle-top-1"));
    await waitFor(() => expect(screen.queryByTestId("scoring-row-q1")).toBeNull());
  });

  it("«Свернуть все» / «Развернуть все» fold and unfold every section", async () => {
    const model = baseModel({
      sections: [buildSection()],
      scoring: { defaultQuestionPoints: null, questionOverrides: dbOverrides },
    });
    renderWithClient(<ScoringSection model={model} testId="test-1" updateModel={() => {}} />);
    expect(await screen.findByTestId("scoring-row-q1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("scoring-collapse-all"));
    await waitFor(() => expect(screen.queryByTestId("scoring-row-q1")).toBeNull());

    fireEvent.click(screen.getByTestId("scoring-expand-all"));
    expect(await screen.findByTestId("scoring-row-q1")).toBeInTheDocument();
  });

  // Черновик не требует сохранения, чтобы его настроить: вопросы приходят из банка,
  // а переопределения лежат в модели и дописываются сразу после создания теста.
  it("режим создания: таблица вопросов доступна без сохранённого теста", async () => {
    const model = baseModel({ id: undefined, sections: [buildSection()] });
    renderWithClient(<ScoringSection model={model} updateModel={() => {}} />);
    expect(await screen.findByTestId("scoring-row-q1")).toBeInTheDocument();
    expect(screen.queryByTestId("scoring-create-hint")).toBeNull();
  });
});
