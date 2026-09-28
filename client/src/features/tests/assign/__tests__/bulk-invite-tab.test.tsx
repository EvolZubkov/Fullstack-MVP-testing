/**
 * @module features/tests/assign/__tests__/bulk-invite-tab.test
 * @description Component tests for the PRD-28 «Списком» tab: the four states of
 * one canvas (upload -> preview -> running -> report). `fetch` is stubbed per
 * URL, so the preview parse, the run and the audit mark all resolve against
 * fixtures. Covers that parsed rows appear with their statuses, that an error
 * row cannot be ticked, that the invite button carries the number of chosen
 * rows, that a taken group name is reported without leaving the preview, and
 * (раздел 16) that the typed list and the workbook are alternatives which reach
 * the right routes for each purpose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
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
  // Срок выпущенных ссылок приходит с сервера: оператор его не задавал, а
  // умолчание (+30 дней) знает только выпуск токена.
  linksExpireAt: "2026-09-12T00:00:00.000Z",
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
    // У назначения и рецензирования маршруты разные, конвейер один (PRD-52, 14).
    if (url.endsWith("/participants/preview") || url.endsWith("/review/preview")) return previewResponse();
    if (url.endsWith("/participants/invite") || url.endsWith("/review/invite")) return inviteResponse();
    if (url.endsWith("/links-exported")) return jsonRes(null, true, 204);
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderTab(props: { purpose?: "assign" | "review" } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  const onGoToAssignments = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <BulkInviteTab
        testId="t1"
        testTitle="Основы ИБ"
        onGoToAssignments={onGoToAssignments}
        purpose={props.purpose}
      />
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
    expect(screen.getByText("Только .xlsx. Колонки: email, name; по желанию organization, unit, position."))
      .toBeInTheDocument();
  });

  it("у рецензирования оргколонок в подписи нет: их там не читают", () => {
    renderTab({ purpose: "review" });
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

describe("<BulkInviteTab /> — набранный список", () => {
  it("отдаёт предпросмотру разобранные строки, а не файл", async () => {
    renderTab();
    fireEvent.change(screen.getByLabelText(/Адреса почты/), {
      target: { value: "Ирина Петрова <i.petrova@example.com>\ns.kovalev@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить список" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/participants/preview"))).toBe(true));
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/participants/preview"))!;
    const init = call[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      rows: [
        { index: 0, email: "i.petrova@example.com", name: "Ирина Петрова" },
        { index: 1, email: "s.kovalev@example.com", name: null },
      ],
    });
  });

  it("заполненное поле гасит зону файла, очистка возвращает её", () => {
    const { container } = renderTab();
    const emails = screen.getByLabelText(/Адреса почты/);

    fireEvent.change(emails, { target: { value: "a@x.ru" } });
    expect(container.querySelector(".ou-uploader")).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(emails, { target: { value: "" } });
    expect(container.querySelector(".ou-uploader")).not.toHaveAttribute("aria-disabled");
  });

  it("выбранный файл гасит поле адресов", () => {
    const { container } = renderTab();
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [xlsx()] },
    });
    expect(screen.getByLabelText(/Адреса почты/)).toBeDisabled();
  });

  it("кнопка проверки мертва, пока не задан ни один источник", () => {
    renderTab();
    expect(screen.getByRole("button", { name: "Проверить список" })).toBeDisabled();
  });

  it("на рецензировании не показывает полей назначения, но оставляет срок ссылки", () => {
    renderTab({ purpose: "review" });

    // Прогон рецензирования не знает ни срока сдачи, ни группы: назначения, к
    // которому эти поля относятся, у него нет (PRD-52 раздел 3.3).
    expect(screen.queryByLabelText("Срок выполнения")).toBeNull();
    expect(screen.queryByLabelText("Создать группу из списка")).toBeNull();
    expect(screen.getByLabelText("Ссылка активна до")).toBeInTheDocument();
  });

  it("на назначении оба поля на месте", () => {
    renderTab();

    expect(screen.getByLabelText("Срок выполнения")).toBeInTheDocument();
    expect(screen.getByLabelText("Создать группу из списка")).toBeInTheDocument();
  });

  it("на рецензировании ходит в свои маршруты, а не в маршруты участников", async () => {
    renderTab({ purpose: "review" });
    fireEvent.change(screen.getByLabelText(/Адреса почты/), { target: { value: "e@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить список" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/review/preview"))).toBe(true));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/participants/preview"))).toBe(false);
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
    inviteResponse = () => jsonRes({ code: "group_name_taken", error: "Группа с таким именем уже есть: Аудит ИБ" }, false, 400);
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

  it("переименование группы не убирает поле и возвращает кнопку в строй", async () => {
    inviteResponse = () => jsonRes({ code: "group_name_taken", error: "Группа с таким именем уже есть: Аудит ИБ" }, false, 400);
    const { container } = renderTab();

    fireEvent.change(screen.getByLabelText("Создать группу из списка"), { target: { value: "Аудит ИБ" } });
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));
    await screen.findByText("Имя занято");

    fireEvent.change(screen.getByLabelText("Создать группу из списка"), {
      target: { value: "Аудит ИБ, сентябрь" },
    });
    // Поле осталось на месте — переименовать можно не уходя с предпросмотра.
    expect((screen.getByLabelText("Создать группу из списка") as HTMLInputElement).value)
      .toBe("Аудит ИБ, сентябрь");
    expect(screen.queryByText("Имя занято")).toBeNull();
    expect(screen.getByRole("button", { name: "Пригласить (5)" })).not.toBeDisabled();
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

    // The export pulls ExcelJS in on demand; the first such import in a loaded
    // parallel run takes longer than the default one-second patience.
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled(), { timeout: 20000 });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/participants/links-exported"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ count: 2 });
    }, { timeout: 20000 });
  }, 30000);

  it("в книге стоит срок ссылок с сервера, даже когда оператор его не задавал", async () => {
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
    let saved: Blob | null = null;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return "blob:test";
    }) as unknown as typeof URL.createObjectURL;

    const { container } = renderTab();
    await goToPreview(container);
    // Поле «Ссылка активна до» не трогаем: ровно случай приёмки.
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));
    fireEvent.click(await screen.findByRole("button", { name: /Выгрузить ссылки/ }));

    await waitFor(() => expect(saved).not.toBeNull(), { timeout: 20000 });
    const wb = new ExcelJS.Workbook();
    // Node Buffer, not the ArrayBuffer itself: under jsdom the externalised
    // `jszip` lives in another realm, where `data instanceof ArrayBuffer` is
    // false for a perfectly good buffer (see `bulk-invite-export.test`).
    // The cast is about typings only: exceljs merges its own
    // `interface Buffer extends ArrayBuffer` into the global one, so no real
    // Node Buffer satisfies the signature it declares for `load`.
    const bytes = Buffer.from(new Uint8Array(await saved!.arrayBuffer()));
    await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).getCell(5).value).toBe("Действует до");
    // Колонка была пуста («—»), потому что клиент подставлял то, что ввёл
    // оператор, — а он не вводил ничего.
    expect(ws.getRow(2).getCell(5).value).toBe("12.09.2026");
    expect(ws.getRow(3).getCell(5).value).toBe("12.09.2026");
  }, 30000);

  it("«К назначениям» возвращает на вкладку назначений", async () => {
    const { container, onGoToAssignments } = renderTab();
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));

    fireEvent.click(await screen.findByRole("button", { name: "К назначениям" }));
    expect(onGoToAssignments).toHaveBeenCalled();
  });

  it("на рецензировании отчёт говорит о приглашении, а не о назначении", async () => {
    const { container } = renderTab({ purpose: "review" });
    await goToPreview(container);
    fireEvent.click(screen.getByRole("button", { name: "Пригласить (5)" }));

    expect(await screen.findByText("Приглашено")).toBeInTheDocument();
    expect(screen.queryByText("Назначено")).toBeNull();
    expect(screen.getByRole("button", { name: "К приглашённым" })).toBeInTheDocument();
  });
});

describe("<BulkInviteTab /> — оргполя в предпросмотре (план оргструктуры)", () => {
  it("показывает колонку, когда в файле есть оргполя", async () => {
    previewResponse = () => jsonRes([
      { ...previewRows[0], organization: "ООО «Партнёр»", unit: "Логистика", position: "Кладовщик" },
      previewRows[1],
    ]);
    const { container } = renderTab();
    await goToPreview(container);
    expect(screen.getByRole("columnheader", { name: "Подразделение и должность" })).toBeInTheDocument();
    expect(screen.getByText("Логистика")).toBeInTheDocument();
    expect(screen.getByText("Кладовщик · ООО «Партнёр»")).toBeInTheDocument();
  });

  it("не показывает колонку, когда в файле их нет", async () => {
    const { container } = renderTab();
    await goToPreview(container);
    expect(screen.queryByRole("columnheader", { name: "Подразделение и должность" })).toBeNull();
  });
});
