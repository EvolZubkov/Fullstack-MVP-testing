/**
 * @module features/tests/list/__tests__/tests-list.branches.test
 * @description Branch-coverage tests for the explorer-tree tests list page.
 * Complements {@link tests-list.test} and {@link tests-list.coverage.test} by
 * driving the still-uncovered branches: the filter facets that the coverage file
 * skipped (owner Select + scope SegmentedControl → chips + scope filtering), the
 * mutation onError toasts (status generic / 409-non-infeasible / force-republish),
 * the outside-click / Escape menu close, the row «Назначить» + «Общий доступ»
 * actions, the delete-test typed-confirm error + failure catch, the folder-delete
 * destination Select and the move-modal «Текущая» label.
 *
 * Harness copied from {@link tests-list.coverage.test}.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ROLES } from "@shared/access";
import { TestsListPage } from "../tests-list";

const { authMock } = vi.hoisted(() => ({
  authMock: {
    can: (_cap: string): boolean => true,
    roles: [] as string[],
    userId: "current-user",
  },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    can: (cap: string) => authMock.can(cap),
    hasRole: (role: string) => authMock.roles.includes(role),
    user: { id: authMock.userId },
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildApiTestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    title: "Основы информационной безопасности",
    description: null,
    status: "draft",
    mode: "standard",
    folderId: null,
    flowPolicyJson: null,
    ownerId: "current-user",
    ownerName: "Марина Иванова",
    version: 1,
    createdAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-01T10:00:00Z",
    sections: [
      { id: "s-1", testId: "t-1", topicId: "t1", drawCount: 5, required: true, topicName: "Topic", maxQuestions: 10 },
    ],
    ...overrides,
  };
}

function buildApiFolder(overrides: Record<string, unknown> = {}) {
  return { id: "f-1", name: "ИБ", parentId: null, createdAt: "2026-05-01T10:00:00Z", ...overrides };
}

// ─── fetch mocking ──────────────────────────────────────────────────────────

type FetchCall = { url: string; method: string; body: unknown };
type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;
let calls: FetchCall[];

function okJson(body: unknown, status = 200, text?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => (text ?? JSON.stringify(body)),
  } as Response;
}

function installFetch(opts: {
  tests?: unknown[];
  folders?: unknown[];
  overrides?: Array<{ match: (url: string, method: string) => boolean; res: Response | Promise<Response> }>;
}) {
  const tests = opts.tests ?? [];
  const folders = opts.folders ?? [];
  fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      body = init?.body;
    }
    calls.push({ url, method, body });
    for (const o of opts.overrides ?? []) {
      if (o.match(url, method)) return o.res;
    }
    if (method === "GET" && (url === "/api/tests" || url.startsWith("/api/tests?"))) return okJson(tests);
    if (method === "GET" && (url === "/api/test-folders" || url.startsWith("/api/test-folders?"))) return okJson(folders);
    if (method === "GET") return okJson(tests);
    return okJson({ annulledAttempts: 0 });
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TestsListPage />
    </QueryClientProvider>,
  );
}

const lastCallMatching = (pred: (c: FetchCall) => boolean) => calls.filter(pred).at(-1);

beforeEach(() => {
  fetchMock = vi.fn();
  calls = [];
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  authMock.can = () => true;
  authMock.roles = [ROLES.ADMINISTRATOR];
  authMock.userId = "current-user";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Filter facets: owner Select + scope SegmentedControl ────────────────────

describe("<TestsListPage /> — filter facets", () => {
  it("applies the «Владелец» facet → chip, then removes it", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("tests-list-filter"));
    const panel = screen.getByRole("dialog", { name: "Фильтры" });
    // Owner Select trigger shows «Любой» until a specific author is chosen.
    fireEvent.click(within(panel).getByRole("button", { name: "Любой" }));
    fireEvent.click(within(panel).getByRole("option", { name: "Марина Иванова" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Применить" }));

    const chip = await screen.findByText(/Владелец: Марина Иванова/i);
    expect(chip).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Удалить"));
    await waitFor(() => expect(screen.queryByText(/Владелец: Марина Иванова/i)).toBeNull());
  });

  it("applies the «Область» = Мои scope → chip, keeps the owned row", async () => {
    installFetch({ tests: [buildApiTestRow({ ownerId: "current-user" })], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("tests-list-filter"));
    const panel = screen.getByRole("dialog", { name: "Фильтры" });
    fireEvent.click(within(panel).getByRole("button", { name: "Мои" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Применить" }));

    await screen.findByText(/Область: Мои/i);
    // «Мои» keeps ownerId === userId rows.
    expect(screen.getByText("Основы информационной безопасности")).toBeInTheDocument();
  });

  it("applies the «Область» = Доступные scope → hides own rows (else branch)", async () => {
    installFetch({ tests: [buildApiTestRow({ ownerId: "current-user" })], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("tests-list-filter"));
    const panel = screen.getByRole("dialog", { name: "Фильтры" });
    fireEvent.click(within(panel).getByRole("button", { name: "Доступные" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Применить" }));

    await screen.findByText(/Область: Доступные/i);
    // «Доступные» = ownerId !== userId → the own row is filtered out.
    await waitFor(() =>
      expect(screen.queryByText("Основы информационной безопасности")).toBeNull(),
    );
  });
});

// ─── Mutation onError toasts ─────────────────────────────────────────────────

describe("<TestsListPage /> — mutation error branches", () => {
  it("a generic (500) publish error falls through to the toast", async () => {
    installFetch({
      tests: [buildApiTestRow()],
      folders: [],
      overrides: [
        { match: (u, m) => m === "PATCH" && u === "/api/tests/t-1/status", res: okJson({ error: "boom" }, 500) },
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-toggle-publish-t-1"));

    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "PATCH" && c.url === "/api/tests/t-1/status")).toBeTruthy(),
    );
    // The row is unchanged (still shows the publish action next time).
    expect(screen.getByText("Основы информационной безопасности")).toBeInTheDocument();
  });

  it("a 409 that is NOT publish_infeasible falls through to the toast", async () => {
    installFetch({
      tests: [buildApiTestRow()],
      folders: [],
      overrides: [
        {
          match: (u, m) => m === "PATCH" && u === "/api/tests/t-1/status",
          res: okJson({ error: "some_other_conflict" }, 409),
        },
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-toggle-publish-t-1"));

    await waitFor(() =>
      expect(lastCallMatching((c) => c.url === "/api/tests/t-1/status")).toBeTruthy(),
    );
    // No impact dialog for a non-infeasible conflict.
    expect(screen.queryByText(/Тест нельзя опубликовать/i)).toBeNull();
  });

  it("a 409 with a non-JSON body hits the parse catch and toasts", async () => {
    installFetch({
      tests: [buildApiTestRow()],
      folders: [],
      overrides: [
        {
          match: (u, m) => m === "PATCH" && u === "/api/tests/t-1/status",
          res: okJson({}, 409, "not-json"),
        },
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-toggle-publish-t-1"));

    await waitFor(() =>
      expect(lastCallMatching((c) => c.url === "/api/tests/t-1/status")).toBeTruthy(),
    );
    expect(screen.queryByText(/Тест нельзя опубликовать/i)).toBeNull();
  });

  it("a force-republish publish_infeasible 409 surfaces the impact dialog, then «Открыть структуру теста»", async () => {
    installFetch({
      tests: [buildApiTestRow({ status: "published" })],
      folders: [],
      overrides: [
        {
          match: (u, m) => m === "POST" && u === "/api/tests/t-1/republish-force",
          res: okJson({ error: "publish_infeasible", findings: [] }, 409),
        },
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-force-republish-t-1"));
    fireEvent.click(await screen.findByRole("button", { name: /Переопубликовать и прервать/i }));

    await screen.findByText(/Тест нельзя опубликовать/i);
    // onOpenStructure opens the editor Drawer for the offending test.
    fireEvent.click(screen.getByRole("button", { name: "Открыть структуру теста" }));
    await waitFor(() => expect(screen.getByTestId("test-editor-root")).toBeInTheDocument());
  });

  it("a generic force-republish error falls through to the toast", async () => {
    installFetch({
      tests: [buildApiTestRow({ status: "published" })],
      folders: [],
      overrides: [
        {
          match: (u, m) => m === "POST" && u === "/api/tests/t-1/republish-force",
          res: okJson({ error: "boom" }, 500),
        },
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-force-republish-t-1"));
    fireEvent.click(await screen.findByRole("button", { name: /Переопубликовать и прервать/i }));

    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "POST" && c.url === "/api/tests/t-1/republish-force")).toBeTruthy(),
    );
    expect(screen.queryByText(/Тест нельзя опубликовать/i)).toBeNull();
  });
});

// ─── Menu close on Escape / outside click ────────────────────────────────────

describe("<TestsListPage /> — menu dismissal", () => {
  it("closes the open test more-menu on Escape and on an outside click", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("test-more-t-1"));
    expect(screen.getByTestId("menu-edit-t-1")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("menu-edit-t-1")).toBeNull());

    // Re-open, then dismiss via an outside document click.
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    expect(screen.getByTestId("menu-edit-t-1")).toBeInTheDocument();
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByTestId("menu-edit-t-1")).toBeNull());
  });
});

// ─── Row actions: assign + access panel ──────────────────────────────────────

describe("<TestsListPage /> — row actions", () => {
  it("«Назначить» opens the assign dialog", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("test-assign-t-1"));
    expect(await screen.findByText("Управление назначениями")).toBeInTheDocument();
  });

  it("«Общий доступ» opens the access panel for an admin", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-access-t-1"));
    expect(await screen.findByText("Общий доступ")).toBeInTheDocument();
  });
});

// ─── Delete-test typed confirm error + failure catch ─────────────────────────

describe("<TestsListPage /> — delete-test confirm branches", () => {
  it("shows the mismatch error while typing and recovers, then catches a failed DELETE", async () => {
    installFetch({
      tests: [buildApiTestRow()],
      folders: [],
      overrides: [
        { match: (u, m) => m === "DELETE" && u === "/api/tests/t-1", res: okJson({ error: "boom" }, 500) },
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-delete-t-1"));

    // Typing a non-matching value surfaces the inline mismatch error.
    fireEvent.change(screen.getByTestId("delete-test-input"), { target: { value: "wrong" } });
    expect(screen.getByText("Название не совпадает")).toBeInTheDocument();

    // Typing the exact title clears the error and enables the destructive action.
    fireEvent.change(screen.getByTestId("delete-test-input"), {
      target: { value: "Основы информационной безопасности" },
    });
    const confirm = screen.getByTestId("delete-test-confirm");
    expect(confirm).not.toBeDisabled();

    // The DELETE fails → the onDelete catch re-sets the error and keeps the modal.
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "DELETE" && c.url === "/api/tests/t-1")).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText("Название не совпадает")).toBeInTheDocument());
    expect(screen.getByTestId("delete-test-input")).toBeInTheDocument();
  });
});

// ─── Folder-delete destination Select (folder-only) ──────────────────────────

describe("<TestsListPage /> — folder-only delete destination", () => {
  it("picks a destination folder for the moved tests and DELETEs with moveTestsTo", async () => {
    installFetch({
      tests: [buildApiTestRow({ folderId: "f-1" })],
      folders: [buildApiFolder({ id: "f-1", name: "ИБ" }), buildApiFolder({ id: "f-2", name: "Архив" })],
    });
    renderPage();
    await waitFor(() => screen.getByTestId("folder-row-f-1"));
    fireEvent.click(screen.getByTestId("folder-more-f-1"));
    fireEvent.click(screen.getByTestId("folder-menu-delete-f-1"));

    // folder-only mode is the default; pick «Архив» as the move destination.
    const dest = screen.getByTestId("delete-folder-dest");
    fireEvent.click(within(dest).getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "Архив" }));

    fireEvent.click(screen.getByTestId("delete-folder-confirm"));
    await waitFor(() => {
      const c = lastCallMatching((x) => x.method === "DELETE" && x.url === "/api/test-folders/f-1");
      expect(c).toBeTruthy();
      expect((c!.body as { mode: string; moveTestsTo: string }).mode).toBe("folder-only");
      expect((c!.body as { moveTestsTo: string }).moveTestsTo).toBe("f-2");
    });
  });
});

// ─── Move modal «Текущая» label for a test already in a folder ───────────────

describe("<TestsListPage /> — move modal current-folder label", () => {
  it("shows the current folder name in the move modal", async () => {
    installFetch({
      tests: [buildApiTestRow({ folderId: "f-1" })],
      folders: [buildApiFolder({ id: "f-1", name: "ИБ" })],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-move-t-1"));

    expect(await screen.findByText(/Текущая:\s*ИБ/)).toBeInTheDocument();
  });
});
