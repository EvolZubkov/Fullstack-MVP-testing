/**
 * @module features/tests/list/__tests__/tests-list.coverage.test
 * @description Coverage-focused component tests for the explorer-tree tests
 * list page. Complements {@link tests-list.test} by exercising the row / folder
 * more-menu ACTIONS (edit / debug / export / publish-toggle / archive /
 * republish / force-republish / move / delete), the folder menu (rename /
 * delete both modes), the toolbar (sort, filter facets + chips), pseudo-states
 * (loading / error + retry), the FAB create flows and the `?edit=` deep-link.
 *
 * Harness copied from {@link tests-list.test}: the auth context is stubbed with
 * a mutable `authMock`, `fetch` is stubbed globally, and the page is rendered
 * inside a throwaway QueryClient.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ROLES } from "@shared/access";
import { TestsListPage } from "../tests-list";

// The list reads capabilities to gate row actions (PRD-13). Stub the auth
// context so the component renders without an AuthProvider; every capability is
// granted (admin-like) so all actions are visible.
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

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/**
 * Installs a fetch stub that answers the two GET list endpoints with the given
 * fixtures and every other request (all mutations) with a generic 200. The
 * optional `overrides` map lets a test force a specific response for a
 * `METHOD url-prefix` key (matched by prefix), e.g. an error branch.
 */
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
    // Any other GET under /api/tests/:id (editor deep-link, etc.) — return an
    // array shape which the editor mapper rejects (draft stays null); harmless.
    if (method === "GET") return okJson(tests);
    // Mutations: generic OK. `republish-force` reads `.annulledAttempts`.
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

// ─── Pseudo-states ────────────────────────────────────────────────────────────

describe("<TestsListPage /> — pseudo-states", () => {
  it("renders the loading skeleton while the tests query is in flight", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.startsWith("/api/test-folders")) return okJson([]);
      // /api/tests never resolves → the query stays in `isLoading`.
      return new Promise<Response>(() => {});
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("tests-list-loading")).toBeInTheDocument());
  });

  it("renders the error pane and recovers on «Повторить»", async () => {
    let fail = true;
    installFetch({
      tests: [buildApiTestRow()],
      folders: [],
      overrides: [
        { match: (u, m) => m === "GET" && (u === "/api/tests" || u.startsWith("/api/tests?")), res: undefined as unknown as Response },
      ],
    });
    // Override the /api/tests GET dynamically so retry can flip to success.
    fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: undefined });
      if (method === "GET" && url.startsWith("/api/test-folders")) return okJson([]);
      if (method === "GET" && (url === "/api/tests" || url.startsWith("/api/tests?"))) {
        return fail ? okJson({}, 500) : okJson([buildApiTestRow()]);
      }
      return okJson([]);
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("tests-list-error")).toBeInTheDocument());

    fail = false;
    fireEvent.click(screen.getByTestId("tests-list-error-retry"));
    await waitFor(() => expect(screen.getByText("Основы информационной безопасности")).toBeInTheDocument());
  });
});

// ─── Toolbar: sort + filters ────────────────────────────────────────────────

describe("<TestsListPage /> — toolbar sort + filters", () => {
  it("changing the sort Select persists the choice to localStorage", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    // Open the DS Select and pick another option.
    const sort = screen.getByTestId("tests-list-sort");
    fireEvent.click(within(sort).getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "По названию (А→Я)" }));

    expect(window.localStorage.getItem("tests_sort")).toBe("title_asc");
  });

  it("applies a status facet → shows a chip, removes it, then clears all", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("tests-list-filter"));
    fireEvent.click(screen.getByLabelText("Черновик"));
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));

    // Applied filter surfaces a condition chip.
    const chip = await screen.findByText(/Статус: Черновик/i);
    expect(chip).toBeInTheDocument();

    // Remove the single chip (commitFilter path).
    fireEvent.click(screen.getByLabelText("Удалить"));
    await waitFor(() => expect(screen.queryByText(/Статус: Черновик/i)).toBeNull());

    // Re-apply, then clear everything via «Очистить всё».
    fireEvent.click(screen.getByTestId("tests-list-filter"));
    fireEvent.click(screen.getByLabelText("Черновик"));
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    await screen.findByText(/Статус: Черновик/i);
    fireEvent.click(screen.getByRole("button", { name: "Очистить всё" }));
    await waitFor(() => expect(screen.queryByText(/Статус: Черновик/i)).toBeNull());
  });
});

