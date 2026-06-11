/**
 * @module features/tests/list/__tests__/tests-list.test
 * @description Component tests for the explorer-tree tests list page.
 *
 * Coverage:
 *   - Tree renders root row + test row from API list (s-default).
 *   - Search switches to flat list with banner (s-search) and "Сбросить" clears it.
 *   - Test more-menu opens with the expected items.
 *   - FR-30: typed-confirm — Delete button stays disabled until the input
 *     matches the test title exactly.
 *   - FAB speed-dial toggles + sub-actions render.
 *   - Empty state shown when there are no tests and no folders.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getPermissions, ROLES, type Capability } from "@shared/access";
import { TestsListPage } from "../tests-list";

// The list reads capabilities to gate row actions (PRD-13). Stub the auth
// context so the component renders without an AuthProvider; `authMock.can` is
// mutable so individual tests can simulate a role. Reset to "all true" in
// beforeEach so the rest of the suite keeps every action visible.
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

/** Build a `can` that mirrors the real role -> permission map for the role set. */
function canForRoles(roles: Parameters<typeof getPermissions>[0]): (cap: string) => boolean {
  const perms = getPermissions(roles);
  return (cap: string) => perms.has(cap as Capability);
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

function buildApiTestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    title: "Основы информационной безопасности",
    description: null,
    status: "draft",
    mode: "standard",
    folderId: null,
    overallPassRuleJson: { type: "percent", value: 70 },
    flowPolicyJson: null,
    feedbackJson: null,
    webhookUrl: null,
    telemetryEnabled: false,
    timeLimitMinutes: null,
    maxAttempts: null,
    showCorrectAnswers: false,
    showDifficultyLevel: true,
    version: 1,
    createdAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-01T10:00:00Z",
    designSettingsJson: {},
    sections: [
      { id: "s-1", testId: "t-1", topicId: "t1", drawCount: 5, required: true, topicName: "Topic", maxQuestions: 10 },
    ],
    ...overrides,
  };
}

function buildApiFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: "f-1",
    name: "Информационная безопасность",
    parentId: null,
    createdAt: "2026-05-01T10:00:00Z",
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom doesn't ship localStorage with persistence across tests; reset.
  window.localStorage.clear();
  // Default: every capability granted (admin-like) so unrelated tests are unaffected.
  authMock.can = () => true;
  authMock.roles = [ROLES.ADMINISTRATOR];
  authMock.userId = "current-user";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockGet(url: string, body: unknown) {
  fetchMock.mockImplementation(async (input: RequestInfo) => {
    const u = typeof input === "string" ? input : input.url;
    if (u.startsWith(url) || u === url) {
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
  });
}

function mockMany(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input: RequestInfo) => {
    const u = typeof input === "string" ? input : input.url;
    for (const [path, body] of Object.entries(routes)) {
      if (u === path || u.startsWith(path + "?")) {
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TestsListPage />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<TestsListPage /> — default tree", () => {
  it("renders root + test row from the API list", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow()],
      "/api/test-folders": [],
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("tests-list-tree")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText("Основы информационной безопасности")).toBeInTheDocument(),
    );
    expect(screen.getByText(/ВСЕ ТЕСТЫ/i)).toBeInTheDocument();
    expect(screen.getByTestId("test-row-t-1")).toBeInTheDocument();
  });

  it("renders folder row when folders exist", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow({ folderId: "f-1" })],
      "/api/test-folders": [buildApiFolder()],
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("folder-row-f-1")).toBeInTheDocument());
  });
});

describe("<TestsListPage /> — search", () => {
  it("switches to flat list with banner when query is entered", async () => {
    mockMany({
      "/api/tests": [
        buildApiTestRow({ id: "t-1", title: "Основы информационной безопасности" }),
        buildApiTestRow({ id: "t-2", title: "GDPR для разработчиков" }),
      ],
      "/api/test-folders": [],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("Основы информационной безопасности")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("tests-list-search-input"), { target: { value: "GDPR" } });

    await waitFor(() => expect(screen.getByTestId("tests-list-search")).toBeInTheDocument());
    expect(screen.getByText(/Результаты поиска по/i)).toBeInTheDocument();
    expect(screen.queryByText("Основы информационной безопасности")).toBeNull();
    expect(screen.getByText("GDPR для разработчиков")).toBeInTheDocument();
  });

  it("Сбросить clears the search", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow()],
      "/api/test-folders": [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.change(screen.getByTestId("tests-list-search-input"), { target: { value: "anything" } });
    await waitFor(() => screen.getByTestId("tests-list-search-clear"));
    fireEvent.click(screen.getByTestId("tests-list-search-clear"));

    await waitFor(() => expect(screen.getByTestId("tests-list-tree")).toBeInTheDocument());
  });
});

describe("<TestsListPage /> — test more-menu", () => {
  it("opens with all required items", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow()],
      "/api/test-folders": [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("test-more-t-1"));

    expect(screen.getByTestId("menu-edit-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("menu-export-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("menu-toggle-publish-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("menu-move-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("menu-archive-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("menu-delete-t-1")).toBeInTheDocument();
  });

  it("publish menu item label depends on status", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow({ status: "published" })],
      "/api/test-folders": [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("test-more-t-1"));
    expect(screen.getByText("Снять с публикации")).toBeInTheDocument();
  });
});

