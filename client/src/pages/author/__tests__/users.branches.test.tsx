/**
 * @module pages/author/__tests__/users.branches.test
 * @description Branch-coverage companion to `users.test.tsx`. Targets the paths
 * the smoke suite leaves untouched: the bulk CSV/Excel import wizard
 * (upload -> preview -> done, including the preview-table renderers, the
 * duplicate-action select and the drag-and-drop zone), the reset-attempts
 * dialog (empty state, populated list, reset), the `pending` status badge and
 * empty-role dash, and every mutation `onError` toast (create/update/roles,
 * deactivate, activate, reset-password, bulk preview/import). `useToast` is
 * mocked so error/success toasts can be asserted without mounting a provider;
 * auth is an administrator so every action is available.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "admin1", name: "Admin", roles: ["administrator"] } }),
}));

// Capture toast calls so success/error branches are observable without a
// mounted <ToastProvider> (the real hook is a silent no-op in that case).
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn() }),
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
  id: "u-admin", email: "admin@test.dev", name: "Админ Тест", roles: ["administrator"],
  status: "active", mustChangePassword: false, gdprConsent: true,
  lastLoginAt: "2026-01-01T10:00:00Z", expiresAt: null, createdAt: "2025-12-01T09:00:00Z",
};
const learnerUser: MockUser = {
  id: "u-learn", email: "learner@test.dev", name: "Ученик", roles: ["learner"],
  status: "inactive", mustChangePassword: true, gdprConsent: true,
  lastLoginAt: null, expiresAt: null, createdAt: "2025-12-02T09:00:00Z",
};
const pendingUser: MockUser = {
  id: "u-pend", email: "pending@test.dev", name: null, roles: [],
  status: "pending", mustChangePassword: true, gdprConsent: false,
  lastLoginAt: null, expiresAt: null, createdAt: "2025-12-03T09:00:00Z",
};

/** Preview rows spanning every group/status/action render branch. */
const previewRowsFixture = [
  { idx: 0, email: "a@x.dev", name: "Alice", role: "learner", groupName: "Группа A", groupId: "g1", groupFound: true, status: "new" as const },
  { idx: 1, email: "b@x.dev", name: null, role: "author", groupName: "Группа X", groupId: null, groupFound: false, status: "duplicate" as const, existingId: "u-admin" },
  { idx: 2, email: "bad", name: null, role: "learner", groupName: null, groupId: null, groupFound: false, status: "error" as const, error: "Некорректный email" },
];

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let usersData: MockUser[];
let attemptsSummary: unknown[];
let bulkPreviewRows: unknown[];
let bulkImportResult: unknown;
let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Install the URL router. `custom` may short-circuit specific routes (to force
 * error responses); returning `undefined` falls through to the happy defaults.
 */