// ─── Tree: folders, flow chips, adaptive badge ─────────────────────────────

describe("<TestsListPage /> — tree rendering", () => {
  it("toggles a folder collapsed and expanded", async () => {
    installFetch({
      tests: [buildApiTestRow({ folderId: "f-1" })],
      folders: [buildApiFolder()],
    });
    renderPage();
    const folderRow = await screen.findByTestId("folder-row-f-1");
    expect(folderRow.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(folderRow);
    await waitFor(() => expect(screen.getByTestId("folder-row-f-1").getAttribute("aria-expanded")).toBe("false"));
    fireEvent.click(screen.getByTestId("folder-row-f-1"));
    await waitFor(() => expect(screen.getByTestId("folder-row-f-1").getAttribute("aria-expanded")).toBe("true"));
  });

  it("renders router / by-topics flow chips and the adaptive mode badge", async () => {
    installFetch({
      tests: [
        buildApiTestRow({ id: "t-1", title: "Первый", flowPolicyJson: { mode: "router_by_topics" } }),
        buildApiTestRow({ id: "t-2", title: "Второй", flowPolicyJson: { mode: "linear_by_topics" } }),
        buildApiTestRow({ id: "t-3", title: "Третий", mode: "adaptive" }),
      ],
      folders: [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Первый"));
    expect(screen.getByText("Роутер")).toBeInTheDocument();
    expect(screen.getByText("По темам")).toBeInTheDocument();
    expect(screen.getByText("Адаптив")).toBeInTheDocument();
  });
});

// ─── Test more-menu actions ───────────────────────────────────────────────

describe("<TestsListPage /> — test more-menu actions", () => {
  function openMenu() {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    return waitFor(() => screen.getByText("Основы информационной безопасности")).then(() => {
      fireEvent.click(screen.getByTestId("test-more-t-1"));
    });
  }

  it("«Выполнить отладку» opens the debug player window", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await openMenu();
    fireEvent.click(screen.getByTestId("menu-debug-t-1"));
    expect(openSpy).toHaveBeenCalledWith(
      "/author/tests/t-1/debug",
      "tb-debug-t-1",
      expect.stringContaining("popup=yes"),
    );
    openSpy.mockRestore();
  });

  it("exposes SCORM + Excel export links", async () => {
    await openMenu();
    expect(screen.getByTestId("menu-export-t-1").getAttribute("href")).toBe("/api/tests/t-1/export/scorm");
    expect(screen.getByTestId("menu-export-excel-t-1").getAttribute("href")).toBe("/api/tests/t-1/workbook/export");
    // Clicking closes the menu (onClick handler).
    fireEvent.click(screen.getByTestId("menu-export-excel-t-1"));
  });

  it("«Опубликовать» fires a status PATCH", async () => {
    await openMenu();
    fireEvent.click(screen.getByTestId("menu-toggle-publish-t-1"));
    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "PATCH" && c.url === "/api/tests/t-1/status")).toBeTruthy(),
    );
    expect(lastCallMatching((c) => c.url === "/api/tests/t-1/status")?.body).toEqual({ status: "published" });
  });

  it("«Архивировать» fires an archive status PATCH", async () => {
    await openMenu();
    fireEvent.click(screen.getByTestId("menu-archive-t-1"));
    await waitFor(() =>
      expect(lastCallMatching((c) => c.url === "/api/tests/t-1/status")?.body).toEqual({ status: "archived" }),
    );
  });

  it("a publish_infeasible 409 surfaces the impact dialog", async () => {
    installFetch({
      tests: [buildApiTestRow()],
      folders: [],
      overrides: [
        {
          match: (u, m) => m === "PATCH" && u === "/api/tests/t-1/status",
          res: okJson({}, 200), // placeholder; replaced below
        },
      ],
    });
    // Replace the status PATCH with a 409 whose text is the infeasible payload.
    fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: undefined });
      if (method === "GET" && url.startsWith("/api/test-folders")) return okJson([]);
      if (method === "GET" && url.startsWith("/api/tests")) return okJson([buildApiTestRow()]);
      if (method === "PATCH" && url === "/api/tests/t-1/status") {
        return { ok: false, status: 409, statusText: "", json: async () => ({}), text: async () => JSON.stringify({ error: "publish_infeasible", findings: [] }) } as Response;
      }
      return okJson({});
    });

    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-toggle-publish-t-1"));

    await waitFor(() =>
      expect(screen.getByText(/Тест нельзя опубликовать/i)).toBeInTheDocument(),
    );
  });

  it("«Опубликовать изменения» shows for published_with_changes and fires a publish PATCH", async () => {
    installFetch({
      tests: [buildApiTestRow({ status: "published", publication: { state: "published_with_changes" } })],
      folders: [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    expect(screen.getByText("Есть изменения")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-republish-t-1"));
    await waitFor(() =>
      expect(lastCallMatching((c) => c.url === "/api/tests/t-1/status")?.body).toEqual({ status: "published" }),
    );
  });

  it("«Экстренная переопубликация» confirms and fires a republish-force POST", async () => {
    installFetch({ tests: [buildApiTestRow({ status: "published" })], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-force-republish-t-1"));

    // Confirmation dialog with the destructive primary action.
    const confirm = await screen.findByRole("button", { name: /Переопубликовать и прервать/i });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "POST" && c.url === "/api/tests/t-1/republish-force")).toBeTruthy(),
    );
  });

  it("«Переместить в папку» picks a folder and fires the move PATCH", async () => {
    installFetch({
      tests: [buildApiTestRow()],
      folders: [buildApiFolder({ id: "f-1", name: "ИБ" })],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-move-t-1"));

    // Root is pre-selected (test.folderId === null) → submit disabled.
    expect(screen.getByTestId("move-folder-pick-submit")).toBeDisabled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Корень (без папки)"));
    const pop = document.querySelector(".tb-foldercombo__pop");
    expect(pop).not.toBeNull();
    fireEvent.click(within(pop as HTMLElement).getByText("ИБ"));
    fireEvent.click(screen.getByTestId("move-folder-pick-submit"));

    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "PATCH" && c.url === "/api/test-folders/move/t-1")).toBeTruthy(),
    );
  });

  it("«Удалить тест» fires a DELETE after the typed confirmation matches", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-delete-t-1"));

    fireEvent.change(screen.getByTestId("delete-test-input"), {
      target: { value: "Основы информационной безопасности" },
    });
    fireEvent.click(screen.getByTestId("delete-test-confirm"));

    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "DELETE" && c.url === "/api/tests/t-1")).toBeTruthy(),
    );
  });
});

