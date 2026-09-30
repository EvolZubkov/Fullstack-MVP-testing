/**
 * @module features/tests/editor/questions/__tests__/test-questions-section.test
 * @description «Вопросы теста»: список вопросов темы со сводкой, поиск по фрагменту,
 * переходы в ящик вопроса и просмотр глазами участника; группа тем в рейле «Состава».
 */
import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestQuestionsSection, searchableText } from "../test-questions-section";
import { CompositionTab } from "../../sections/editor-tabs";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";

// Просмотр глазами участника рисует экран шаблона; здесь важен только факт открытия.
vi.mock("@/features/questions/question-preview-modal", () => ({
  QuestionPreviewModal: ({ question }: { question: { prompt: string } }) => (
    <div data-testid="preview-modal">{question.prompt}</div>
  ),
}));

const QUESTIONS = [
  {
    id: "q1",
    topicId: "law",
    type: "single",
    orderIndex: 2,
    prompt: "Что такое <b>персональные</b> данные?",
    tags: ["Основы"],
    difficulty: 40,
    contentHash: "h1",
    feedbackMode: "general",
    feedback: "См. статью 3",
  },
  {
    id: "q2",
    topicId: "law",
    type: "multiple",
    orderIndex: 1,
    prompt: "Можно ли передавать ёмкие сведения третьим лицам?",
    tags: [],
    difficulty: null,
    contentHash: "h2",
    feedbackMode: "general",
    feedback: "",
  },
  { id: "q9", topicId: "other", type: "single", orderIndex: 0, prompt: "Чужая тема", tags: [] },
];

function section(topicId: string, topicName: string) {
  return {
    topicId,
    topicName,
    maxQuestions: 2,
    drawCount: 1,
    drawAll: false,
    required: false,
    timeLimit: { source: "inherit_test" as const },
    feedback: { format: "plain" as const, text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
  };
}

function model(patch: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_by_topics",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Тест",
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
    runtime: {
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: false,
      allowReturnToUnanswered: true,
      allowFreeSectionNavigation: false,
      allowAnswerChange: false,
      quickAdvance: false,
      showSectionResults: true,
      skipReviewWhenComplete: false,
      closeSectionOnLeave: false,
      copyProtection: true,
      protectionWatermark: false,
      protectionHideOnBlur: false,
      lmsAttemptResult: "best" as const,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [section("other", "Другое"), section("law", "Право")],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...patch,
  } as TestEditorModel;
}

function client() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  c.setQueryData(["/api/questions"], QUESTIONS);
  c.setQueryData(["/api/topics"], []);
  return c;
}

function renderSection(
  m: TestEditorModel,
  handlers: { onOpenQuestion?: (id: string) => void; onCreateQuestion?: (id: string) => void } = {},
) {
  return rtlRender(
    <QueryClientProvider client={client()}>
      <TestQuestionsSection model={m} topicId="law" {...handlers} />
    </QueryClientProvider>,
  );
}

const rowIds = () =>
  screen.getAllByTestId(/^test-questions-row-/).map((r) => r.getAttribute("data-testid"));

describe("searchableText", () => {
  it("drops markup, case and the ё/е difference", () => {
    expect(searchableText("Что <b>ТАКОЕ</b>  Ёж?")).toBe("что такое еж?");
  });
});

describe("<TestQuestionsSection />", () => {
  it("heads the pane with the topic number, name and draw", () => {
    renderSection(model());
    const pane = screen.getByTestId("test-questions-law");
    expect(pane).toHaveTextContent("2. Право");
    expect(pane).toHaveTextContent("выдача 1 из 2");
  });

  it("lists only this topic's questions, by their order in the topic, with the summary", () => {
    renderSection(model());
    expect(rowIds()).toEqual(["test-questions-row-q2", "test-questions-row-q1"]);
    const row = screen.getByTestId("test-questions-row-q1");
    expect(row).toHaveTextContent("Основы · сложность 40 · балл 1 · цена ответа «Точное» · обратная связь: общая");
  });

  it("finds questions by a fragment, ignoring markup, case and ё", () => {
    renderSection(model());
    const search = screen.getByTestId("test-questions-search").querySelector("input") ??
      screen.getByTestId("test-questions-search");
    fireEvent.change(search, { target: { value: "ПЕРСОНАЛЬНЫЕ данные" } });
    expect(rowIds()).toEqual(["test-questions-row-q1"]);
    fireEvent.change(search, { target: { value: "емкие" } });
    expect(rowIds()).toEqual(["test-questions-row-q2"]);
    fireEvent.change(search, { target: { value: "нет такого" } });
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^test-questions-row-/)).toHaveLength(0);
  });

  it("shows deviation flags, including the delivery exclusion", () => {
    renderSection(model({ deliveryExcludedQuestionIds: ["q2"] }));
    expect(screen.getByTestId("test-questions-flag-excluded-q2")).toHaveTextContent("исключён из выдачи");
    expect(screen.queryByTestId("test-questions-flag-excluded-q1")).toBeNull();
  });

  it("opens the question drawer from the row and from the pencil", () => {
    const onOpen = vi.fn();
    renderSection(model(), { onOpenQuestion: onOpen });
    fireEvent.click(screen.getByTestId("test-questions-row-q1"));
    fireEvent.click(screen.getByTestId("test-questions-open-q2"));
    expect(onOpen.mock.calls).toEqual([["q1"], ["q2"]]);
  });

  it("previews as the participant without opening the drawer", () => {
    const onOpen = vi.fn();
    renderSection(model(), { onOpenQuestion: onOpen });
    fireEvent.click(screen.getByTestId("test-questions-preview-q1"));
    expect(screen.getByTestId("preview-modal")).toHaveTextContent("персональные");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("«Добавить вопрос» asks for a new question in this topic", () => {
    const onCreate = vi.fn();
    renderSection(model(), { onCreateQuestion: onCreate });
    fireEvent.click(screen.getByTestId("test-questions-add"));
    expect(onCreate).toHaveBeenCalledWith("law");
  });

  it("says so when the topic has no questions yet", () => {
    rtlRender(
      <QueryClientProvider client={client()}>
        <TestQuestionsSection
          model={model({ sections: [section("empty", "Пустая")] })}
          topicId="empty"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("В теме пока нет вопросов")).toBeInTheDocument();
  });
});

describe("«Вопросы теста» in the composition rail", () => {
  function renderTab(m: TestEditorModel) {
    return rtlRender(
      <QueryClientProvider client={client()}>
        <CompositionTab model={m} updateModel={() => {}} savedFlowMode={null} />
      </QueryClientProvider>,
    );
  }

  it("lists the test's topics, numbered in test order, between «Состав» and «Сценарий»", () => {
    renderTab(model());
    const rail = screen.getByRole("navigation", { name: "Подразделы состава и сценария" });
    const labels = within(rail).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Состав", "1. Другое", "2. Право", "Сценарий"]);
    expect(within(rail).getByRole("group", { name: "Вопросы теста" })).toBeInTheDocument();
  });

  it("opens the chosen topic's questions", () => {
    renderTab(model());
    fireEvent.click(screen.getByTestId("composition-rail-questions:law"));
    expect(screen.getByTestId("test-questions-law")).toBeInTheDocument();
  });

  it("hides the group while the test has no topics", () => {
    renderTab(model({ sections: [] }));
    expect(screen.queryByRole("group", { name: "Вопросы теста" })).toBeNull();
  });
});