function installFetch(
  custom?: (url: string, method: string, options?: RequestInit) => Promise<Response | undefined>,
) {
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (custom) {
      const r = await custom(u, method, options);
      if (r) return r;
    }
    if (method === "GET") {
      if (u === "/api/users") return jsonResponse(usersData);
      if (u.includes("attempts-summary")) return jsonResponse(attemptsSummary);
      return jsonResponse([]);
    }
    if (u.includes("bulk-preview")) return jsonResponse(bulkPreviewRows);
    if (u.includes("bulk-import")) return jsonResponse(bulkImportResult);
    return jsonResponse({ id: "ok" });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  toastSpy.mockClear();
  usersData = [adminUser, learnerUser];
  attemptsSummary = [];
  bulkPreviewRows = previewRowsFixture;
  bulkImportResult = { created: 3, updated: 2, skipped: 1, invitesSent: 4, errors: [] };
  installFetch();
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

/** Open the bulk-import dialog and drive it to the preview step via the file input. */
async function openBulkPreview() {
  fireEvent.click(await screen.findByRole("button", { name: "Загрузить CSV" }));
  const input = await screen.findByLabelText("Файл для импорта пользователей");
  const file = new File(["email\na@x.dev"], "users.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText("Новых: 1");
}

// ─── Status badge + role rendering ─────────────────────────────────────────────

describe("<UsersPage /> — badges", () => {
  it("renders the pending status tag and an em-dash for empty roles", async () => {
    usersData = [pendingUser];
    renderPage();
    await screen.findByText("pending@test.dev");
    // getStatusBadge('pending') -> tone-less Tag with the localized label.
    expect(screen.getByText("Ожидает")).toBeInTheDocument();
    // renderRoleBadges([]) -> muted em-dash.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

// ─── Mutation onError toasts ───────────────────────────────────────────────────

describe("<UsersPage /> — create/update onError", () => {
  it("maps a duplicate-email create failure to the emailAlreadyExists toast", async () => {
    installFetch(async (u, method) =>
      method === "POST" && u === "/api/users"
        ? jsonResponse({ error: "User with this email already exists" }, false, 409)
        : undefined,
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать пользователя" }));
    fireEvent.change(await screen.findByPlaceholderText("user@example.com"), {
      target: { value: "dup@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("Минимум 8 символов"), {
      target: { value: "Passw0rd!42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: "Пользователь с таким email уже существует",
        }),
      ),
    );
  });

  it("maps a generic create failure to the failedToCreate toast", async () => {
    installFetch(async (u, method) =>
      method === "POST" && u === "/api/users"
        ? jsonResponse({ error: "boom" }, false, 500)
        : undefined,
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать пользователя" }));
    fireEvent.change(await screen.findByPlaceholderText("user@example.com"), {
      target: { value: "x@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("Минимум 8 символов"), {
      target: { value: "Passw0rd!42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось создать пользователя." }),
      ),
    );
  });

  it("surfaces failedToUpdate when the user PUT fails", async () => {
    installFetch(async (u, method) =>
      method === "PUT" && u === "/api/users/u-admin"
        ? jsonResponse({ error: "nope" }, false, 500)
        : undefined,
    );
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Редактировать" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось обновить пользователя." }),
      ),
    );
  });

  it("surfaces failedToUpdate when the roles PUT fails after a successful user PUT", async () => {
    installFetch(async (u, method) =>
      method === "PUT" && u === "/api/users/u-admin/roles"
        ? jsonResponse({ error: "role ceiling" }, false, 403)
        : undefined,
    );
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Редактировать" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-admin/roles",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось обновить пользователя." }),
      ),
    );
  });
});

describe("<UsersPage /> — lifecycle onError", () => {
  it("shows failedToDeactivate when the deactivate POST fails", async () => {
    installFetch(async (u, method) =>
      method === "POST" && u.includes("/deactivate")
        ? jsonResponse({}, false, 500)
        : undefined,
    );
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Заблокировать" }));
    fireEvent.click(await screen.findByRole("button", { name: "Заблокировать" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось заблокировать пользователя." }),
      ),
    );
  });

  it("shows failedToActivate when the activate POST fails", async () => {
    installFetch(async (u, method) =>
      method === "POST" && u.includes("/activate")
        ? jsonResponse({}, false, 500)
        : undefined,
    );
    renderPage();
    await screen.findByText("learner@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[1]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Активировать" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось активировать пользователя." }),
      ),
    );
  });

  it("shows failedToResetPassword when the reset-password POST fails", async () => {
    installFetch(async (u, method) =>
      method === "POST" && u.includes("/reset-password")
        ? jsonResponse({}, false, 500)
        : undefined,
    );
    renderPage();
    await screen.findByText("admin@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Сбросить пароль" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сбросить пароль" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось сбросить пароль." }),
      ),
    );
  });
});

// ─── Bulk import wizard ────────────────────────────────────────────────────────

