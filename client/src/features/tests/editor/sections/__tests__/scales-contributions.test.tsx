/**
 * @module features/tests/editor/sections/__tests__/scales-contributions.test
 * @description Tests for «Шкалы» → «Вклады вопросов»: без единой шкалы раздел —
 * одно пустое состояние (вкладов нет вовсе), со шкалой обе группы идут стопкой в
 * одной колонке (рейл принадлежит вкладке, своего под-рейла у шкал нет);
 * questions are grouped by section (topic) and each section folds; «Свернуть все» /
 * «Развернуть все» fold and unfold every section (numbering is global across
 * sections); uncovered questions warn on the card and on the section header.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScalesSection } from "../scales-section";
import type { TestEditorModel, EditorSection, ScaleModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

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
      title: "Sample", description: "", descriptionFormat: "plain", status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [], feedbackAssets: [], feedbackEvents: [],
      webhookUrl: "", telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowFreeSectionNavigation: false, allowAnswerChange: false, showSectionResults: true, skipReviewWhenComplete: false, closeSectionOnLeave: false, quickAdvance: false, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false, lmsAttemptResult: "best" as const },
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

// q1/q2 → top-1 (Финансы); q3 → top-2 (Право).
const dbQuestions = [
  { id: "q1", topicId: "top-1", type: "single", prompt: "Вопрос 1", dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 } },
  { id: "q2", topicId: "top-1", type: "single", prompt: "Вопрос 2", dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 1 } },
  { id: "q3", topicId: "top-2", type: "single", prompt: "Вопрос 3", dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 } },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = String(url).includes("/api/questions") ? dbQuestions : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const SCALE: ScaleModel = {
  key: "comp", label: "Компетенция", description: "", type: "number", aggregation: "sum",
  normalization: "none", direction: "positive", bands: [],
  domainMin: null, domainMax: null, displayMax: null, valence: "none", learnerVisibility: "hidden",
  scormTarget: "none", sortOrder: 0,
};

function renderScales(opts: { withScale?: boolean } = {}) {
  const withScale = opts.withScale ?? true;
  const model = baseModel({
    sections: [buildSection(), buildSection({ topicId: "top-2", topicName: "Право" })],
    scales: withScale ? [SCALE] : [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScalesSection pane="contributions" model={model} testId="test-1" updateModel={() => {}} />
    </QueryClientProvider>,
  );
}

/** Render with a scale: обе группы («Шкалы теста» и «Вклады») идут одной колонкой. */
function openContributions() {
  renderScales({ withScale: true });
}

describe("«Шкалы» → «Вклады вопросов»", () => {
  it("without a single scale the section is the empty state only — no contributions", () => {
    renderScales({ withScale: false });
    expect(screen.getByTestId("scales-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("scales-pane-contributions")).toBeNull();
  });

  it("панель показывает ОДНУ сторону: вклады без списка шкал", () => {
    // Разделение сделано ради матрицы: её ширина растёт с каждой шкалой, и делить
    // панель со списком шкал ей нечем. Выбор между сторонами делает рейл вкладки.
    renderScales({ withScale: true });
    expect(screen.getByTestId("scales-pane-contributions")).toBeInTheDocument();
    expect(screen.queryByTestId("scales-pane-list")).toBeNull();
    // Свой рейл панель по-прежнему не рисует — рейл принадлежит вкладке.
    expect(document.querySelector(".ou-drawer__rail")).toBeNull();
  });

  it("без единой шкалы вклады подменяются списком: показывать матрицу нечем", () => {
    renderScales({ withScale: false });
    expect(screen.getByTestId("scales-pane-list")).toBeInTheDocument();
    expect(screen.queryByTestId("scales-pane-contributions")).toBeNull();
  });

  it("groups questions under section headers with global numbering", async () => {
    openContributions();
    expect(await screen.findByTestId("contrib-sec-toggle-top-1")).toBeInTheDocument();
    expect(screen.getByTestId("contrib-sec-toggle-top-2")).toBeInTheDocument();
    // Three cards, numbered globally 1..3 across the two sections.
    expect(screen.getByTestId("contrib-card-0")).toHaveTextContent("1. Вопрос 1");
    expect(screen.getByTestId("contrib-card-1")).toHaveTextContent("2. Вопрос 2");
    expect(screen.getByTestId("contrib-card-2")).toHaveTextContent("3. Вопрос 3");
  });

  it("folds one section: its cards hide, the other stays", async () => {
    openContributions();
    expect(await screen.findByTestId("contrib-card-0")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("contrib-sec-toggle-top-1"));
    await waitFor(() => expect(screen.queryByTestId("contrib-card-0")).toBeNull());
    expect(screen.getByTestId("contrib-card-2")).toBeInTheDocument();
  });

  it("«Свернуть все» / «Развернуть все» fold and unfold every section", async () => {
    openContributions();
    expect(await screen.findByTestId("contrib-card-0")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("contrib-collapse-all"));
    await waitFor(() => expect(screen.queryByTestId("contrib-card-0")).toBeNull());
    expect(screen.queryByTestId("contrib-card-2")).toBeNull();

    fireEvent.click(screen.getByTestId("contrib-expand-all"));
    expect(await screen.findByTestId("contrib-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("contrib-card-2")).toBeInTheDocument();
  });

  it("uncovered questions warn on the card; the section header only counts questions", async () => {
    openContributions();
    const card = await screen.findByTestId("contrib-card-0");
    // Inside the pane a scale always exists, so «не привязан» is actionable.
    expect(card.querySelector(".tb-status-dot--warn")).not.toBeNull();
    expect(card).toHaveTextContent("не привязан");
    // Шапка свёртки о непривязанных МОЛЧИТ: об этом уже говорят баннер над списком и
    // точка карточки, а третий счётчик тех же вопросов только спорил бы с ними.
    expect(screen.queryByTestId("contrib-sec-uncovered-top-1")).toBeNull();
    expect(screen.getByTestId("contrib-sec-top-1")).toHaveTextContent("2 вопроса");
  });
});
