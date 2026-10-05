/**
 * @module features/tests/export/__tests__/save-as-dialog
 * @description Э5 «Сохранить как…» (эскиз approved/e5-export.html, решения Р6-Р8): форматы по
 * задаче, версия у SCORM и пакета, книга — из черновика, телеметрия только показом, формат без
 * права скрыт, последний выбор запоминается, ошибка сервера показывается в окне.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@skillum/ui-kit";
import { getQueryFn } from "@/lib/queryClient";

import { fileNameOf, SaveAsDialog, saveAsUrl, type ExportOptions } from "../save-as-dialog";

const PUBLISHED: ExportOptions = {
  published: { version: 4, publishedAt: "2026-09-28T10:00:00.000Z" },
  telemetry: { draft: false, published: true },
};
const DRAFT_ONLY: ExportOptions = { published: null, telemetry: { draft: true, published: null } };

let fetchMock: ReturnType<typeof vi.fn>;

function renderDialog(options: ExportOptions, props: Partial<Parameters<typeof SaveAsDialog>[0]> = {}) {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/export/options")) {
      return new Response(JSON.stringify(options), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(new Blob(["PK"]), {
      status: 200,
      headers: { "Content-Disposition": "attachment; filename*=UTF-8''%D0%A2%D0%B5%D1%81%D1%82.zip" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SaveAsDialog open onClose={() => {}} test={{ id: "t1", title: "Тест" }} canExportScorm {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("saveAsUrl / fileNameOf", () => {
  it("SCORM и пакет несут версию, книга — нет", () => {
    expect(saveAsUrl("t1", "scorm", "published")).toBe("/api/tests/t1/export/scorm?source=published");
    expect(saveAsUrl("t1", "tbtest", "draft")).toBe("/api/tests/t1/transfer?source=draft");
    expect(saveAsUrl("t1", "xlsx", "published")).toBe("/api/tests/t1/workbook/export");
  });

  it("имя файла — из filename* в UTF-8, иначе из filename, иначе запасное", () => {
    expect(fileNameOf("attachment; filename*=UTF-8''%D0%A2.zip", "x")).toBe("Т.zip");
    expect(fileNameOf('attachment; filename="a.tbtest"', "x")).toBe("a.tbtest");
    expect(fileNameOf(null, "x.xlsx")).toBe("x.xlsx");
  });
});

describe("SaveAsDialog", () => {
  it("по умолчанию — опубликованная версия и телеметрия этой версии", async () => {
    renderDialog(PUBLISHED);
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    expect(await screen.findByText("Опубликованная — версия 4 от 28.09.2026")).toBeInTheDocument();
    expect(screen.getByText("включена — прохождения придут в аналитику")).toBeInTheDocument();
  });

  it("книга: версия — черновик, «Не переносит» и предупреждение", async () => {
    renderDialog(PUBLISHED);
    fireEvent.click(screen.getByRole("radio", { name: /Книга для правки/ }));
    expect(screen.getByText("текущий черновик")).toBeInTheDocument();
    expect(screen.getByText(/вложения, ссылки и мероприятия исходов/)).toBeInTheDocument();
    expect(screen.getByText(/Книга собирается из текущего черновика/)).toBeInTheDocument();
  });

  it("неопубликованный тест — только черновик", async () => {
    renderDialog(DRAFT_ONLY);
    fireEvent.click(screen.getByRole("radio", { name: /Пакет теста/ }));
    expect(await screen.findByText("Текущий черновик — тест ещё не опубликован")).toBeInTheDocument();
  });

  it("без права на SCORM формата нет; первым — книга", () => {
    renderDialog(PUBLISHED, { canExportScorm: false });
    expect(screen.queryByRole("radio", { name: /SCORM/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Книга для правки/ })).toBeChecked();
  });

  it("«Сохранить» скачивает выбранное и запоминает формат", async () => {
    const onClose = vi.fn();
    renderDialog(PUBLISHED, { onClose });
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    await screen.findByText("Опубликованная — версия 4 от 28.09.2026");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/tests/t1/export/scorm?source=published", expect.anything());
    expect(window.localStorage.getItem("tb.saveAs.format")).toBe("scorm");
  });

  it("ошибка сервера остаётся в окне", async () => {
    renderDialog(PUBLISHED);
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith("/export/options")
      ? new Response(JSON.stringify(PUBLISHED), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify({ error: "Адрес приёма телеметрии не задан" }), { status: 422 })));
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Адрес приёма телеметрии не задан")).toBeInTheDocument();
  });

  it("кнопка настроек ведёт туда, где включается телеметрия", async () => {
    const onOpenSettings = vi.fn();
    renderDialog(PUBLISHED, { onOpenSettings });
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    fireEvent.click(screen.getByRole("button", { name: /Основное · Интеграция/ }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
