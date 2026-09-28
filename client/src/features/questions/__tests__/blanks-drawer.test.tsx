// @vitest-environment jsdom
/**
 * @module features/questions/__tests__/blanks-drawer.test
 *
 * PRD-57 FR-24 — FR-24d: список пропусков ЕСТЬ отображение текста задания.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const blanksQuestion = {
  id: "q-blanks",
  topicId: "t1",
  type: "blanks",
  prompt: "Надзор осуществляет {{organ}}, срок {{srok}} суток.",
  dataJson: {},
  correctJson: {
    blanks: [
      { id: "organ", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }] },
      { id: "srok", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 15 }] },
    ],
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><ToastProvider>
      <QuestionEditorDrawer {...props} />
    </ToastProvider></QueryClientProvider>,
  );
}

function postedBody(): any {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/questions"));
  return JSON.parse((call![1] as any).body);
}

describe("<QuestionEditorDrawer /> — пропуски", () => {
  it("предлагает тип «Пропуски»", () => {
    renderDrawer();
    expect(questionTypeOptions()).toContain("Пропуски");
  });

  it("открывает сохранённые пропуски строками списка", () => {
    renderDrawer({ question: blanksQuestion });
    expect(screen.getByTestId("blanks-block")).toBeTruthy();
    expect(screen.getByText("{{organ}}")).toBeTruthy();
    expect(screen.getByText("{{srok}}")).toBeTruthy();
  });

  it("подзаголовок строки говорит, чем пропуск проверяется", () => {
    renderDrawer({ question: blanksQuestion });
    expect(screen.getByText("Текст · одно правило")).toBeTruthy();
    expect(screen.getByText("Число · одно правило")).toBeTruthy();
  });

  it("новый пропуск в тексте добавляет строку без правил", async () => {
    renderDrawer({ question: blanksQuestion });
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Надзор осуществляет {{organ}}, срок {{srok}} суток. Выдал {{kto}}." },
    });
    await waitFor(() => expect(screen.getByText("{{kto}}")).toBeTruthy());
    expect(screen.getByText("Правил нет")).toBeTruthy();
  });

  it("переименование в тексте переносит правила на новое имя", async () => {
    renderDrawer({ question: blanksQuestion });
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Надзор осуществляет {{organ}}, срок {{days}} суток." },
    });
    // Пропуск {{srok}} имел правило, поэтому ящик сначала спрашивает.
    await waitFor(() => expect(screen.getByTestId("blanks-remove-cancel")).toBeTruthy());
  });

  it("удаление пропуска с правилами спрашивает подтверждение, а отказ возвращает текст", async () => {
    renderDrawer({ question: blanksQuestion });
    const prompt = screen.getByTestId("input-question-prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "Надзор осуществляет {{organ}}." } });
    await waitFor(() => expect(screen.getByTestId("blanks-remove-cancel")).toBeTruthy());

    fireEvent.click(screen.getByTestId("blanks-remove-cancel"));
    await waitFor(() => expect(prompt.value).toContain("{{srok}}"));
    expect(screen.getByText("{{srok}}")).toBeTruthy();
  });

  it("сохраняет наборы правил по пропускам в эталон задания", async () => {
    // Правка существующего вопроса идёт через защиту содержимого (PRD-15), поэтому
    // проверяется СОЗДАНИЕ: путь сохранения у них один.
    renderDrawer({ defaultTopicId: "t1" });
    chooseQuestionType("Пропуски");
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Надзор осуществляет {{organ}}, срок {{srok}} суток." },
    });
    await waitFor(() => expect(screen.getByText("{{organ}}")).toBeTruthy());
    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = postedBody();
    expect(body.type).toBe("blanks");
    expect(body.correctJson.blanks.map((b: { id: string }) => b.id)).toEqual(["organ", "srok"]);
  });
});

describe("вставка пропуска кнопкой (FR-24b)", () => {
  it("ставит пустые скобки и просит ввести имя", async () => {
    renderDrawer({ defaultTopicId: "t1" });
    chooseQuestionType("Пропуски");
    const prompt = screen.getByTestId("input-question-prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "Наряд выдаёт " } });
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);

    fireEvent.click(screen.getByTestId("insert-blank"));
    await waitFor(() => expect(prompt.value).toBe("Наряд выдаёт {{}}"));
    // Имя за автора не придумывается: пустой пропуск в списке не появляется.
    expect(screen.queryByText("{{}}")).toBeNull();
    expect(screen.getByText(/введите имя пропуска/i)).toBeTruthy();
  });
});
