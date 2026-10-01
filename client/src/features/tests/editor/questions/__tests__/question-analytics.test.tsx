/**
 * @module features/tests/editor/questions/__tests__/question-analytics.test
 * @description Данные прохождений в строке «Вопросов теста»: величины словами аналитики,
 * признак «Качества вопросов» первой отметкой, «Открыть в аналитике» в новой вкладке, и всё
 * это — только с правом на аналитику.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { questionAnalytics } from "../question-analytics";
import { TestQuestionsSection } from "../test-questions-section";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";
import type { ItemQualityRow } from "@/features/analytics/test/item-quality";

const auth = vi.hoisted(() => ({ value: null as null | { can: (p: string) => boolean } }));
vi.mock("@/lib/auth", () => ({ useOptionalAuth: () => auth.value }));
vi.mock("@/features/questions/question-preview-modal", () => ({ QuestionPreviewModal: () => null }));

function item(patch: Partial<ItemQualityRow> = {}): ItemQualityRow {
  return {
    questionId: "q1",
    observations: 87,
    difficulty: 0.62,
    correctedDifficulty: null,
    itemRest: 0.41,
    discrimination: 0.38,
    declaredDifficulty: null,
    difficultyConfidence: "reliable",
    coefficientConfidence: "reliable",
    flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
    timingFlags: { rushed: false, slow: false },
    ...patch,
  };
}

describe("questionAnalytics", () => {
  it("is empty without a psychometrics row", () => {
    expect(questionAnalytics(undefined)).toEqual({ line: null, flag: null, canOpen: false });
  });

  it("names difficulty, discrimination and observations as the analytics tab does", () => {
    expect(questionAnalytics(item())).toEqual({
      line: "трудность 0,62 · дискриминативность 0,41 · 87 наблюдений",
      flag: null,
      canOpen: true,
    });
  });

  it("skips values the engine could not compute", () => {
    const a = questionAnalytics(item({ itemRest: null, observations: 12, coefficientConfidence: "insufficient" }));
    expect(a.line).toBe("трудность 0,62 · 12 наблюдений");
    expect(a.flag).toMatchObject({ tone: "info", title: "Мало данных" });
  });

  it("takes the strongest flag of the quality tab", () => {
    const a = questionAnalytics(item({
      itemRest: -0.18,
      flags: { tooHard: false, tooEasy: true, negativeDiscrimination: true, atChanceLevel: false },
    }));
    expect(a.line).toContain("дискриминативность −0,18");
    expect(a.flag).toMatchObject({ tone: "error", title: "Сильные ошибаются чаще" });
  });

  it("says a pool question was never delivered and offers nothing to open", () => {
    expect(questionAnalytics(item({ neverDelivered: true, observations: 0 }))).toEqual({
      line: "Вопрос ещё не выдавался",
      flag: null,
      canOpen: false,
    });
  });
});

const QUESTIONS = [
  { id: "q1", topicId: "law", type: "single", orderIndex: 1, prompt: "Первый", tags: [], difficulty: 50 },
  { id: "q2", topicId: "law", type: "single", orderIndex: 2, prompt: "Второй", tags: [], difficulty: 50 },
];

function model(): TestEditorModel {
  return {
    id: "test-1",
    version: 1,
    mode: "standard",
    flowMode: "linear_by_topics",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Тест", description: "", descriptionFormat: "plain", status: "draft",
      feedback: { format: "plain", text: "" }, feedbackLinks: [], feedbackAssets: [],
      feedbackEvents: [], webhookUrl: "", telemetryEnabled: false,
    },
    runtime: {} as TestEditorModel["runtime"],
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [{
      topicId: "law", topicName: "Право", maxQuestions: 2, drawCount: 1, drawAll: false,
      required: false, timeLimit: { source: "inherit_test" },
      feedback: { format: "plain", text: "" }, feedbackLinks: [], feedbackAssets: [],
      feedbackEvents: [], defaultPoints: null,
    }],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [{
      id: "o", testId: "test-1", questionId: "q1", points: 2, scoringJson: null, difficulty: null,
      pinnedContentHash: null,
    }] },
  } as TestEditorModel;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/questions"], QUESTIONS);
  client.setQueryData(["tests", "test-1", "review-comments"], []);
  client.setQueryData(["/api/analytics/psychometrics/test-1"], {
    items: [
      item({
        itemRest: -0.18,
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
      }),
      item({ questionId: "q2", neverDelivered: true, observations: 0, difficulty: null, itemRest: null }),
    ],
  });
  return render(
    <QueryClientProvider client={client}>
      <TestQuestionsSection model={model()} topicId="law" testId="test-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  auth.value = null;
  vi.restoreAllMocks();
});

describe("<TestQuestionsSection /> with analytics", () => {
  it("shows the stats line, the analytics flag FIRST and the link with the analytics right", () => {
    auth.value = { can: (p) => p === "analytics.read" };
    renderSection();
    expect(screen.getByTestId("test-questions-stats-q1")).toHaveTextContent(
      "трудность 0,62 · дискриминативность −0,18 · 87 наблюдений",
    );
    const flags = screen.getByTestId("test-questions-row-q1").querySelector(".tb-qlist__flags");
    expect(flags?.firstElementChild).toHaveTextContent("Сильные ошибаются чаще");
    expect(flags).toHaveTextContent("задано в тесте");
    expect(screen.getByTestId("test-questions-stats-q2")).toHaveTextContent("Вопрос ещё не выдавался");
    expect(screen.queryByTestId("test-questions-analytics-q2")).toBeNull();
  });

  it("opens the question breakdown in a new browser tab without opening the drawer", () => {
    auth.value = { can: () => true };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderSection();
    fireEvent.click(screen.getByTestId("test-questions-analytics-q1"));
    expect(open).toHaveBeenCalledWith(
      "/author/tests/test-1/analytics?tab=quality&questionId=q1",
      "_blank",
      "noopener",
    );
  });

  it("shows nothing from analytics without the right", () => {
    auth.value = { can: () => false };
    renderSection();
    expect(screen.queryByTestId("test-questions-stats-q1")).toBeNull();
    expect(screen.queryByTestId("test-questions-flag-analytics-q1")).toBeNull();
    expect(screen.queryByTestId("test-questions-analytics-q1")).toBeNull();
  });
});
