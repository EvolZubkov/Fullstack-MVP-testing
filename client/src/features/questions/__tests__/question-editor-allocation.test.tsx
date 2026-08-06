/**
 * @module client/features/questions/__tests__/question-editor-allocation
 *
 * PRD-44 в карточке вопроса (FR-44 - FR-46, FR-49).
 *
 * Проверяется то, что отличает этот тип от соседей: блока верного ответа НЕТ (эталонного
 * распределения не существует), три поля описывают бюджет и домен, а невыполнимая
 * конфигурация не даёт сохранить и называет ЧИСЛА — «невыполнимо» само по себе оставляет
 * автора гадать, какое из трёх полей менять.
 *
 * Обвязка (мок охраны содержимого, заглушка fetch) повторяет соседний файл
 * question-editor-drawer.test.tsx: редактор один, и тесты у него должны запускаться
 * одинаково.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";

const topics = [{ id: "t1", name: "Лидерство" }] as unknown as Topic[];

const allocationQuestion = (data: Record<string, unknown>): Question =>
  ({
    id: "q-alloc",
    topicId: "t1",
    type: "allocation",
    prompt: "Как вы распределите своё внимание?",
    dataJson: data,
    correctJson: {},
    mediaUrl: null,
    mediaType: null,
    shuffleAnswers: true,
    difficulty: null,
    feedbackMode: "general",
    feedback: null,
    feedbackCorrect: null,
    feedbackIncorrect: null,
    tags: [],
  }) as unknown as Question;

const FOUR = { options: ["А", "Б", "В", "Г"], budget: 7, minPerOption: 0, maxPerOption: 7 };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  guardMock.mockReset();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "new-id" }),
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

/** Поле-степпер: `data-testid` компонент кладёт на сам `input`, не на обёртку. */
const numberInput = (testId: string): HTMLInputElement =>
  screen.getByTestId(testId) as HTMLInputElement;

describe("карточка вопроса-распределения", () => {
  it("тип объявлен в списке типов (FR-44)", () => {
    renderDrawer();
    expect(screen.getByText("Распределение баллов")).toBeInTheDocument();
  });

  it("открывает вопрос с бюджетом и доменом (FR-45)", () => {
    renderDrawer({ question: allocationQuestion(FOUR) });
    expect(numberInput("input-alloc-budget").value).toBe("7");
    expect(numberInput("input-alloc-min").value).toBe("0");
    expect(numberInput("input-alloc-max").value).toBe("7");
  });

  it("пустые минимум и максимум показываются умолчаниями", () => {
    renderDrawer({ question: allocationQuestion({ options: ["А", "Б"], budget: 5 }) });
    expect(numberInput("input-alloc-min").value).toBe("0");
    expect(numberInput("input-alloc-max").value).toBe("5");
  });

  it("блока верного ответа у типа НЕТ", () => {
    renderDrawer({ question: allocationQuestion(FOUR) });
    // Переключатель «есть правильная градация» принадлежит шкале и здесь недопустим:
    // у распределения эталона не существует вовсе.
    expect(screen.queryByTestId("switch-scale-has-correct")).not.toBeInTheDocument();
  });

  it("невыполнимая конфигурация называет ЧИСЛА (FR-05, FR-46)", async () => {
    renderDrawer({ question: allocationQuestion(FOUR) });
    // Ровно случай референса: 4 утверждения по минимуму 2 требуют 8 баллов из 7.
    fireEvent.change(numberInput("input-alloc-min"), { target: { value: "2" } });
    await waitFor(() => {
      expect(screen.getByText(/минимумы требуют 8 баллов, а бюджет — 7/i)).toBeInTheDocument();
    });
  });

  it("максимум ниже бюджета при одном утверждении тоже ловится", async () => {
    renderDrawer({ question: allocationQuestion({ options: ["А", "Б"], budget: 7, minPerOption: 0, maxPerOption: 7 }) });
    fireEvent.change(numberInput("input-alloc-max"), { target: { value: "1" } });
    await waitFor(() => {
      expect(screen.getByText(/максимумы дают только 2/i)).toBeInTheDocument();
    });
  });

  it("годная конфигурация ошибок не даёт", () => {
    renderDrawer({ question: allocationQuestion(FOUR) });
    expect(screen.queryByText(/невыполнимо/i)).not.toBeInTheDocument();
  });
});
