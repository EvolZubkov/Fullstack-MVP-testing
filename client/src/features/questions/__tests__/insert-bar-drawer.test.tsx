// @vitest-environment jsdom
/**
 * @module features/questions/__tests__/insert-bar-drawer.test
 *
 * PRD-57 FR-09a: панель вставки в ящике вопроса — листинг, формула, пропуск.
 *
 * Проверяется то, из-за чего панель и заводится: разметка встаёт В ПОЗИЦИЮ КУРСОРА, язык
 * листинга спрашивается ПРИ вставке, а кнопка пропуска предлагается только тому типу, где
 * двойные скобки действительно станут полем.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chooseQuestionType } from "./helpers/question-type";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";
import { ToastProvider } from "@skillum/ui-kit";

const topics = [{ id: "t1", name: "Охрана труда" }] as unknown as Topic[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "new-id" }),
    text: async () => JSON.stringify({ id: "new-id" }),
  })));
});
afterEach(() => vi.unstubAllGlobals());

function renderDrawer(overrides: Partial<QuestionEditorDrawerProps> = {}) {
  const props: QuestionEditorDrawerProps = {
    open: true,
    question: null,
    topics,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    defaultTopicId: "t1",
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><ToastProvider>
      <QuestionEditorDrawer {...props} />
    </ToastProvider></QueryClientProvider>,
  );
}

/** Поле текста задания с поставленным курсором в конце набранного. */
function promptWith(text: string): HTMLTextAreaElement {
  const prompt = screen.getByTestId("input-question-prompt") as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: text } });
  prompt.setSelectionRange(text.length, text.length);
  return prompt;
}

describe("панель вставки", () => {
  it("стоит у любого типа задания: листинг и формула работают везде", () => {
    renderDrawer();
    expect(screen.getByTestId("prompt-insert-bar")).toBeTruthy();
    expect(screen.getByTestId("insert-code")).toBeTruthy();
    expect(screen.getByTestId("insert-formula")).toBeTruthy();
  });

  it("кнопка пропуска — только у своего типа", () => {
    renderDrawer();
    expect(screen.queryByTestId("insert-blank")).toBeNull();
    chooseQuestionType("Пропуски");
    expect(screen.getByTestId("insert-blank")).toBeTruthy();
  });

  it("формула встаёт в позицию курсора", async () => {
    renderDrawer();
    const prompt = promptWith("Доля считается по формуле ");
    fireEvent.click(screen.getByTestId("insert-formula"));
    await waitFor(() => expect(prompt.value).toBe("Доля считается по формуле $$$$"));
  });

  it("язык листинга спрашивается меню и попадает в открывающую строку", async () => {
    renderDrawer();
    const prompt = promptWith("Что выведет код?");
    fireEvent.click(screen.getByTestId("insert-code"));
    fireEvent.click(await screen.findByTestId("insert-code-sql"));
    await waitFor(() => expect(prompt.value).toBe("Что выведет код?\n\n```sql\n\n```"));
  });

  it("меню предлагает ровно то, что умеет подсветка, плюс блок без неё", async () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId("insert-code"));
    expect(await screen.findByTestId("insert-code-python")).toBeTruthy();
    expect(screen.getByTestId("insert-code-sql")).toBeTruthy();
    expect(screen.getByTestId("insert-code-javascript")).toBeTruthy();
    expect(screen.getByTestId("insert-code-plain")).toBeTruthy();
  });

  it("выделенный текст оборачивается, а не затирается", async () => {
    renderDrawer();
    const prompt = promptWith("Формула E = mc^2 известна всем.");
    prompt.setSelectionRange("Формула ".length, "Формула E = mc^2".length);
    fireEvent.click(screen.getByTestId("insert-formula"));
    await waitFor(() => expect(prompt.value).toBe("Формула $$E = mc^2$$ известна всем."));
  });
});
