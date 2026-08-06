/**
 * @module features/content/__tests__/content-tree.test
 * @description Unit tests for the unified "Темы и вопросы" tree
 * ({@link ContentTree}). The component self-loads its data from
 * `/api/folders` + `/api/topics` + `/api/questions` (+ `/api/users`) via React
 * Query, so — like the topics-page smoke test — we stub `fetch` by URL and wrap
 * in a QueryClientProvider with the real `getQueryFn`. The heavy leaf drawers /
 * modals (question editor, topic drawer, bulk-op modals, content-guard dialog,
 * folder picker, inline preview) are mocked to lightweight stubs so the tests
 * focus on the tree's own behaviour: hierarchy render, expand/collapse, the two
 * selection modes, the empty/loading branches, and the row/FAB actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

// Content-guard spy shared with the mock (hoisted so the factory can close over it).
const { guardSpy, toastSpy } = vi.hoisted(() => ({ guardSpy: vi.fn(), toastSpy: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ can: () => true, hasRole: () => false, user: { id: "u1", name: "Author" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardSpy, dialogProps: { open: false } }),
}));
vi.mock("@/features/content-protection/content-impact-dialog", () => ({
  ContentImpactDialog: () => null,
}));
vi.mock("@/features/questions/question-editor-drawer", () => ({
  QuestionEditorDrawer: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-question-editor" /> : null),
}));
vi.mock("@/features/topics/topic-drawer", () => ({
  TopicDrawer: ({ target }: { target: unknown }) => (target ? <div data-testid="mock-topic-drawer" /> : null),
}));
vi.mock("@/features/content/question-preview", () => ({
  QuestionPreview: () => <div data-testid="mock-qpreview" />,
}));
vi.mock("@/components/folder-tree-select", () => ({
  FolderTreeSelect: () => <div data-testid="mock-folder-tree-select" />,
}));
vi.mock("@/features/content/bulk-content-ops", () => ({
  GroupMoveModal: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-group-move" /> : null),
  GroupAccessModal: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-group-access" /> : null),
  FolderDeleteDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-folder-delete" /> : null),
  GroupDeleteFlow: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-group-delete-flow" /> : null),
}));

import { ContentTree } from "../content-tree";

// ── Fixtures ──────────────────────────────────────────────────────────────
// f1 (root) ⊃ f2 (subfolder) + t1 «Бюджетирование» ⊃ q1, q2
// t2 «Инвестиции» (standalone) ⊃ q3
const folders = [
  { id: "f1", name: "Финансы", parentId: null },
  { id: "f2", name: "Аналитика", parentId: "f1" },
];
const topics = [
  { id: "t1", name: "Бюджетирование", folderId: "f1", ownerId: "u1", visibility: "shared" },
  { id: "t2", name: "Инвестиции", folderId: null, ownerId: "u1", visibility: "shared" },
];
const questions = [
  { id: "q1", topicId: "t1", type: "single", prompt: "Сколько будет 2+2?", difficulty: 50, tags: [], mediaType: null, createdBy: "u1" },
  { id: "q2", topicId: "t1", type: "multiple", prompt: "Выберите верные утверждения", difficulty: null, tags: [], mediaType: null, createdBy: "u1" },
  { id: "q3", topicId: "t2", type: "single", prompt: "Что такое акция?", difficulty: null, tags: [], mediaType: null, createdBy: "u1" },
];

interface TreeData {
  folders?: unknown[];
  topics?: unknown[];
  questions?: unknown[];
  users?: unknown[];
}

/** Build a URL-routed fetch stub over the given fixtures. */
function stubFetch(data: TreeData) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const u = String(url);
    let body: unknown = {};
    if (u === "/api/folders") body = data.folders ?? [];
    else if (u === "/api/topics") body = data.topics ?? [];
    else if (u === "/api/questions") body = data.questions ?? [];
    else if (u === "/api/users") body = data.users ?? [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderTree(data: TreeData = { folders, topics, questions }) {
  const fetchMock = stubFetch(data);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <ContentTree />
    </QueryClientProvider>,
  );
  return { ...utils, fetchMock };
}

