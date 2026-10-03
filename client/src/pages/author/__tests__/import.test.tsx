/**
 * @module pages/author/__tests__/import.test
 * @description Component tests for the «Импорт» section as the SINGLE import point (stage E6,
 * wireframe `docs/wireframes/approved/e6-import-single-point.html`): the uploader and the
 * «Что можно загрузить» list by rights, routing a file to its kind's form, the denial without
 * explanation, the entry from the test menu, and the workbook path kept from PRD-14 (questions
 * only to the bank; scales and the rest need a target test chosen in a searchable Select). Auth
 * is stubbed per test; `fetch` is stubbed per URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hasPermission, type Capability, type Role } from "@shared/access";
import { getQueryFn } from "@/lib/queryClient";

const auth = vi.hoisted(() => ({ roles: ["administrator"] as string[] }));
const route = vi.hoisted(() => ({ search: "" }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    can: (cap: Capability) => hasPermission(auth.roles as Role[], cap),
    hasRole: () => false,
    user: { id: "u1", name: "Author", roles: auth.roles },
  }),
}));

vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useSearch: () => route.search,
}));

import ImportPage from "../import";
import { ToastProvider } from "@skillum/ui-kit";

// ─── fetch stub ─────────────────────────────────────────────────────────────

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const testsData = [
  { id: "test1", title: "Стресс-опросник" },
  { id: "test2", title: "Аттестация" },
];

const questionsOnlyInspect = {
  kind: "workbook",
  sheets: ["Вопросы"],
  hasQuestions: true,
  hasScales: false,
  hasResultVariables: false,
  hasMeasurements: false,
  requiresTest: false,
  counts: { questions: 3, scales: 0, resultVariables: 0, measurements: 0 },
};
const workbookInspect = {
  ...questionsOnlyInspect,
  sheets: ["Вопросы", "Шкалы", "Показатели"],
  hasScales: true,
  hasResultVariables: true,
  requiresTest: true,
  counts: { questions: 3, scales: 2, resultVariables: 1, measurements: 0 },
};

let inspectResponse: Response;
let importWarnings: string[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  auth.roles = ["administrator"];
  route.search = "";
  inspectResponse = jsonRes(questionsOnlyInspect);
  importWarnings = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET" && url === "/api/tests") return jsonRes(testsData);
    if (method === "GET" && url === "/api/groups") return jsonRes([]);
    if (method === "GET" && url.startsWith("/api/analytics/lms-import/batches/")) return jsonRes([]);
    if (method === "POST") {
      if (url.startsWith("/api/workbook/inspect")) return inspectResponse;
      if (url.startsWith("/api/users/bulk-preview")) {
        return jsonRes([
          { idx: 0, email: "a@test.com", name: "А", role: "learner", groupName: null, groupId: null, groupFound: false, status: "new" },
        ]);
      }
      if (url.startsWith("/api/questions/import")) {
        return jsonRes({ created: 3, updated: 1, skipped: 0, errors: [] });
      }
      if (url.includes("/workbook/import")) {
        return jsonRes({
          questions: { created: 3, updated: 0, skipped: 0 },
          scales: { created: 2, updated: 0 },
          resultVariables: { created: 1, updated: 0 },
          structure: { sections: 0, quotas: 0 },
          errors: [],
          warnings: importWarnings,
          test: { id: "test1", title: "Стресс-опросник" },
        });
      }
    }
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}><ToastProvider>
      <ImportPage />
    </ToastProvider></QueryClientProvider>,
  );
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!el) throw new Error("file input not found");
  return el as HTMLInputElement;
}

function file(name: string): File {
  return new File(["x"], name);
}

function inspectCalls(): number {
  return fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/workbook/inspect")).length;
}

/** Pick an option of the target-test Select: open it by its trigger, then click the option. */
async function pickTarget(label: string) {
  fireEvent.click(screen.getByText("Выберите тест или создайте новый"));
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<ImportPage /> — пусто: загрузчик и перечень по правам", () => {
  it("администратор видит все пять видов и все форматы", async () => {
    renderPage();
    expect(await screen.findByText("Перетащите файл или выберите")).toBeInTheDocument();
    expect(screen.getByText(".xlsx, .csv, .tbtest, .zip")).toBeInTheDocument();
    for (const kind of ["Книга с вопросами", "Выгрузка отчёта LMS", "Пакет теста", "Список пользователей", "Шаблон оформления"]) {
      expect(screen.getByText(kind)).toBeInTheDocument();
    }
  });

  it("менеджер видит только выгрузку LMS и список пользователей", async () => {
    auth.roles = ["manager"];
    renderPage();
    await screen.findByText("Перетащите файл или выберите");
    expect(screen.getByText(".xlsx, .csv")).toBeInTheDocument();
    expect(screen.getByText("Выгрузка отчёта LMS")).toBeInTheDocument();
    expect(screen.getByText("Список пользователей")).toBeInTheDocument();
    expect(screen.getByText("учётные записи участников и группы")).toBeInTheDocument();
    expect(screen.queryByText("Книга с вопросами")).toBeNull();
    expect(screen.queryByText("Пакет теста")).toBeNull();
    expect(screen.queryByText("Шаблон оформления")).toBeNull();
  });

  it("руководство по книге скачивается с /api/workbook/docs/guide", async () => {
    renderPage();
    await screen.findByText("Книга с вопросами");

    const clicked: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute("href") ?? "");
    };
    try {
      fireEvent.click(screen.getByRole("button", { name: "Руководство" }));
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }

    expect(clicked).toEqual(["/api/workbook/docs/guide"]);
  });
});

