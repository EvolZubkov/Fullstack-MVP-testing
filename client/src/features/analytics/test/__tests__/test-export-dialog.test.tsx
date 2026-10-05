/**
 * @module features/analytics/test/__tests__/test-export-dialog
 * @description Э5.2: окно «Экспорт» уровня теста — условия страницы названы, число прохождений
 * спрошено тем же отбором с этим тестом, книга уходит общей ручкой выгрузки с тестом в условиях,
 * отчёт и матрица — ручками психометрики с фильтром страницы.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_FILTER } from "../../registry/filter-state";
import { TestExportDialog } from "../test-export-dialog";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/analytics/registry")) {
      return new Response(JSON.stringify({ total: 412, rows: [] }), { status: 200 });
    }
    return new Response(new Blob(["xlsx"]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const FILTER = { ...EMPTY_FILTER, sources: ["web" as const], from: "2026-01-01" };

function renderDialog(onClose = vi.fn()) {
  render(
    <TestExportDialog
      open
      onClose={onClose}
      testId="t1"
      testTitle="Сертификация"
      filter={FILTER}
      conditionLabels={["Источник: веб", "Период: с 01.01.2026"]}
      psychometricsUrl={(path) => `${path}?source=web`}
    />,
  );
  return onClose;
}

describe("TestExportDialog", () => {
  it("называет условия и число прохождений тем же отбором с этим тестом", async () => {
    renderDialog();
    expect(await screen.findByText("Под условия подходит 412 прохождений")).toBeInTheDocument();
    expect(screen.getByText("Источник: веб · Период: с 01.01.2026")).toBeInTheDocument();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("testId=t1");
    expect(url).toContain("source=web");
  });

  it("книга — общей ручкой выгрузки с тестом и условиями страницы", async () => {
    const onClose = renderDialog();
    await screen.findByText("Под условия подходит 412 прохождений");
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/export/excel") as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({
      testIds: ["t1"], sources: ["web"], dateFrom: "2026-01-01",
      includeSheets: { summary: true, attempts: true, answers: true, questionStats: false },
    });
  });

  it("психометрический отчёт и матрица — ручками психометрики с фильтром страницы", async () => {
    renderDialog();
    await screen.findByText("Под условия подходит 412 прохождений");
    fireEvent.click(screen.getByRole("radio", { name: /Матрица ответов/ }));
    expect(screen.queryByText("Листы книги")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/analytics/psychometrics/t1/matrix?source=web", expect.anything()));
  });

  it("без листов книги выгружать нечего", async () => {
    renderDialog();
    await screen.findByText("Под условия подходит 412 прохождений");
    for (const name of ["Сводка", "Прохождения", "Ответы"]) fireEvent.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByRole("button", { name: "Выгрузить" })).toBeDisabled();
  });
});