beforeEach(() => {
  guardSpy.mockClear();
  toastSpy.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<ContentTree /> — data branches", () => {
  it("shows the loading state while the queries are pending", () => {
    // A never-resolving fetch keeps every query in the pending state.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
    });
    render(
      <QueryClientProvider client={client}>
        <ContentTree />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Загрузка…")).toBeInTheDocument();
  });

  it("renders the empty state when there are no topics", async () => {
    renderTree({ folders: [], topics: [], questions: [] });
    await waitFor(() =>
      expect(screen.getByText(/Тем пока нет/)).toBeInTheDocument(),
    );
  });

  it("renders the folder/topic hierarchy with the root count and column header", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    // Nested folder, topics and the root aggregate count.
    expect(screen.getByText("Аналитика")).toBeInTheDocument();
    expect(screen.getByText("Бюджетирование")).toBeInTheDocument();
    expect(screen.getByText("Инвестиции")).toBeInTheDocument();
    // The root caption now spells out what each number counts (2 папки · 2 темы · 3 вопроса).
    expect(document.querySelector(".ct-rootrow")!.textContent).toContain("Все темы");
    expect(document.querySelector(".ct-rootrow")!.textContent).toContain("3 вопроса");
    expect(screen.getByText("Название")).toBeInTheDocument();
    // Topics start collapsed → their questions are not in the DOM yet.
    expect(screen.queryByText("Сколько будет 2+2?")).not.toBeInTheDocument();
  });
});

describe("<ContentTree /> — expand / collapse", () => {
  it("reveals a topic's questions when the topic row is clicked, hides them again on re-click", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование"));
    expect(screen.getByText("Сколько будет 2+2?")).toBeInTheDocument();
    expect(screen.getByText("Выберите верные утверждения")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Бюджетирование"));
    expect(screen.queryByText("Сколько будет 2+2?")).not.toBeInTheDocument();
  });

  it("collapses a folder (hiding its subtree) when the folder row is clicked", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Финансы"));
    // f1's subtree (subfolder + topic) is gone; the standalone topic remains.
    expect(screen.queryByText("Бюджетирование")).not.toBeInTheDocument();
    expect(screen.queryByText("Аналитика")).not.toBeInTheDocument();
    expect(screen.getByText("Инвестиции")).toBeInTheDocument();
  });

  it("«Развернуть всё» opens every topic; questions across topics become visible", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Развернуть всё" }));
    expect(screen.getByText("Сколько будет 2+2?")).toBeInTheDocument();
    expect(screen.getByText("Что такое акция?")).toBeInTheDocument();
  });

  it("«Свернуть всё» collapses folders, hiding the subtree", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Свернуть всё" }));
    expect(screen.queryByText("Бюджетирование")).not.toBeInTheDocument();
  });

  it("shows the inline preview when a question row is expanded", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование")); // expand topic
    fireEvent.click(screen.getByText("Сколько будет 2+2?")); // expand question
    expect(screen.getByTestId("mock-qpreview")).toBeInTheDocument();
  });
});

describe("<ContentTree /> — selection modes", () => {
  it("selecting a question opens the «Вопросы» bulk bar", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование")); // expand to reveal question checkboxes
    fireEvent.click(screen.getAllByLabelText("Выбрать вопрос")[0]);
    expect(screen.getByText("Снять выбор")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Переместить…" })).toBeInTheDocument();
  });

  it("selecting a topic opens the «Папки и темы» group bar with its actions", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Выбрать тему для экспорта")[0]);
    expect(screen.getByTestId("ct-group-move")).toBeInTheDocument();
    expect(screen.getByTestId("ct-group-access")).toBeInTheDocument();
    expect(screen.getByTestId("ct-export-topics")).toBeInTheDocument();
    expect(screen.getByTestId("ct-group-delete")).toBeInTheDocument();
  });

  it("group bar (topic selection) wires move / access / export / delete actions", async () => {
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { href: "" } });
    try {
      renderTree();
      await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
      fireEvent.click(screen.getAllByLabelText("Выбрать тему для экспорта")[0]);
      fireEvent.click(screen.getByTestId("ct-group-move"));
      expect(screen.getByTestId("mock-group-move")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("ct-group-access"));
      expect(screen.getByTestId("mock-group-access")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("ct-export-topics"));
      expect(window.location.href).toContain("/api/questions/export?topicIds=t1");
      // No folder selected → the topic-delete branch (GroupDeleteFlow), not the folder dialog.
      fireEvent.click(screen.getByTestId("ct-group-delete"));
      expect(screen.getByTestId("mock-group-delete-flow")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, writable: true, value: orig });
    }
  });

  it("selecting a folder + group delete opens the two-mode folder-delete dialog", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Выбрать папку")[0]);
    fireEvent.click(screen.getByTestId("ct-group-delete"));
    expect(screen.getByTestId("mock-folder-delete")).toBeInTheDocument();
  });
});