// ─── Search-mode more-menu ────────────────────────────────────────────────

describe("<TestsListPage /> — search-mode more-menu", () => {
  it("opens a test more-menu from the flat search results", async () => {
    installFetch({
      tests: [buildApiTestRow({ id: "t-9", title: "GDPR для разработчиков" })],
      folders: [],
    });
    renderPage();
    await waitFor(() => screen.getByText("GDPR для разработчиков"));

    fireEvent.change(screen.getByTestId("tests-list-search-input"), { target: { value: "GDPR" } });
    await waitFor(() => expect(screen.getByTestId("tests-list-search")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("test-more-t-9"));
    expect(screen.getByTestId("menu-edit-t-9")).toBeInTheDocument();
    // Editing from the menu opens the editor Drawer.
    fireEvent.click(screen.getByTestId("menu-edit-t-9"));
    await waitFor(() => expect(screen.getByTestId("test-editor-root")).toBeInTheDocument());
  });
});

// ─── Folder more-menu ──────────────────────────────────────────────────────

describe("<TestsListPage /> — folder more-menu", () => {
  async function openFolderMenu(testsInFolder = 1) {
    installFetch({
      tests: testsInFolder > 0 ? [buildApiTestRow({ folderId: "f-1" })] : [],
      folders: [buildApiFolder()],
    });
    renderPage();
    await waitFor(() => screen.getByTestId("folder-row-f-1"));
    fireEvent.click(screen.getByTestId("folder-more-f-1"));
  }

  it("«Переименовать» fires a folder PUT", async () => {
    await openFolderMenu();
    fireEvent.click(screen.getByTestId("folder-menu-rename-f-1"));
    fireEvent.change(screen.getByTestId("rename-folder-input"), { target: { value: "ИБ 2.0" } });
    fireEvent.click(screen.getByTestId("rename-folder-submit"));
    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "PUT" && c.url === "/api/test-folders/f-1")?.body).toEqual({ name: "ИБ 2.0" }),
    );
  });

  it("folder-only delete fires a DELETE with mode folder-only", async () => {
    await openFolderMenu();
    fireEvent.click(screen.getByTestId("folder-menu-delete-f-1"));
    fireEvent.click(screen.getByTestId("delete-folder-confirm"));
    await waitFor(() => {
      const c = lastCallMatching((x) => x.method === "DELETE" && x.url === "/api/test-folders/f-1");
      expect(c).toBeTruthy();
      expect((c!.body as { mode: string }).mode).toBe("folder-only");
    });
  });

  it("cascade delete requires the typed name then fires DELETE with mode folder-and-tests", async () => {
    await openFolderMenu();
    fireEvent.click(screen.getByTestId("folder-menu-delete-f-1"));
    // Switch to the destructive «Папку и все тесты» mode.
    fireEvent.click(screen.getByTestId("delete-folder-mode-cascade"));
    // Confirm stays disabled until the name matches.
    expect(screen.getByTestId("delete-folder-confirm")).toBeDisabled();
    fireEvent.change(screen.getByTestId("delete-folder-confirm-input"), { target: { value: "ИБ" } });
    fireEvent.click(screen.getByTestId("delete-folder-confirm"));
    await waitFor(() => {
      const c = lastCallMatching((x) => x.method === "DELETE" && x.url === "/api/test-folders/f-1");
      expect(c).toBeTruthy();
      expect((c!.body as { mode: string }).mode).toBe("folder-and-tests");
    });
  });
});

