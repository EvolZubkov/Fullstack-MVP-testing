/**
 * @module features/tests/editor/sections/__tests__/level-feedback-card.test
 * @description Э2.5: карточка «По уровням» — тексты адаптивных уровней и текст темы, у
 * которой не подтверждён ни один уровень. Список строится по структуре лестницы.
 */
import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LevelFeedbackCard } from "../level-feedback-card";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";

function level(index: number, name: string, over: Record<string, unknown> = {}) {
  return {
    levelIndex: index,
    levelName: name,
    minDifficulty: 0,
    maxDifficulty: 30,
    questionsCount: 5,
    passThreshold: 60,
    passThresholdType: "percent" as const,
    feedback: null,
    links: [],
    ...over,
  };
}

function section(topicId: string, topicName: string) {
  return {
    topicId,
    topicName,
    maxQuestions: 10,
    drawCount: 2,
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

function baseModel(over: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "adaptive",
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
      skipReviewWhenComplete: false, closeSectionOnLeave: false,
      copyProtection: true,
      protectionWatermark: false,
      protectionHideOnBlur: false,
      lmsAttemptResult: "best" as const,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [section("t1", "Тема А")],
    adaptive: {
      showDifficultyLevel: true,
      testSettings: { showDifficultyLevel: true },
      topics: [
        { topicId: "t1", topicName: "Тема А", failureFeedback: null, enabled: true, levels: [level(0, "L1")] },
      ],
    },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...over,
  } as TestEditorModel;
}

function render(model: TestEditorModel, updateModel: (u: (m: TestEditorModel) => TestEditorModel) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(
    <QueryClientProvider client={client}>
      <LevelFeedbackCard model={model} updateModel={updateModel} />
    </QueryClientProvider>,
  );
}

const runUpdater = (fn: ReturnType<typeof vi.fn>, model: TestEditorModel) =>
  (fn.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);

describe("<LevelFeedbackCard />", () => {
  it("стандартному тесту не показывается вовсе: лестницы у него нет", () => {
    const { container } = render(baseModel({ mode: "standard" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("перечисляет включённые темы и их уровни", () => {
    render(baseModel());
    expect(screen.getByText("Тема А")).toBeInTheDocument();
    expect(screen.getByTestId("adaptive-topic-failure-t1")).toBeInTheDocument();
    expect(screen.getByTestId("adaptive-level-t1-0-feedback")).toBeInTheDocument();
  });

  it("выключенная тема в карточку не попадает", () => {
    const model = baseModel({
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          { topicId: "t1", topicName: "Тема А", failureFeedback: null, enabled: false, levels: [level(0, "L1")] },
        ],
      },
    } as never);
    render(model);
    expect(screen.getByTestId("level-feedback-no-topics")).toBeInTheDocument();
  });

  it("текст темы при не пройденном уровне сохраняется", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(model, updateModel);
    fireEvent.click(screen.getByTestId("adaptive-topic-failure-t1"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), { target: { value: "Повторите тему" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(runUpdater(updateModel, model).adaptive.topics[0].failureFeedback).toBe("Повторите тему");
  });

  it("текст уровня сохраняется на своём уровне", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            topicId: "t1",
            topicName: "Тема А",
            failureFeedback: null,
            enabled: true,
            levels: [level(0, "L1"), level(1, "L2")],
          },
        ],
      },
    } as never);
    render(model, updateModel);
    fireEvent.click(screen.getByTestId("adaptive-level-t1-1-feedback"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), { target: { value: "Целевой уровень" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    const next = runUpdater(updateModel, model);
    expect(next.adaptive.topics[0].levels[1].feedback).toBe("Целевой уровень");
    expect(next.adaptive.topics[0].levels[0].feedback).toBeNull();
  });

  it("снятая ссылка уровня уходит в модель", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      adaptive: {
        showDifficultyLevel: true,
        testSettings: { showDifficultyLevel: true },
        topics: [
          {
            topicId: "t1",
            topicName: "Тема А",
            failureFeedback: null,
            enabled: true,
            levels: [level(0, "L1", { links: [{ title: "Doc", url: "https://example.com" }] })],
          },
        ],
      },
    } as never);
    render(model, updateModel);
    // Предпросмотр не пуст (есть ссылка) — правку открывает карандаш.
    fireEvent.click(screen.getByTestId("adaptive-level-t1-0-feedback-edit"));
    fireEvent.click(screen.getByTestId("feedback-editor-link-remove-0"));
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(runUpdater(updateModel, model).adaptive.topics[0].levels[0].links).toHaveLength(0);
  });
});
