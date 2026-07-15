/**
 * @module features/content/__tests__/content-tree-branches.test
 * @description Branch-completion coverage for the unified "Темы и вопросы" tree
 * ({@link ContentTree}) not reached by the sibling suite: the remaining active-
 * condition chip removals (type / tag / media / owner / difficulty / scope),
 * every {@link ContentTree.topicInScope} scope facet (mine / shared /
 * accessible), the transitive `resolvedTopicIds` collection when a folder with a
 * sub-folder is selected, the owner-label variants (self / other user / none)
 * and the media pictogram branch.
 *
 * IMPORTANT: unlike the sibling suite, this file does NOT mock
 * `@/features/content/bulk-content-ops` — mocking it would zero the module's
 * coverage in a combined v8 run. The real group modals render here; only the
 * heavy leaves (question editor, topic drawer, preview, content guard, folder
 * picker) are stubbed. Group modals fire no network unless confirmed, and this
 * suite never confirms one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// NOTE: bulk-content-ops is intentionally NOT mocked (see module JSDoc).

import { ContentTree } from "../content-tree";

// ── Fixtures ──────────────────────────────────────────────────────────────
// f1 (root) ⊃ f2 (sub) ⊃ t3; f1 also has t1, t4 directly. t2 is standalone.
// Owners: t1 = self (u1), t2 = none (null), t3 = u2 (Петров), t4 = u9 (unknown).
const folders = [
  { id: "f1", name: "Финансы", parentId: null },
  { id: "f2", name: "Аналитика", parentId: "f1" },
];
const topics = [
  { id: "t1", name: "Бюджетирование", folderId: "f1", ownerId: "u1", visibility: "shared" },
  { id: "t2", name: "Инвестиции", folderId: null, ownerId: null, visibility: "private" },
  { id: "t3", name: "Секретная", folderId: "f2", ownerId: "u2", visibility: "private" },
  { id: "t4", name: "Резервы", folderId: "f1", ownerId: "u9", visibility: "shared" },
];
const questions = [
  { id: "q1", topicId: "t1", type: "single", prompt: "Сколько будет 2+2?", difficulty: 50, tags: ["налоги"], mediaType: "image", createdBy: "u1" },
  { id: "q2", topicId: "t1", type: "multiple", prompt: "Выберите верные утверждения", difficulty: null, tags: [], mediaType: null, createdBy: "u2" },
  { id: "q3", topicId: "t2", type: "single", prompt: "Что такое акция?", difficulty: 20, tags: ["акции"], mediaType: null, createdBy: "u1" },
  { id: "q4", topicId: "t3", type: "ranking", prompt: "Упорядочьте активы", difficulty: 80, tags: [], mediaType: "audio", createdBy: "u2" },
];
const users = [
  { id: "u1", name: "Author", email: "a@corp.ru" },
  { id: "u2", name: "Петров", email: "p@corp.ru" },
];

interface TreeData { folders?: unknown[]; topics?: unknown[]; questions?: unknown[]; users?: unknown[] }

function stubFetch(data: TreeData) {
  const fetchMock = vi.fn(async (url: string) => {
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

function renderTree(data: TreeData = { folders, topics, questions, users }) {
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

/** Open the facet panel from the toolbar. */
function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
}
/** Click «Применить» inside the facet panel. */
function applyFilters() {
  const panel = screen.getByRole("dialog", { name: "Фильтры" });
  fireEvent.click(within(panel).getByText("Применить"));
}
/** Remove the active-condition chip carrying the given label. */
function removeChip(label: string) {
  const chip = screen.getByText(label).closest(".ou-chip") as HTMLElement;
  fireEvent.click(within(chip).getByLabelText("Удалить"));
}