// ─── FAB create flows ──────────────────────────────────────────────────────

describe("<TestsListPage /> — FAB create flows", () => {
  it("«Новый тест» picks a folder then opens the editor in create mode", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("fab-toggle"));
    fireEvent.click(screen.getByTestId("fab-new-test"));
    fireEvent.click(screen.getByTestId("fab-pick-create"));

    await waitFor(() => expect(screen.getByTestId("test-editor-root")).toBeInTheDocument());
    expect(screen.getByText("Новый тест")).toBeInTheDocument();
  });

  it("«Добавить папку» submits a create-folder POST", async () => {
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("fab-toggle"));
    fireEvent.click(screen.getByTestId("fab-new-folder"));
    fireEvent.change(screen.getByTestId("new-folder-input"), { target: { value: "Новая папка" } });
    fireEvent.click(screen.getByTestId("new-folder-submit"));

    await waitFor(() =>
      expect(lastCallMatching((c) => c.method === "POST" && c.url === "/api/test-folders")?.body).toEqual({ name: "Новая папка", parentId: null }),
    );
  });
});

// ─── Deep-link ────────────────────────────────────────────────────────────

describe("<TestsListPage /> — ?edit deep-link (PRD-18 FR-16)", () => {
  it("opens the editor Drawer for the linked test and strips the param", async () => {
    window.history.replaceState(null, "", "/?edit=t-1");
    installFetch({ tests: [buildApiTestRow()], folders: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("test-editor-root")).toBeInTheDocument());
    expect(window.location.search).toBe("");
  });
});
