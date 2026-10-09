/**
 * @module features/questions/__tests__/question-editor-drawer.option-feedback.test
 * @description Per-option feedback texts in the question editor (single choice).
 *
 * Under every option of a single-choice question sits a switch «Переопределить обратную
 * связь»; while it is on, a labelled text field is shown. The saved body carries
 * `optionFeedbackJson` aligned with the saved options. Other types get no switches and
 * save `null`. Approved wireframe: docs/wireframes/approved/option-feedback.html.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chooseQuestionType } from "./helpers/question-type";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";
import { ToastProvider } from "@skillum/ui-kit";

const topics = [{ id: "t1", name: "Налоги" }] as unknown as Topic[];

const savedQuestion = {
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "Что такое НДФЛ?",
  dataJson: { options: ["Налог на доходы", "Налог на добавленную стоимость", "Налог на имущество"] },
  correctJson: { correctIndex: 0 },
  mediaUrl: null,
  mediaType: null,
  shuffleAnswers: true,
  difficulty: null,
  feedbackMode: "general",
  feedback: "Общий текст",
  feedbackCorrect: null,
  feedbackIncorrect: null,
  optionFeedbackJson: [null, "НДС платит продавец"],
  tags: [],
} as unknown as Question;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "new-id" }),
    text: async () => JSON.stringify({ id: "new-id" }),
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
      <ToastProvider>
        <QuestionEditorDrawer {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const optionSwitch = (i: number) => screen.getByTestId(`switch-option-feedback-${i}`) as HTMLInputElement;

/** The body sent to POST /api/questions. */
function postedBody(): any {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/questions"));
  return JSON.parse((call![1] as any).body);
}

function fillNewQuestion(options: string[]) {
  fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Вопрос" } });
  options.forEach((value, i) => {
    fireEvent.change(screen.getByTestId(`input-option-${i}`), { target: { value } });
  });
}

describe("<QuestionEditorDrawer /> — option feedback", () => {
  it("shows a switch under every option and no text field until it is on", () => {
    renderDrawer();
    expect(optionSwitch(0).checked).toBe(false);
    expect(screen.getAllByText("Переопределить обратную связь").length).toBe(4);
    expect(screen.queryByTestId("input-option-feedback-0")).toBeNull();

    fireEvent.click(optionSwitch(0));

    expect(screen.getByTestId("input-option-feedback-0")).toBeInTheDocument();
    expect(screen.getByText("Обратная связь при выборе варианта")).toBeInTheDocument();
  });

  it("opens a stored question with the overridden option switched on", () => {
    renderDrawer({ question: savedQuestion });
    expect(optionSwitch(0).checked).toBe(false);
    expect(optionSwitch(1).checked).toBe(true);
    expect((screen.getByTestId("input-option-feedback-1") as HTMLTextAreaElement).value).toBe(
      "НДС платит продавец",
    );
  });

  it("saves the texts aligned with the options, skipping blank options", async () => {
    renderDrawer({ defaultTopicId: "t1" });
    fillNewQuestion(["А", "", "В", "Г"]);
    fireEvent.click(optionSwitch(2));
    fireEvent.change(screen.getByTestId("input-option-feedback-2"), { target: { value: "Почему В" } });

    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = postedBody();
    expect(body.dataJson.options).toEqual(["А", "В", "Г"]);
    expect(body.optionFeedbackJson).toEqual([null, "Почему В", null]);
  });

  it("does not save the text of an option whose switch was turned off", async () => {
    renderDrawer({ defaultTopicId: "t1" });
    fillNewQuestion(["А", "Б"]);
    fireEvent.click(optionSwitch(1));
    fireEvent.change(screen.getByTestId("input-option-feedback-1"), { target: { value: "Почему Б" } });
    fireEvent.click(optionSwitch(1));

    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(postedBody().optionFeedbackJson).toBeNull();
  });

  it("offers no switches for other types (the server stores null for them)", () => {
    renderDrawer({ defaultTopicId: "t1" });
    chooseQuestionType("Шкала");
    expect(screen.queryByTestId("switch-option-feedback-0")).toBeNull();
  });
});
