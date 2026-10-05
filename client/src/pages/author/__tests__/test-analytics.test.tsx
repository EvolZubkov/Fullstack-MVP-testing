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

// Э2: тест и вопрос — сегменты адреса уровня, вкладка — `?tab=`. Страница рисуется в настоящем
// маршрутизаторе с адресом в памяти: переходы по вкладкам и к разбору вопроса меняют этот адрес.
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ANALYTICS_QUESTION_ROUTE, ANALYTICS_TEST_ROUTE } from "@/features/analytics/levels/analytics-routes";

import TestAnalyticsPage from "../test-analytics";
import { ToastProvider } from "@skillum/ui-kit";

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const baseSummary = () => ({
  totalAttempts: 10, completedAttempts: 8, uniqueUsers: 6,
  avgPercent: 72.5, avgDuration: 615, medianDuration: 540, passRate: 60, avgScore: 14, maxScore: 20,
});

const standardAnalytics = () => ({
  testId: "t1", testTitle: "Тест по финансам", testMode: "standard" as const,
  summary: baseSummary(),
  thresholdPercent: 70,
  topicStats: [
    {
      topicId: "top1", topicName: "Бюджет",
      passedShare: 80, correctShare: 75, thresholdPercent: 70, inSample: 20,
      subtopics: [
        { name: "Планирование", passedShare: 70, correctShare: 64, thresholdPercent: 70, inSample: 12 },
      ],
    },
    {
      topicId: "top2", topicName: "Инвестиции",
      passedShare: null, correctShare: 33, thresholdPercent: null, inSample: 18,
      subtopics: [],
    },
  ],
  questionStats: [
    {
      questionId: "q1", questionPrompt: "Что такое бюджет?", questionType: "single",
      topicId: "top1", topicName: "Бюджет", difficulty: 2,
      totalAnswers: 10, gradedAnswers: 10, correctAnswers: 7, correctPercent: 70,
      skipShare: 0, exposurePercent: 80, latencyMedianMs: 42_000, latencySampleSize: 10,
      reviewFlags: [],
    },
  ],
  scoreDistribution: [
    { label: "0–9", from: 0, to: 10, count: 1, share: 12.5, tone: "error", holdsThreshold: false },
    { label: "60–69", from: 60, to: 70, count: 2, share: 25, tone: "error", holdsThreshold: false },
    { label: "70–79", from: 70, to: 80, count: 3, share: 37.5, tone: "success", holdsThreshold: false },
    { label: "90–100", from: 90, to: 100, count: 2, share: 25, tone: "success", holdsThreshold: false },
  ],
  passTrend: [
    { key: "2026-06", label: "июнь 2026", attempts: 5, judged: 5, passRate: 60 },
    { key: "2026-07", label: "июль 2026", attempts: 3, judged: 3, passRate: 65 },
  ],
});

const emptyAnalytics = () => ({
  ...standardAnalytics(),
  summary: { ...baseSummary(), avgDuration: null },
  topicStats: [],
  questionStats: [],
  scoreDistribution: [
    { label: "0–9", from: 0, to: 10, count: 0, share: 0, tone: "error", holdsThreshold: false },
    { label: "90–100", from: 90, to: 100, count: 0, share: 0, tone: "success", holdsThreshold: false },
  ],
  passTrend: [],
});

