/**
 * @module pages/author/__tests__/users.org.test
 * @description Org-structure fields on the users page (org-structure plan,
 * task 3; approved wireframe `docs/wireframes/approved/org-users-profile.html`):
 * the «Подразделение» and «Должность» columns, the three org filters, the org
 * fields and linking keys in the create/edit drawers, the 409 on a taken LMS
 * learner id shown at the field, and the merged columns of the bulk preview.
 *
 * Harness mirrors users.test.tsx: a URL-routed `fetch` stub and an
 * administrator in the auth mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "admin1", name: "Admin", roles: ["administrator"] } }),
}));

import UsersPage from "../users";

const common = {
  status: "active", mustChangePassword: false, gdprConsent: true,
  lastLoginAt: null, expiresAt: null, createdAt: "2026-01-01T09:00:00Z", roles: ["learner"],
};
const petrov = {
  ...common, id: "u-petrov", email: "i.petrov@company.ru", name: "Петров Иван",
  organization: "АО «Северсталь-Сервис»", unit: "Отдел продаж", position: "Менеджер по продажам",
  lmsLearnerId: "petrov_i", externalKey: "SS-1",
};
const egorov = {
  ...common, id: "u-egorov", email: "p.egorov@company.ru", name: "Егоров Павел",
  organization: "АО «Северсталь-Сервис»", unit: "Логистика", position: "Кладовщик",
  lmsLearnerId: null, externalKey: null,
};
const frolova = {
  ...common, id: "u-frolova", email: "a.frolova@partner.ru", name: "Фролова Анна",
  organization: null, unit: null, position: null, lmsLearnerId: null, externalKey: null,
};

const orgValues = {
  organization: [{ value: "АО «Северсталь-Сервис»", users: 2, attempts: 0 }],
  unit: [
    { value: "Логистика", users: 1, attempts: 0 },
    { value: "Отдел продаж", users: 1, attempts: 212 },
  ],
  position: [],
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
/** Answer for the user PUT; a test may replace it with a refusal. */
let putResponse: () => Response;

beforeEach(() => {
  putResponse = () => jsonResponse({ id: "ok" });
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      if (u === "/api/users") return jsonResponse([petrov, egorov, frolova]);
      if (u === "/api/users/org-values") return jsonResponse(orgValues);
      return jsonResponse([]);
    }
    if (method === "PUT" && u === "/api/users/u-petrov") return putResponse();
    if (u === "/api/users/bulk-preview") {
      return jsonResponse([{
        idx: 0, email: "o.belkina@company.ru", name: "Белкина Ольга", role: "learner",
        groupName: null, groupId: null, groupFound: false, status: "new",
        organization: "АО «Северсталь-Сервис»", unit: "Отдел продаж", position: "Менеджер по продажам",
        lmsLearnerId: "belkina_o", externalKey: "SS-5",
      }]);
    }
    return jsonResponse({ id: "ok" });
  });
  vi.stubGlobal("fetch", fetchMock);
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

/** Body of the first request to `url` with `method`, parsed. */
function bodyOf(url: string, method: string): Record<string, unknown> | undefined {
  const call = fetchMock.mock.calls.find(([u, o]) =>
    String(u) === url && (o?.method ?? "GET").toUpperCase() === method);
  return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
}

async function openEdit() {
  renderPage();
  await screen.findByText("i.petrov@company.ru");
  fireEvent.click(screen.getAllByLabelText("Действия")[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Редактировать" }));
  await screen.findByRole("heading", { name: "Редактировать пользователя" });
}

describe("users list — org columns and filters", () => {
  it("shows unit and position under the name, without new columns", async () => {
    // Owner's decision 2026-09-28: two more columns did not fit next to the
    // sidebar, and the DS table clipped «Создан» and the row menu.
    renderPage();
    await screen.findByText("i.petrov@company.ru");
    expect(screen.getByText("Отдел продаж · Менеджер по продажам")).toBeInTheDocument();
    expect(screen.getByText("Логистика · Кладовщик")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Подразделение" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Должность" })).toBeNull();
  });

  it("filters by unit, «Не указано» included", async () => {
    renderPage();
    await screen.findByText("i.petrov@company.ru");

    fireEvent.click(screen.getByText("Все подразделения"));
    fireEvent.click(await screen.findByRole("option", { name: "Отдел продаж" }));
    expect(screen.getByText("i.petrov@company.ru")).toBeInTheDocument();
    expect(screen.queryByText("p.egorov@company.ru")).toBeNull();

    fireEvent.click(screen.getByText("Отдел продаж", { selector: ".ou-select__value, .ou-select__value *" }));
    fireEvent.click(await screen.findByRole("option", { name: "Не указано" }));
    expect(screen.getByText("a.frolova@partner.ru")).toBeInTheDocument();
    expect(screen.queryByText("i.petrov@company.ru")).toBeNull();
  });
});

