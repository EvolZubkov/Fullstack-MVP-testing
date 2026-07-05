/**
 * @module pages/author/__tests__/analytics.test
 * @description Coverage suite for the combined analytics dashboard
 * (`pages/author/analytics.tsx`). Exercises the three top-level tabs (overview /
 * attempts / export), the source & test filters, the attempts table (search,
 * date-range, sort, pagination), the full attempt-details modal for both a
 * standard web attempt (answer formatting across all 4 question types) and an
 * adaptive LMS attempt (achieved levels), plus the loading / empty / error
 * states and the Excel/CSV export flows.
 *
 * Recharts is mocked with framework-free stubs: in jsdom the real
 * ResponsiveContainer measures a 0x0 box and renders nothing, so the chart
 * branches would never mount. Passthrough stubs let the LineChart/BarChart
 * branches render deterministically without DOM measurement.
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
    ResponsiveContainer: Pass,
    LineChart: Pass,
    BarChart: Pass,
    Line: Null,
    Bar: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    Legend: Null,
  };
});

import AnalyticsPage from "../analytics";

// ---------------------------------------------------------------------------
// Fixture builders (fresh objects per test — nothing is shared/mutated).
// ---------------------------------------------------------------------------

const summary = () => ({
  totalAttempts: 100,
  passedAttempts: 60,
  passRate: 60,
  avgPercent: 72.5,
  webAttempts: 70,
  lmsAttempts: 30,
  uniqueWebUsers: 40,
  uniqueLmsUsers: 15,
  adaptiveAttempts: 5,
  adaptivePassed: 3,
});

const webAttempt = () => ({
  id: "a1",
  testId: "test1",
  testTitle: "Тест по финансам",
  userId: "u1",
  username: "Иван Петров",
  userEmail: "ivan@test.ru",
  startedAt: "2026-06-01T10:00:00Z",
  finishedAt: "2026-06-01T10:15:00Z",
  duration: 900,
  resultPercent: 85,
  resultPassed: true,
  totalPoints: 17,
  maxPoints: 20,
  source: "web" as const,
});

const lmsAttempt = () => ({
  id: "s1",
  testId: "test1",
  testTitle: "Тест по финансам",
  lmsUserId: "lms-1",
  lmsUserName: "Мария Сидорова",
  lmsUserEmail: "maria@lms.ru",
  startedAt: "2026-06-02T09:00:00Z",
  finishedAt: "2026-06-02T09:20:00Z",
  duration: 1200,
  resultPercent: 0,
  resultPassed: false,
  totalPoints: 0,
  maxPoints: 0,
  source: "lms" as const,
  isAdaptive: true,
  achievedTopics: 2,
  totalTopics: 3,
});

const combined = () => ({
  summary: summary(),
  attempts: [webAttempt(), lmsAttempt()],
  testStats: [
    { testId: "test1", testTitle: "Тест по финансам", totalAttempts: 100, webAttempts: 70, lmsAttempts: 30, passRate: 60, avgPercent: 72 },
  ],
  topicStats: [
    { topicId: "top1", topicName: "Бюджетирование", totalAnswers: 200, correctAnswers: 150, avgPercent: 75, failureCount: 5 },
    { topicId: "top2", topicName: "Инвестиции", totalAnswers: 180, correctAnswers: 60, avgPercent: 33, failureCount: 40 },
  ],
  trends: [
    { date: "2026-06-01", attempts: 5, webAttempts: 3, lmsAttempts: 2, avgPercent: 70, passRate: 60 },
    { date: "2026-06-02", attempts: 8, webAttempts: 5, lmsAttempts: 3, avgPercent: 75, passRate: 65 },
  ],
  top5Tests: [{ testId: "test1", testTitle: "Тест по финансам" }],
  alerts: [{ testId: "test1", testTitle: "Тест по финансам", recentPassRate: 40, prevPassRate: 70, drop: 30 }],
});

const emptyCombined = () => ({
  summary: { ...summary(), totalAttempts: 0, passedAttempts: 0, passRate: 0, avgPercent: 0, adaptiveAttempts: 0, adaptivePassed: 0 },
  attempts: [],
  testStats: [],
  topicStats: [],
  trends: [],
  top5Tests: [],
  alerts: [],
});

const exportFilters = () => ({
  tests: [
    { id: "test1", title: "Тест по финансам", mode: "standard", hasWebAttempts: true, hasLmsAttempts: true },
    { id: "test2", title: "Адаптивный тест", mode: "adaptive", hasWebAttempts: true, hasLmsAttempts: false },
  ],
  users: [{ id: "u1", username: "Иван Петров", source: "web", email: "ivan@test.ru" }],
  groups: [{ id: "g1", name: "Группа А", userCount: 1, userIds: ["u1"] }],
  scormPackages: [],
});

const webDetail = () => ({
  attemptId: "a1",
  userId: "u1",
  username: "Иван Петров",
  testId: "test1",
  testTitle: "Тест по финансам",
  testMode: "standard",
  startedAt: "2026-06-01T10:00:00Z",
  finishedAt: "2026-06-01T10:15:00Z",
  duration: 900,
  overallPercent: 85,
  earnedPoints: 17,
  possiblePoints: 20,
  passed: true,
  answers: [
    { questionId: "q1", questionPrompt: "Single?", questionType: "single", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: 0, correctAnswer: { correctIndex: 1 }, options: ["A", "B"], isCorrect: false, earnedPoints: 0, possiblePoints: 1 },
    { questionId: "q2", questionPrompt: "Multiple?", questionType: "multiple", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: [0, 1], correctAnswer: { correctIndices: [1] }, options: ["X", "Y", "Z"], isCorrect: false, earnedPoints: 0, possiblePoints: 1 },
    { questionId: "q3", questionPrompt: "Matching?", questionType: "matching", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: { 0: 1, 1: 0 }, correctAnswer: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] }, leftItems: ["L1", "L2"], rightItems: ["R1", "R2"], isCorrect: false, earnedPoints: 0, possiblePoints: 1, levelName: "Уровень 1" },
    { questionId: "q4", questionPrompt: "Ranking?", questionType: "ranking", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: [2, 0, 1], correctAnswer: { correctOrder: [0, 1, 2] }, items: ["I1", "I2", "I3"], isCorrect: true, earnedPoints: 1, possiblePoints: 1 },
  ],
  topicResults: [
    { topicId: "top1", topicName: "Бюджетирование", percent: 85, passed: true, earnedPoints: 17, possiblePoints: 20 },
  ],
  source: "web",
});

const lmsDetail = () => ({
  attemptId: "s1",
  lmsUserId: "lms-1",
  lmsUserName: "Мария Сидорова",
  lmsUserEmail: "maria@lms.ru",
  testId: "test1",
  testTitle: "Тест по финансам",
  testMode: "adaptive",
  startedAt: "2026-06-02T09:00:00Z",
  finishedAt: "2026-06-02T09:20:00Z",
  duration: 1200,
  overallPercent: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  passed: false,
  answers: [],
  topicResults: [],
  achievedLevels: [{ topicId: "top1", topicName: "Бюджетирование", levelIndex: 1, levelName: "Средний" }],
  source: "lms",
});

// ---------------------------------------------------------------------------
// Configurable fetch stub. Each test may tweak `state` before rendering.
// ---------------------------------------------------------------------------

type State = {
  combinedOk: boolean;
  combined: ReturnType<typeof combined>;
  summary: ReturnType<typeof summary>;
  tests: { id: string; title: string }[];
  filters: ReturnType<typeof exportFilters>;
  webDetail: ReturnType<typeof webDetail>;
  lmsDetail: ReturnType<typeof lmsDetail>;
};

let state: State;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state = {
    combinedOk: true,
    combined: combined(),
    summary: summary(),
    tests: [{ id: "test1", title: "Тест по финансам" }],
    filters: exportFilters(),
    webDetail: webDetail(),
    lmsDetail: lmsDetail(),
  };

  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
  });
  const fail = () => ({
    ok: false,
    status: 500,
    statusText: "Server Error",
    json: async () => ({}),
    text: async () => "boom",
    blob: async () => new Blob(),
  });

  fetchMock = vi.fn(async (input: string) => {
    const u = String(input);
    if (u.startsWith("/api/analytics/combined-full")) return state.combinedOk ? ok(state.combined) : fail();
    if (u.startsWith("/api/analytics/summary")) return ok(state.summary);
    if (u === "/api/tests") return ok(state.tests);
    if (u.startsWith("/api/export/filters")) return ok(state.filters);
    if (u.startsWith("/api/analytics/scorm-attempts/")) return ok(state.lmsDetail);
    if (u.startsWith("/api/analytics/attempts/")) return ok(state.webDetail);
    if (u.startsWith("/api/export/excel")) return ok({ done: true });
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("alert", vi.fn());

  // downloadBlob / CSV export helpers use these; jsdom does not implement them.
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsPage />
    </QueryClientProvider>,
  );
}

/** Render and wait until the main dashboard header is on screen. */
async function renderLoaded() {
  renderPage();
  await waitFor(() => expect(screen.getByText("Аналитика")).toBeInTheDocument());
}

