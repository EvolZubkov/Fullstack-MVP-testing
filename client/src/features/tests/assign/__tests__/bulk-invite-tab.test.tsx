/**
 * @module features/tests/assign/__tests__/bulk-invite-tab.test
 * @description Component tests for the PRD-28 «Списком из файла» tab: the four
 * states of one canvas (upload -> preview -> running -> report). `fetch` is
 * stubbed per URL, so the preview parse, the run and the audit mark all resolve
 * against fixtures. Covers that parsed rows appear with their statuses, that an
 * error row cannot be ticked, that the invite button carries the number of
 * chosen rows, and that a taken group name is reported without leaving the
 * preview.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { BulkInviteTab } from "../bulk-invite-tab";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const previewRows = [
  { index: 0, email: "a.sokolova@partner.ru", name: "Соколова Анастасия", status: "new", userId: null },
  { index: 1, email: "anna.frolova@partner.ru", name: "Фролова Анна", status: "external", userId: "u-1" },
  { index: 2, email: "i.petrov@company.ru", name: "Петров Иван", status: "learner", userId: "u-2" },
  { index: 3, email: "s.orlova@company.ru", name: "Орлова Светлана", status: "privileged", userId: "u-3" },
  { index: 4, email: "m.kuznetsov@company.ru", name: "Кузнецов Максим", status: "assigned", userId: "u-4" },
  {
    index: 5, email: "ivanov.partner.ru", name: "Иванов Пётр",
    status: "error", userId: null, error: "Некорректный адрес",
  },
];

const report = {
  created: 1,
  reused: 4,
  assigned: 5,
  groupId: null,
  results: [
    { email: "a.sokolova@partner.ru", name: "Соколова Анастасия", status: "new", magicLink: "https://host/access/aaa", delivered: true },
    { email: "anna.frolova@partner.ru", name: "Фролова Анна", status: "external", magicLink: "https://host/access/bbb", delivered: false },
  ],
  failed: [],
};

// ─── fetch stub ───────────────────────────────────────────────────────────────

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

let previewResponse: () => Response;
let inviteResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  previewResponse = () => jsonRes(previewRows);
  inviteResponse = () => jsonRes(report);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/participants/preview")) return previewResponse();
    if (url.endsWith("/participants/invite")) return inviteResponse();
    if (url.endsWith("/participants/links-exported")) return jsonRes(null, true, 204);
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  const onGoToAssignments = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <BulkInviteTab testId="t1" testTitle="Основы ИБ" onGoToAssignments={onGoToAssignments} />
    </QueryClientProvider>,
  );
  return { ...utils, onGoToAssignments };
}

function xlsx(name = "uchastniki.xlsx"): File {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Pick the file and run the parse, landing the tab on the preview state. */
async function goToPreview(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [xlsx()] } });
  fireEvent.click(await screen.findByRole("button", { name: "Проверить список" }));
  await screen.findByText("a.sokolova@partner.ru");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<BulkInviteTab /> — загрузка", () => {
  it("показывает зону выбора файла без числа строк в подписи", () => {
    renderTab();
    expect(screen.getByText("Перетащите книгу или нажмите, чтобы выбрать")).toBeInTheDocument();
    expect(screen.getByText("Только .xlsx. Колонки: email, name.")).toBeInTheDocument();
  });

  it("подставляет срок ссылки из срока сдачи, пока его не тронули руками", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Срок выполнения"), { target: { value: "2026-09-15" } });
    expect((screen.getByLabelText("Ссылка активна до") as HTMLInputElement).value).toBe("2026-09-15");

    fireEvent.change(screen.getByLabelText("Ссылка активна до"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Срок выполнения"), { target: { value: "2026-09-20" } });
    expect((screen.getByLabelText("Ссылка активна до") as HTMLInputElement).value).toBe("2026-10-01");
  });

  it("выбранный файл заменяет зону выбора строкой файла", async () => {
    const { container } = renderTab();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [xlsx()] } });
    expect(await screen.findByText("uchastniki.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("Перетащите книгу или нажмите, чтобы выбрать")).toBeNull();
  });
});

