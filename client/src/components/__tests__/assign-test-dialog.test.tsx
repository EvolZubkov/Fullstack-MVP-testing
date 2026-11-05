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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { AssignTestDialog } from "../assign-test-dialog";
import { ToastProvider } from "@skillum/ui-kit";

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
let candidatesData: unknown[] = [];
let candidatesOk = true;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignmentsData = [];
  usersData = [learner, learner2, author];
  groupsData = [groupA];
  groupUsersData = [];
  candidatesData = [{ id: "u-expert", email: "expert@example.com", name: "Ирина", status: "active" }];
  candidatesOk = true;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET") {
      if (url === "/api/tests/test1/assignments") return jsonRes(assignmentsData);
      if (url === "/api/users") return jsonRes(usersData);
      if (url === "/api/groups") return jsonRes(groupsData);
      if (url.endsWith("/group-users")) return jsonRes(groupUsersData);
      if (url === "/api/tests/test1/review/reviewers") return jsonRes([]);
      if (url === "/api/tests/test1/review/candidates") {
        return candidatesOk ? jsonRes(candidatesData) : jsonRes({ error: "Forbidden" }, false, 403);
      }
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
    <QueryClientProvider client={client}><ToastProvider>
      <AssignTestDialog
        open
        onOpenChange={onOpenChange}
        testId="test1"
        testTitle="Основы ИБ"
        {...props}
      />
    </ToastProvider></QueryClientProvider>,
  );
  return { ...utils, onOpenChange };
}

/** The dialog footer (`ou-modal__foot`), where the tab actions live (approved wireframe 2026-10-20). */
function footer(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".ou-modal__foot");
  if (!el) throw new Error("dialog footer not rendered");
  return el;
}

/** A button of the dialog footer, by its accessible name. */
function footerButton(name: RegExp | string): HTMLElement {
  return within(footer()).getByRole("button", { name });
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

  // PRD-54 BR-54-42: участнику без почты ссылку отправить некуда — пункт гаснет, сервер отказ даёт сам.
  it("гасит «Обновить ссылку» у участника группы без почты", async () => {
    assignmentsData = [groupAssignment];
    groupUsersData = [
      { id: "m1", email: "member@example.com", name: "Член", status: "active", tokenStatus: "active" },
      { id: "m2", email: null, name: "Участник 1a2b3c4d", status: "active", tokenStatus: "none" },
    ];
    renderDialog();
    await screen.findByText("Группа Б");
    fireEvent.click(screen.getByText("Группа Б"));
    await screen.findByText("Участник 1a2b3c4d");
    const [withEmail, withoutEmail] = screen.getAllByRole("button", { name: "Обновить ссылку" });
    expect(withEmail).not.toBeDisabled();
    expect(withoutEmail).toBeDisabled();
    expect(withoutEmail).toHaveAttribute("title", "У участника нет почты — ссылку отправить некуда");
    // Вместо почты в строке участника — прочерк, как на экране «Пользователи».
    expect(screen.getByText("Участник 1a2b3c4d").previousElementSibling).toHaveTextContent("—");
  });
});

describe("<AssignTestDialog /> — users tab", () => {
  it("lists available learners and assigns the people put into the basket", async () => {
    renderDialog();
    await screen.findByText("Управление назначениями");
    fireEvent.click(screen.getByRole("tab", { name: /Пользователи/ }));

    // Only learners are offered; the author is filtered out.
    expect(await screen.findByText("learner@example.com")).toBeInTheDocument();
    expect(screen.queryByText("author@example.com")).toBeNull();

    // Tick a person on the left, move them into the basket, then assign from the footer.
    fireEvent.click(screen.getByRole("checkbox", { name: "Иван Ученик" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить отмеченных" }));
    fireEvent.click(footerButton(/Назначить \(1\)/));

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

// ─── PRD-52: режим рецензирования ────────────────────────────────────────────

describe("AssignTestDialog — режим рецензирования", () => {
  it("называется «Отправить на рецензирование» и предупреждает о видимости", async () => {
    renderDialog({ mode: "review" });
    expect(await screen.findByText("Отправить на рецензирование")).toBeInTheDocument();
    expect(screen.getByText(/видят комментарии друг друга/i)).toBeInTheDocument();
  });

  it("первая вкладка показывает приглашённых рецензентов, а не участников", async () => {
    renderDialog({ mode: "review" });
    expect(await screen.findByRole("tab", { name: /Приглашены/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Назначено/ })).not.toBeInTheDocument();
  });

  it("действие называется «Пригласить», а не «Назначить»", async () => {
    renderDialog({ mode: "review" });
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));
    expect(await screen.findByRole("button", { name: /Пригласить/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Назначить/ })).not.toBeInTheDocument();
  });

  it("вкладки «Группы» нет: рецензентов приглашают поимённо", async () => {
    renderDialog({ mode: "review" });
    await screen.findByRole("tab", { name: /Приглашены/ });

    expect(screen.queryByRole("tab", { name: /Группы/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Пользователи/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Списком/ })).toBeInTheDocument();
  });

  it("в обычном режиме вкладка «Группы» на месте", async () => {
    renderDialog();
    expect(await screen.findByRole("tab", { name: /Группы/ })).toBeInTheDocument();
  });

  it("не показывает срок сдачи: у рецензирования нет назначения", async () => {
    renderDialog({ mode: "review" });
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));

    expect(screen.queryByLabelText("Срок выполнения")).toBeNull();
    expect(screen.getByLabelText("Ссылка активна до")).toBeInTheDocument();
  });

  it("пустой список пользователей объясняется приглашением, а не назначением", async () => {
    candidatesData = [];
    renderDialog({ mode: "review" });
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));

    expect(await screen.findByText("Все пользователи уже приглашены")).toBeInTheDocument();
  });

  // PRD-52 раздел 14.7: у автора нет `users.read`, поэтому реестр пользователей
  // ему закрыт — кандидатов отдаёт маршрут под правом приглашения.
  it("берёт кандидатов из маршрута рецензирования, а не из реестра пользователей", async () => {
    renderDialog({ mode: "review" });
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));

    expect(await screen.findByText("expert@example.com")).toBeInTheDocument();
    const gets = fetchMock.mock.calls
      .filter(([, init]) => !init?.method || init.method === "GET")
      .map(([u]) => String(u));
    expect(gets).not.toContain("/api/users");
    expect(gets).not.toContain("/api/groups");
  });

  it("приглашает выбранного кандидата поимённо", async () => {
    renderDialog({ mode: "review" });
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));
    await screen.findByText("expert@example.com");

    fireEvent.click(screen.getByRole("checkbox", { name: "Ирина" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить отмеченных" }));
    fireEvent.click(footerButton(/Пригласить \(1\)/));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === "/api/tests/test1/review/invite");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string).rows).toEqual([{ userId: "u-expert" }]);
    });
  });

  it("отказ при чтении кандидатов не выдаёт себя за «все уже приглашены»", async () => {
    candidatesOk = false;
    renderDialog({ mode: "review" });
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));

    expect(await screen.findByText("Не удалось загрузить список пользователей")).toBeInTheDocument();
    expect(screen.queryByText("Все пользователи уже приглашены")).toBeNull();
  });

  it("обычный режим заголовка и предупреждения не меняет", async () => {
    renderDialog();
    expect(screen.queryByText("Отправить на рецензирование")).not.toBeInTheDocument();
    expect(screen.queryByText(/видят комментарии друг друга/i)).not.toBeInTheDocument();
  });
});