beforeEach(() => { guardSpy.mockClear(); toastSpy.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ── Active-condition chip removal (per facet) ───────────────────────────────
describe("<ContentTree /> — chip removal per facet", () => {
  it("type facet: applies a type condition and removes its chip", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    openFilters();
    fireEvent.click(screen.getByLabelText("Один ответ"));
    applyFilters();
    expect(screen.getByText("Тип: Один ответ")).toBeInTheDocument();
    removeChip("Тип: Один ответ");
    expect(screen.queryByText("Тип: Один ответ")).not.toBeInTheDocument();
  });

  it("tag facet: applies a tag condition and removes its chip", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    openFilters();
    const tagInput = screen.getByPlaceholderText("Добавить тег…");
    fireEvent.change(tagInput, { target: { value: "налоги" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    applyFilters();
    expect(screen.getByText("Тег: налоги")).toBeInTheDocument();
    removeChip("Тег: налоги");
    expect(screen.queryByText("Тег: налоги")).not.toBeInTheDocument();
  });

  it("media facet: applies a media condition and removes its chip", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    openFilters();
    fireEvent.click(screen.getByLabelText("С изображением"));
    applyFilters();
    expect(screen.getByText("Медиа: С изображением")).toBeInTheDocument();
    removeChip("Медиа: С изображением");
    expect(screen.queryByText("Медиа: С изображением")).not.toBeInTheDocument();
  });

  it("owner facet: applies an owner condition and removes its chip", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    openFilters();
    // The «Владелец» Select trigger currently shows the placeholder «Любой».
    fireEvent.click(screen.getByText("Любой"));
    fireEvent.click(screen.getByRole("option", { name: "Петров" }));
    applyFilters();
    expect(screen.getByText("Владелец: Петров")).toBeInTheDocument();
    removeChip("Владелец: Петров");
    expect(screen.queryByText("Владелец: Петров")).not.toBeInTheDocument();
  });

  it("difficulty «unset» facet: applies and removes via its own chip (not «Очистить всё»)", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    openFilters();
    fireEvent.click(screen.getByLabelText("Не задана"));
    applyFilters();
    expect(screen.getByText("Сложность: не задана")).toBeInTheDocument();
    removeChip("Сложность: не задана");
    expect(screen.queryByText("Сложность: не задана")).not.toBeInTheDocument();
  });

  it("difficulty range facet: narrows the interval via the slider and removes the range chip", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    openFilters();
    // Move the upper thumb down from 100 → 90 (PageDown = -step*10), then apply.
    const upper = screen.getByRole("slider", { name: "Интервал сложности — верхняя граница" });
    fireEvent.keyDown(upper, { key: "PageDown" });
    applyFilters();
    expect(screen.getByText("Сложность: 0–90")).toBeInTheDocument();
    removeChip("Сложность: 0–90");
    expect(screen.queryByText("Сложность: 0–90")).not.toBeInTheDocument();
  });
});

// ── topicInScope facet variants ─────────────────────────────────────────────
describe("<ContentTree /> — scope facet (topicInScope)", () => {
  /** Open filters, pick a scope segment, apply. */
  function applyScope(segment: string) {
    openFilters();
    const panel = screen.getByRole("dialog", { name: "Фильтры" });
    fireEvent.click(within(panel).getByText(segment));
    applyFilters();
  }

  it("«Мои» keeps only self-owned topics", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    applyScope("Мои");
    expect(screen.getByText("Область: Мои")).toBeInTheDocument();
    expect(screen.getByText("Бюджетирование")).toBeInTheDocument(); // owner u1 (self)
    expect(screen.queryByText("Инвестиции")).not.toBeInTheDocument(); // owner none
    expect(screen.queryByText("Резервы")).not.toBeInTheDocument(); // owner u9
    // Remove the scope chip → back to the full tree.
    removeChip("Область: Мои");
    expect(screen.getByText("Инвестиции")).toBeInTheDocument();
  });

  it("«Общие» keeps only shared-visibility topics", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    applyScope("Общие");
    expect(screen.getByText("Бюджетирование")).toBeInTheDocument(); // shared
    expect(screen.getByText("Резервы")).toBeInTheDocument(); // shared
    expect(screen.queryByText("Инвестиции")).not.toBeInTheDocument(); // private
    expect(screen.queryByText("Секретная")).not.toBeInTheDocument(); // private
  });

  it("«Доступные» keeps topics owned by others and not shared", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    applyScope("Доступные");
    expect(screen.getByText("Инвестиции")).toBeInTheDocument(); // owner none, private
    expect(screen.getByText("Секретная")).toBeInTheDocument(); // owner u2, private
    expect(screen.queryByText("Бюджетирование")).not.toBeInTheDocument(); // self-owned
    expect(screen.queryByText("Резервы")).not.toBeInTheDocument(); // shared
  });
});

