/**
 * @module features/questions/__tests__/answer-rules-drawer.test
 * @description PRD-57 §6.5: «Короткий ответ» in the question drawer.
 *
 * What matters to the author: the type is offered among the others, choosing it replaces
 * the option list with the «Проверка ответа» block, and the rules travel to the server as
 * the question's answer key — `correct_json`, the same column every other type uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chooseQuestionType, questionTypeOptions } from "./helpers/question-type";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";
import { ToastProvider } from "@skillum/ui-kit";

const topics = [{ id: "t1", name: "Охрана труда" }] as unknown as Topic[];

const shortQuestion = {
  id: "q-short",
  topicId: "t1",
  type: "short",
  prompt: "Кто выдаёт наряд-допуск?",
  dataJson: {},
  correctJson: {
    answerKind: "text",
    join: "any",
    rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }],
  },
  mediaUrl: null,
  mediaType: null,
  shuffleAnswers: true,
  difficulty: null,
  feedbackMode: "general",
  feedback: null,
  feedbackCorrect: null,
  feedbackIncorrect: null,
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
    <QueryClientProvider client={client}><ToastProvider>
      <QuestionEditorDrawer {...props} />
    </ToastProvider></QueryClientProvider>,
  );
}

/** The body sent to the questions API. */
function postedBody(): any {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/questions"));
  return JSON.parse((call![1] as any).body);
}

describe("<QuestionEditorDrawer /> — короткий ответ (PRD-57)", () => {
  it("предлагает «Короткий ответ» среди типов", () => {
    renderDrawer();
    expect(questionTypeOptions()).toContain("Короткий ответ");
  });

  it("на этом типе показывает блок правил вместо вариантов", () => {
    renderDrawer();
    chooseQuestionType("Короткий ответ");
    expect(screen.getByTestId("answer-rules-block")).toBeTruthy();
    // Правило можно написать сразу: у нового вопроса проверка включена, потому что
    // ради неё тип и выбирают.
    expect(screen.getByTestId("answer-rules-add")).toBeTruthy();
    // Вариантов ответа у типа нет.
    expect(screen.queryByTestId("input-option-0")).toBeNull();
  });

  it("открывает сохранённые правила на правку", () => {
    renderDrawer({ question: shortQuestion });
    expect(screen.getByTestId("answer-rules-block")).toBeTruthy();
    expect(screen.getByText("Ростехнадзор")).toBeTruthy();
  });

  it("сохраняет набранные правила эталоном вопроса", async () => {
    renderDrawer({ defaultTopicId: "t1" });
    chooseQuestionType("Короткий ответ");
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Кто выдаёт наряд-допуск?" },
    });

    fireEvent.click(screen.getByTestId("answer-rules-add"));
    fireEvent.change(screen.getByTestId("answer-rules-text-value"), {
      target: { value: "Ростехнадзор" },
    });

    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = postedBody();
    expect(body.type).toBe("short");
    expect(body.correctJson).toEqual({
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }],
    });
    // Вариантов у типа нет: содержимое задания — это его формулировка.
    expect(body.dataJson).toEqual({});
  });

});

describe("<QuestionEditorDrawer /> — состояние черновика правил (FR-28d)", () => {
  it("нетронутые правила состояния не показывают", () => {
    renderDrawer({ question: shortQuestion });
    expect(screen.queryByTestId("answer-rules-dirty")).toBeNull();
  });

  it("после правки подвал говорит, что изменения не сохранены", () => {
    renderDrawer({ question: shortQuestion });
    fireEvent.click(screen.getByText("Все правила"));
    const dirty = screen.getByTestId("answer-rules-dirty");
    expect(dirty.textContent).toContain("Изменения не сохранены");
  });

  it("«Вернуть изменения» возвращает набор, каким он был при открытии", () => {
    renderDrawer({ question: shortQuestion });
    fireEvent.click(screen.getByText("Число"));
    fireEvent.click(screen.getByTestId("answer-rules-revert"));
    expect(screen.queryByTestId("answer-rules-dirty")).toBeNull();
    // Вернулся текстовый набор с исходным правилом.
    expect(screen.getByText("Ростехнадзор")).toBeTruthy();
  });
});