const adaptiveAnalytics = () => ({
  ...standardAnalytics(),
  testMode: "adaptive" as const,
  levelStats: [
    { levelIndex: 1, levelName: "Средний", topicId: "top1", topicName: "Бюджет", achievedCount: 2, attemptedCount: 5, passedCount: 2, failedCount: 3, avgCorrectPercent: 45 },
    { levelIndex: 0, levelName: "Базовый", topicId: "top1", topicName: "Бюджет", achievedCount: 5, attemptedCount: 8, passedCount: 5, failedCount: 3, avgCorrectPercent: 60 },
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
  detailBody: unknown;
  /** PRD-66: расчёт психометрики — питает колонки трудности и дискриминативности. */
  psychometricsBody: unknown;
};
let state: State;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state = {
    mode: "standard", analyticsBody: standardAnalytics(), detailBody: standardDetail(),
    psychometricsBody: [],
  };
  const ok = (body: unknown) => ({
    ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
    // Э5.2: окно «Экспорт» скачивает ответ файлом.
    blob: async () => new Blob(["xlsx"]), headers: new Headers(),
  });
  fetchMock = vi.fn(async (input: string) => {
    const u = String(input);
    if (u === "/api/analytics/tests/t1") return ok(state.analyticsBody);
    if (u === "/api/analytics/psychometrics/t1") return ok(state.psychometricsBody);
    if (u.startsWith("/api/analytics/attempts/")) return ok(state.detailBody);
    // Э3.1: реестр прохождений внутри теста.
    if (u.startsWith("/api/analytics/registry")) {
      return ok({
        rows: [{
          id: "a1", participant: "Иван Петров", participantKey: null, userId: "u1",
          testId: "t1", testTitle: "Тест по финансам", attemptNumber: 1,
          startedAt: "2026-06-01T10:00:00Z", finishedAt: "2026-06-01T10:15:00Z",
          durationMs: 900_000, percent: 85, passed: true, outcome: "passed",
          source: "web", groupId: null, groups: [],
        }],
        total: 1, limit: 25, offset: 0,
      });
    }
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

/** Адрес в памяти последнего отрисованного экрана; `history` — все адреса, где он побывал. */
let memory: ReturnType<typeof memoryLocation>;

function renderPage(path = "/author/analytics/tests/t1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  memory = memoryLocation({ path, record: true });
  return render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <QueryClientProvider client={client}><ToastProvider>
        <Route path={ANALYTICS_QUESTION_ROUTE}><TestAnalyticsPage /></Route>
        <Route path={ANALYTICS_TEST_ROUTE}><TestAnalyticsPage /></Route>
      </ToastProvider></QueryClientProvider>
    </Router>,
  );
}

async function renderLoaded() {
  renderPage();
  // Название теста — и в крошке, и в заголовке (Э2): ждём заголовок.
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Тест по финансам" })).toBeInTheDocument());
}

/** Э4б: «Качество вопросов» — набор колонок «Психометрика» вкладки «Вопросы». */
async function openPsychometrics() {
  fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
  fireEvent.click(await screen.findByRole("button", { name: "Психометрика" }));
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

  // План сверки, 5.1: каркас по эскизам prd56-test-analytics и prd66-item-quality.
  it("шапка по эскизу Э2: крошки «Аналитика › тест», название, объём и источники, «Обновить»", async () => {
    await renderLoaded();
    // Крошки вместо «Все тесты»: «Аналитика» ведёт на общий уровень, отобранный по этому тесту.
    const crumbs = screen.getByRole("navigation", { name: "Хлебные крошки" });
    expect(within(crumbs).getByRole("link", { name: "Аналитика" })).toHaveAttribute("href", "/author/analytics?testId=t1&tab=attempts");
    expect(within(crumbs).getByText("Тест по финансам")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Все тесты" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Тест по финансам" })).toBeInTheDocument();
    expect(screen.getByText("8 завершённых прохождений · веб, телеметрия LMS и импортированные выгрузки"))
      .toBeInTheDocument();
    // Э3.1: прохождения — вкладка, а не переход из шапки в общий реестр.
    expect(screen.queryByRole("button", { name: /Прохождения теста/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Экспорт Excel/ })).toBeInTheDocument();
    // Э6: загрузка выгрузки LMS ушла в раздел «Импорт» — в шапке её нет.
    expect(screen.queryByRole("button", { name: /Загрузить выгрузку LMS/ })).toBeNull();
  });

  it("четыре плитки сводки — на «Обзоре», время медианой", async () => {
    await renderLoaded();
    for (const label of ["Прохождений", "Сдали", "Средний результат", "Время, медиана"]) {
      // «Сдали» и «Средний результат» есть и в заголовках «Результатов по группам» (Э3.2).
      expect(screen.getAllByText(label).filter(el => !el.closest("th"))).toHaveLength(1);
    }
    expect(screen.getByText("60 %")).toBeInTheDocument();
    expect(screen.getByText("73 %")).toBeInTheDocument();
    expect(screen.getByText("9:00")).toBeInTheDocument();
  });

  it("на других вкладках плиток сводки нет, а фильтр стоит под вкладками", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));

    await waitFor(() => expect(screen.queryByText("Средний результат")).toBeNull());
    const filter = document.querySelector(".ou-filterbar")!;
    const tablist = screen.getByRole("tablist");
    // Фильтр идёт ПОСЛЕ списка вкладок в порядке документа.
    expect(tablist.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the overview: charts and per-topic stats", async () => {
    await renderLoaded();
    // PRD-56 FR-13, FR-14: три блока обзора — распределение, темы и помесячная динамика.
    expect(screen.getByText("Распределение результатов")).toBeInTheDocument();
    expect(screen.getByText("Динамика сдаваемости")).toBeInTheDocument();
    expect(screen.getByText("Темы и подтемы")).toBeInTheDocument();
    expect(screen.getByText("Бюджет")).toBeInTheDocument();
    expect(screen.getByText("Инвестиции")).toBeInTheDocument();
    // Подтема — строкой под своей темой.
    expect(screen.getByText("Планирование")).toBeInTheDocument();
    // Единицы счёта названы в заголовках: 80 % прохождений против 75 % ответов (FR-14a).
    expect(screen.getByText("Прошли тему, % прохождений")).toBeInTheDocument();
    expect(screen.getByText("Доля верных, % ответов")).toBeInTheDocument();
  });

  it("falls back to empty states across the overview when there is no data", async () => {
    state.analyticsBody = { ...emptyAnalytics(), summary: { ...baseSummary(), avgDuration: null, medianDuration: null, completedAttempts: 0 } };
    await renderLoaded();
    // Пустые блоки говорят, ЧЕГО нет, а не «нет данных» вообще: по первому понятно, что
    // прохождений не было, по второму — что читателю думать.
    expect(screen.getAllByText(/Прохождений пока нет/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Разрезов по темам пока нет/)).toBeInTheDocument();
    expect(screen.getByText(/динамику строить не из чего/)).toBeInTheDocument();
    // medianDuration null → «—» на плитке «Время, медиана».
    expect(screen.getByText("—")).toBeInTheDocument();
  });



  it("прохождения теста — вкладка сразу за «Обзором», тот же реестр (Э3.1)", async () => {
    await renderLoaded();

    // FR-23: один список на продукт. Э3.1: он открывается внутри теста, а не в общем разделе.
    const tabs = screen.getAllByRole("tab").map(tab => tab.textContent);
    expect(tabs.slice(0, 2)).toEqual(["Обзор", "Прохождения"]);
    expect(screen.queryByRole("link", { name: /Прохождения теста/ })).toBeNull();
  });

  it("реестр внутри теста: запрос по этому тесту, без колонки «Тест», строка открывает разбор (Э3.1)", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Прохождения" }));

    await waitFor(() => expect(screen.getByText("Иван Петров")).toBeInTheDocument());
    const asked = fetchMock.mock.calls.map(call => String(call[0])).find(url => url.startsWith("/api/analytics/registry"));
    expect(asked).toContain("testId=t1");
    expect(screen.getByText("Прохождения теста")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^Тест/ })).toBeNull();
    // Фильтр — один на уровень теста: второй панели внутри карточки нет, экспорт — в общей.
    expect(screen.getAllByRole("button", { name: /^Фильтр/ })).toHaveLength(1);
    // Э5.2: окно экспорта на уровне одно — кнопка в шапке, своей у вкладки нет.
    expect(screen.queryByRole("button", { name: "Экспорт" })).toBeNull();
    expect(screen.getByRole("button", { name: /Экспорт Excel/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Иван Петров"));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).startsWith("/api/analytics/attempts/a1"))).toBe(true));
  });

  it("«Прохождения с ошибкой» ведут во вкладку «Прохождения» этого теста с условием по вопросу (Э3.1)", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
    await waitFor(() => expect(screen.getByText("Что такое бюджет?")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Действия с вопросом: Что такое бюджет?" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Прохождения с ошибкой: Что такое бюджет?" }));

    // Один переход: условие и вкладка вместе, тест — в адресе, а не в условиях.
    await waitFor(() => expect(memory.history?.at(-1)).toBe("/author/analytics/tests/t1?wrongQuestionId=q1&tab=passages"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Прохождения" })).toHaveAttribute("aria-selected", "true"));
  });

  it("renders the questions tab with per-question stats", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
    // PRD-56 FR-15: карточки заменены таблицей — задания сравнивают между собой.
    await waitFor(() => expect(screen.getByText("Что такое бюджет?")).toBeInTheDocument());
    // PRD-66 FR-02: место доли верных заняла трудность по доле балла.
    expect(screen.getByText("Трудность")).toBeInTheDocument();
    // Э4б: экспозиция — в наборе колонок «Показы и пропуски».
    fireEvent.click(screen.getByRole("button", { name: "Показы и пропуски" }));
    expect(await screen.findByText("80 %")).toBeInTheDocument();
  });

  it("берёт трудность и дискриминативность из расчёта психометрики (PRD-66 FR-02, FR-03)", async () => {
    // Ручка одна на обе вкладки: колонка таблицы и карточка разбора не могут разойтись в
    // числах, потому что читают один ответ.
    state.psychometricsBody = {
      items: [{
        questionId: "q1", observations: 40, difficulty: 0.62, correctedDifficulty: null,
        itemRest: 0.31, discrimination: null, declaredDifficulty: null,
        difficultyConfidence: "reliable", coefficientConfidence: "reliable",
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
        timingFlags: { rushed: false, slow: false },
      }],
      reliability: "too-few-items", sem: null, cutBand: null,
      sample: { respondents: 40, responses: 40, bySource: { web: 40 }, unknownVersionShare: 0 },
      firstAttemptOnly: true,
    };
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));

    await waitFor(() => expect(screen.getByText("0,62")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Разбор вопроса/ })).toBeInTheDocument();

    // Э2: разбор вопроса — свой адрес уровня, а не состояние страницы.
    fireEvent.click(screen.getByRole("button", { name: /Разбор вопроса/ }));
    expect(memory.history.at(-1)).toBe("/author/analytics/tests/t1/questions/q1");
  });

  it("крошка «Аналитика» возвращает на общий уровень с тем фильтром, с которым с него ушли (Э2)", async () => {
    window.history.replaceState({ analyticsReturn: "/author/analytics?testId=t1&testId=t2&tab=attention" }, "", "/");
    try {
      await renderLoaded();
      const crumbs = screen.getByRole("navigation", { name: "Хлебные крошки" });
      expect(within(crumbs).getByRole("link", { name: "Аналитика" }))
        .toHaveAttribute("href", "/author/analytics?testId=t1&testId=t2&tab=attention");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("уровень вопроса (Э2): три крошки, заголовок — вопрос, вкладок теста нет", async () => {
    const breakdown = {
      questionId: "q1", prompt: "Какая мера относится к антикоррупционным?", questionType: "single",
      topicName: "Право и комплаенс",
      item: {
        observations: 268, difficulty: 0.41, correctedDifficulty: 0.21, itemRest: 0.34, discrimination: 0.38,
        declaredDifficulty: 60, timing: { medianMs: 48_000, q1Ms: 31_000, q3Ms: 82_000, measured: 244 },
      },
      groups: { size: 72, share: 0.27, topDifficulty: 0.68, bottomDifficulty: 0.19 },
      options: [],
    };
    fetchMock.mockImplementation(async (input: string) => {
      const u = String(input);
      // Переход «в другой тест» (t2) открывает его уровень вопроса — аналитика теста нужна и ему.
      const body = u === "/api/analytics/tests/t1" || u === "/api/analytics/tests/t2" ? state.analyticsBody
        : u.startsWith("/api/analytics/psychometrics/t1/items/q1") ? breakdown
        : u.startsWith("/api/analytics/psychometrics/t1") ? state.psychometricsBody
        // Э3.3: «Вопрос в этом тесте» и «Этот вопрос в других тестах».
        : u === "/api/analytics/tests/t1/questions/q1/card" ? {
          questionId: "q1", prompt: "Какая мера относится к антикоррупционным?", questionType: "single",
          topicName: "Право и комплаенс", tags: ["Антикоррупция"], media: null, excluded: false,
          points: 2, pointsInTest: true, scoringKind: "exact", scoringInTest: false,
          difficulty: 60, difficultyInTest: false, correctAnswer: null, windowMonths: 12,
          otherTests: [{ testId: "t2", title: "Антикоррупционный минимум", delivered: 412, observations: 412, difficulty: 0.58 }],
        }
        : [];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    renderPage("/author/analytics/tests/t1/questions/q1");

    const crumbs = await screen.findByRole("navigation", { name: "Хлебные крошки" });
    await waitFor(() => expect(within(crumbs).getByText("Какая мера относится к антикоррупционным?")).toBeInTheDocument());
    expect(within(crumbs).getByRole("link", { name: "Аналитика" })).toHaveAttribute("href", "/author/analytics?testId=t1&tab=attempts");
    // Крошка теста возвращает на вкладку, где живёт таблица вопросов (Э4б — «Вопросы»).
    expect(within(crumbs).getByRole("link", { name: "Тест по финансам" }))
      .toHaveAttribute("href", "/author/analytics/tests/t1?tab=questions");
    expect(screen.queryByRole("tab", { name: "Обзор" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ко всем вопросам" })).toBeNull();

    // Э3.3: сам вопрос и его настройки в тесте, другие тесты, переходы и действия.
    expect(await screen.findByText("Вопрос в этом тесте")).toBeInTheDocument();
    expect(screen.getByText("настроено в тесте")).toBeInTheDocument();
    expect(screen.getByText("выдаётся")).toBeInTheDocument();
    // PRD-70 FR-50: другие тесты и редакции — на странице вопроса банка; здесь — карточка с переходом.
    expect(screen.getByText("Вопрос в банке")).toBeInTheDocument();
    expect(screen.getByText(/Выдавался ещё в 1 тесте за 12 мес./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Статистика вопроса банка" })).toBeInTheDocument();
    // Пришли по ссылке, порядка таблицы нет — а таблица «Качества» пуста: соседей нет.
    expect(screen.getByRole("button", { name: /Предыдущий/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Следующий/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Действия с вопросом" }));
    expect((await screen.findAllByRole("menuitem")).map(item => item.textContent))
      .toEqual(["Открыть вопрос в теме", "Прохождения с ошибкой", "Исключить из выдачи…"]);

    // PRD-70 FR-50: «Статистика вопроса банка» ведёт на страницу вопроса по всем тестам.
    fireEvent.click(screen.getByRole("button", { name: "Статистика вопроса банка" }));
    await waitFor(() => expect(memory.history?.at(-1)).toBe("/author/analytics/questions/q1"));
  });

  it("«Предыдущий / Следующий» идут по порядку таблицы, из которой пришли; крошка — на её вкладку (Э3.3)", async () => {
    window.history.replaceState({ questionOrder: ["q0", "q1", "q2"], questionFrom: "questions" }, "", "/");
    fetchMock.mockImplementation(async (input: string) => {
      const body = String(input) === "/api/analytics/tests/t1" ? state.analyticsBody : [];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    renderPage("/author/analytics/tests/t1/questions/q1");

    const crumbs = await screen.findByRole("navigation", { name: "Хлебные крошки" });
    expect(within(crumbs).getByRole("link", { name: "Тест по финансам" }))
      .toHaveAttribute("href", "/author/analytics/tests/t1?tab=questions");
    fireEvent.click(screen.getByRole("button", { name: /Следующий/ }));
    await waitFor(() => expect(memory.history?.at(-1)).toBe("/author/analytics/tests/t1/questions/q2"));
    window.history.replaceState(null, "", "/");
  });

  it("вкладка — в адресе: переход по вкладке пишется в историю, адрес с вкладкой её открывает (Э2)", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
    expect(memory.history.at(-1)).toBe("/author/analytics/tests/t1?tab=questions");
  });



  describe("фильтр экрана доходит до психометрики (PRD-66 FR-04a, FR-54b)", () => {
    beforeEach(() => {
      // Условия экрана живут в адресе: с них и начинается страница.
      window.history.replaceState(null, "", "/author/analytics/tests/t1?groupId=g1&source=import");
      state.psychometricsBody = {
        items: [{
          questionId: "q1", observations: 40, difficulty: 0.62, correctedDifficulty: null,
          itemRest: 0.31, discrimination: null, declaredDifficulty: null,
          difficultyConfidence: "reliable", coefficientConfidence: "reliable",
          flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
          timingFlags: { rushed: false, slow: false },
        }],
        reliability: "too-few-items", sem: null, cutBand: null,
        sample: { respondents: 40, responses: 40, bySource: { import: 40 }, unknownVersionShare: 0 },
        firstAttemptOnly: true,
      };
      // Ответы — по пути БЕЗ условий: сами условия проверяет каждый тест.
      fetchMock.mockImplementation(async (input: string) => {
        const path = String(input).split("?")[0];
        const body = path === "/api/analytics/psychometrics/t1" ? state.psychometricsBody
          : path === "/api/analytics/tests/t1" ? state.analyticsBody : [];
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      });
    });
    afterEach(() => window.history.replaceState(null, "", "/"));

    it("расчёт «Качества вопросов» идёт по отобранной выборке, а не по всему тесту", async () => {
      await renderLoaded();
      await openPsychometrics();

      // Без условий в запросе автор видел бы числа по всем прохождениям, выбрав одну группу.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/analytics/psychometrics/t1?groupId=g1&source=import",
        expect.anything(),
      ));
      expect(fetchMock).not.toHaveBeenCalledWith("/api/analytics/psychometrics/t1", expect.anything());
    });

    it("отчёт и матрица выгружаются по тем же условиям, что на экране", async () => {
      await renderLoaded();
      await openPsychometrics();

      // Файл, собранный по другим условиям, чем показанные, невоспроизводим (FR-54b). Э5.2: отчёт
      // и матрица выгружаются из окна «Экспорт» шапки, по тому же адресу психометрики.
      URL.createObjectURL = vi.fn(() => "blob:x");
      URL.revokeObjectURL = vi.fn();
      for (const [kind, path] of [[/Психометрический отчёт/, "export"], [/Матрица ответов/, "matrix"]] as const) {
        fireEvent.click(screen.getByRole("button", { name: /Экспорт Excel/ }));
        fireEvent.click(await screen.findByRole("radio", { name: kind }));
        fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
          `/api/analytics/psychometrics/t1/${path}?groupId=g1&source=import`, expect.anything()));
      }
    });
  });

  describe("«только первая попытка» (PRD-66 FR-51)", () => {
    /** Расчёт психометрики с одним заданием; режим попыток сервер возвращает тем, что спросили. */
    const bodyFor = (url: string) => ({
      items: [{
        questionId: "q1", observations: 40, difficulty: 0.62, correctedDifficulty: null,
        itemRest: 0.31, discrimination: null, declaredDifficulty: null,
        difficultyConfidence: "reliable", coefficientConfidence: "reliable",
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
        timingFlags: { rushed: false, slow: false },
      }],
      reliability: "too-few-items", sem: null, cutBand: null,
      sample: { respondents: 40, responses: 40, bySource: { web: 40 }, unknownVersionShare: 0 },
      firstAttemptOnly: !url.includes("firstAttemptOnly=false"),
    });

    beforeEach(() => {
      fetchMock.mockImplementation(async (input: string) => {
        const url = String(input);
        const path = url.split("?")[0];
        const body = path === "/api/analytics/psychometrics/t1" ? bodyFor(url)
          : path === "/api/analytics/tests/t1" ? state.analyticsBody : [];
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      });
    });

    /** Кнопка снятия чипа с этой подписью. */
    const removeChip = (label: string) =>
      screen.getByText(label).closest(".ou-chip")!.querySelector("button[aria-label]") as HTMLElement;

    it("по умолчанию включено и стоит чипом в строке фильтра «Качества вопросов»", async () => {
      await renderLoaded();
      await openPsychometrics();

      expect(await screen.findByText("Только первая попытка")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith("/api/analytics/psychometrics/t1", expect.anything());
    });

    it("на «Обзоре» чипа нет: там считаются все попытки", async () => {
      await renderLoaded();
      expect(screen.queryByText("Только первая попытка")).toBeNull();
    });

    it("снятие чипа пересчитывает по всем попыткам и предупреждает о зависимости наблюдений", async () => {
      await renderLoaded();
      await openPsychometrics();
      await screen.findByText("Только первая попытка");

      fireEvent.click(removeChip("Только первая попытка"));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/analytics/psychometrics/t1?firstAttemptOnly=false", expect.anything(),
      ));
      expect(await screen.findByText("Посчитано по всем попыткам")).toBeInTheDocument();
      expect(screen.queryByText("Только первая попытка")).toBeNull();
    });

    it("кнопка в предупреждении возвращает первую попытку", async () => {
      await renderLoaded();
      await openPsychometrics();
      await screen.findByText("Только первая попытка");
      fireEvent.click(removeChip("Только первая попытка"));

      fireEvent.click(await screen.findByRole("button", { name: "Вернуть: только первая попытка" }));

      expect(await screen.findByText("Только первая попытка")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText("Посчитано по всем попыткам")).toBeNull());
    });

    it("«Сбросить фильтры» снимает и «Только первая попытка» (замечание владельца 2026-10-04)", async () => {
      await renderLoaded();
      await openPsychometrics();
      await screen.findByText("Только первая попытка");

      fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));

      await waitFor(() => expect(screen.queryByText("Только первая попытка")).toBeNull());
    });

    it("снятое условие возвращается в окне «Условия отбора»", async () => {
      await renderLoaded();
      await openPsychometrics();
      await screen.findByText("Только первая попытка");
      fireEvent.click(removeChip("Только первая попытка"));
      await waitFor(() => expect(screen.queryByText("Только первая попытка")).toBeNull());

      fireEvent.click(screen.getByRole("button", { name: /^Фильтр/ }));
      fireEvent.click(await screen.findByLabelText("Только первая попытка"));
      fireEvent.click(screen.getByRole("button", { name: "Применить" }));

      expect(await screen.findByText("Только первая попытка")).toBeInTheDocument();
    });
  });

  /**
   * Э3.2 (эскиз approved/e3-test-and-question.html): срезы живут на уровне теста. Срез создаётся
   * из фильтра теста — «Сравнить со срезом» и «Сохранить как срез» стоят в его строке; сравнение
   * одно, во вкладке «Срезы», а «Качество вопросов» — вторая метрика рядом с «Результатом и темами».
   */
  describe("срезы на уровне теста (Э3.2)", () => {
    const slice = (id: string, name: string, respondents: number, conditions: Record<string, unknown>) => ({
      id, name, conditions, alpha: 0.8, reliabilityGap: null, sem: 2, respondents,
      observations: respondents * 10, itemsCount: 3, suspiciousCount: 1, items: [],
    });

    beforeEach(() => {
      fetchMock.mockImplementation(async (input: string) => {
        const path = String(input).split("?")[0];
        const body = path === "/api/analytics/psychometrics/t1/slices"
          ? { slices: [
            slice("whole", "Тест целиком", 486, {}),
            slice("s1", "Офис", 272, { sources: ["web"], groupIds: ["g1"] }),
          ] }
          : path === "/api/analytics/psychometrics/t1" ? {
            items: [], reliability: "too-few-items", sem: null, cutBand: null,
            sample: { respondents: 40, responses: 40, bySource: { web: 40 }, unknownVersionShare: 0 },
            firstAttemptOnly: true,
          }
            : path === "/api/analytics/tests/t1" ? state.analyticsBody : [];
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      });
    });

    it("в строке фильтра теста — «Сравнить со срезом» и «Сохранить как срез», выключенные без условий", async () => {
      await renderLoaded();

      const compare = screen.getByRole("button", { name: "Сравнить со срезом" });
      const save = screen.getByRole("button", { name: "Сохранить как срез" });
      expect(compare.closest(".ou-filterbar")).not.toBeNull();
      expect(compare).toBeDisabled();
      expect(save).toBeDisabled();
      // Прежнего входа в сравнение на «Качестве вопросов» нет: сравнение одно, во «Срезах».
      await openPsychometrics();
      expect(screen.queryByRole("button", { name: /Сравнить срезы/ })).toBeNull();
    });

    it("вкладка «Срезы» стоит за «Вопросами» (Э4б); сравнение по качеству — вторая метрика", async () => {
      await renderLoaded();
      const tabs = screen.getAllByRole("tab").map(tab => tab.textContent);
      expect(tabs).not.toContain("Качество вопросов");
      expect(tabs.indexOf("Срезы")).toBe(tabs.indexOf("Вопросы") + 1);

      fireEvent.click(screen.getByRole("tab", { name: "Срезы" }));
      fireEvent.click(await screen.findByRole("button", { name: "Сравнение" }));
      expect(await screen.findByText("Сравнение срезов")).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "Качество вопросов" }));

      // Тот же механизм слотов PRD-56 и тот же расчёт PRD-66, что был на «Качестве вопросов».
      expect(await screen.findByText("486 прохождений")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ Добавить срез" })).toBeInTheDocument();
      expect(screen.getByText("до четырёх срезов")).toBeInTheDocument();
    });
  });

  /** План сверки 5.6, эскиз prd66-item-quality (состояние wf-scales). */
  describe("измерительный тест: качество шкал (PRD-66 FR-52, Э4б)", () => {
    beforeEach(() => {
      // Измерительный тест: прохождения есть, оценённых среди них нет — по этому признаку шапка
      // говорит «измерительный тест» сразу, ещё до загрузки вкладки качества.
      state.analyticsBody = {
        ...standardAnalytics(),
        hasScales: true,
        summary: { ...standardAnalytics().summary, gradedAttempts: 0 },
      };
      fetchMock.mockImplementation(async (input: string) => {
        const path = String(input).split("?")[0];
        const body = path === "/api/analytics/psychometrics/t1/scales" ? {
          scales: [{
            scaleKey: "burnout", label: "Деперсонализация",
            reliability: { alpha: 0.64, items: 5, respondents: 312, totalSd: 4, dichotomous: false },
            respondents: 312, ipsative: false,
            items: [{
              questionId: "s1", prompt: "Мне стало безразлично, что происходит с коллегами",
              questionType: "scale", contribution: { value: 1, exact: true },
              observations: 312, itemRest: 0.61, distribution: [0.04, 0.17, 0.41, 0.28, 0.1],
              gradeLabels: ["совсем не согласен", "скорее не согласен", "затрудняюсь", "скорее согласен", "полностью согласен"],
              dead: false, againstScale: false, alphaIfMirrored: null,
            }],
          }],
          firstAttemptOnly: true,
        }
          : path === "/api/analytics/psychometrics/t1" ? {
            items: [{
              questionId: "s1", observations: 0, difficulty: null, correctedDifficulty: null,
              itemRest: null, discrimination: null, declaredDifficulty: null,
              difficultyConfidence: "insufficient", coefficientConfidence: "insufficient",
              flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
              timingFlags: { rushed: false, slow: false },
            }],
            reliability: "too-few-items", sem: null, cutBand: null,
            sample: { respondents: 312, responses: 312, bySource: { web: 312 }, unknownVersionShare: 0 },
            firstAttemptOnly: true,
            measurementOnly: true,
          }
            : path === "/api/analytics/tests/t1" ? state.analyticsBody : [];
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      });
    });

    it("качество шкал — на вкладке «Шкалы»; у опросника нет набора «Психометрика»", async () => {
      await renderLoaded();
      fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
      await screen.findByRole("button", { name: "Показы и пропуски" });
      expect(screen.queryByRole("button", { name: "Психометрика" })).toBeNull();
      fireEvent.click(screen.getByRole("tab", { name: "Шкалы" }));

      expect(await screen.findByText("Шкалы методики")).toBeInTheDocument();
      expect(screen.getByText("Пункты шкалы «Деперсонализация»")).toBeInTheDocument();
      expect(screen.getByText("+1")).toBeInTheDocument();
      expect(screen.queryByText("Тест измерительный")).toBeNull();
      expect(screen.queryByText(/Надёжность \(/)).toBeNull();
      expect(screen.queryByRole("link", { name: /Психометрический отчёт/ })).toBeNull();
      // Почему так — говорит подзаголовок страницы, как в эскизе.
      expect(screen.getByText(/измерительный тест, эталона у вопросов нет/)).toBeInTheDocument();
    });
  });

  it("Э5.2: «Экспорт Excel» в шапке открывает окно, книга уходит общей выгрузкой с этим тестом", async () => {
    await renderLoaded();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: /Экспорт Excel/ }));
    expect(await screen.findByRole("dialog", { name: "Экспорт" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === "/api/export/excel");
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({ testIds: ["t1"] });
    });
  });

  it("renders the adaptive dashboard: levels inside «Выдача» and per-level stats", async () => {
    // PRD-56: отдельной вкладки «Уровни» больше нет — статистика по уровням переехала в
    // «Выдачу», рядом с вариантами и версиями: она о том же, об устройстве выдачи.
    state.analyticsBody = adaptiveAnalytics();
    await renderLoaded();
    expect(screen.queryByRole("tab", { name: "Уровни" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Выдача" }));
    await waitFor(() => expect(screen.getByText("Базовый")).toBeInTheDocument());
    // Both levels of the topic render, sorted by index.
    expect(screen.getByText("Средний")).toBeInTheDocument();
    expect(screen.getByText("5 достигли")).toBeInTheDocument();
  });

});
