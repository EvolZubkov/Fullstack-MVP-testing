/**
 * @module features/content/__tests__/content-tree-extra.coverage.test
 * @description Supplementary coverage for {@link ContentTree}, targeting the
 * branches the primary suite leaves untouched:
 *   - the «Область» scope facet (Мои / Общие / Доступные) driving `topicInScope`
 *     + `folderVisible`, and its removable chip (`commitFilter`);
 *   - owner-column labels (self / other user / common pool);
 *   - the Тип / Медиа facet chips;
 *   - the media pictogram on a question row;
 *   - the «Вопросы» bulk-bar move action (opens the move modal, confirm disabled
 *     with no target) and the move-failure error toast;
 *   - toggling the filter panel closed from the toolbar.
 * Same harness as the primary suite: `fetch` stubbed by URL, heavy leaf
 * modals/drawers mocked to stubs. `stubFetch` also accepts a write router so a
 * mutation can be forced to fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

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
// Owners: t1 = self (u1), t2 = other (u2) + shared, t3 = common pool (null).
const folders = [{ id: "f1", name: "Финансы", parentId: null }];
const topics = [
  { id: "t1", name: "Бюджетирование", folderId: "f1", ownerId: "u1", visibility: "private" },
  { id: "t2", name: "Инвестиции", folderId: null, ownerId: "u2", visibility: "shared" },
  { id: "t3", name: "Налоги", folderId: null, ownerId: null, visibility: "private" },
];
const questions = [
  { id: "q1", topicId: "t1", type: "single", prompt: "Вопрос про бюджет", difficulty: 50, tags: ["a"], mediaType: "image", createdBy: "u1" },
  { id: "q2", topicId: "t2", type: "multiple", prompt: "Вопрос про акции", difficulty: null, tags: [], mediaType: null, createdBy: "u2" },
];
const users = [{ id: "u2", name: "Марина", email: "m@corp.ru" }];

interface TreeData {
  folders?: unknown[];
  topics?: unknown[];
  questions?: unknown[];
  users?: unknown[];
}
type WriteRouter = (url: string, method: string, body: any) => { ok?: boolean; status?: number; body?: unknown } | undefined;

function stubFetch(data: TreeData, onWrite?: WriteRouter) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "GET") {
      let body: unknown = {};
      if (u === "/api/folders") body = data.folders ?? [];
      else if (u === "/api/topics") body = data.topics ?? [];
      else if (u === "/api/questions") body = data.questions ?? [];
      else if (u === "/api/users") body = data.users ?? [];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    const w = onWrite?.(u, method, init?.body ? JSON.parse(init.body as string) : undefined);
    const r = w ?? { ok: true, body: {} };
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

function renderTree(data: TreeData = { folders, topics, questions, users }, onWrite?: WriteRouter) {
  const fetchMock = stubFetch(data, onWrite);
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

/** Apply a facet scope from the filter panel. */
function applyScope(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
  fireEvent.click(screen.getByText(label));
  fireEvent.click(screen.getByText("Применить"));
}

beforeEach(() => {
  guardSpy.mockClear();
  toastSpy.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<ContentTree /> — owner column", () => {
  it("labels the owner as self / other user / common pool", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    expect(screen.getByText("Author")).toBeInTheDocument(); // t1 — self
    expect(screen.getByText("Марина")).toBeInTheDocument(); // t2 — other user
    expect(screen.getByText("—")).toBeInTheDocument(); // t3 — common pool (null owner)
  });
});

describe("<ContentTree /> — scope facet", () => {
  it("«Мои» keeps only owned topics and shows a removable chip", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Инвестиции")).toBeInTheDocument());
    applyScope("Мои");
    expect(screen.getByText("Бюджетирование")).toBeInTheDocument();
    expect(screen.queryByText("Инвестиции")).not.toBeInTheDocument();
    expect(screen.queryByText("Налоги")).not.toBeInTheDocument();
    expect(screen.getByText("Область: Мои")).toBeInTheDocument();
    // Removing the chip (commitFilter) restores every topic.
    fireEvent.click(screen.getByLabelText("Удалить"));
    expect(screen.getByText("Инвестиции")).toBeInTheDocument();
  });

  it("«Общие» keeps only shared topics", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Инвестиции")).toBeInTheDocument());
    applyScope("Общие");
    expect(screen.getByText("Инвестиции")).toBeInTheDocument(); // t2 visibility shared
    expect(screen.queryByText("Бюджетирование")).not.toBeInTheDocument();
    expect(screen.queryByText("Налоги")).not.toBeInTheDocument();
  });

  it("«Доступные» keeps only accessible (non-owned, non-shared) topics", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Налоги")).toBeInTheDocument());
    applyScope("Доступные");
    expect(screen.getByText("Налоги")).toBeInTheDocument(); // t3 — null owner, private
    expect(screen.queryByText("Бюджетирование")).not.toBeInTheDocument();
    expect(screen.queryByText("Инвестиции")).not.toBeInTheDocument();
  });
});

describe("<ContentTree /> — facet chips & media", () => {
  it("Тип + Медиа facets produce their chips", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
    fireEvent.click(screen.getByLabelText("Один ответ")); // type: single
    fireEvent.click(screen.getByLabelText("С изображением")); // media: image
    fireEvent.click(screen.getByText("Применить"));
    expect(screen.getByText("Тип: Один ответ")).toBeInTheDocument();
    expect(screen.getByText("Медиа: С изображением")).toBeInTheDocument();
  });

  it("shows the media pictogram on a question that carries media", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование")); // expand t1 to reveal q1
    expect(screen.getByTitle("С медиа")).toBeInTheDocument();
  });
});

describe("<ContentTree /> — question bulk bar", () => {
  it("«Переместить…» opens the move modal with no preset target (confirm disabled)", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование")); // expand to reveal the question checkbox
    fireEvent.click(screen.getAllByLabelText("Выбрать вопрос")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Переместить…" }));
    await waitFor(() => expect(screen.getByText("Переместить вопросы в тему")).toBeInTheDocument());
    expect(screen.getByTestId("ct-move-questions-confirm")).toBeDisabled();
  });

  it("surfaces an error toast when moving a question fails", async () => {
    renderTree({ folders, topics, questions, users }, (url, method) =>
      url.includes("/api/questions/q1") && method === "PUT" ? { ok: false, status: 500, body: { error: "conflict" } } : undefined,
    );
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование")); // expand t1
    fireEvent.click(screen.getAllByLabelText("Действия вопроса")[0]);
    fireEvent.click(screen.getByText("Переместить в тему…"));
    // The ⋯-menu preset the target to the question's own topic → confirm enabled.
    await waitFor(() => expect(screen.getByTestId("ct-move-questions-confirm")).toBeEnabled());
    fireEvent.click(screen.getByTestId("ct-move-questions-confirm"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
  });
});

describe("<ContentTree /> — toolbar", () => {
  it("toggles the filter panel closed on a second click of «Фильтры»", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
    expect(screen.getByRole("dialog", { name: "Фильтры" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
    expect(screen.queryByRole("dialog", { name: "Фильтры" })).not.toBeInTheDocument();
  });
});