describe("<BulkInviteTab /> — предпросмотр", () => {
  it("после разбора файла показывает строки и запрещает выбор ошибочных", async () => {
    const { container } = renderTab();
    await goToPreview(container);

    expect(screen.getByText("ivanov.partner.ru")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Выбрать строку 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Строка 6 недоступна для выбора" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Строка 6 недоступна для выбора" })).not.toBeChecked();
  });

  it("считает выбранные строки в подписи кнопки приглашения", async () => {
    const { container } = renderTab();
    await goToPreview(container);

    expect(screen.getByRole("button", { name: "Пригласить (5)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выбрать строку 1" }));
    expect(screen.getByRole("button", { name: "Пригласить (4)" })).toBeInTheDocument();
  });

  it("шлёт выбранные строки на прогон и показывает отчёт", async () => {
    const { container } = renderTab();
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tests/t1/participants/invite",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/participants/invite"));
    expect(JSON.parse((call![1] as RequestInit).body as string).rows).toHaveLength(5);
    expect(await screen.findByText("Создано учётных записей")).toBeInTheDocument();
  });

  it("занятое имя группы показывает ошибку и не уводит с предпросмотра", async () => {
    inviteResponse = () => jsonRes({ error: "Группа с таким именем уже есть: Аудит ИБ" }, false, 400);
    const { container } = renderTab();

    fireEvent.change(screen.getByLabelText("Создать группу из списка"), { target: { value: "Аудит ИБ" } });
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));

    expect(await screen.findByText("Группа «Аудит ИБ» уже существует")).toBeInTheDocument();
    expect(screen.getByText("Имя занято")).toBeInTheDocument();
    // Still on the preview: the rows and the invite button are where they were.
    expect(screen.getByText("a.sokolova@partner.ru")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пригласить (5)" })).toBeDisabled();
  });
});

describe("<BulkInviteTab /> — отчёт", () => {
  it("сводит прогон в шесть чисел и перечисляет проблемные адреса", async () => {
    const { container } = renderTab();
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));

    expect(await screen.findByText("Создано учётных записей")).toBeInTheDocument();
    expect(screen.getByText("Переиспользовано")).toBeInTheDocument();
    expect(screen.getByText("Назначено")).toBeInTheDocument();
    expect(screen.getByText("Писем отправлено")).toBeInTheDocument();
    expect(screen.getByText("Письмо не ушло")).toBeInTheDocument();
    expect(screen.getByText("Пропущено")).toBeInTheDocument();

    expect(screen.getByText("Требуют внимания")).toBeInTheDocument();
    expect(screen.getByText("Письмо не доставлено")).toBeInTheDocument();
  });

  it("предупреждает о действующих ключах и считает выпущенные ссылки", async () => {
    const { container } = renderTab();
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));

    expect(await screen.findByText("Файл со ссылками содержит действующие ключи доступа")).toBeInTheDocument();
    expect(
      screen.getByText(/Выгрузка возможна, только пока открыт этот отчёт/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Выгрузить ссылки \(2\)/ })).toBeInTheDocument();
  });

  it("выгрузка сохраняет книгу и шлёт отметку с количеством", async () => {
    // jsdom не умеет object-URL — путь сохранения работает через заглушки.
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();

    const { container } = renderTab();
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));
    fireEvent.click(await screen.findByRole("button", { name: /Выгрузить ссылки/ }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/participants/links-exported"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ count: 2 });
    });
  });

  it("«К назначениям» возвращает на вкладку назначений", async () => {
    const { container, onGoToAssignments } = renderTab();
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));

    fireEvent.click(await screen.findByRole("button", { name: "К назначениям" }));
    expect(onGoToAssignments).toHaveBeenCalled();
  });
});
