/**
 * @module features/analytics/lms-import/__tests__/lms-import-form
 * @description Форма загрузки выгрузки LMS: список загрузок с откатом и подписи плана.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn, queryClient } from "@/lib/queryClient";
import { LmsImportForm, type LmsInspectResult } from "../lms-import-form";
import { ToastProvider } from "@skillum/ui-kit";

const INSPECT: LmsInspectResult = {
  kind: "lmsExport", testId: "t1", testTitle: "Тест", rows: 3, questionIds: 2,
  scaleKeys: [], variableNames: [], unknownColumns: [],
};

const BATCHES = [
  { id: "b1", fileName: "сентябрь.xlsx", importedAt: "2026-09-11T20:40:00Z", rowsCreated: 3, rowsUpdated: 0, rowsLinked: 0 },
  { id: "b2", fileName: "август.xlsx", importedAt: "2026-08-14T07:12:00Z", rowsCreated: 18, rowsUpdated: 0, rowsLinked: 0 },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } });
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/analytics/lms-import/batches/t1") return ok(BATCHES);
    if (url.startsWith("/api/analytics/lms-import/batches/") && init?.method === "DELETE") {
      return ok({ ok: true });
    }
    if (url.startsWith("/api/analytics/lms-import?dryRun=true")) {
      return ok({ testId: "t1", testTitle: "Тест", rowsTotal: 3, rowsCreated: 2, rowsUpdated: 1, rowsSkipped: 0, rowsLinked: 0, warnings: [] });
    }
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderForm() {
  const file = new File(["x"], "выгрузка.xlsx");
  return render(
    <QueryClientProvider client={queryClient}><ToastProvider>
      <LmsImportForm file={file} inspect={INSPECT} />
    </ToastProvider></QueryClientProvider>,
  );
}

describe("<LmsImportForm /> — список загрузок", () => {
  it("переключателя «В расчётах» нет: загрузку можно только откатить (FR-12 снят 2026-10-02)", async () => {
    renderForm();

    await screen.findByText("сентябрь.xlsx");
    expect(screen.queryByRole("checkbox", { name: "В расчётах" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Откатить" })).toHaveLength(2);
  });

  it("после отката числа аналитики на странице пересчитываются", async () => {
    // Ключи запросов аналитики — целые адреса («/api/analytics/psychometrics/t1»), и сброс по
    // ключу ["/api/analytics"] их не задевал: страница показывала числа с откаченной загрузкой.
    queryClient.setQueryData(["/api/analytics/psychometrics/t1?source=import"], { items: [] });
    queryClient.setQueryData(["/api/analytics/tests/t1", "?groupId=g1"], { summary: {} });
    queryClient.setQueryData(["/api/tests"], []);
    renderForm();

    await screen.findByText("сентябрь.xlsx");
    fireEvent.click(screen.getAllByRole("button", { name: "Откатить" })[0]);

    await waitFor(() => expect(
      queryClient.getQueryState(["/api/analytics/psychometrics/t1?source=import"])?.isInvalidated,
    ).toBe(true));
    expect(queryClient.getQueryState(["/api/analytics/tests/t1", "?groupId=g1"])?.isInvalidated).toBe(true);
    // Чужие данные не трогаются.
    expect(queryClient.getQueryState(["/api/tests"])?.isInvalidated).toBe(false);
  });
});

describe("<LmsImportForm /> — вход из меню теста: тест известен до файла (эскиз Э6)", () => {
  function renderEmpty(props: { presetTestId?: string } = {}) {
    return render(
      <QueryClientProvider client={queryClient}><ToastProvider>
        <LmsImportForm {...props} />
      </ToastProvider></QueryClientProvider>,
    );
  }

  it("до файла — только загрузчик и загрузки теста, без группы и кнопок (эскиз Э6)", async () => {
    renderEmpty({ presetTestId: "t1" });

    expect(screen.getByText("Перетащите файл .xlsx или выберите")).toBeInTheDocument();
    expect(screen.getByText("Выгрузка отчёта LMS — тест определится по файлу")).toBeInTheDocument();
    expect(await screen.findByText("Загрузки этого теста")).toBeInTheDocument();
    expect(screen.queryByText("Группа")).toBeNull();
    expect(screen.queryByRole("button", { name: "Проверить" })).toBeNull();
  });

  it("загрузки теста видны сразу — откатить можно, ничего не загружая", async () => {
    renderEmpty({ presetTestId: "t1" });

    expect(await screen.findAllByRole("button", { name: "Откатить" })).toHaveLength(2);
    expect(screen.getByText("Загрузки этого теста")).toBeInTheDocument();
  });

  it("где тест определяется по файлу, списка до файла нет: показывать нечего", () => {
    renderEmpty();

    expect(screen.queryByText("Загрузки этого теста")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/lms-import/batches/"), expect.anything());
  });

  it("с файлом кнопки стоят перед списком загрузок", async () => {
    renderForm();
    await screen.findByText("сентябрь.xlsx");

    const list = screen.getByText("Загрузки этого теста");
    const importButton = screen.getByRole("button", { name: "Импортировать" });
    expect(importButton.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("файл другого теста не отвергается: список переключается на его тест", async () => {
    // Владелец 2026-10-02: тест задаёт ФАЙЛ, а тест из меню — только начальный вид.
    render(
      <QueryClientProvider client={queryClient}><ToastProvider>
        <LmsImportForm presetTestId="t9" file={new File(["x"], "другой.xlsx")} inspect={INSPECT} />
      </ToastProvider></QueryClientProvider>,
    );

    expect(await screen.findByText("сентябрь.xlsx")).toBeInTheDocument();
    expect(screen.queryByText(/другого теста/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/lms-import/batches/t1", expect.anything());
  });

  it("баннер называет тест и числа файла — без технического пояснения", () => {
    renderForm();

    expect(screen.getByText("Тест")).toBeInTheDocument();
    expect(screen.getByText("2 вопроса.")).toBeInTheDocument();
    expect(screen.queryByText(/выбирать не нужно/)).toBeNull();
  });

  it("нет права на вид файла — отказ без пояснений", async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (String(input) === "/api/workbook/inspect") {
        return { ok: false, status: 403, json: async () => ({ kind: "workbook", error: "x" }) };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    const { container } = renderEmpty({ presetTestId: "t1" });

    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "книга.xlsx")] } });

    expect(await screen.findByText("Недостаточно прав для выполнения операции")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выбрать другой файл" })).toBeInTheDocument();
  });
});

describe("<LmsImportForm /> — план загрузки", () => {
  it("счётчики плана читаются как прогноз в одной форме", async () => {
    renderForm();
    fireEvent.click(await screen.findByRole("button", { name: "Проверить" }));

    for (const label of ["Будет добавлено: 2", "Будет обновлено: 1", "Будет пропущено: 0", "Будет связано: 0"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });
});