// ── Empty result branch ─────────────────────────────────────────────────────
describe("<ContentTree /> — no matches", () => {
  it("renders the «Ничего не найдено» state when the search matches nothing", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Поиск по темам и вопросам…"), { target: { value: "неттакого" } });
    await waitFor(() => expect(screen.getByText("Ничего не найдено.")).toBeInTheDocument());
    expect(screen.queryByText("Финансы")).not.toBeInTheDocument();
  });
});

// ── Owner label + media pictogram branches ──────────────────────────────────
describe("<ContentTree /> — owner labels + media pictogram", () => {
  it("renders self / other-user / none owner labels", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    // Self-owned topic → the current user's name.
    expect(screen.getByText("Author")).toBeInTheDocument();
    // Other user in the directory → their name.
    expect(screen.getByText("Петров")).toBeInTheDocument();
    // Null owner + unknown owner both render the «—» placeholder (t2 + t4).
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the media pictogram only for questions carrying media", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Бюджетирование")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Бюджетирование")); // expand t1 → q1 (image) + q2 (none)
    expect(screen.getByTitle("С медиа")).toBeInTheDocument();
  });
});

// ── Transitive resolvedTopicIds + real group modals ─────────────────────────
describe("<ContentTree /> — folder selection resolves topics transitively", () => {
  it("selecting a parent folder counts direct + sub-folder topics and drives group access/export", async () => {
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { href: "" } });
    try {
      renderTree();
      await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
      // Select the root folder f1 → topicsUnderFolder walks into f2 (BFS).
      fireEvent.click(screen.getAllByLabelText("Выбрать папку")[0]);
      // f1 direct (t1, t4) + f2's t3 = 3 topics · 1 folder.
      expect(screen.getByText(/3 темы/)).toBeInTheDocument();
      expect(screen.getByText(/1 папка/)).toBeInTheDocument();

      // Real GroupAccessModal (not mocked): folderCount > 0 → the folders-aware scope banner.
      fireEvent.click(screen.getByTestId("ct-group-access"));
      await waitFor(() => expect(screen.getByText("Групповой доступ")).toBeInTheDocument());
      expect(screen.getByText(/Применится к 3 темам/)).toBeInTheDocument();
      expect(screen.getByText(/из 1 папок/)).toBeInTheDocument();
      // Close the access modal before exporting.
      fireEvent.click(screen.getByText("Отмена"));

      // Export uses the resolved topic id set.
      fireEvent.click(screen.getByTestId("ct-export-topics"));
      expect(window.location.href).toContain("/api/questions/export?topicIds=");
      expect(window.location.href).toContain("t1");
      expect(window.location.href).toContain("t3");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, writable: true, value: orig });
    }
  });

  it("selecting a folder + group delete opens the real two-mode folder-delete dialog", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Выбрать папку")[0]);
    fireEvent.click(screen.getByTestId("ct-group-delete"));
    // Real FolderDeleteDialog renders its title with the primary folder name.
    await waitFor(() => expect(screen.getByText(/Удалить папку «Финансы»/)).toBeInTheDocument());
  });
});
