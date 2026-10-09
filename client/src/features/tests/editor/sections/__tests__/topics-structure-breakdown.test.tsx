/**
 * @module features/tests/editor/sections/__tests__/topics-structure-breakdown.test
 * @description PRD-50 §16 (FR-56): таблица «раздел x ключ» после отмены индивидуальных
 * порогов подтем — квота и попадание ключа в каждый вариант. Порогов в ней нет вовсе;
 * в вариантном режиме таблица остаётся раскрытой СПРАВКОЙ о раскладке тегов по вариантам.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

const TOPICS = [{ id: "top-1", name: "Основы ИБ", questionCount: 4 }];
const QUESTIONS = [
  { id: "q1", topicId: "top-1", type: "single", prompt: "Q1", tags: ["Крипто"] },
  { id: "q2", topicId: "top-1", type: "single", prompt: "Q2", tags: ["Крипто"] },
  { id: "q3", topicId: "top-1", type: "single", prompt: "Q3", tags: ["Сети"] },
  { id: "q4", topicId: "top-1", type: "single", prompt: "Q4", tags: [] },
];

function baseModel(sections: EditorSection[]): TestEditorModel {
  return {
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
    runtime: {
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowFreeSectionNavigation: false, allowAnswerChange: false, showSectionResults: true,
      skipReviewWhenComplete: false, closeSectionOnLeave: false, quickAdvance: false, copyProtection: true,
      protectionWatermark: false, protectionHideOnBlur: false,
      lmsAttemptResult: "best" as const,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections,
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [], scales: [], measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
  };
}

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1", topicName: "Основы ИБ", maxQuestions: 4, drawCount: 3,
    drawAll: false, required: false, timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [], feedbackAssets: [], feedbackEvents: [], defaultPoints: null,
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => TOPICS, text: async () => "[]" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/questions"], QUESTIONS);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("таблица «раздел x ключ»", () => {
  it("FR-56: переключателя порогов и столбца «Порог» в карточке больше нет", () => {
    const model = baseModel([
      buildSection({ drawBlueprint: { strata: [{ tag: "Крипто", count: 1, mode: "exact" }] } }),
    ]);
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.queryByTestId("topic-rules-toggle-top-1")).toBeNull();
    expect(screen.queryByTestId("key-threshold-mode-top-1-0")).toBeNull();
    expect(screen.queryByTestId("key-threshold-value-top-1-0")).toBeNull();
    // Квоты остались: они про выдачу, а не про оценку.
    expect(screen.getByTestId("topic-quota-toggle-top-1")).toBeInTheDocument();
    // Карточка квоты открывается свёрнутой — поля живут в её теле.
    fireEvent.click(screen.getByTestId("quota-fold-top-1-0"));
    expect(screen.getByTestId("quota-tag-top-1-0")).toBeInTheDocument();
  });

  it("FR-56: в режиме вариантов таблица раскрыта справкой — теги темы и «В вариантах»", () => {
    const model = baseModel([
      buildSection({
        formSet: {
          forms: [
            { id: "f1", label: "Вариант 1", questionIds: ["q1", "q3"] },
            { id: "f2", label: "Вариант 2", questionIds: ["q3", "q4"] },
          ],
        },
      }),
    ]);
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("topic-quota-block-top-1")).toBeInTheDocument();
    // Ключ «Крипто» есть в первом варианте (q1) и отсутствует во втором.
    expect(screen.getByTestId("key-variants-top-1-0")).toHaveTextContent("Вариант 1: 1");
    expect(screen.getByTestId("key-variants-top-1-0")).toHaveTextContent("Вариант 2: 0");
  });

  it("нехватка вопросов под квоту помечает СТРОКУ знаком тревоги с подсказкой", () => {
    const model = baseModel([
      // «Сети» несёт один вопрос (q3), а запрошено два — нехватка ровно в этой строке.
      buildSection({
        drawBlueprint: {
          strata: [
            { tag: "Крипто", count: 1, mode: "exact" },
            { tag: "Сети", count: 2, mode: "exact" },
          ],
        },
      }),
    ]);
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.queryByTestId("quota-shortfall-top-1-0")).toBeNull();
    const alarm = screen.getByTestId("quota-shortfall-top-1-1");
    expect(alarm).toHaveTextContent("доступно 1 из 2");
    expect(alarm).toHaveTextContent("Выдастся сколько есть");
    // Чипа уровня в подвале карточки больше нет — о нехватке говорит знак у значения.
    expect(screen.queryByText("нехватка по тегу")).toBeNull();
  });
});