describe("<ContentTree /> — row actions & FAB", () => {
  it("the topic ⋯-menu «Добавить вопрос» opens the question editor", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Действия темы")[0]);
    fireEvent.click(screen.getByTestId("ct-topic-addq-t1"));
    expect(screen.getByTestId("mock-question-editor")).toBeInTheDocument();
  });

  it("the folder ⋯-menu «Добавить папку» opens the create-folder modal", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Действия папки")[0]);
    fireEvent.click(screen.getByText("Добавить папку"));
    await waitFor(() => expect(screen.getByText("Новая папка")).toBeInTheDocument());
  });

  it("the question ⋯-menu «Дублировать» fires the duplicate request", async () => {
    const { fetchMock } = renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование"));
    fireEvent.click(screen.getAllByLabelText("Действия вопроса")[0]);
    fireEvent.click(screen.getByText("Дублировать"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/questions/q1/duplicate"))).toBe(true),
    );
  });

  it("the question ⋯-menu «Удалить» routes through the content guard", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование"));
    fireEvent.click(screen.getAllByLabelText("Действия вопроса")[0]);
    const menu = screen.getByText("Дублировать").closest(".ct-menu") as HTMLElement;
    fireEvent.click(within(menu).getByText("Удалить"));
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0]).toMatchObject({ method: "DELETE" });
  });

  it("the question ⋯-menu «Переместить в тему…» opens the move modal", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование"));
    fireEvent.click(screen.getAllByLabelText("Действия вопроса")[0]);
    fireEvent.click(screen.getByText("Переместить в тему…"));
    await waitFor(() => expect(screen.getByTestId("ct-move-questions-confirm")).toBeInTheDocument());
  });

  it("the speed-dial FAB reveals the create actions and opens the folder modal", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-fab-toggle"));
    expect(screen.getByTestId("ct-fab-folder")).toBeInTheDocument();
    expect(screen.getByTestId("ct-fab-topic")).toBeInTheDocument();
    expect(screen.getByTestId("ct-fab-question")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ct-fab-folder"));
    await waitFor(() => expect(screen.getByText("Новая папка")).toBeInTheDocument());
  });
});

describe("<ContentTree /> — mutations & modal confirms", () => {
  it("creates a folder from the create modal (POST /api/folders)", async () => {
    const { fetchMock } = renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-fab-toggle"));
    fireEvent.click(screen.getByTestId("ct-fab-folder"));
    await waitFor(() => expect(screen.getByText("Новая папка")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Название папки"), { target: { value: "Кредиты" } });
    fireEvent.click(screen.getByTestId("ct-new-folder-confirm"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]) === "/api/folders" && (c[1] as RequestInit)?.method === "POST"),
      ).toBe(true),
    );
  });

  it("renames a folder from its ⋯-menu (PUT /api/folders/f1)", async () => {
    const { fetchMock } = renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Действия папки")[0]);
    fireEvent.click(screen.getByText("Переименовать…"));
    await waitFor(() => expect(screen.getByLabelText("Название папки")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Название папки"), { target: { value: "Финансы 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/folders/f1" && (c[1] as RequestInit)?.method === "PUT")).toBe(true),
    );
  });

  it("moves a topic to a folder from its ⋯-menu (PUT /api/topics/t1)", async () => {
    const { fetchMock } = renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Действия темы")[0]);
    fireEvent.click(screen.getByText("Переместить в папку…"));
    await waitFor(() => expect(screen.getByTestId("ct-move-topic-confirm")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-move-topic-confirm"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/topics/t1" && (c[1] as RequestInit)?.method === "PUT")).toBe(true),
    );
  });

  it("moves a question to a topic from the move modal (PUT /api/questions/q1)", async () => {
    const { fetchMock } = renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование"));
    fireEvent.click(screen.getAllByLabelText("Действия вопроса")[0]);
    fireEvent.click(screen.getByText("Переместить в тему…"));
    // The target topic defaults to the question's current topic, so confirm is enabled.
    await waitFor(() => expect(screen.getByTestId("ct-move-questions-confirm")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ct-move-questions-confirm"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/questions/q1" && (c[1] as RequestInit)?.method === "PUT")).toBe(true),
    );
  });

  it("exports a topic's questions to Excel via its ⋯-menu", async () => {
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { href: "" } });
    try {
      renderTree();
      await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
      fireEvent.click(screen.getAllByLabelText("Действия темы")[0]);
      fireEvent.click(screen.getByTestId("ct-topic-export-t1"));
      expect(window.location.href).toContain("/api/questions/export?topicIds=t1");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, writable: true, value: orig });
    }
  });
});