describe("<TestsListPage /> — owner column + action gating by role (PRD-13)", () => {
  it("AC-30: shows the owner name in the «Владелец» column", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow({ ownerName: "Марина Иванова" })],
      "/api/test-folders": [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));
    expect(screen.getByText("Марина Иванова")).toBeInTheDocument();
  });

  it("an author sees edit, analytics and the more-menu, but not assign", async () => {
    authMock.can = canForRoles([ROLES.AUTHOR]);
    mockMany({ "/api/tests": [buildApiTestRow()], "/api/test-folders": [] });
    renderPage();
    await waitFor(() => screen.getByTestId("test-row-t-1"));
    expect(screen.getByTestId("test-edit-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("test-analytics-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("test-more-t-1")).toBeInTheDocument();
    expect(screen.queryByTestId("test-assign-t-1")).toBeNull();
  });

  it("a manager sees assign and analytics, but not edit or the more-menu", async () => {
    authMock.can = canForRoles([ROLES.MANAGER]);
    mockMany({ "/api/tests": [buildApiTestRow()], "/api/test-folders": [] });
    renderPage();
    await waitFor(() => screen.getByTestId("test-row-t-1"));
    expect(screen.getByTestId("test-assign-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("test-analytics-t-1")).toBeInTheDocument();
    expect(screen.queryByTestId("test-edit-t-1")).toBeNull();
    expect(screen.queryByTestId("test-more-t-1")).toBeNull();
  });

  it("«Общий доступ» shows for the test owner (author, BRC-27)", async () => {
    authMock.can = canForRoles([ROLES.AUTHOR]);
    authMock.roles = [ROLES.AUTHOR];
    authMock.userId = "current-user";
    mockMany({ "/api/tests": [buildApiTestRow({ ownerId: "current-user" })], "/api/test-folders": [] });
    renderPage();
    await waitFor(() => screen.getByTestId("test-row-t-1"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    expect(screen.getByTestId("menu-access-t-1")).toBeInTheDocument();
  });

  it("«Общий доступ» is hidden for a non-owner author (object scope, BRC-27)", async () => {
    authMock.can = canForRoles([ROLES.AUTHOR]);
    authMock.roles = [ROLES.AUTHOR];
    authMock.userId = "current-user";
    mockMany({ "/api/tests": [buildApiTestRow({ ownerId: "someone-else" })], "/api/test-folders": [] });
    renderPage();
    await waitFor(() => screen.getByTestId("test-row-t-1"));
    fireEvent.click(screen.getByTestId("test-more-t-1"));
    expect(screen.getByTestId("menu-edit-t-1")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-access-t-1")).toBeNull();
  });
});

describe("<TestsListPage /> — move-to-folder (S13.1-G32)", () => {
  it("opens MoveFolderPickModal instead of window.prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    mockMany({
      "/api/tests": [buildApiTestRow()],
      "/api/test-folders": [buildApiFolder({ id: "f-1", name: "ИБ" })],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-move-t-1"));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("move-folder-pick-root")).toBeInTheDocument();
    // Root pre-selected (test.folderId === null) and submit disabled (no change).
    expect(
      (screen.getByTestId("move-folder-pick-root") as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByTestId("move-folder-pick-submit")).toBeDisabled();

    // Pick a different folder — submit enables.
    fireEvent.click(screen.getByTestId("move-folder-pick-folder-f-1"));
    expect(screen.getByTestId("move-folder-pick-submit")).not.toBeDisabled();

    promptSpy.mockRestore();
  });
});

describe("<TestsListPage /> — delete confirm (FR-30)", () => {
  it("blocks Delete until input matches the title exactly", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow()],
      "/api/test-folders": [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    fireEvent.click(screen.getByTestId("test-more-t-1"));
    fireEvent.click(screen.getByTestId("menu-delete-t-1"));

    const confirmBtn = screen.getByTestId("delete-test-confirm") as HTMLButtonElement;
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("delete-test-input"), { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("delete-test-input"), {
      target: { value: "Основы информационной безопасности" },
    });
    expect(confirmBtn).not.toBeDisabled();
  });
});

describe("<TestsListPage /> — FAB", () => {
  it("toggles speed-dial and shows new-test / new-folder actions", async () => {
    mockMany({
      "/api/tests": [buildApiTestRow()],
      "/api/test-folders": [],
    });
    renderPage();
    await waitFor(() => screen.getByText("Основы информационной безопасности"));

    expect(screen.queryByTestId("fab-new-test")).toBeNull();
    expect(screen.queryByTestId("fab-new-folder")).toBeNull();

    fireEvent.click(screen.getByTestId("fab-toggle"));
    expect(screen.getByTestId("fab-new-test")).toBeInTheDocument();
    expect(screen.getByTestId("fab-new-folder")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("fab-toggle"));
    expect(screen.queryByTestId("fab-new-test")).toBeNull();
  });
});

describe("<TestsListPage /> — empty state", () => {
  it("shows empty pane with two CTAs when no data", async () => {
    mockMany({
      "/api/tests": [],
      "/api/test-folders": [],
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("tests-list-empty")).toBeInTheDocument());
    expect(screen.getByTestId("tests-list-empty-new-folder")).toBeInTheDocument();
    expect(screen.getByTestId("tests-list-empty-new-test")).toBeInTheDocument();
  });
});