async function openAttemptsTab() {
  fireEvent.click(screen.getByRole("tab", { name: /Попытки/ }));
  await waitFor(() => expect(screen.getByText("Иван Петров")).toBeInTheDocument());
}

/** Open a labelled DS Select (its trigger button is a sibling of the label). */
function openSelectByLabel(labelText: string) {
  const label = screen.getByText(labelText);
  const trigger = label.parentElement!.querySelector("button");
  fireEvent.click(trigger!);
}

describe("<AnalyticsPage />", () => {
  it("shows the loading state before data arrives", async () => {
    renderPage();
    expect(screen.getByText("Загрузка аналитики...")).toBeInTheDocument();
    await renderLoaded();
  });

  it("renders the error state when the combined feed fails", async () => {
    state.combinedOk = false;
    renderPage();
    await waitFor(() => expect(screen.getByText("Не удалось загрузить аналитику")).toBeInTheDocument());
  });

  it("renders the overview: KPI cards, alerts, charts and topic stats", async () => {
    await renderLoaded();
    // KPI cards (summary query).
    expect(screen.getByText("Всего попыток")).toBeInTheDocument();
    expect(screen.getByText("Успешных")).toBeInTheDocument();
    expect(screen.getByText("Pass Rate")).toBeInTheDocument();
    expect(screen.getByText("Средний балл")).toBeInTheDocument();
    // Adaptive footnote from summary.
    expect(screen.getByText(/адаптивных/)).toBeInTheDocument();
    // Pass-rate drop alert.
    expect(screen.getByText(/Pass rate упал на/)).toBeInTheDocument();
    // Chart section headers + topic stats.
    expect(screen.getByText("Тренды (30 дней)")).toBeInTheDocument();
    expect(screen.getByText("Эффективность тестов")).toBeInTheDocument();
    expect(screen.getByText("Статистика по темам")).toBeInTheDocument();
    // Problem topics: top2 has failures.
    expect(screen.getByText("Проблемные темы")).toBeInTheDocument();
    expect(screen.getByText("40 ошибок")).toBeInTheDocument();
  });

  it("toggles the trend mode between total and by-test", async () => {
    await renderLoaded();
    const byTest = screen.getByRole("tab", { name: "По тестам" });
    fireEvent.click(byTest);
    expect(byTest).toHaveAttribute("aria-selected", "true");
    const total = screen.getByRole("tab", { name: "Общие" });
    fireEvent.click(total);
    expect(total).toHaveAttribute("aria-selected", "true");
  });

  it("renders empty states across the overview when there is no data", async () => {
    state.combined = emptyCombined();
    state.summary = { ...summary(), totalAttempts: 0, passedAttempts: 0, passRate: 0, avgPercent: 0, adaptiveAttempts: 0, adaptivePassed: 0 };
    await renderLoaded();
    // Trends + test-efficiency charts fall back to «Нет данных».
    expect(screen.getAllByText("Нет данных").length).toBeGreaterThanOrEqual(2);
    // No failing topics.
    expect(screen.getByText("Нет проблемных тем!")).toBeInTheDocument();
  });

  it("filters by source through the Select and resets", async () => {
    await renderLoaded();
    // Open the source Select (its trigger shows «Все»).
    fireEvent.click(screen.getByText("Все").closest("button")!);
    fireEvent.click(screen.getByText("Web"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("combined-full?source=web"))).toBe(true),
    );
    // A reset control appears once the reloaded feed for the new source renders.
    const reset = await screen.findByRole("button", { name: "Сбросить" });
    fireEvent.click(reset);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Сбросить" })).not.toBeInTheDocument());
  });

  it("filters by test through the test Select", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText("Все тесты").closest("button")!);
    const menu = screen.getByRole("listbox");
    fireEvent.click(within(menu).getByText("Тест по финансам"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("testId=test1"))).toBe(true),
    );
  });

  it("refreshes both feeds on «Обновить»", async () => {
    await renderLoaded();
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes("combined-full")).length;
    fireEvent.click(screen.getByRole("button", { name: /Обновить/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("combined-full")).length).toBeGreaterThan(before),
    );
  });

  it("renders the attempts table with web and LMS rows", async () => {
    await renderLoaded();
    await openAttemptsTab();
    expect(screen.getByText("Мария Сидорова")).toBeInTheDocument();
    expect(screen.getByText("ivan@test.ru")).toBeInTheDocument();
    // Adaptive LMS attempt shows a topic ratio + «Завершён».
    expect(screen.getByText("2/3 тем")).toBeInTheDocument();
    expect(screen.getByText("Завершён")).toBeInTheDocument();
  });

  it("filters attempts by user search and date, then resets", async () => {
    await renderLoaded();
    await openAttemptsTab();

    // User search narrows to the matching web attempt.
    fireEvent.change(screen.getByPlaceholderText("Имя или email..."), { target: { value: "Иван" } });
    await waitFor(() => expect(screen.queryByText("Мария Сидорова")).not.toBeInTheDocument());
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    // The filtered/total counter reflects the narrowed set.
    expect(screen.getByText(/из 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    await waitFor(() => expect(screen.getByText("Мария Сидорова")).toBeInTheDocument());

    // Date-range inputs (the two type=date fields under «С:»/«По:»).
    const dateInputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
    // dateFrom excludes the earlier web attempt (2026-06-01).
    fireEvent.change(dateInputs[0], { target: { value: "2026-06-02" } });
    await waitFor(() => expect(screen.queryByText("Иван Петров")).not.toBeInTheDocument());
    expect(screen.getByText("Мария Сидорова")).toBeInTheDocument();
    // dateTo then also excludes the LMS attempt → empty table state.
    fireEvent.change(dateInputs[1], { target: { value: "2026-06-01" } });
    await waitFor(() => expect(screen.getByText("Нет данных о попытках")).toBeInTheDocument());
    // Reset restores both rows.
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    await waitFor(() => expect(screen.getByText("Иван Петров")).toBeInTheDocument());
  });

  it("sorts the attempts table across all sortable columns", async () => {
    await renderLoaded();
    await openAttemptsTab();
    for (const header of ["Результат", "Пользователь", "Тест", "Дата"]) {
      fireEvent.click(screen.getByText(header));
    }
    // Still renders after re-sorting.
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
  });

  it("paginates when there are more than a page of attempts", async () => {
    state.combined = { ...combined(), attempts: makeAttempts(30) as never, alerts: [] };
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: /Попытки/ }));
    await waitFor(() => expect(screen.getByText("Страница 1 из 2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "→" }));
    await waitFor(() => expect(screen.getByText("Страница 2 из 2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "←" }));
    await waitFor(() => expect(screen.getByText("Страница 1 из 2")).toBeInTheDocument());
  });

  it("opens the web attempt-details modal and formats every answer type", async () => {
    await renderLoaded();
    await openAttemptsTab();
    const row = screen.getByText("Иван Петров").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Детали попытки"));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Детали попытки")).toBeInTheDocument());
    // Overview tab: percent + points.
    await waitFor(() => expect(within(dialog).getByText("85%")).toBeInTheDocument());

    // Answers tab covers formatUserAnswer / formatCorrectAnswer for all 4 types.
    fireEvent.click(within(dialog).getByRole("tab", { name: /Ответы \(4\)/ }));
    await waitFor(() => expect(within(dialog).getByText("Single?")).toBeInTheDocument());
    expect(within(dialog).getByText("Multiple?")).toBeInTheDocument();
    expect(within(dialog).getByText("Matching?")).toBeInTheDocument();
    expect(within(dialog).getByText("Ranking?")).toBeInTheDocument();
    // Ranking user answer is reordered by index → «1. I3».
    expect(within(dialog).getByText(/1\. I3/)).toBeInTheDocument();

    // Topics tab (standard mode) shows per-topic percent.
    fireEvent.click(within(dialog).getByRole("tab", { name: "Темы" }));
    await waitFor(() => expect(within(dialog).getByText("Бюджетирование")).toBeInTheDocument());

    // Close it.
    fireEvent.click(within(dialog).getByLabelText("Закрыть"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the adaptive LMS attempt-details modal with achieved levels", async () => {
    await renderLoaded();
    await openAttemptsTab();
    const row = screen.getByText("Мария Сидорова").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Детали попытки"));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("ЗАВЕРШЁН")).toBeInTheDocument());
    // Achieved level card.
    expect(within(dialog).getByText("Средний")).toBeInTheDocument();
    // Answers tab is empty for the adaptive attempt.
    fireEvent.click(within(dialog).getByRole("tab", { name: /Ответы \(0\)/ }));
    await waitFor(() => expect(within(dialog).getByText("Нет данных об ответах")).toBeInTheDocument());
  });

  it("downloads a single attempt as CSV from the row action", async () => {
    await renderLoaded();
    await openAttemptsTab();
    const row = screen.getByText("Иван Петров").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Скачать детали попытки"));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it("downloads an adaptive attempt as CSV (achieved-levels branch)", async () => {
    await renderLoaded();
    await openAttemptsTab();
    const row = screen.getByText("Мария Сидорова").closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Скачать детали попытки"));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it("drives the export filter controls: select-all, search, groups, users", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Экспорт" }));
    await screen.findByRole("button", { name: /Создать отчёт/ });

    // Select-all users, then select-all groups (which clears users), then a
    // single group toggle — exercises handleSelectAllUsers/Groups + handleGroupToggle.
    fireEvent.click(screen.getByRole("button", { name: "Выбрать всех" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Выбрать все" })[1]);
    fireEvent.click(screen.getByLabelText(/Группа А/));
    // Select-all tests.
    fireEvent.click(screen.getAllByRole("button", { name: "Выбрать все" })[0]);
    await waitFor(() => expect(screen.getByText("Тесты (2 выбрано)")).toBeInTheDocument());
    // Search boxes across all three lists.
    fireEvent.change(screen.getByPlaceholderText("Поиск тестов..."), { target: { value: "Адапт" } });
    fireEvent.change(screen.getByPlaceholderText("Поиск тестов..."), { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("Поиск групп..."), { target: { value: "А" } });
    fireEvent.change(screen.getByPlaceholderText("Поиск пользователей..."), { target: { value: "Иван" } });
    // Best-attempt toggle + a sheet toggle.
    fireEvent.click(screen.getByLabelText("Только лучшая попытка каждого пользователя"));
    fireEvent.click(screen.getByLabelText("Сводка"));
    expect(screen.getByRole("button", { name: /Создать отчёт/ })).toBeInTheDocument();
  });

  it("reveals the adaptive best-attempt criterion and exports to the LMS workbook", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Экспорт" }));
    await screen.findByRole("button", { name: /Создать отчёт/ });

    // Switch test-mode to adaptive → only the adaptive test remains.
    openSelectByLabel("Режим тестов");
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Адаптивные"));
    fireEvent.click(await screen.findByLabelText("Адаптивный тест"));

    // Best-attempt on + an adaptive test selected → the criterion Select appears.
    fireEvent.click(screen.getByLabelText("Только лучшая попытка каждого пользователя"));
    openSelectByLabel("Критерий лучшей попытки (для адаптивных)");
    fireEvent.click(within(screen.getByRole("listbox")).getByText("По сумме уровней"));

    // Source → LMS-only, then export hits the LMS workbook endpoint.
    openSelectByLabel("Источник данных");
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Только LMS"));
    fireEvent.click(screen.getByRole("button", { name: /Создать отчёт/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/export/excel-lms"))).toBe(true),
    );
  });

  it("runs the export tab: loads filters, gates the button, and posts to Excel", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Экспорт" }));
    // Wait for the filters feed to load (the button lives in the loaded body).
    const exportBtn = await screen.findByRole("button", { name: /Создать отчёт/ });
    expect(screen.getByText("Экспорт отчёта")).toBeInTheDocument();

    // Without a selected test the export button is disabled.
    expect(exportBtn).toBeDisabled();

    // Select a test → counter updates and the button enables.
    fireEvent.click(screen.getByLabelText("Тест по финансам"));
    await waitFor(() => expect(screen.getByText("Тесты (1 выбрано)")).toBeInTheDocument());
    expect(exportBtn).not.toBeDisabled();

    fireEvent.click(exportBtn);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/export/excel"))).toBe(true),
    );
  });
});

/** Build N synthetic web attempts to exercise the attempts-table pagination. */
function makeAttempts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    testId: "test1",
    testTitle: "Тест по финансам",
    username: `User ${i}`,
    userEmail: `u${i}@t.ru`,
    startedAt: "2026-06-01T10:00:00Z",
    finishedAt: `2026-06-0${(i % 9) + 1}T10:00:00Z`,
    duration: 600,
    resultPercent: i,
    resultPassed: i > 50,
    totalPoints: i,
    maxPoints: 100,
    source: "web" as const,
  }));
}
