/**
 * @module pages/author/__tests__/users.external.test
 * @description PRD-28 delta on the author user-management page: the «Внешний»
 * mark next to the address, the fourth filter by kind of account, the
 * «Сделать штатным» row action (external rows only, no way back) and the
 * «Внешний участник» flag in the create form, which puts out everything an
 * account without a password cannot have. `fetch` is stubbed per URL; auth is
 * an administrator, so every action is on the table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "admin1", name: "Admin", roles: ["administrator"] } }),
}));

import UsersPage from "../users";

const staffUser = {
  id: "u-staff", email: "i.petrov@company.ru", name: "Петров Иван",
  roles: ["learner"], status: "active", isExternal: false,
  mustChangePassword: false, gdprConsent: true,
  lastLoginAt: "2026-08-12T09:41:00Z", expiresAt: null, createdAt: "2026-02-03T11:02:00Z",
};

const externalUser = {
  id: "u-ext", email: "anna.frolova@partner.ru", name: "Фролова Анна",
  roles: ["learner"], status: "pending", isExternal: true,
  mustChangePassword: false, gdprConsent: false,
  lastLoginAt: null, expiresAt: null, createdAt: "2026-08-10T10:15:00Z",
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const u = String(url);
    if ((options?.method ?? "GET").toUpperCase() === "GET") {
      if (u === "/api/users") return jsonResponse([staffUser, externalUser]);
      return jsonResponse([]);
    }
    return jsonResponse({ success: true, sent: true });
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

/** Open the action menu of the row holding this address. */
async function openRowMenu(email: string) {
  const row = screen.getByText(email).closest("tr")!;
  fireEvent.click(within(row).getByLabelText("Действия"));
  await screen.findByRole("menuitem", { name: "Редактировать" });
}

/** Open the create drawer and tick the «Внешний участник» flag. */
async function openCreateAsExternal() {
  fireEvent.click(await screen.findByRole("button", { name: "Создать пользователя" }));
  await screen.findByPlaceholderText("user@example.com");
  fireEvent.click(screen.getByLabelText(/Внешний участник/));
}

// ─── Список ───────────────────────────────────────────────────────────────────

describe("<UsersPage /> — внешний участник в списке", () => {
  it("помечает внешнюю запись тегом рядом с адресом, отдельной колонки нет", async () => {
    renderPage();
    const externalRow = (await screen.findByText("anna.frolova@partner.ru")).closest("tr")!;
    expect(within(externalRow).getByText("Внешний")).toBeInTheDocument();

    const staffRow = screen.getByText("i.petrov@company.ru").closest("tr")!;
    expect(within(staffRow).queryByText("Внешний")).toBeNull();
    // Колонки списка не прибавилось.
    expect(screen.queryByRole("columnheader", { name: "Вид" })).toBeNull();
  });

  it("фильтрует список по виду учётной записи", async () => {
    renderPage();
    await screen.findByText("anna.frolova@partner.ru");

    fireEvent.click(screen.getByText("Все виды"));
    fireEvent.click(await screen.findByRole("option", { name: "Внешние участники" }));
    expect(screen.getByText("anna.frolova@partner.ru")).toBeInTheDocument();
    expect(screen.queryByText("i.petrov@company.ru")).toBeNull();

    fireEvent.click(screen.getByText("Внешние участники"));
    fireEvent.click(await screen.findByRole("option", { name: "Штатные" }));
    expect(screen.getByText("i.petrov@company.ru")).toBeInTheDocument();
    expect(screen.queryByText("anna.frolova@partner.ru")).toBeNull();
  });
});

// ─── Меню строки ──────────────────────────────────────────────────────────────

describe("<UsersPage /> — меню строки", () => {
  it("у внешнего есть «Сделать штатным», пароль погашен, приглашения нет", async () => {
    renderPage();
    await screen.findByText("anna.frolova@partner.ru");
    await openRowMenu("anna.frolova@partner.ru");

    expect(screen.getByRole("menuitem", { name: /Сделать штатным/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Сбросить пароль/ })).toBeDisabled();
    // Запись «Ожидает», но письма с ключом пароля внешнему не выпускают.
    expect(screen.queryByRole("menuitem", { name: "Отправить приглашение" })).toBeNull();
  });

  it("у штатной записи обратного пункта нет", async () => {
    renderPage();
    await screen.findByText("i.petrov@company.ru");
    await openRowMenu("i.petrov@company.ru");

    expect(screen.queryByRole("menuitem", { name: /Сделать штатным/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Сделать внешним/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Сбросить пароль/ })).not.toBeDisabled();
  });

  it("«Сделать штатным» переводит запись в штатные", async () => {
    renderPage();
    await screen.findByText("anna.frolova@partner.ru");
    await openRowMenu("anna.frolova@partner.ru");
    fireEvent.click(screen.getByRole("menuitem", { name: /Сделать штатным/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/u-ext/promote",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

// ─── Форма создания ───────────────────────────────────────────────────────────

describe("<UsersPage /> — признак в форме создания", () => {
  it("признак гасит пароль, приглашение, смену пароля и выбор ролей", async () => {
    renderPage();
    await openCreateAsExternal();

    expect(screen.getByPlaceholderText("У внешнего участника пароля нет")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сгенерировать" })).toBeDisabled();
    expect(screen.getByLabelText(/Требовать смену пароля/)).toBeDisabled();
    expect(screen.getByLabelText(/Отправить приглашение/)).toBeDisabled();
    expect(screen.getByLabelText(/Отправить приглашение/)).not.toBeChecked();
    const roleGroup = screen.getByRole("group", { name: "Роли пользователя" });
    const roleBoxes = within(roleGroup).getAllByRole("checkbox");
    expect(roleBoxes.length).toBeGreaterThan(1);
    roleBoxes.forEach((box) => expect(box).toBeDisabled());
  });

  it("создаёт внешнего без пароля, ролей и приглашения", async () => {
    renderPage();
    await openCreateAsExternal();
    fireEvent.change(screen.getByPlaceholderText("user@example.com"), {
      target: { value: "d.morozov@partner.ru" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, options]) => String(url) === "/api/users" && (options as RequestInit)?.method === "POST",
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toMatchObject({ email: "d.morozov@partner.ru", isExternal: true });
      expect(body.password).toBeFalsy();
      expect(body.sendInvite).toBeFalsy();
      expect(body.roles ?? []).toEqual([]);
    });
  });

  it("снятый признак возвращает обычную форму", async () => {
    renderPage();
    await openCreateAsExternal();
    fireEvent.click(screen.getByLabelText(/Внешний участник/));

    expect(screen.getByPlaceholderText("Минимум 8 символов")).not.toBeDisabled();
    expect(screen.getByLabelText(/Отправить приглашение/)).toBeChecked();
  });
});
