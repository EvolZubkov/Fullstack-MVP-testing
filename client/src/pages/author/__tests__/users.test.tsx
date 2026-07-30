/**
 * @module pages/author/__tests__/users.test
 * @description Smoke/behaviour tests for the author user-management page
 * (PRD-13). Exercises the searchable user table, the create/edit drawers, and
 * the row action menu (edit / reset password / deactivate / activate) against a
 * URL-routed `fetch` stub. Auth is mocked to an administrator so the role picker
 * and every action are available. The design-system Drawer/ModalDialog/Menu
 * primitives render through real portals, so assertions target visible text,
 * roles and placeholders (the page ships no data-testids).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "admin1", name: "Admin", roles: ["administrator"] } }),
}));

import UsersPage from "../users";

interface MockUser {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  status: "pending" | "active" | "inactive";
  mustChangePassword: boolean;
  gdprConsent: boolean;
  lastLoginAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const adminUser: MockUser = {
  id: "u-admin",
  email: "admin@test.dev",
  name: "Админ Тест",
  roles: ["administrator"],
  status: "active",
  mustChangePassword: false,
  gdprConsent: true,
  lastLoginAt: "2026-01-01T10:00:00Z",
  expiresAt: null,
  createdAt: "2025-12-01T09:00:00Z",
};

const learnerUser: MockUser = {
  id: "u-learn",
  email: "learner@test.dev",
  name: "Ученик",
  roles: ["learner"],
  status: "inactive",
  mustChangePassword: true,
  gdprConsent: true,
  lastLoginAt: null,
  expiresAt: null,
  createdAt: "2025-12-02T09:00:00Z",
};

/** Never signed in — the only state an invitation letter makes sense for. */
const pendingUser: MockUser = {
  id: "u-pend",
  email: "pending@test.dev",
  name: "Новичок",
  roles: ["learner"],
  status: "pending",
  mustChangePassword: true,
  gdprConsent: false,
  lastLoginAt: null,
  expiresAt: null,
  createdAt: "2025-12-03T09:00:00Z",
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

/** Mutable list backing the "/api/users" GET route; reset per test. */
let usersData: MockUser[];
let fetchMock: ReturnType<typeof vi.fn>;

/** Install the default URL router; individual tests may re-stub for errors. */
function installDefaultFetch() {
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      if (u === "/api/users") return jsonResponse(usersData);
      if (u.includes("attempts-summary")) return jsonResponse([]);
      return jsonResponse([]);
    }
    // Any create/update/deactivate/activate/reset mutation resolves ok.
    return jsonResponse({ id: "ok" });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  usersData = [adminUser, learnerUser, pendingUser];
  installDefaultFetch();
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

describe("<UsersPage />", () => {
  it("renders the user table with emails, names and role/status badges", async () => {
    renderPage();
    await screen.findByText("admin@test.dev");
    expect(screen.getByText("Админ Тест")).toBeInTheDocument();
    expect(screen.getByText("learner@test.dev")).toBeInTheDocument();
    // Role labels from ROLE_LABELS and the localized status tag.
    expect(screen.getByText("Администратор")).toBeInTheDocument();
    expect(screen.getByText("Активен")).toBeInTheDocument();
  });

  it("opens the create-user drawer", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать пользователя" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Создать пользователя" })).toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("user@example.com")).toBeInTheDocument();
  });

  it("fills and submits the create-user drawer (POST /api/users)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать пользователя" }));
    const email = await screen.findByPlaceholderText("user@example.com");
    fireEvent.change(email, { target: { value: "new@test.dev" } });
    fireEvent.change(screen.getByPlaceholderText("Минимум 8 символов"), {
      target: { value: "Passw0rd!42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("opens the edit drawer prefilled from the selected row", async () => {
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Редактировать" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Редактировать пользователя" })).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("admin@test.dev")).toBeInTheDocument();
  });

  it("saves an edited user (PUT /api/users/:id and .../roles)", async () => {
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Редактировать" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-admin",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-admin/roles",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("deactivates an active user through the confirm dialog (POST .../deactivate)", async () => {
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Заблокировать" }));
    // Confirm dialog footer button.
    fireEvent.click(await screen.findByRole("button", { name: "Заблокировать" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-admin/deactivate",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("activates an inactive user directly from the menu (POST .../activate)", async () => {
    renderPage();
    await screen.findByText("learner@test.dev");
    // The learner row is the second action menu (inactive → shows «Активировать»).
    fireEvent.click(screen.getAllByLabelText("Действия")[1]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Активировать" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-learn/activate",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("resets a user's password from the reset dialog (POST .../reset-password)", async () => {
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Сбросить пароль" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сбросить пароль" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-admin/reset-password",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("re-sends the invitation for a pending user (POST .../invite)", async () => {
    renderPage();
    await screen.findByText("pending@test.dev");
    // Third row — the account still awaiting its first sign-in.
    fireEvent.click(screen.getAllByLabelText("Действия")[2]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Отправить приглашение" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-pend/invite",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("offers no invitation for an account that has already signed in", async () => {
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    await screen.findByRole("menuitem", { name: "Редактировать" });
    expect(screen.queryByRole("menuitem", { name: "Отправить приглашение" })).toBeNull();
  });

  it("shows the empty state when no users exist", async () => {
    usersData = [];
    renderPage();
    expect(await screen.findByText("Пользователей пока нет")).toBeInTheDocument();
  });

  it("degrades to the empty state when the users query fails", async () => {
    // Re-stub fetch so the list query resolves not-ok (the page has no dedicated
    // error UI, so the query error surfaces as the default empty list).
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const method = (options?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(url) === "/api/users") {
        return jsonResponse({ error: "boom" }, false, 500);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    expect(await screen.findByText("Пользователей пока нет")).toBeInTheDocument();
    // Header action still renders — the page did not crash.
    expect(screen.getByRole("button", { name: "Создать пользователя" })).toBeInTheDocument();
  });
});
