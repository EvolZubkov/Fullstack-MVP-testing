/**
 * @module features/tests/editor/sections/__tests__/topic-picker-create.test
 * @description «Создать тему» в окне выбора темы: кнопка есть только при праве создавать
 * темы, ящик новой темы получает название из поиска, созданная тема встаёт в тест — в ту
 * группу, из которой открывали выбор.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";

const auth = vi.hoisted(() => ({ value: null as null | { can: (p: string) => boolean } }));
vi.mock("@/lib/auth", () => ({ useOptionalAuth: () => auth.value }));

// Ящик темы проверен своими тестами; здесь важно, ЧТО ему передают и что делают с ответом.
vi.mock("@/features/topics/topic-drawer", () => ({
  TopicDrawer: (props: {
    target: { mode: string; name?: string } | null;
    onCreated?: (topic: { id: string; name: string }) => void;
    onClose: () => void;
  }) =>
    props.target ? (
      <div data-testid="topic-drawer-stub" data-name={props.target.name ?? ""}>
        <button
          type="button"
          data-testid="topic-drawer-stub-save"
          onClick={() => {
            props.onCreated?.({ id: "new-1", name: "Новая тема" });
            props.onClose();
          }}
        />
      </div>
    ) : null,
}));

function model(patch: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
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
    runtime: {
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowFreeSectionNavigation: false, allowAnswerChange: false,
      quickAdvance: false, showSectionResults: true, skipReviewWhenComplete: false,
      closeSectionOnLeave: false, copyProtection: true, protectionWatermark: false,
      protectionHideOnBlur: false, lmsAttemptResult: "best" as const,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...patch,
  } as TestEditorModel;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: "top-1", name: "Основы ИБ", questionCount: 10 }],
    text: async () => "[]",
  })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  auth.value = null;
});

function renderSection(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function runUpdater(updateModel: ReturnType<typeof vi.fn>, m: TestEditorModel): TestEditorModel {
  return (updateModel.mock.calls[0][0] as (x: TestEditorModel) => TestEditorModel)(m);
}

describe("«Создать тему» in the topic picker", () => {
  it("is hidden without the right to create topics", async () => {
    auth.value = { can: () => false };
    renderSection(<CompositionSection model={model()} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("composition-add-topic"));
    await waitFor(() => expect(screen.getByTestId("topic-picker-item-top-1")).toBeInTheDocument());
    expect(screen.queryByTestId("topic-picker-create")).toBeNull();
  });

  it("is hidden outside an auth provider", async () => {
    renderSection(<CompositionSection model={model()} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("composition-add-topic"));
    await waitFor(() => expect(screen.getByTestId("topic-picker-item-top-1")).toBeInTheDocument());
    expect(screen.queryByTestId("topic-picker-create")).toBeNull();
  });

  it("opens the topic drawer with the searched name and adds the created topic", async () => {
    auth.value = { can: (p) => p === "topics.manage" };
    const updateModel = vi.fn();
    const m = model();
    renderSection(<CompositionSection model={m} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("composition-add-topic"));
    const search = await screen.findByTestId("topic-picker-search");
    fireEvent.change(search.querySelector("input") ?? search, { target: { value: "  Охрана труда " } });
    fireEvent.click(screen.getByTestId("topic-picker-create"));

    const drawer = screen.getByTestId("topic-drawer-stub");
    expect(drawer).toHaveAttribute("data-name", "Охрана труда");
    expect(screen.queryByTestId("topic-picker-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("topic-drawer-stub-save"));
    const next = runUpdater(updateModel, m);
    expect(next.sections).toHaveLength(1);
    expect(next.sections[0]).toMatchObject({ topicId: "new-1", topicName: "Новая тема", maxQuestions: 0 });
    expect(screen.queryByTestId("topic-drawer-stub")).toBeNull();
  });

  it("puts the created topic into the group the picker was opened from", async () => {
    auth.value = { can: () => true };
    const updateModel = vi.fn();
    const m = model({ sectionGroups: [{ key: "group-1", label: "Компетенции" }] });
    renderSection(<CompositionSection model={m} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("composition-group-add-topic-group-1"));
    fireEvent.click(await screen.findByTestId("topic-picker-create"));
    fireEvent.click(screen.getByTestId("topic-drawer-stub-save"));
    expect(runUpdater(updateModel, m).sections[0].groupKey).toBe("group-1");
  });
});
