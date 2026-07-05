/**
 * @module pages/author/__tests__/topics-extra.coverage.test
 * @description Branch-coverage top-up for the topics page (PRD-15), complementing
 * `topics.test.tsx`. Drives the actions the smoke suite leaves cold: duplicate /
 * delete (content guard) / open-access-tab, single + select-all selection and the
 * bulk-delete confirm→guard flow, the search filter (match / no-match), the scope
 * SegmentedControl, the grid↔list view toggle, folder create / edit / delete /
 * expand + add-topic-to-folder, and the admin-only «показывать пустые папки» +
 * duplicates report. The auth (admin toggle), content-guard and drawer network are
 * mocked.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

const { authState, guardMock } = vi.hoisted(() => ({
  authState: { current: { isAdmin: false } },
  guardMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    can: () => true,
    // ROLES.ADMINISTRATOR / ROLES.SUPERADMIN both resolve to the admin toggle.
    hasRole: () => authState.current.isAdmin,
    user: { id: "u1", name: "Author" },
  }),
}));
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import TopicsPage from "../topics";

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const topics = () => [
  { id: "t1", name: "Финансы", description: "База", folderId: null, ownerId: "u1", visibility: "shared", nameNormalized: "финансы", code: null, feedbackJson: { format: "plain", text: "", links: [{ title: "Курс", url: "https://e.test" }], assets: [{ id: "a1" }], events: [{ title: "Вебинар" }] }, courses: [], events: [], questionCount: 5 },
  { id: "t2", name: "Инвестиции", description: "", folderId: "f1", ownerId: "u2", visibility: "private", nameNormalized: "инвестиции", code: null, feedbackJson: null, courses: [], events: [], questionCount: 0 },
  { id: "t3", name: "Налоги", description: "", folderId: null, ownerId: "u2", visibility: "shared", nameNormalized: "налоги", code: null, feedbackJson: null, courses: [], events: [], questionCount: 3 },
];

const folders = () => [
  { id: "f1", name: "Папка 1", parentId: null },
  { id: "f2", name: "Подпапка", parentId: "f1" },
  { id: "f3", name: "Пустая", parentId: null },
];

const duplicatesReport = () => ({
  groups: [
    {
      nameNormalized: "финансы",
      topics: [
        { id: "t1", name: "Финансы", ownerId: "u1", visibility: "shared" },
        { id: "tx", name: "Финансы", ownerId: null, visibility: "private" },
      ],
    },
  ],
});

let fetchMock: ReturnType<typeof vi.fn>;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  authState.current = { isAdmin: false };
  guardMock.mockClear();
  calls = [];
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method || "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") calls.push({ url: u, method, body });
    if (u === "/api/topics") return ok(topics());
    if (u === "/api/folders") return ok(folders());
    if (u === "/api/users") return ok([{ id: "u1", name: "Author", email: "a@t.ru" }, { id: "u2", name: "Other", email: "o@t.ru" }]);
    if (u === "/api/topics/duplicates-report") return ok(duplicatesReport());
    if (u.startsWith("/api/topics/name-check")) return ok({ exists: false });
    if (u.match(/^\/api\/topics\/[^/]+\/access$/)) return ok({ topicId: "t1", ownerId: "u1", grants: [] });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TopicsPage />
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  renderPage();
  await waitFor(() => expect(screen.getByText("Финансы")).toBeInTheDocument());
}

describe("<TopicsPage /> — actions & folders", () => {
  it("renders feedback counts and hides empty folders for a non-admin", async () => {
    await renderLoaded();
    expect(screen.getByText(/1 мероприятий/)).toBeInTheDocument();
    expect(screen.getByText("Папка 1")).toBeInTheDocument(); // holds t2 → visible
    expect(screen.queryByText("Пустая")).not.toBeInTheDocument(); // empty → hidden
  });

  it("duplicates a topic", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("button-duplicate-topic-t1"));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/topics/t1/duplicate" && c.method === "POST")).toBe(true),
    );
  });

  it("routes a topic delete through the content guard", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("button-delete-topic-t1"));
    expect(guardMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/topics/t1", method: "DELETE" }),
    );
  });

  it("opens the access tab of the unified topic drawer", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("button-access-topic-t1"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Доступ" })).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Доступ" })).toHaveAttribute("aria-selected", "true");
  });

  it("selects a topic, selects-all, and opens the bulk-delete confirm→guard flow", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("checkbox-topic-t1"));
    // The destructive bulk-delete button surfaces once something is selected.
    const bulkBtn = await screen.findByTestId("button-delete-selected-topics");
    // Select-all flips the label to «снять выделение».
    fireEvent.click(screen.getByTestId("button-select-all-topics"));
    expect(screen.getByText("Снять выделение")).toBeInTheDocument();
    // Bulk delete → confirm modal → guard.
    fireEvent.click(bulkBtn);
    fireEvent.click(await screen.findByTestId("button-confirm-bulk-delete-topics"));
    expect(guardMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/topics/bulk-delete", method: "POST" }),
    );
  });

  it("filters topics by search (match and no-match)", async () => {
    await renderLoaded();
    const search = screen.getByPlaceholderText("Поиск тем...");
    fireEvent.change(search, { target: { value: "Финансы" } });
    await waitFor(() => expect(screen.queryByText("Налоги")).not.toBeInTheDocument());
    expect(screen.getByText("Финансы")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText("Ничего не найдено")).toBeInTheDocument());
  });

  it("narrows the list through the scope SegmentedControl", async () => {
    await renderLoaded();
    // «Мои» → only the u1-owned t1 remains among root topics; t3 (u2) drops out.
    fireEvent.click(screen.getByText("Мои"));
    await waitFor(() => expect(screen.queryByText("Налоги")).not.toBeInTheDocument());
    expect(screen.getByText("Финансы")).toBeInTheDocument();
    // «Общие» brings the shared t3 back.
    fireEvent.click(screen.getByText("Общие"));
    await waitFor(() => expect(screen.getByText("Налоги")).toBeInTheDocument());
  });

  it("switches to the list view and renders the table", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByLabelText("Список"));
    await waitFor(() => expect(screen.getByText("Тема")).toBeInTheDocument()); // table column header
    expect(screen.getByText("Финансы")).toBeInTheDocument();
    expect(localStorage.getItem("topics_view")).toBe("list");
  });

  it("creates a folder", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("button-create-folder"));
    fireEvent.change(await screen.findByTestId("input-folder-name"), { target: { value: "Новая папка" } });
    fireEvent.click(screen.getByTestId("button-submit-folder"));
    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/folders" && c.method === "POST");
      expect(post).toBeTruthy();
      expect((post!.body as { name: string }).name).toBe("Новая папка");
    });
  });

  it("edits a folder with its name prefilled", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("button-edit-folder-f1"));
    await waitFor(() =>
      expect((screen.getByTestId("input-folder-name") as HTMLInputElement).value).toBe("Папка 1"),
    );
  });

  it("deletes a folder after the confirm prompt", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("button-delete-folder-f1"));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/folders/f1" && c.method === "DELETE")).toBe(true),
    );
  });

  it("expands a folder and opens create-in-folder from it", async () => {
    await renderLoaded();
    // f1 is collapsed → its topic t2 is hidden until expanded.
    expect(screen.queryByText("Инвестиции")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Развернуть папку"));
    await waitFor(() => expect(screen.getByText("Инвестиции")).toBeInTheDocument());
    // «+» inside the folder header opens the create drawer scoped to that folder.
    fireEvent.click(screen.getByTestId("button-add-topic-to-folder-f1"));
    await waitFor(() => expect(screen.getByTestId("input-topic-name")).toBeInTheDocument());
  });
});

describe("<TopicsPage /> — admin controls", () => {
  beforeEach(() => { authState.current = { isAdmin: true }; });

  it("reveals empty folders and the duplicates report", async () => {
    await renderLoaded();
    // Admin-only «показывать пустые папки» → the empty f3 appears once toggled.
    expect(screen.queryByText("Пустая")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-show-empty-folders"));
    await waitFor(() => expect(screen.getByText("Пустая")).toBeInTheDocument());

    // Duplicates report modal (admin-only): fetches the report + users.
    fireEvent.click(screen.getByTestId("button-duplicates-report"));
    await waitFor(() => expect(screen.getByText(/«финансы» · 2/)).toBeInTheDocument());
    expect(screen.getByText("Author")).toBeInTheDocument();     // owner label (u1)
    expect(screen.getByText("не назначен")).toBeInTheDocument(); // null owner
    expect(screen.getByText("Общая")).toBeInTheDocument();
    expect(screen.getByText("Приватная")).toBeInTheDocument();
  });
});