describe("<ContentTree /> — filters & search", () => {
  it("opens the facet filter panel from the toolbar", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
    expect(screen.getByText("Тип вопроса")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Фильтры" })).toBeInTheDocument();
  });

  it("applies a facet condition and shows a removable chip", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
    fireEvent.click(screen.getByLabelText("Не задана")); // difficulty «unset» facet
    fireEvent.click(screen.getByText("Применить"));
    expect(screen.getByText("Сложность: не задана")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Очистить всё"));
    expect(screen.queryByText("Сложность: не задана")).not.toBeInTheDocument();
  });

  it("debounced search auto-expands to matches and hides non-matching branches", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Поиск по темам и вопросам…"), {
      target: { value: "инвест" },
    });
    // After the 250ms debounce settles, the matching topic's questions appear
    // and the non-matching «Финансы» branch is filtered out.
    await waitFor(() => expect(screen.getByText("Что такое акция?")).toBeInTheDocument());
    expect(screen.getByText(/Показано\s+1\s+совпадение/)).toBeInTheDocument();
    expect(screen.queryByText("Финансы")).not.toBeInTheDocument();
  });
});

// ── Counts in row captions ────────────────────────────────────────────────
// The root used to show a bare «(N)» that silently meant QUESTIONS, and a folder
// showed only its own topics with a hard-coded «темы» ending — so «1 темы» and a
// container folder reading «0 темы» while holding hundreds of questions.
describe("<ContentTree /> — счётчики в подписях строк", () => {
  it("корень расшифровывает, что именно посчитано", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    const root = document.querySelector(".ct-rootrow")!;
    expect(root.textContent).toContain("2 папки");
    expect(root.textContent).toContain("2 темы");
    expect(root.textContent).toContain("3 вопроса");
  });

  it("папка считает всё вложенное вглубь, а не только своё", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    // f1 ⊃ f2 (пустая) + t1 (2 вопроса)
    const row = screen.getByText("Финансы").closest(".ct-row")!;
    expect(row.textContent).toContain("1 папка");
    expect(row.textContent).toContain("1 тема");
    expect(row.textContent).toContain("2 вопроса");
  });

  it("пустая папка так и говорит", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Аналитика")).toBeInTheDocument());
    const row = screen.getByText("Аналитика").closest(".ct-row")!;
    expect(row.textContent).toContain("пусто");
  });

  it("склоняет существительные по числу", async () => {
    const one = {
      folders: [{ id: "f1", name: "Одна", parentId: null }],
      topics: [{ id: "t1", name: "Тема", folderId: "f1", ownerId: "u1", visibility: "shared" }],
      questions: [
        { id: "q1", topicId: "t1", type: "single", prompt: "Раз?", difficulty: null, tags: [], mediaType: null, createdBy: "u1" },
      ],
    };
    renderTree(one);
    await waitFor(() => expect(screen.getByText("Одна")).toBeInTheDocument());
    const row = screen.getByText("Одна").closest(".ct-row")!;
    expect(row.textContent).toContain("1 тема");
    expect(row.textContent).toContain("1 вопрос");
    expect(row.textContent).not.toContain("1 вопроса");
  });
});
