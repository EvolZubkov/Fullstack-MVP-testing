/**
 * @module features/questions/__tests__/question-editor-drawer.order-index.test
 * @description PRD-30 Э5: the «Индекс в теме» field in the question card.
 *
 * Wireframe: docs/wireframes/approved/prd30-question-order.html, state
 * `question`. The field carries an author value that may legitimately be EMPTY
 * («не задано» — such questions are delivered last), so the two things worth
 * pinning are that an empty box reaches the API as `null` rather than 0, and
 * that a stored index is loaded back into the box.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";

const topics = [{ id: "t1", name: "Тема A" }] as unknown as Topic[];

function makeQuestion(over: Partial<Question> = {}): Question {
  return {
    id: "q1",
    topicId: "t1",
    type: "single",
    prompt: "Столица Франции?",
    dataJson: { options: ["Париж", "Лондон"] },
    correctJson: { correctIndex: 0 },
    mediaUrl: null,
    mediaType: null,
    shuffleAnswers: true,
    difficulty: null,
    orderIndex: null,
    feedbackMode: "general",
    feedback: null,
    feedbackCorrect: null,
    feedbackIncorrect: null,
    tags: [],
    ...over,
  } as unknown as Question;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  guardMock.mockReset();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "q1" }),
    text: async () => "{}",
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDrawer(overrides: Partial<QuestionEditorDrawerProps> = {}) {
  const props: QuestionEditorDrawerProps = {
    open: true,
    question: null,
    topics,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuestionEditorDrawer {...props} />
    </QueryClientProvider>,
  );
}

const field = () => screen.getByTestId("input-question-order-index") as HTMLInputElement;

describe("«Индекс в теме» — the field itself (PRD-30 FR-01)", () => {
  it("is empty for a new question — «не задано» is the default", () => {
    renderDrawer({ defaultTopicId: "t1" });

    expect(field().value).toBe("");
  });

  it("loads the stored index of an existing question", () => {
    renderDrawer({ question: makeQuestion({ orderIndex: 20 }) });

    expect(field().value).toBe("20");
  });

  it("loads zero — an ordinary index, not «not set»", () => {
    renderDrawer({ question: makeQuestion({ orderIndex: 0 }) });

    expect(field().value).toBe("0");
  });

  it("accepts a typed value", () => {
    renderDrawer({ defaultTopicId: "t1" });

    fireEvent.change(field(), { target: { value: "30" } });

    expect(field().value).toBe("30");
  });
});

describe("«Индекс в теме» — what reaches the API", () => {
  async function submitNewQuestion(index?: string) {
    renderDrawer({ defaultTopicId: "t1" });
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Столица Франции?" },
    });
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Париж" } });
    fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Лондон" } });
    if (index !== undefined) fireEvent.change(field(), { target: { value: index } });

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const call = fetchMock.mock.calls.find(([url]) => url === "/api/questions");
    return JSON.parse((call![1] as { body: string }).body);
  }

  it("sends the typed index", async () => {
    expect(await submitNewQuestion("40")).toMatchObject({ orderIndex: 40 });
  });

  it("sends null for an empty box — not 0, which would be a real index", async () => {
    expect(await submitNewQuestion()).toMatchObject({ orderIndex: null });
  });

  it("clearing the box sends null", async () => {
    expect(await submitNewQuestion("")).toMatchObject({ orderIndex: null });
  });
});