describe("create drawer — org fields and linking keys", () => {
  it("sends the org fields, the LMS learner id and the external key", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать пользователя" }));
    fireEvent.change(await screen.findByPlaceholderText("user@example.com"), { target: { value: "n@company.ru" } });
    fireEvent.change(screen.getByPlaceholderText("Минимум 8 символов"), { target: { value: "Passw0rd!42" } });

    fireEvent.click(screen.getByRole("combobox", { name: "Подразделение" }));
    fireEvent.click(await screen.findByText("Логистика", { selector: ".ou-combo__option-title, .ou-combo__option-title *" }));
    fireEvent.change(screen.getByLabelText("Идентификатор в LMS"), { target: { value: "new_n" } });
    fireEvent.change(screen.getByLabelText("Внешний ключ"), { target: { value: "SS-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(bodyOf("/api/users", "POST")).toBeDefined());
    expect(bodyOf("/api/users", "POST")).toMatchObject({
      unit: "Логистика", organization: "", position: "", lmsLearnerId: "new_n", externalKey: "SS-9",
    });
  });

  it("sends the org fields for an external participant too", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Создать пользователя" }));
    fireEvent.change(await screen.findByPlaceholderText("user@example.com"), { target: { value: "ext@partner.ru" } });
    fireEvent.click(screen.getByLabelText(/Внешний участник/));
    fireEvent.click(screen.getByRole("combobox", { name: "Подразделение" }));
    fireEvent.click(await screen.findByText("Логистика", { selector: ".ou-combo__option-title, .ou-combo__option-title *" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(bodyOf("/api/users", "POST")).toBeDefined());
    expect(bodyOf("/api/users", "POST")).toMatchObject({ isExternal: true, unit: "Логистика" });
  });
});

describe("edit drawer — org fields and linking keys", () => {
  it("prefills and sends the fields", async () => {
    await openEdit();
    expect(screen.getByLabelText("Идентификатор в LMS")).toHaveValue("petrov_i");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(bodyOf("/api/users/u-petrov", "PUT")).toBeDefined());
    expect(bodyOf("/api/users/u-petrov", "PUT")).toMatchObject({
      organization: "АО «Северсталь-Сервис»", unit: "Отдел продаж", position: "Менеджер по продажам",
      lmsLearnerId: "petrov_i", externalKey: "SS-1",
    });
  });

  it("shows a taken LMS learner id at the field and keeps the drawer open", async () => {
    putResponse = () => jsonResponse({
      field: "lmsLearnerId",
      error: "Идентификатор в LMS «petrov_i» уже у пользователя Петров Игорь",
    }, false, 409);
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(await screen.findByText("Идентификатор в LMS «petrov_i» уже у пользователя Петров Игорь"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Идентификатор в LMS")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("heading", { name: "Редактировать пользователя" })).toBeInTheDocument();
  });
});

describe("bulk preview — merged columns", () => {
  it("shows unit and position in one column, the two keys in another", async () => {
    renderPage();
    await screen.findByText("i.petrov@company.ru");
    fireEvent.click(screen.getByRole("button", { name: "Загрузить CSV" }));
    const input = await screen.findByLabelText("Файл для импорта пользователей");
    fireEvent.change(input, { target: { files: [new File(["x"], "u.xlsx")] } });

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("o.belkina@company.ru");
    expect(within(dialog).getByRole("columnheader", { name: "Подразделение и должность" })).toBeInTheDocument();
    expect(within(dialog).getByRole("columnheader", { name: "Ключи связывания" })).toBeInTheDocument();
    expect(within(dialog).getByText("Менеджер по продажам · АО «Северсталь-Сервис»")).toBeInTheDocument();
    expect(within(dialog).getByText("LMS: belkina_o")).toBeInTheDocument();
    expect(within(dialog).getByText("Ключ: SS-5")).toBeInTheDocument();
  });
});