describe("<ImportPage /> — вид файла", () => {
  it("формат вне доступных отклоняется без разбора", async () => {
    auth.roles = ["manager"];
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("пакет.tbtest")] } });

    expect(inspectCalls()).toBe(0);
    expect(screen.getByText("Перетащите файл или выберите")).toBeInTheDocument();
  });

  it("распознанный вид без права — отказ без пояснений", async () => {
    auth.roles = ["manager"];
    inspectResponse = jsonRes({ kind: "workbook", error: "Недостаточно прав для выполнения операции" }, false, 403);
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("mbi_test.xlsx")] } });

    expect(await screen.findByText("Недостаточно прав для выполнения операции")).toBeInTheDocument();
    expect(screen.getByText("mbi_test.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Выбрать другой файл" }));
    expect(await screen.findByText("Перетащите файл или выберите")).toBeInTheDocument();
  });

  it("список пользователей ведёт на предпросмотр списка", async () => {
    inspectResponse = jsonRes({ kind: "users", sheets: ["Лист1"], rows: 1 });
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("сотрудники.csv")] } });

    expect(await screen.findByText("Новых: 1")).toBeInTheDocument();
    expect(screen.getByText("список пользователей · 1 строка · 1 КБ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Импортировать (1 строка)" })).toBeInTheDocument();
  });

  it("выгрузка LMS ведёт на форму выгрузки", async () => {
    inspectResponse = jsonRes({
      kind: "lmsExport", testId: "test1", testTitle: "Стресс-опросник", rows: 3, questionIds: 2,
      scaleKeys: [], variableNames: [], unknownColumns: [],
    });
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("выгрузка.xlsx")] } });

    expect(await screen.findByText("Стресс-опросник")).toBeInTheDocument();
    expect(screen.getByText("Группа")).toBeInTheDocument();
  });
});

describe("<ImportPage /> — вход из меню теста", () => {
  it("сразу шаг выгрузки LMS этого теста: заголовок, название теста и его загрузки", async () => {
    route.search = "testId=test2";
    renderPage();

    expect(await screen.findByText("Загрузка выгрузки LMS")).toBeInTheDocument();
    expect(await screen.findByText("Аттестация")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/analytics/lms-import/batches/test2", expect.anything()),
    );
    expect(screen.queryByText("Что можно загрузить")).toBeNull();
  });
});

describe("<ImportPage /> — книга: только вопросы", () => {
  it("inspects, previews the dry-run, then imports to the done banner", async () => {
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");

    fireEvent.change(fileInput(container), { target: { files: [file("questions.xlsx")] } });

    await waitFor(() =>
      expect(screen.getByText("В файле только вопросы — импорт в общий банк.")).toBeInTheDocument(),
    );
    expect(screen.getByText("questions.xlsx")).toBeInTheDocument();
    expect(screen.getByText("книга с вопросами · 1 лист · 1 КБ")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));
    await waitFor(() =>
      expect(screen.getByText("Ошибок не найдено — можно импортировать.")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Импортировать" }));
    await waitFor(() => {
      const onPage = screen.getAllByText("Импорт выполнен").filter((el) => !el.closest(".ou-toast-stack"));
      expect(onPage).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: "Импортировать ещё" })).toBeInTheDocument();
  });
});

describe("<ImportPage /> — книга с целевым тестом", () => {
  it("gates the actions until a target test is chosen and previews the workbook plan", async () => {
    inspectResponse = jsonRes(workbookInspect);
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("workbook.xlsx")] } });

    await screen.findByText("В файле есть шкалы/показатели/вклады — укажите целевой тест.");
    expect(screen.getByRole("button", { name: "Проверить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Импортировать" })).toBeDisabled();

    await pickTarget("Аттестация");
    await waitFor(() => expect(screen.getByRole("button", { name: "Проверить" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));
    await waitFor(() => expect(screen.getByText("Шкалы")).toBeInTheDocument());
    expect(screen.getByText(/Целевой тест:/)).toBeInTheDocument();
  });

  it("целевой тест — список с поиском по части названия", async () => {
    inspectResponse = jsonRes(workbookInspect);
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("workbook.xlsx")] } });
    await screen.findByText("В файле есть шкалы/показатели/вклады — укажите целевой тест.");

    fireEvent.click(screen.getByText("Выберите тест или создайте новый"));
    fireEvent.change(await screen.findByPlaceholderText("Поиск по названию теста"), { target: { value: "аттес" } });

    expect(screen.getByRole("option", { name: "Аттестация" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Стресс-опросник" })).toBeNull();
  });

  it("requires a name when creating a new test", async () => {
    inspectResponse = jsonRes(workbookInspect);
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("workbook.xlsx")] } });
    await screen.findByText("В файле есть шкалы/показатели/вклады — укажите целевой тест.");

    await pickTarget("＋ Создать новый тест");

    const nameInput = await screen.findByLabelText(/Название нового теста/);
    expect(screen.getByRole("button", { name: "Импортировать" })).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: "Новый тест 2026" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Импортировать" })).not.toBeDisabled());
  });

  it("показывает предупреждение импорта в предпросмотре, не блокируя запись", async () => {
    inspectResponse = jsonRes(workbookInspect);
    importWarnings = [
      "Оценка взята с листа «Оценка» (строк: 0); колонки «Балл»/«Цена ответа» листа «Вопросы» не читались.",
    ];
    const { container } = renderPage();
    await screen.findByText("Перетащите файл или выберите");
    fireEvent.change(fileInput(container), { target: { files: [file("workbook.xlsx")] } });
    await screen.findByText("В файле есть шкалы/показатели/вклады — укажите целевой тест.");

    await pickTarget("Аттестация");
    await waitFor(() => expect(screen.getByRole("button", { name: "Проверить" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getByText(/не читались/)).toBeInTheDocument());
    expect(screen.getByText("Ошибок не найдено — можно импортировать.")).toBeInTheDocument();
  });
});
