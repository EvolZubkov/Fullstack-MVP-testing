/**
 * @module features/analytics/tests/__tests__/tests-tab.test
 * @description Э3.0: вкладка «Тесты» общего уровня — единая точка входа в аналитику теста.
 *
 * Строка открывает уровень теста, поиск сужает список по названию, свежие тесты — сверху,
 * у измерительного теста вместо доли сдавших и среднего — прочерк, без прохождений — пустое
 * состояние, которое говорит, откуда возьмутся строки.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestsTab, type TestSummaryRow } from "../tests-tab";

const ROWS: TestSummaryRow[] = [
  { testId: "t-old", title: "Охрана труда", completedAttempts: 312, passRate: 88, avgPercent: 81, lastAttemptAt: "2026-09-05T09:48:00.000Z" },
  { testId: "t-new", title: "Сертификация руководителей", completedAttempts: 486, passRate: 61, avgPercent: 68, lastAttemptAt: "2026-09-08T13:31:00.000Z" },
  { testId: "t-survey", title: "Опросник ЧИЛ", completedAttempts: 97, passRate: null, avgPercent: null, lastAttemptAt: "2026-09-01T10:00:00.000Z" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ tests: ROWS }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTab(onOpenTest = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TestsTab onOpenTest={onOpenTest} />
    </QueryClientProvider>,
  );
  return onOpenTest;
}

/** Названия тестов в порядке строк таблицы. */
function titlesInOrder(): string[] {
  return [...document.querySelectorAll("tbody tr")].map(tr => tr.querySelector("td")?.textContent ?? "");
}

describe("TestsTab", () => {
  it("lists tests with their numbers, freshest first", async () => {
    renderTab();

    await screen.findByText("Сертификация руководителей");
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics/tests", expect.anything());
    expect(titlesInOrder()).toEqual(["Сертификация руководителей", "Охрана труда", "Опросник ЧИЛ"]);
    expect(screen.getByText("486")).toBeTruthy();
    expect(screen.getByText("08.09.2026")).toBeTruthy();
    expect(screen.getByText("3 теста · завершённые прохождения: веб, телеметрия LMS и импортированные выгрузки")).toBeTruthy();
  });

  it("shows a dash where a measurement test has no verdict and nothing graded", async () => {
    renderTab();

    const row = (await screen.findByText("Опросник ЧИЛ")).closest("tr")!;
    const cells = [...row.querySelectorAll("td")].map(td => td.textContent);
    expect(cells.slice(1, 4)).toEqual(["97", "—", "—"]);
  });

  it("opens the test level from a row", async () => {
    const onOpenTest = renderTab();

    fireEvent.click(await screen.findByText("Охрана труда"));
    expect(onOpenTest).toHaveBeenCalledWith("t-old");
  });

  it("narrows the list by title", async () => {
    renderTab();
    await screen.findByText("Охрана труда");

    fireEvent.change(screen.getByLabelText("Поиск по названию теста"), { target: { value: "охрана" } });
    await waitFor(() => expect(titlesInOrder()).toEqual(["Охрана труда"]));

    fireEvent.change(screen.getByLabelText("Поиск по названию теста"), { target: { value: "нет такого" } });
    expect(await screen.findByText("Тестов с таким названием нет")).toBeTruthy();
  });

  it("says where the rows come from when there are no passages yet", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ tests: [] }), { status: 200 }));
    renderTab();

    expect(await screen.findByText("Прохождений пока нет")).toBeTruthy();
  });
});
