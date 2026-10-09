/**
 * @module features/tests/review/__tests__/review-panel.test
 *
 * PRD-52 FR-20..FR-28: панель комментариев. Проверяются правила, которые человек
 * должен видеть ДО того, как получит отказ от сервера: отклонение требует ответа,
 * рецензенту закрывать нечем, удалённый объект гасит переход, а пометка «изменено
 * после комментария» стоит там, где содержимое разошлось с пином.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewPanel } from "../review-panel";
import type { ReviewThread } from "../review-api";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    fetchReviewThreads: vi.fn(),
    createReviewComment: vi.fn(),
    resolveReviewComment: vi.fn(),
    reopenReviewComment: vi.fn(),
    updateReviewComment: vi.fn(),
    deleteReviewComment: vi.fn(),
  },
}));

vi.mock("../review-api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...apiMock,
}));

/** Ветка от рецензента с якорем на вопрос. */
function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "c1", testId: "t1", authorId: "expert-1", authorName: "Ирина Петрова", parentId: null,
    body: "Формулировка допускает два прочтения",
    anchorKind: "question", questionId: "q1", topicId: "tp1", contentPageId: null,
    contextLabel: "Раздел «О компании» · Вопрос «Стратегия-2030»",
    pinnedContentHash: "a".repeat(64),
    status: "open", resolvedBy: null, resolvedAt: null,
    createdAt: "2026-09-02T14:20:00.000Z", updatedAt: "2026-09-02T14:20:00.000Z",
    replies: [], stale: false, orphaned: false,
    ...over,
  } as ReviewThread;
}

function renderPanel(props: Partial<React.ComponentProps<typeof ReviewPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewPanel testId="t1" mode="editor" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.fetchReviewThreads.mockResolvedValue([thread()]);
  apiMock.createReviewComment.mockResolvedValue({ id: "r1" });
  apiMock.resolveReviewComment.mockResolvedValue({ id: "c1", status: "accepted" });
  apiMock.reopenReviewComment.mockResolvedValue({ id: "c1", status: "open" });
});
afterEach(cleanup);

