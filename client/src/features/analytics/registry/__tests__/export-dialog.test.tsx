/**
 * @module features/analytics/registry/__tests__/export-dialog
 * @description PRD-56 FR-04: окно выгрузки реестра — листы книги и «только лучшая попытка».
 *
 * «Только лучшая попытка участника» переехала сюда из снятой вкладки «Экспорт» (решение
 * владельца 2026-09-25, вариант «б» задачи 2.2): это правило отбора строк книги, и без него
 * отчёт «по лучшему результату каждого» собрать было бы нечем.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getQueryFn } from "@/lib/queryClient";
import { ExportDialog } from "../export-dialog";
import { EMPTY_FILTER } from "../filter-state";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.startsWith("/api/analytics/registry")) {
      return { ok: true, status: 200, json: async () => ({ total: 12, rows: [] }) };
    }
    if (url === "/api/export/excel") {
      return { ok: true, status: 200, blob: async () => new Blob(["x"]) };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
});

afterEach(() => vi.unstubAllGlobals());

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
  return render(
    <QueryClientProvider client={client}>
      <ExportDialog open onClose={() => {}} filter={EMPTY_FILTER} />
    </QueryClientProvider>,
  );
}

/** Тело запроса выгрузки. */
function exportBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/export/excel");
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

describe("ExportDialog — только лучшая попытка", () => {
  it("по умолчанию выключена, выбора критерия нет", async () => {
    renderDialog();

    const box = await screen.findByRole("checkbox", { name: /Только лучшая попытка участника/ });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("Лучшая — по")).toBeNull();
  });

  it("галочка открывает выбор, по какому признаку попытка лучшая", async () => {
    renderDialog();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Только лучшая попытка участника/ }));

    expect(screen.getByText("Лучшая — по")).toBeTruthy();
  });

  it("выгрузка несёт правило отбора — сервер его уже умеет", async () => {
    renderDialog();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Только лучшая попытка участника/ }));
    await waitFor(() => expect(screen.getByText(/12 прохождений/)).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Скачать книгу" }));

    await waitFor(() => expect(exportBody()).toMatchObject({ bestAttemptOnly: true, bestAttemptCriteria: "percent" }));
  });

  it("вариант и версия отбора уходят в выгрузку, а не теряются", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
    render(
      <QueryClientProvider client={client}>
        <ExportDialog
          open
          onClose={() => {}}
          filter={{ ...EMPTY_FILTER, testIds: ["t1"], formIds: ["form-b"], snapshotIds: ["snap-3"] }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/12 прохождений/)).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Скачать книгу" }));

    await waitFor(() => expect(exportBody()).toMatchObject({
      formIds: ["form-b"], snapshotIds: ["snap-3"],
    }));
  });

  it("оргусловия отбора уходят в выгрузку (FR-06b)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
    render(
      <QueryClientProvider client={client}>
        <ExportDialog
          open
          onClose={() => {}}
          filter={{ ...EMPTY_FILTER, testIds: ["t1"], organizations: ["АО"], units: ["Отдел продаж"], positions: ["Кладовщик"] }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/12 прохождений/)).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Скачать книгу" }));

    await waitFor(() => expect(exportBody()).toMatchObject({
      organizations: ["АО"], units: ["Отдел продаж"], positions: ["Кладовщик"],
    }));
  });

  it("без галочки правило не передаётся включённым", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText(/12 прохождений/)).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Скачать книгу" }));

    await waitFor(() => expect(exportBody()).toMatchObject({ bestAttemptOnly: false }));
  });
});
