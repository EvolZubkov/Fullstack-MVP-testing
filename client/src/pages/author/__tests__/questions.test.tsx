/**
 * @module pages/author/__tests__/questions.test
 * @description Component tests for the author question bank page. Verifies the
 * loading/empty states, the filtered card list with per-type answer previews,
 * the duplicate (successful mutation) and guarded delete / bulk-delete flows,
 * opening the reusable question editor (create / edit), and the import + export
 * dialogs. Auth and the PRD-15 content guard are stubbed; `fetch` is stubbed per
 * URL so the React Query hooks resolve against fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ can: () => true, hasRole: () => false, user: { id: "u1", name: "Author" } }),
}));

// Both the page and the reusable QuestionEditorDrawer call useContentGuard; a
// single shared mock lets us assert the guard is invoked for delete/bulk-delete
// without exercising the real dry-run network flow.
const { guardMock } = vi.hoisted(() => ({ guardMock: vi.fn() }));
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import QuestionsPage from "../questions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const qSingle = {
  id: "q1", topicId: "t1", topicName: "Тема A", type: "single",
  prompt: "Столица России?", difficulty: 20,
  dataJson: { options: ["Москва", "Париж"] },
  correctJson: { correctIndex: 0 },
  mediaUrl: null, mediaType: null, tags: ["geo"],
  shuffleAnswers: true, feedbackMode: "general",
};
const qMultiple = {
  id: "q2", topicId: "t1", topicName: "Тема A", type: "multiple",
  prompt: "Выберите чётные числа", difficulty: 50,
  dataJson: { options: ["2", "3", "4"] },
  correctJson: { correctIndices: [0, 2] },
  mediaUrl: null, mediaType: null, tags: [],
};
const qMatching = {
  id: "q3", topicId: "t2", topicName: "Тема B", type: "matching",
  prompt: "Сопоставьте страны и столицы", difficulty: 80,
  dataJson: { left: ["Россия", "Франция"], right: ["Москва", "Париж"] },
  correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
  mediaUrl: null, mediaType: null, tags: [],
};
const qRanking = {
  id: "q4", topicId: "t2", topicName: "Тема B", type: "ranking",
  prompt: "Расставьте по возрастанию", difficulty: null,
  dataJson: { items: ["Один", "Два", "Три"] },
  correctJson: { correctOrder: [0, 1, 2] },
  mediaUrl: null, mediaType: null, tags: [],
};

const topicsData = [
  { id: "t1", name: "Тема A" },
  { id: "t2", name: "Тема B" },
];
const testsData = [{ id: "test1", title: "Итоговый тест" }];

// ─── fetch stub ─────────────────────────────────────────────────────────────

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

let questionsData: unknown[] = [];
let importDryRun = { created: 2, updated: 1, skipped: 0, errors: [] as string[] };
let importReal = { created: 2, updated: 0, skipped: 0, errors: [] as string[] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  guardMock.mockReset();
  questionsData = [qSingle, qMultiple, qMatching, qRanking];
  importDryRun = { created: 2, updated: 1, skipped: 0, errors: [] };
  importReal = { created: 2, updated: 0, skipped: 0, errors: [] };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET") {
      if (url === "/api/questions") return jsonRes(questionsData);
      if (url === "/api/topics") return jsonRes(topicsData);
      if (url === "/api/tests") return jsonRes(testsData);
    }
    if (method === "POST") {
      if (url.includes("/duplicate")) return jsonRes({ id: "dup" });
      if (url.startsWith("/api/questions/import")) {
        return jsonRes(url.includes("dryRun=true") ? importDryRun : importReal);
      }
    }
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuestionsPage />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<QuestionsPage /> — states", () => {
  it("shows the loading state before questions resolve", () => {
    renderPage();
    expect(screen.getByText("Загрузка вопросов...")).toBeInTheDocument();
  });

  it("renders the card list with per-type answer previews", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Столица России?")).toBeInTheDocument());
    // All four question cards.
    expect(screen.getByTestId("card-question-q1")).toBeInTheDocument();
    expect(screen.getByTestId("card-question-q4")).toBeInTheDocument();
    // Single-choice preview option + difficulty tag.
    expect(screen.getByText("1. Москва")).toBeInTheDocument();
    expect(screen.getByText(/Сложность: 20/)).toBeInTheDocument();
    // Matching preview renders left + right columns.
    expect(screen.getByText("1. Россия")).toBeInTheDocument();
    expect(screen.getByText("A. Москва")).toBeInTheDocument();
    // Ranking preview.
    expect(screen.getByText("1. Один")).toBeInTheDocument();
  });

  it("renders the empty state when there are no questions", async () => {
    questionsData = [];
    renderPage();
    await waitFor(() => expect(screen.getByText("Вопросов пока нет")).toBeInTheDocument());
  });
});

describe("<QuestionsPage /> — filtering", () => {
  it("search narrows the list and shows the empty state when nothing matches", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Столица России?")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Поиск по тексту вопроса..."), {
      target: { value: "нетакого" },
    });
    await waitFor(() => expect(screen.getByText("Вопросов пока нет")).toBeInTheDocument());
  });

  it("difficulty filter keeps only easy questions", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Столица России?")).toBeInTheDocument());
    const diffSelect = screen.getByTestId("select-filter-difficulty");
    fireEvent.click(within(diffSelect).getByRole("button"));
    fireEvent.click(screen.getByText("Лёгкие (0-33)"));
    await waitFor(() => expect(screen.queryByText("Выберите чётные числа")).toBeNull());
    expect(screen.getByText("Столица России?")).toBeInTheDocument();
  });
});

describe("<QuestionsPage /> — mutations & guarded ops", () => {
  it("duplicates a question via POST /duplicate", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Столица России?"));
    fireEvent.click(screen.getByTestId("button-duplicate-question-q1"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/questions/q1/duplicate",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("routes a single delete through the content guard", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Столица России?"));
    fireEvent.click(screen.getByTestId("button-delete-question-q1"));
    expect(guardMock).toHaveBeenCalledTimes(1);
    expect(guardMock.mock.calls[0][0]).toMatchObject({
      url: "/api/questions/q1",
      method: "DELETE",
    });
  });

  it("select-all reveals bulk delete which goes through the guard", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Столица России?"));
    fireEvent.click(screen.getByTestId("checkbox-select-all"));
    const bulk = await screen.findByTestId("button-bulk-delete");
    fireEvent.click(bulk);
    expect(guardMock).toHaveBeenCalledTimes(1);
    expect(guardMock.mock.calls[0][0]).toMatchObject({
      url: "/api/questions/bulk-delete",
      method: "POST",
    });
  });
});

describe("<QuestionsPage /> — question editor drawer", () => {
  it("opens the editor in create mode", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Столица России?"));
    fireEvent.click(screen.getByTestId("button-create-question"));
    await waitFor(() => expect(screen.getByTestId("select-question-topic")).toBeInTheDocument());
    // Create mode: empty prompt.
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value).toBe("");
  });

  it("opens the editor in edit mode with the prompt prefilled", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Столица России?"));
    fireEvent.click(screen.getByTestId("button-edit-question-q1"));
    await waitFor(() =>
      expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value).toBe(
        "Столица России?",
      ),
    );
  });
});

describe("<QuestionsPage /> — import dialog", () => {
  it("previews (dry-run) then confirms an import", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Столица России?"));
    fireEvent.click(screen.getByTestId("button-import-questions"));

    const file = new File(["x"], "questions.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByTestId("input-import-file"), { target: { files: [file] } });

    // Dry-run preview.
    fireEvent.click(screen.getByTestId("button-check-import"));
    await waitFor(() => expect(screen.getByTestId("import-preview")).toBeInTheDocument());
    expect(screen.getByText(/Будет создано: 2/)).toBeInTheDocument();

    // Real import closes the dialog.
    fireEvent.click(screen.getByTestId("button-confirm-import"));
    await waitFor(() => expect(screen.queryByTestId("import-preview")).toBeNull());
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) =>
          String(u) === "/api/questions/import" &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(true);
  });
});

describe("<QuestionsPage /> — export dialog", () => {
  it("switches to «Выбрать темы» and counts the selected topics", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Столица России?"));
    fireEvent.click(screen.getByTestId("button-export-questions"));
    await waitFor(() => expect(screen.getByText("Экспорт вопросов")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Выбрать темы" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Тема A" }));
    expect(screen.getByText(/Выбрано тем: 1/)).toBeInTheDocument();
    expect(screen.getByTestId("button-confirm-export")).not.toBeDisabled();
  });
});
