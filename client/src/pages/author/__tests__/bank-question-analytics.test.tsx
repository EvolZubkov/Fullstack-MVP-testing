/**
 * @module pages/author/__tests__/bank-question-analytics
 * @description PRD-70 FR-40 - FR-44: страница вопроса банка — строка на тест без итоговой строки,
 * «мало данных» по-честному, выбор редакции меняет адрес и выборку, строка ведёт на вопрос в тесте.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ToastProvider } from "@skillum/ui-kit";

import { getQueryFn } from "@/lib/queryClient";
import { ANALYTICS_BANK_QUESTION_ROUTE } from "@/features/analytics/levels/analytics-routes";
import BankQuestionAnalyticsPage from "../bank-question-analytics";

const STATS = {
  question: { id: "q1", prompt: "Что считается подарком?", type: "single", topicId: "tp1", topicName: "Право и комплаенс", tags: ["Антикоррупция"] },
  selectedVersion: "h-cur",
  minObservations: 10,
  rows: [
    {
      testId: "t1", title: "Сертификация руководителей", delivered: 214, drawMode: "quota", sharePercent: 44, expectedPercent: 40,
      observations: 214, difficulty: 0.58, difficultyConfidence: "reliable", itemRest: -0.21, coefficientConfidence: "reliable",
      declared: 30, hardness: 42, skipShare: 2, latencyMedianMs: 41_000,
      flag: { tone: "error", title: "Сильные ошибаются чаще", detail: "вероятна ошибка в ключе: r = −0,21" },
      deadOptions: [{ label: "Скидка партнёру", chosen: 0, of: 214 }],
    },
    {
      testId: "t3", title: "Вводный курс", delivered: 6, drawMode: "all", sharePercent: 100, expectedPercent: null,
      observations: 6, difficulty: 0.9, difficultyConfidence: "insufficient", itemRest: null, coefficientConfidence: "insufficient",
      declared: 30, hardness: null, skipShare: 0, latencyMedianMs: 52_000, flag: null, deadOptions: [],
    },
  ],
  versions: [
    { psychoHash: "h-cur", firstAt: "2026-09-04T00:00:00Z", lastAt: "2026-10-01T00:00:00Z", tests: 2, observations: 220, current: true },
    { psychoHash: "h-old", firstAt: "2026-03-12T00:00:00Z", lastAt: "2026-09-03T00:00:00Z", tests: 1, observations: 100, current: false },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
let memory: ReturnType<typeof memoryLocation>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => STATS, text: async () => JSON.stringify(STATS) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false } } });
  memory = memoryLocation({ path, record: true });
  return render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <QueryClientProvider client={client}><ToastProvider>
        <Route path={ANALYTICS_BANK_QUESTION_ROUTE}><BankQuestionAnalyticsPage /></Route>
      </ToastProvider></QueryClientProvider>
    </Router>,
  );
}

describe("BankQuestionAnalyticsPage", () => {
  it("строка на тест, без итоговой строки; признак, мёртвый вариант и «мало данных»", async () => {
    renderAt("/author/analytics/questions/q1");

    expect(await screen.findByText("Сертификация руководителей")).toBeInTheDocument();
    expect(screen.getByText(/Вопрос банка · Право и комплаенс · Антикоррупция · выдавался в 2 тестах/)).toBeInTheDocument();
    expect(screen.getByText(/^ожидаемая 40\s%$/)).toBeInTheDocument();
    expect(screen.getByText("весь банк")).toBeInTheDocument();
    expect(screen.getByText("30 → 42")).toBeInTheDocument();
    expect(screen.getByText("Сильные ошибаются чаще")).toBeInTheDocument();
    expect(screen.getByText("Мёртвый вариант «Скидка партнёру» — 0 из 214")).toBeInTheDocument();
    expect(screen.getAllByText("мало данных").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/Итого|Среднее/)).toBeNull();
  });

  it("версии содержания — выбранная помечена, «Показать» меняет редакцию в адресе (FR-11)", async () => {
    renderAt("/author/analytics/questions/q1");

    const card = (await screen.findByText("Версии содержания")).closest(".ou-card") as HTMLElement;
    expect(within(card).getByText("Выбрана")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Показать" }));

    await waitFor(() => expect(memory.history?.at(-1)).toBe("/author/analytics/questions/q1?version=h-old"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/analytics/questions/q1?version=h-old", expect.anything()));
  });

  it("«Открыть вопрос в теме» ведёт в банк", async () => {
    renderAt("/author/analytics/questions/q1");

    fireEvent.click(await screen.findByRole("button", { name: "Открыть вопрос в теме" }));
    await waitFor(() => expect(memory.history?.at(-1)).toBe("/author/content?questionId=q1"));
  });

  it("строка теста ведёт на уровень вопроса в этом тесте", async () => {
    renderAt("/author/analytics/questions/q1");

    fireEvent.click(await screen.findByText("Сертификация руководителей"));
    await waitFor(() => expect(memory.history?.at(-1)).toBe("/author/analytics/tests/t1/questions/q1"));
  });
});
