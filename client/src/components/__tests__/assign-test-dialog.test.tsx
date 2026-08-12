/**
 * @module components/__tests__/assign-test-dialog.test
 * @description Component tests for the test-assignment dialog. Driven entirely
 * through its props (open / onOpenChange / testId / testTitle). Covers the
 * closed (null) render, the current-assignments tab (empty state, user + group
 * rows, group expand -> members panel), removing / resending an assignment, and
 * the Users / Groups tabs (available lists, row selection, the bulk assign
 * mutation, and the "all assigned" empty states). `fetch` is stubbed per URL so
 * the enabled-on-open queries and the mutations resolve against fixtures.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { AssignTestDialog } from "../assign-test-dialog";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const learner = { id: "u-learner", email: "learner@example.com", name: "Иван Ученик", roles: ["learner"], status: "active" };
const learner2 = { id: "u-learner2", email: "second@example.com", name: null, roles: ["learner"], status: "pending" };
const author = { id: "u-author", email: "author@example.com", name: "Автор", roles: ["author"], status: "active" };

const groupA = { id: "g-a", name: "Отдел продаж", description: "Продавцы", userCount: 4 };

const userAssignment = {
  id: "a-user", testId: "test1", userId: "u-assigned", groupId: null,
  dueDate: "2026-08-01", linkExpiresAt: "2026-08-15", assignedAt: "2026-07-01",
  user: { id: "u-assigned", email: "assigned@example.com", name: "Пётр", status: "active" },
  group: null, tokenStatus: "active", tokenId: "tok-1",
};
const groupAssignment = {
  id: "a-group", testId: "test1", userId: null, groupId: "g-b",
  dueDate: null, linkExpiresAt: null, assignedAt: "2026-07-01",
  user: null, group: { id: "g-b", name: "Группа Б", userCount: 2 },
  groupMemberIds: ["m1", "m2"], tokenStatus: "none", tokenId: null,
};

// ─── fetch stub ─────────────────────────────────────────────────────────────

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

let assignmentsData: unknown[] = [];
let usersData: unknown[] = [];
let groupsData: unknown[] = [];
let groupUsersData: unknown[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignmentsData = [];
  usersData = [learner, learner2, author];
  groupsData = [groupA];
  groupUsersData = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET") {
      if (url === "/api/tests/test1/assignments") return jsonRes(assignmentsData);
      if (url === "/api/users") return jsonRes(usersData);
      if (url === "/api/groups") return jsonRes(groupsData);
      if (url.endsWith("/group-users")) return jsonRes(groupUsersData);
    }
    // Mutations (bulk assign / remove / resend / revoke) all return ok JSON.
    return jsonRes({ sent: 2 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog(props: Partial<React.ComponentProps<typeof AssignTestDialog>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  const onOpenChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <AssignTestDialog
        open
        onOpenChange={onOpenChange}
        testId="test1"
        testTitle="Основы ИБ"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<AssignTestDialog /> — open/close", () => {
  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByText("Управление назначениями")).toBeNull();
  });

  it("renders the modal with the test title as description when open", async () => {
    renderDialog();
    expect(await screen.findByText("Управление назначениями")).toBeInTheDocument();
    expect(screen.getByText("Основы ИБ")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when «Отмена» is pressed", async () => {
    const { onOpenChange } = renderDialog();
    await screen.findByText("Управление назначениями");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("<AssignTestDialog /> — current assignments tab", () => {
  it("shows the empty state when there are no assignments", async () => {
    renderDialog();
    expect(await screen.findByText("Нет назначений")).toBeInTheDocument();
  });

  it("renders user and group assignment rows", async () => {
    assignmentsData = [userAssignment, groupAssignment];
    renderDialog();
    expect(await screen.findByText("assigned@example.com")).toBeInTheDocument();
    expect(screen.getByText("Группа Б")).toBeInTheDocument();
  });

  it("removes an assignment via DELETE", async () => {
    assignmentsData = [userAssignment];
    renderDialog();
    await screen.findByText("assigned@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Удалить назначение" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/assignments/a-user",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("resends the email for a user assignment via POST", async () => {
    assignmentsData = [userAssignment];
    renderDialog();
    await screen.findByText("assigned@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Отправить письмо повторно" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/assignments/a-user/resend",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("expands a group row and loads its members panel", async () => {
    assignmentsData = [groupAssignment];
    groupUsersData = [{ id: "m1", email: "member@example.com", name: "Член", status: "active", tokenStatus: "active" }];
    renderDialog();
    await screen.findByText("Группа Б");
    fireEvent.click(screen.getByText("Группа Б"));
    expect(await screen.findByText("member@example.com")).toBeInTheDocument();
  });
});

describe("<AssignTestDialog /> — users tab", () => {
  it("lists available learners and assigns a selected user via bulk POST", async () => {
    renderDialog();
    await screen.findByText("Управление назначениями");
    fireEvent.click(screen.getByRole("tab", { name: /Пользователи/ }));

    // Only learners are offered; the author is filtered out.
    expect(await screen.findByText("learner@example.com")).toBeInTheDocument();
    expect(screen.queryByText("author@example.com")).toBeNull();

    // Select the first row, then assign.
    fireEvent.click(screen.getByRole("checkbox", { name: "Выбрать строку 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Назначить \(1\)/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tests/test1/assignments/bulk",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchMock.mock.calls.find(([u]) => String(u) === "/api/tests/test1/assignments/bulk");
    expect(JSON.parse((call![1] as RequestInit).body as string).userIds).toContain("u-learner");
  });

  it("shows the «all assigned» empty state when no learners remain", async () => {
    usersData = [author];
    renderDialog();
    await screen.findByText("Управление назначениями");
    fireEvent.click(screen.getByRole("tab", { name: /Пользователи/ }));
    expect(await screen.findByText("Все пользователи уже назначены")).toBeInTheDocument();
  });
});

describe("<AssignTestDialog /> — groups tab", () => {
  it("lists available groups and assigns a selected group via bulk POST", async () => {
    renderDialog();
    await screen.findByText("Управление назначениями");
    fireEvent.click(screen.getByRole("tab", { name: /Группы/ }));

    expect(await screen.findByText("Отдел продаж")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выбрать строку 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Назначить \(1\)/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u]) => String(u) === "/api/tests/test1/assignments/bulk",
      );
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string).groupIds).toContain("g-a");
    });
  });

  it("shows the «all assigned» empty state when no groups remain", async () => {
    assignmentsData = [{ ...groupAssignment, groupId: "g-a", group: groupA }];
    renderDialog();
    await screen.findByText("Управление назначениями");
    fireEvent.click(screen.getByRole("tab", { name: /Группы/ }));
    expect(await screen.findByText("Все группы уже назначены")).toBeInTheDocument();
  });
});
