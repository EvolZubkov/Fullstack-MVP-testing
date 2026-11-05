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
  scorm: { publishes: false, version: 4 },
};
const EDITED: ExportOptions = { ...PUBLISHED, scorm: { publishes: true, version: 5 } };
const DRAFT_ONLY: ExportOptions = {
  published: null,
  telemetry: { draft: true, published: null },
  scorm: { publishes: true, version: 1 },
};
const ARCHIVED: ExportOptions = { ...DRAFT_ONLY, scorm: { publishes: false, version: null } };

let fetchMock: ReturnType<typeof vi.fn>;

function renderDialog(options: ExportOptions, props: Partial<Parameters<typeof SaveAsDialog>[0]> = {}) {
  return renderDialogWithClient(options, props).view;
}

function renderDialogWithClient(options: ExportOptions, props: Partial<Parameters<typeof SaveAsDialog>[0]> = {}) {
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
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SaveAsDialog open onClose={() => {}} test={{ id: "t1", title: "Тест" }} canExportScorm {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { view, client };
}

beforeEach(() => {
  window.localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("saveAsUrl / fileNameOf", () => {
  it("версию несёт только пакет: SCORM публикует тест (Р7а), книга — из черновика", () => {
    expect(saveAsUrl("t1", "scorm", "draft")).toBe("/api/tests/t1/export/scorm");
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
  it("SCORM без правок: действующая версия, без выбора, телеметрия этой версии", async () => {
    renderDialog(PUBLISHED);
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    expect(await screen.findByText("опубликованная — версия 4 от 28.09.2026")).toBeInTheDocument();
    expect(screen.getByText("Изменений после публикации нет — новая версия не создаётся")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Версия" })).toBeNull();
    expect(screen.getByText("включена — прохождения придут в аналитику")).toBeInTheDocument();
  });

  it("SCORM с правками: называет новую версию, телеметрия — черновика", async () => {
    renderDialog(EDITED);
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    expect(await screen.findByText("будет опубликована версия 5")).toBeInTheDocument();
    expect(screen.getByText(/правки после версии 4 фиксируются новой версией/)).toBeInTheDocument();
    expect(screen.getByText("выключена")).toBeInTheDocument();
  });

  it("SCORM неопубликованного теста: будет опубликована первая версия", async () => {
    renderDialog(DRAFT_ONLY);
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    expect(await screen.findByText("будет опубликована версия 1")).toBeInTheDocument();
    expect(screen.getByText("Выгрузка публикует текущий черновик: он фиксируется новой версией")).toBeInTheDocument();
  });

  it("SCORM архивного теста — вне Р7а: прежний список черновика", async () => {
    renderDialog(ARCHIVED);
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    expect(await screen.findByText("Текущий черновик — тест ещё не опубликован")).toBeInTheDocument();
  });

  it("выгрузка, опубликовавшая тест, обновляет его статус в списках", async () => {
    const onClose = vi.fn();
    const { client } = renderDialogWithClient(EDITED, { onClose });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    await screen.findByText("будет опубликована версия 5");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/tests/t1/export/scorm", expect.anything());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/tests"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/home"] });
  });

  it("невыполнимая выдача: причины по темам, как у публикации; окно не закрывается", async () => {
    const onClose = vi.fn();
    renderDialog(DRAFT_ONLY, { onClose });
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith("/export/options")
      ? new Response(JSON.stringify(DRAFT_ONLY), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify({
        error: "publish_infeasible",
        message: "Выдача вопросов невыполнима при текущем составе тем",
        findings: [{ topicId: "tp", topicName: "Тема про риски", issues: [] }],
      }), { status: 409 })));
    fireEvent.click(screen.getByRole("radio", { name: /SCORM/ }));
    await screen.findByText("будет опубликована версия 1");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Тест нельзя опубликовать: выдача вопросов невыполнима")).toBeInTheDocument();
    expect(screen.getByText(/Тема про риски/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("radio", { name: /Пакет теста/ }));
    await screen.findByText("Опубликованная — версия 4 от 28.09.2026");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/tests/t1/transfer?source=published", expect.anything());
    expect(window.localStorage.getItem("tb.saveAs.format")).toBe("tbtest");
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
