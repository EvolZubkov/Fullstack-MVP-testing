/**
 * @module features/analytics/lms-import/__tests__/lms-import-dialog
 * @description Окно загрузки выгрузки LMS: кнопки формы стоят в стандартном подвале окна
 * (эскиз prd54-lms-import, состояние «в окне»), а сухой прогон, импорт и закрытие работают из него.
 */
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn, queryClient } from "@/lib/queryClient";
import { LmsImportDialog } from "../lms-import-dialog";
import { ToastProvider } from "@skillum/ui-kit";

const INSPECT = {
  kind: "lmsExport", testId: "t1", testTitle: "Тест", rows: 3, questionIds: 2,
  scaleKeys: [], variableNames: [], unknownColumns: [],
};
const OUTCOME = { testId: "t1", testTitle: "Тест", rowsTotal: 3, rowsCreated: 2, rowsUpdated: 1, rowsSkipped: 0, rowsLinked: 0, warnings: [] };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } });
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url === "/api/workbook/inspect") return ok(INSPECT);
    if (url.startsWith("/api/analytics/lms-import?dryRun=")) return ok(OUTCOME);
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderDialog(props: Partial<ComponentProps<typeof LmsImportDialog>> = {}) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}><ToastProvider>
      <LmsImportDialog open onClose={onClose} onDone={onDone} fixedTestId="t1" description="Тест" {...props} />
    </ToastProvider></QueryClientProvider>,
  );
  return { ...utils, onClose, onDone };
}

/** Подвал окна — там, где DS рисует разделитель. */
function footer(): HTMLElement {
  const el = screen.getByRole("dialog").querySelector("footer.ou-modal__foot");
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

/** Выбрать файл во встроенном загрузчике формы. */
function pickFile() {
  const input = screen.getByRole("dialog").querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "выгрузка.xlsx")] } });
}

describe("<LmsImportDialog />", () => {
  it("закрытое окно ничего не рисует", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("кнопки стоят в подвале окна в порядке эскиза: «Отмена», «Проверить», «Импортировать»", () => {
    renderDialog();
    expect(within(footer()).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Отмена", "Проверить", "Импортировать"]);
    // В теле окна кнопок формы нет — только в подвале.
    const body = screen.getByRole("dialog").querySelector(".ou-modal__body") as HTMLElement;
    expect(within(body).queryByRole("button", { name: "Проверить" })).toBeNull();
  });

  it("без файла «Проверить» и «Импортировать» заблокированы", () => {
    renderDialog();
    expect(within(footer()).getByRole("button", { name: "Проверить" })).toBeDisabled();
    expect(within(footer()).getByRole("button", { name: "Импортировать" })).toBeDisabled();
  });

  it("«Отмена» в подвале закрывает окно", () => {
    const { onClose } = renderDialog();
    fireEvent.click(within(footer()).getByRole("button", { name: "Отмена" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("файл → «Проверить» → «Импортировать» из подвала; после записи — «Закрыть» и «Загрузить ещё»", async () => {
    const { onDone } = renderDialog();
    pickFile();

    const check = await waitFor(() => {
      const b = within(footer()).getByRole("button", { name: "Проверить" });
      expect(b).not.toBeDisabled();
      return b;
    });
    // До проверки импорт закрыт: план — единственное место, где видны предупреждения.
    expect(within(footer()).getByRole("button", { name: "Импортировать" })).toBeDisabled();
    fireEvent.click(check);
    expect(await screen.findByText("Будет добавлено: 2")).toBeInTheDocument();

    const run = within(footer()).getByRole("button", { name: "Импортировать" });
    await waitFor(() => expect(run).not.toBeDisabled());
    fireEvent.click(run);

    expect(await screen.findByText("Загрузка завершена")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/lms-import?dryRun=false", expect.objectContaining({ method: "POST" }));
    expect(within(footer()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Закрыть", "Загрузить ещё"]);
  });

  it("файл чужого теста: в подвале «Отмена» и «Выбрать другой файл»", async () => {
    renderDialog({ fixedTestId: "t2" });
    pickFile();

    expect(await screen.findByText("Это выгрузка другого теста")).toBeInTheDocument();
    expect(within(footer()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Отмена", "Выбрать другой файл"]);
  });
});