describe("лента комментариев", () => {
  it("группирует ветки по месту и показывает контекст", async () => {
    renderPanel();
    expect(await screen.findByText("Раздел «О компании»")).toBeInTheDocument();
    expect(screen.getByText("Раздел «О компании» · Вопрос «Стратегия-2030»")).toBeInTheDocument();
  });

  it("«Тест в целом» уходит в конец списка, а не вклинивается между вопросами", async () => {
    apiMock.fetchReviewThreads.mockResolvedValue([
      thread({ id: "c0", anchorKind: "test", questionId: null, topicId: null, contextLabel: "Тест в целом" }),
      thread(),
    ]);
    renderPanel();
    const titles = await screen.findAllByText(/Раздел «О компании»$|Тест в целом/);
    expect(titles[titles.length - 1].textContent).toBe("Тест в целом");
  });

  it("фильтр «только открытые» скрывает закрытые ветки", async () => {
    apiMock.fetchReviewThreads.mockResolvedValue([
      thread(),
      thread({ id: "c2", status: "accepted", body: "Уже учтено" }),
    ]);
    renderPanel();
    await screen.findByText("Формулировка допускает два прочтения");
    expect(screen.queryByText("Уже учтено")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-open-only"));
    expect(await screen.findByText("Уже учтено")).toBeInTheDocument();
  });

  it("помечает ветку, содержимое которой изменилось после комментария", async () => {
    apiMock.fetchReviewThreads.mockResolvedValue([thread({ stale: true })]);
    renderPanel();
    expect(await screen.findByText("изменено после комментария")).toBeInTheDocument();
  });

  it("удалённый объект гасит переход", async () => {
    apiMock.fetchReviewThreads.mockResolvedValue([thread({ orphaned: true })]);
    renderPanel({ onNavigate: vi.fn() });
    expect(await screen.findByText("объект удалён")).toBeInTheDocument();
    expect(screen.getByTestId("goto-c1")).toBeDisabled();
  });

  it("переход зовёт хозяина панели с разрешённой целью", async () => {
    const onNavigate = vi.fn();
    renderPanel({ onNavigate });
    fireEvent.click(await screen.findByTestId("goto-c1"));
    expect(onNavigate).toHaveBeenCalledWith(
      { target: "question-editor", questionId: "q1" },
      expect.objectContaining({ id: "c1" }),
    );
  });
});

describe("исход ветки", () => {
  it("рецензенту закрывать нечем: кнопки исхода нет", async () => {
    renderPanel({ canResolve: false });
    await screen.findByText("Формулировка допускает два прочтения");
    expect(screen.queryByTestId("resolve-c1")).not.toBeInTheDocument();
  });

  it("отклонение без ответа не отправляется", async () => {
    renderPanel({ canResolve: true });
    fireEvent.click(await screen.findByTestId("resolve-c1"));
    fireEvent.click(screen.getByRole("button", { name: "Отклонено" }));
    expect(screen.getByTestId("confirm-resolve")).toBeDisabled();
    expect(apiMock.resolveReviewComment).not.toHaveBeenCalled();
  });

  it("отклонение с ответом отправляет и ответ, и исход", async () => {
    renderPanel({ canResolve: true });
    fireEvent.click(await screen.findByTestId("resolve-c1"));
    fireEvent.click(screen.getByRole("button", { name: "Отклонено" }));
    fireEvent.change(screen.getByTestId("reject-reply"), { target: { value: "Порог задан приказом" } });
    fireEvent.click(screen.getByTestId("confirm-resolve"));

    await waitFor(() => {
      expect(apiMock.createReviewComment).toHaveBeenCalledWith("t1", {
        body: "Порог задан приказом", parentId: "c1",
      });
      expect(apiMock.resolveReviewComment).toHaveBeenCalledWith("t1", "c1", "rejected");
    });
  });

  it("«учтено» ответа не требует", async () => {
    renderPanel({ canResolve: true });
    fireEvent.click(await screen.findByTestId("resolve-c1"));
    fireEvent.click(screen.getByTestId("confirm-resolve"));
    await waitFor(() => {
      expect(apiMock.resolveReviewComment).toHaveBeenCalledWith("t1", "c1", "accepted");
      expect(apiMock.createReviewComment).not.toHaveBeenCalled();
    });
  });

  it("закрытая ветка открывается заново", async () => {
    apiMock.fetchReviewThreads.mockResolvedValue([thread({ status: "accepted" })]);
    renderPanel({ canResolve: true });
    // Ветка закрыта, поэтому под фильтром «только открытые» её не видно — снимаем
    // фильтр, дождавшись, что панель уже отрисовала свою шапку.
    fireEvent.click(await screen.findByTestId("toggle-open-only"));
    fireEvent.click(await screen.findByRole("button", { name: "Открыть заново" }));
    await waitFor(() => expect(apiMock.reopenReviewComment).toHaveBeenCalledWith("t1", "c1"));
  });
});

describe("создание комментария", () => {
  it("в режиме ящика место выбирается явно и по умолчанию — тест в целом", async () => {
    renderPanel({ mode: "editor", anchorOptions: { topics: [{ id: "tp1", name: "О компании" }] } });
    fireEvent.click(await screen.findByTestId("add-comment"));
    expect(screen.getByTestId("anchor-place")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("comment-body"), { target: { value: "Порог завышен" } });
    fireEvent.click(screen.getByTestId("submit-comment"));
    await waitFor(() => {
      expect(apiMock.createReviewComment).toHaveBeenCalledWith("t1", {
        body: "Порог завышен", anchor: { kind: "test" },
      });
    });
  });

  it("в режиме прогона место подставляется с текущего экрана", async () => {
    renderPanel({ mode: "player", screenAnchor: { kind: "question", questionId: "q7", topicId: "tp1" } });
    fireEvent.click(await screen.findByTestId("add-comment"));
    expect(screen.queryByTestId("anchor-place")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("comment-body"), { target: { value: "Двусмысленно" } });
    fireEvent.click(screen.getByTestId("submit-comment"));
    await waitFor(() => {
      expect(apiMock.createReviewComment).toHaveBeenCalledWith("t1", {
        body: "Двусмысленно", anchor: { kind: "question", questionId: "q7", topicId: "tp1" },
      });
    });
  });

  it("пустой комментарий не отправляется", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("add-comment"));
    expect(screen.getByTestId("submit-comment")).toBeDisabled();
  });

  it("ответ в ветке места не спрашивает — он о том же месте", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Ответить" }));
    expect(screen.queryByTestId("anchor-place")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("comment-body"), { target: { value: "Поправлю" } });
    fireEvent.click(screen.getByTestId("submit-comment"));
    await waitFor(() => {
      expect(apiMock.createReviewComment).toHaveBeenCalledWith("t1", { body: "Поправлю", parentId: "c1" });
    });
  });
});

describe("ссылка на ветку", () => {
  it("раскрывает ветку, на которую ведёт ссылка, и метит её в разметке", async () => {
    renderPanel({ focusThreadId: "c1" });
    const thread = await screen.findByTestId("thread-c1");
    expect(thread).toHaveAttribute("data-expanded", "true");
    expect(thread.className).toContain("is-focused");
  });

  it("без ссылки ни одна ветка не выделена", async () => {
    renderPanel();
    const thread = await screen.findByTestId("thread-c1");
    expect(thread).toHaveAttribute("data-expanded", "false");
  });
});