// ─── Approved wireframe assign-dialog-user-picker.html (2026-10-20) ──────────

describe("AssignTestDialog — выбор двумя половинами, подвал, высота", () => {
  it("окно держит одну высоту: ModalDialog и вкладки в режиме fill", async () => {
    renderDialog();
    await screen.findByText("Управление назначениями");
    expect(document.querySelector(".ou-modal")).toHaveClass("ou-modal--fill");
    expect(document.querySelector(".ou-tabs")).toHaveClass("ou-tabs--fill");
  });

  it("на «Назначено» в подвале только «Отмена»", async () => {
    renderDialog();
    await screen.findByText("Нет назначений");
    expect(within(footer()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Отмена"]);
  });

  it("«Пользователи»: слева кандидаты, справа корзина «К назначению», сроки над половинами", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));
    await screen.findByText("learner@example.com");

    expect(screen.getByRole("heading", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "К назначению" })).toBeInTheDocument();
    expect(document.querySelector(".ou-transfer")).toHaveClass("ou-transfer--fill", "ou-transfer--has-above");
    const left = document.querySelector(".ou-transfer__above--left")!;
    const right = document.querySelector(".ou-transfer__above--right")!;
    expect(within(left as HTMLElement).getByLabelText("Срок выполнения")).toBeInTheDocument();
    expect(within(right as HTMLElement).getByLabelText("Ссылка активна до")).toBeInTheDocument();
    // The action lives in the footer and counts the basket, which starts empty.
    expect(footerButton(/Назначить \(0\)/)).toBeDisabled();
  });

  it("новый поиск слева корзину не трогает", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));
    await screen.findByText("learner@example.com");

    fireEvent.click(screen.getByRole("checkbox", { name: "Иван Ученик" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить отмеченных" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск в «Пользователи»" }), { target: { value: "second" } });

    expect(footerButton(/Назначить \(1\)/)).toBeEnabled();
    const basket = document.querySelectorAll(".ou-transfer__pane")[1] as HTMLElement;
    expect(within(basket).getByText("Иван Ученик")).toBeInTheDocument();
  });

  it("после назначения корзина пустеет", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));
    await screen.findByText("learner@example.com");
    fireEvent.click(screen.getByRole("checkbox", { name: "Иван Ученик" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить отмеченных" }));
    fireEvent.click(footerButton(/Назначить \(1\)/));

    await waitFor(() => expect(screen.getByRole("tab", { name: /Назначено/ })).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("tab", { name: /Пользователи/ }));
    expect(await within(footer()).findByRole("button", { name: /Назначить \(0\)/ })).toBeDisabled();
  });

  it("на «Группах» действие тоже в подвале", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("tab", { name: /Группы/ }));
    await screen.findByText("Отдел продаж");
    expect(footerButton(/Назначить \(0\)/)).toBeDisabled();
  });

  it("на «Списком» «Проверить список» стоит в подвале", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("tab", { name: /Списком/ }));
    expect(await within(footer()).findByRole("button", { name: "Проверить список" })).toBeDisabled();
  });

  it("рецензирование: корзина «К приглашению», одно поле срока во всю ширину", async () => {
    renderDialog({ mode: "review" });
    fireEvent.click(await screen.findByRole("tab", { name: /Пользователи/ }));
    await screen.findByText("expert@example.com");

    expect(screen.getByRole("heading", { name: "К приглашению" })).toBeInTheDocument();
    const span = document.querySelector(".ou-transfer__above--span") as HTMLElement;
    expect(within(span).getByLabelText("Ссылка активна до")).toBeInTheDocument();
    expect(footerButton(/Пригласить \(0\)/)).toBeDisabled();
  });
});
