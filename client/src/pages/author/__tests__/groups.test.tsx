/**
 * @module pages/author/__tests__/groups.test
 * @description Behaviour tests for the author groups-management page. Exercises
 * the searchable groups table, the create/edit dialogs, the delete confirmation,
 * and the members viewer (which lazily fetches group details) against a
 * URL-routed `fetch` stub. Design-system ModalDialog/Menu primitives render via
 * real portals, so assertions target visible text, roles and placeholders (the
 * page ships no data-testids).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "admin1", name: "Admin", roles: ["administrator"] } }),
}));

import GroupsPage from "../groups";

interface MockGroup {
  id: string;
  name: string;
  description: string | null;
  userCount: number;
  createdAt: string;
}

const salesGroup: MockGroup = {
  id: "g1",
  name: "Отдел продаж",
  description: "Менеджеры по продажам",
  userCount: 1,
  createdAt: "2025-12-01T09:00:00Z",
};

const devGroup: MockGroup = {
  id: "g2",
  name: "Разработка",
  description: null,
  userCount: 0,
  createdAt: "2025-12-02T09:00:00Z",
};

const member = {
  id: "m1",
  email: "member@test.dev",
  name: "Участник",
  roles: ["learner"],
  status: "active" as const,
};

/** JSON-ish Response stub honoured by both getQueryFn and the raw mutations. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Mutable list backing the "/api/groups" GET route; reset per test. */
let groupsData: MockGroup[];
let fetchMock: ReturnType<typeof vi.fn>;

/** Install the default URL router; individual tests may re-stub for errors. */
function installDefaultFetch() {
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      if (u === "/api/groups") return jsonResponse(groupsData);
      if (u === "/api/users") return jsonResponse([member]);
      // Group detail fetch (members viewer).
      if (u === "/api/groups/g1") return jsonResponse({ ...salesGroup, users: [member] });
      return jsonResponse([]);
    }
    // Any create/update/delete/add/remove mutation resolves ok.
    return jsonResponse({ id: "ok" });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  groupsData = [salesGroup, devGroup];
  installDefaultFetch();
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GroupsPage />
    </QueryClientProvider>,
  );
}

describe("<GroupsPage />", () => {
  it("renders the groups table with names, descriptions and member counts", async () => {
    renderPage();
    await screen.findByText("Отдел продаж");
    expect(screen.getByText("Менеджеры по продажам")).toBeInTheDocument();
    expect(screen.getByText("Разработка")).toBeInTheDocument();
    expect(screen.getByText("1 чел.")).toBeInTheDocument();
  });

  it("opens the create-group dialog", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать группу" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Создать группу" })).toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("Например: Отдел продаж")).toBeInTheDocument();
  });

  it("fills and submits the create-group dialog (POST /api/groups)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать группу" }));
    const nameInput = await screen.findByPlaceholderText("Например: Отдел продаж");
    fireEvent.change(nameInput, { target: { value: "Новая группа" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/groups",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("opens the edit dialog prefilled from the selected row", async () => {
    renderPage();
    await screen.findByText("Отдел продаж");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Редактировать" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Редактировать группу" })).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Отдел продаж")).toBeInTheDocument();
  });

  it("saves an edited group (PUT /api/groups/:id)", async () => {
    renderPage();
    await screen.findByText("Отдел продаж");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Редактировать" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/groups/g1",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("deletes a group through the confirm dialog (DELETE /api/groups/:id)", async () => {
    renderPage();
    await screen.findByText("Отдел продаж");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Удалить" }));
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/groups/g1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("opens the members viewer and lists the fetched members", async () => {
    renderPage();
    await screen.findByText("Отдел продаж");
    // The member-count tag opens the viewer, which fetches GET /api/groups/g1.
    fireEvent.click(screen.getByText("1 чел."));
    expect(await screen.findByText("member@test.dev")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1", expect.anything()),
    );
  });

  it("shows the empty state when no groups exist", async () => {
    groupsData = [];
    renderPage();
    expect(await screen.findByText("Групп пока нет")).toBeInTheDocument();
  });

  it("degrades to the empty state when the groups query fails", async () => {
    // Re-stub so the list query resolves not-ok. The page has no dedicated error
    // UI, so the query error surfaces as the default empty list.
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const method = (options?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(url) === "/api/groups") {
        return jsonResponse({ error: "boom" }, false, 500);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    expect(await screen.findByText("Групп пока нет")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать группу" })).toBeInTheDocument();
  });
});