describe("<UsersPage /> — bulk import wizard", () => {
  it("walks upload -> preview -> done and renders the preview table branches", async () => {
    renderPage();
    await openBulkPreview();

    // Summary counts (one of each status).
    expect(screen.getByText("Новых: 1")).toBeInTheDocument();
    expect(screen.getByText("Дублей: 1")).toBeInTheDocument();
    expect(screen.getByText("Ошибок: 1")).toBeInTheDocument();

    // Group column: found (success), not-found (⚠), and null (dash).
    expect(screen.getByText("Группа A")).toBeInTheDocument();
    expect(screen.getByText(/Группа X/)).toBeInTheDocument();
    // Status column labels.
    expect(screen.getByText("Новый")).toBeInTheDocument();
    expect(screen.getByText("Дубль")).toBeInTheDocument();
    expect(screen.getByText("Ошибка")).toBeInTheDocument();
    // Action column: 'new' -> «Создать»; 'error'/duplicate share «Пропустить».
    expect(screen.getByText("Создать")).toBeInTheDocument();

    // Dialog title reflects the preview row count.
    expect(screen.getByRole("heading", { name: "Предпросмотр: 3 строк" })).toBeInTheDocument();

    // Confirm import (2 non-error rows) -> done step.
    fireEvent.click(screen.getByRole("button", { name: "Импортировать (2 строк)" }));
    await screen.findByRole("heading", { name: "Импорт завершён" });
    expect(screen.getByText("Создано")).toBeInTheDocument();
    expect(screen.getByText("Писем отправлено")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();

    // Close the wizard (footer button — disambiguated from the dialog's X).
    fireEvent.click(screen.getByText("Закрыть"));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Импорт завершён" })).toBeNull(),
    );
  });

  it("changes a duplicate row's action from «Пропустить» to «Обновить»", async () => {
    renderPage();
    await openBulkPreview();
    // The duplicate row exposes a Select whose current value is «Пропустить».
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }));
    fireEvent.click(await screen.findByRole("option", { name: "Обновить" }));
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
  });

  it("renders the errors block in the done step when the import reports errors", async () => {
    bulkImportResult = { created: 0, updated: 0, skipped: 1, invitesSent: 0, errors: ["Строка 2: дубль"] };
    renderPage();
    await openBulkPreview();
    fireEvent.click(screen.getByRole("button", { name: "Импортировать (2 строк)" }));
    await screen.findByRole("heading", { name: "Импорт завершён" });
    expect(screen.getByText("Ошибки:")).toBeInTheDocument();
    expect(screen.getByText("Строка 2: дубль")).toBeInTheDocument();
  });

  it("returns from preview to the upload step via «Назад»", async () => {
    renderPage();
    await openBulkPreview();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    await screen.findByText("Перетащите файл или нажмите для выбора");
    // Upload footer exposes the Excel template link.
    expect(screen.getByText("Скачать шаблон Excel")).toBeInTheDocument();
  });

  it("toasts on a bulk-preview parse error", async () => {
    installFetch(async (u, method) =>
      method === "POST" && u.includes("bulk-preview")
        ? jsonResponse({ error: "Не тот формат" }, false, 400)
        : undefined,
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Загрузить CSV" }));
    const input = await screen.findByLabelText("Файл для импорта пользователей");
    fireEvent.change(input, { target: { files: [new File(["x"], "bad.csv", { type: "text/csv" })] } });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", title: "Ошибка", description: "Не тот формат" }),
      ),
    );
  });

  it("toasts on a bulk-import error", async () => {
    installFetch(async (u, method) =>
      method === "POST" && u.includes("bulk-import")
        ? jsonResponse({ error: "БД недоступна" }, false, 500)
        : undefined,
    );
    renderPage();
    await openBulkPreview();
    fireEvent.click(screen.getByRole("button", { name: "Импортировать (2 строк)" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", title: "Ошибка импорта", description: "БД недоступна" }),
      ),
    );
  });

  it("shows the analysing spinner while the preview request is in flight", async () => {
    let resolvePreview!: (r: Response) => void;
    fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const u = String(url);
      const method = (options?.method ?? "GET").toUpperCase();
      if (method === "GET" && u === "/api/users") return Promise.resolve(jsonResponse(usersData));
      if (u.includes("bulk-preview")) return new Promise<Response>((res) => { resolvePreview = res; });
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Загрузить CSV" }));
    const input = await screen.findByLabelText("Файл для импорта пользователей");
    fireEvent.change(input, { target: { files: [new File(["x"], "u.csv", { type: "text/csv" })] } });

    expect(await screen.findByText("Анализируем файл...")).toBeInTheDocument();
    // Settle the pending request to avoid act() warnings.
    resolvePreview(jsonResponse(previewRowsFixture));
    await screen.findByText("Новых: 1");
  });

  it("supports drag-over / drag-leave and drop on the upload zone", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Загрузить CSV" }));
    const input = await screen.findByLabelText("Файл для импорта пользователей");
    const zone = input.parentElement as HTMLElement;
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "d.csv", { type: "text/csv" })] } });
    // Drop feeds the same preview mutation.
    await screen.findByText("Новых: 1");
  });

  it("closes the wizard from the upload step via «Отмена»", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Загрузить CSV" }));
    await screen.findByText("Перетащите файл или нажмите для выбора");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await waitFor(() =>
      expect(screen.queryByText("Перетащите файл или нажмите для выбора")).toBeNull(),
    );
  });
});

// ─── Reset attempts dialog ─────────────────────────────────────────────────────

describe("<UsersPage /> — reset attempts", () => {
  async function openResetAttempts() {
    usersData = [learnerUser];
    renderPage();
    await screen.findByText("learner@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Сбросить попытки" }));
  }

  it("shows the empty state when the learner has no attempts", async () => {
    attemptsSummary = [];
    await openResetAttempts();
    expect(
      await screen.findByText("У пользователя нет попыток прохождения тестов"),
    ).toBeInTheDocument();
  });

  it("lists tests, selects one and resets its attempts", async () => {
    attemptsSummary = [
      { testId: "test-a", testTitle: "Тест A", maxAttempts: 3, completedAttempts: 2, inProgressAttempts: 1 },
      { testId: "test-b", testTitle: "Тест B", maxAttempts: null, completedAttempts: 0, inProgressAttempts: 0 },
    ];
    await openResetAttempts();
    // Both attempts rows render (maxAttempts / inProgress branches on Тест A).
    await screen.findByText("Тест A");
    expect(screen.getByText("Тест B")).toBeInTheDocument();

    // Select a test, then confirm the reset.
    fireEvent.click(screen.getByText("Тест A"));
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-learn/reset-attempts",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Попытки сброшены" }),
      ),
    );
  });

  it("toasts on a reset-attempts failure", async () => {
    attemptsSummary = [
      { testId: "test-a", testTitle: "Тест A", maxAttempts: 3, completedAttempts: 2, inProgressAttempts: 1 },
    ];
    installFetch(async (u, method) =>
      method === "POST" && u.includes("reset-attempts")
        ? jsonResponse({}, false, 500)
        : undefined,
    );
    usersData = [learnerUser];
    renderPage();
    await screen.findByText("learner@test.dev");
    fireEvent.click(screen.getAllByLabelText("Действия")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Сбросить попытки" }));
    fireEvent.click(await screen.findByText("Тест A"));
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Не удалось сбросить попытки" }),
      ),
    );
  });
});
