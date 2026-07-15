/**
 * @module pages/author/__tests__/test-analytics.test
 * @description Coverage suite for the per-test analytics dashboard
 * (`pages/author/test-analytics.tsx`). Exercises the loading / not-found states,
 * the summary KPI cards, the overview charts + topic stats (with data and empty
 * fallbacks), the attempts tab (completed / in-progress rows, adaptive «Уровни»
 * column), the questions and levels tabs, the Excel export action, and the full
 * attempt-details modal for both a standard and an adaptive attempt (achieved
 * levels + trajectory), plus the modal's not-found branch.
 *
 * Recharts is mocked with passthrough stubs: in jsdom the real ResponsiveContainer
 * measures a 0x0 box and renders nothing, so the chart branches would never mount.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Null = () => null;
  return {
    ResponsiveContainer: Pass, LineChart: Pass, BarChart: Pass,
    Line: Null, Bar: Null, XAxis: Null, YAxis: Null, CartesianGrid: Null, Tooltip: Null, Legend: Null,
  };
});

vi.mock("wouter", () => ({
  useRoute: () => [true, { testId: "t1" }],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import TestAnalyticsPage from "../test-analytics";

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const baseSummary = () => ({
  totalAttempts: 10, completedAttempts: 8, uniqueUsers: 6,
  avgPercent: 72.5, avgDuration: 615, passRate: 60, avgScore: 14, maxScore: 20,
});

const standardAnalytics = () => ({
  testId: "t1", testTitle: "Тест по финансам", testMode: "standard" as const,
  summary: baseSummary(),
  topicStats: [
    { topicId: "top1", topicName: "Бюджет", totalAnswers: 20, correctAnswers: 15, avgPercent: 75, passRate: 80 },
    { topicId: "top2", topicName: "Инвестиции", totalAnswers: 18, correctAnswers: 6, avgPercent: 33.3, passRate: null },
  ],
  questionStats: [
    { questionId: "q1", questionPrompt: "Что такое бюджет?", questionType: "single", topicId: "top1", topicName: "Бюджет", difficulty: 2, totalAnswers: 10, correctAnswers: 7, correctPercent: 70 },
  ],
  scoreDistribution: [
    { range: "0-20", count: 1 }, { range: "21-40", count: 2 }, { range: "41-60", count: 1 },
    { range: "61-80", count: 3 }, { range: "81-100", count: 1 },
  ],
  dailyTrends: [
    { date: "2026-06-01", attempts: 5, avgPercent: 70, passRate: 60 },
    { date: "2026-06-02", attempts: 3, avgPercent: 75, passRate: 65 },
  ],
});

const emptyAnalytics = () => ({
  ...standardAnalytics(),
  summary: { ...baseSummary(), avgDuration: null },
  topicStats: [],
  questionStats: [],
  scoreDistribution: [{ range: "0-20", count: 0 }, { range: "81-100", count: 0 }],
  dailyTrends: [],
});

const adaptiveAnalytics = () => ({
  ...standardAnalytics(),
  testMode: "adaptive" as const,
  levelStats: [
    { levelIndex: 1, levelName: "Средний", topicId: "top1", topicName: "Бюджет", achievedCount: 2, attemptedCount: 5, passedCount: 2, failedCount: 3, avgCorrectPercent: 45 },
    { levelIndex: 0, levelName: "Базовый", topicId: "top1", topicName: "Бюджет", achievedCount: 5, attemptedCount: 8, passedCount: 5, failedCount: 3, avgCorrectPercent: 60 },
  ],
});

const standardAttempts = () => ({
  testId: "t1", testTitle: "Тест по финансам", testMode: "standard",
  attempts: [
    { attemptId: "at1", userId: "u1", username: "Иван Петров", startedAt: "2026-06-01T10:00:00Z", finishedAt: "2026-06-01T10:15:00Z", duration: 900, overallPercent: 85, earnedPoints: 17, possiblePoints: 20, passed: true, completed: true },
    { attemptId: "at2", userId: "u2", username: "Мария Сидорова", startedAt: "2026-06-02T09:00:00Z", finishedAt: null, duration: null, overallPercent: 0, earnedPoints: 0, possiblePoints: 0, passed: false, completed: false },
  ],
});

const adaptiveAttempts = () => ({
  testId: "t1", testTitle: "Тест по финансам", testMode: "adaptive",
  attempts: [
    { attemptId: "at1", userId: "u1", username: "Иван Петров", startedAt: "2026-06-01T10:00:00Z", finishedAt: "2026-06-01T10:15:00Z", duration: 900, overallPercent: 85, earnedPoints: 17, possiblePoints: 20, passed: true, completed: true, achievedLevels: [{ topicName: "Бюджет", levelName: "Средний" }] },
  ],
});

const standardDetail = () => ({
  attemptId: "at1", userId: "u1", username: "Иван Петров", testId: "t1", testTitle: "Тест по финансам",
  testMode: "standard", startedAt: "2026-06-01T10:00:00Z", finishedAt: "2026-06-01T10:15:00Z", duration: 900,
  overallPercent: 85, earnedPoints: 17, possiblePoints: 20, passed: true,
  answers: [
    { questionId: "q1", questionPrompt: "Что такое бюджет?", questionType: "single", topicId: "top1", topicName: "Бюджет", userAnswer: 0, correctAnswer: 1, isCorrect: true, earnedPoints: 1, possiblePoints: 1, difficulty: 2, levelName: "Уровень 1" },
    { questionId: "q2", questionPrompt: "Виды инвестиций?", questionType: "multiple", topicId: "top2", topicName: "Инвестиции", userAnswer: [0], correctAnswer: [1], isCorrect: false, earnedPoints: 0, possiblePoints: 1, difficulty: 3 },
  ],
  topicResults: [{ topicId: "top1", topicName: "Бюджет", correct: 7, total: 10, percent: 70 }],
});

const adaptiveDetail = () => ({
  ...standardDetail(),
  testMode: "adaptive",
  achievedLevels: [{ topicId: "top1", topicName: "Бюджет", levelIndex: 1, levelName: "Средний" }],
  trajectory: [
    { action: "level_up", topicName: "Бюджет", levelName: "Средний", message: "Повышение до «Средний»" },
    { action: "level_down", topicName: "Бюджет", levelName: "Базовый", message: "Понижение до «Базовый»" },
  ],
});

// ─── Configurable fetch stub ──────────────────────────────────────────────────────

type State = {
  mode: "standard" | "adaptive";
  analyticsBody: unknown;
  attemptsBody: unknown;
  detailBody: unknown;
};
let state: State;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state = { mode: "standard", analyticsBody: standardAnalytics(), attemptsBody: standardAttempts(), detailBody: standardDetail() };
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  fetchMock = vi.fn(async (input: string) => {
    const u = String(input);
    if (u === "/api/analytics/tests/t1") return ok(state.analyticsBody);
    if (u === "/api/analytics/tests/t1/attempts") return ok(state.attemptsBody);
    if (u.startsWith("/api/analytics/attempts/")) return ok(state.detailBody);
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TestAnalyticsPage />
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  renderPage();
  await waitFor(() => expect(screen.getByText("Тест по финансам")).toBeInTheDocument());
}

async function openAttemptsTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Попытки" }));
  await waitFor(() => expect(screen.getByText("Иван Петров")).toBeInTheDocument());
}

describe("<TestAnalyticsPage />", () => {
  it("shows the loading state before analytics arrive", async () => {
    renderPage();
    expect(screen.getByText("Загрузка аналитики...")).toBeInTheDocument();
    await renderLoaded();
  });

  it("renders the not-found empty state when analytics is null", async () => {
    state.analyticsBody = null;
    renderPage();
    await waitFor(() => expect(screen.getByText("Не удалось загрузить аналитику")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Назад к тестам/ })).toBeInTheDocument();
  });

  it("renders the header, standard-mode tag and the summary KPI cards", async () => {
    await renderLoaded();
    expect(screen.getByText("Аналитика")).toBeInTheDocument();
    expect(screen.getByText("Стандартный")).toBeInTheDocument();
    // «Попытки» is both a KPI card and a tab label — assert it exists at all.
    expect(screen.getAllByText("Попытки").length).toBeGreaterThan(0);
    for (const label of ["Средний балл", "Прохождение", "Среднее время", "Всего"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Derived footnotes.
    expect(screen.getByText("6 уникальных пользователей")).toBeInTheDocument();
    expect(screen.getByText(/из 20 баллов/)).toBeInTheDocument();
    expect(screen.getByText("2 незавершённых")).toBeInTheDocument();
  });

  it("renders the overview: charts and per-topic stats", async () => {
    await renderLoaded();
    expect(screen.getByText("Распределение результатов")).toBeInTheDocument();
    expect(screen.getByText("Тренды (30 дней)")).toBeInTheDocument();
    expect(screen.getByText("Статистика по темам")).toBeInTheDocument();
    // Topic rows with pass-rate tag (top1) and none (top2, passRate null).
    expect(screen.getByText("Бюджет")).toBeInTheDocument();
    expect(screen.getByText("Инвестиции")).toBeInTheDocument();
    expect(screen.getByText("80% сдали")).toBeInTheDocument();
    expect(screen.getByText("15 / 20 правильных")).toBeInTheDocument();
  });

  it("falls back to empty states across the overview when there is no data", async () => {
    state.analyticsBody = emptyAnalytics();
    await renderLoaded();
    // Both charts + topic list render their «Нет данных» fallbacks.
    expect(screen.getAllByText("Нет данных").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Нет данных по темам")).toBeInTheDocument();
    // avgDuration null → «—» in the KPI card.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("lists attempts with completed and in-progress rows", async () => {
    await renderLoaded();
    await openAttemptsTab();
    expect(screen.getByText("Мария Сидорова")).toBeInTheDocument();
    expect(screen.getByText("Сдан")).toBeInTheDocument();       // completed + passed
    expect(screen.getByText("В процессе")).toBeInTheDocument(); // not completed
    expect(screen.getByText("85.0%")).toBeInTheDocument();
  });

  it("renders the empty attempts state when there are none", async () => {
    state.attemptsBody = { testId: "t1", testTitle: "Тест по финансам", testMode: "standard", attempts: [] };
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Попытки" }));
    await waitFor(() => expect(screen.getByText("Нет попыток")).toBeInTheDocument());
  });

  it("renders the questions tab with per-question stats", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
    await waitFor(() => expect(screen.getByText("Что такое бюджет?")).toBeInTheDocument());
    expect(screen.getByText("Сложность: 2")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("opens the standard attempt-details modal and shows the answers", async () => {
    await renderLoaded();
    await openAttemptsTab();
    const row = screen.getByText("Иван Петров").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Детализация попытки"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("85.0%")).toBeInTheDocument());
    // Points, verdict tag and the answers list.
    expect(within(dialog).getByText("17/20")).toBeInTheDocument();
    expect(within(dialog).getByText("Пройден")).toBeInTheDocument();
    expect(within(dialog).getByText("Что такое бюджет?")).toBeInTheDocument();
    expect(within(dialog).getByText("Виды инвестиций?")).toBeInTheDocument();
    expect(within(dialog).getByText("Ответы (2)")).toBeInTheDocument();
  });

  it("shows the modal not-found branch when the detail payload is null", async () => {
    state.detailBody = null;
    await renderLoaded();
    await openAttemptsTab();
    const row = screen.getByText("Иван Петров").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Детализация попытки"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Не удалось загрузить данные")).toBeInTheDocument());
  });

  it("exports to Excel via the header action", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Экспорт Excel/ }));
    expect(window.open).toHaveBeenCalledWith("/api/analytics/tests/t1/export/excel", "_blank");
  });

  it("renders the adaptive dashboard: tag, levels tab and per-level stats", async () => {
    state.analyticsBody = adaptiveAnalytics();
    await renderLoaded();
    expect(screen.getByText("Адаптивный")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Уровни" }));
    await waitFor(() => expect(screen.getByText("Базовый")).toBeInTheDocument());
    // Both levels of the topic render, sorted by index.
    expect(screen.getByText("Средний")).toBeInTheDocument();
    expect(screen.getByText("5 достигли")).toBeInTheDocument();
  });

  it("shows the adaptive «Уровни» attempt column and details modal (levels + trajectory)", async () => {
    state.analyticsBody = adaptiveAnalytics();
    state.attemptsBody = adaptiveAttempts();
    state.detailBody = adaptiveDetail();
    await renderLoaded();
    await openAttemptsTab();
    // Adaptive attempts table carries the achieved-level tag.
    expect(screen.getAllByText("Средний").length).toBeGreaterThan(0);
    const row = screen.getByText("Иван Петров").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Детализация попытки"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Достигнутые уровни")).toBeInTheDocument());
    expect(within(dialog).getByText("Траектория прохождения")).toBeInTheDocument();
    expect(within(dialog).getByText("Повышение до «Средний»")).toBeInTheDocument();
    expect(within(dialog).getByText("Понижение до «Базовый»")).toBeInTheDocument();
    // Close the modal.
    fireEvent.click(within(dialog).getByLabelText("Закрыть"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
