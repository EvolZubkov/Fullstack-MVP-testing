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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  // Условия отбора экрана живут в адресе (FR-13, FR-24), поэтому странице нужен и `useLocation`.
  useLocation: () => ["/author/tests/t1/analytics", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

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
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  fetchMock = vi.fn(async (input: string) => {
    const u = String(input);
    if (u === "/api/analytics/tests/t1") return ok(state.analyticsBody);
    if (u === "/api/analytics/psychometrics/t1") return ok(state.psychometricsBody);
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
    <QueryClientProvider client={client}><ToastProvider>
      <TestAnalyticsPage />
    </ToastProvider></QueryClientProvider>,
  );
}

async function renderLoaded() {
  renderPage();
  await waitFor(() => expect(screen.getByText("Тест по финансам")).toBeInTheDocument());
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
  it("шапка по эскизу: «Все тесты», название, объём и источники, реестр и «Обновить»", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: "Все тесты" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Тест по финансам" })).toBeInTheDocument();
    expect(screen.getByText("8 завершённых прохождений · веб, телеметрия LMS и импортированные выгрузки"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Прохождения теста/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Экспорт Excel/ })).toBeInTheDocument();
    // Э6: загрузка выгрузки LMS ушла в раздел «Импорт» — в шапке её нет.
    expect(screen.queryByRole("button", { name: /Загрузить выгрузку LMS/ })).toBeNull();
  });

  it("четыре плитки сводки — на «Обзоре», время медианой", async () => {
    await renderLoaded();
    for (const label of ["Прохождений", "Сдали", "Средний результат", "Время, медиана"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
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



  it("не показывает списка попыток: он живёт в реестре прохождений", async () => {
    await renderLoaded();

    // FR-23: один список на продукт, а не два. Вместо вкладки — переход в реестр, где тот же
    // список умеет фильтровать, догружать и вести в разбор.
    expect(screen.queryByRole("tab", { name: "Попытки" })).toBeNull();
    expect(screen.getByRole("link", { name: /Прохождения теста/ })).toBeInTheDocument();
  });

  it("ведёт в реестр с фильтром по этому тесту", async () => {
    await renderLoaded();

    const link = screen.getByRole("link", { name: /Прохождения теста/ });
    expect(link.getAttribute("href")).toContain("/author/analytics?testId=t1");
  });

  it("renders the questions tab with per-question stats", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
    // PRD-56 FR-15: карточки заменены таблицей — задания сравнивают между собой.
    await waitFor(() => expect(screen.getByText("Что такое бюджет?")).toBeInTheDocument());
    // PRD-66 FR-02: место доли верных заняла трудность по доле балла.
    expect(screen.getByText("Трудность")).toBeInTheDocument();
    expect(screen.getByText("80 %")).toBeInTheDocument();
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
  });



  describe("фильтр экрана доходит до психометрики (PRD-66 FR-04a, FR-54b)", () => {
    beforeEach(() => {
      // Условия экрана живут в адресе: с них и начинается страница.
      window.history.replaceState(null, "", "/author/tests/t1/analytics?groupId=g1&source=import");
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
      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));

      // Без условий в запросе автор видел бы числа по всем прохождениям, выбрав одну группу.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "/api/analytics/psychometrics/t1?groupId=g1&source=import",
        expect.anything(),
      ));
      expect(fetchMock).not.toHaveBeenCalledWith("/api/analytics/psychometrics/t1", expect.anything());
    });

    it("отчёт и матрица выгружаются по тем же условиям, что на экране", async () => {
      await renderLoaded();
      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));

      // Файл, собранный по другим условиям, чем показанные, невоспроизводим (FR-54b).
      const report = await screen.findByRole("link", { name: /Психометрический отчёт/ });
      expect(report.getAttribute("href")).toBe("/api/analytics/psychometrics/t1/export?groupId=g1&source=import");
      expect(screen.getByRole("link", { name: /Матрица ответов/ }).getAttribute("href"))
        .toBe("/api/analytics/psychometrics/t1/matrix?groupId=g1&source=import");
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
      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));

      expect(await screen.findByText("Только первая попытка")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith("/api/analytics/psychometrics/t1", expect.anything());
    });

    it("на «Обзоре» чипа нет: там считаются все попытки", async () => {
      await renderLoaded();
      expect(screen.queryByText("Только первая попытка")).toBeNull();
    });

    it("снятие чипа пересчитывает по всем попыткам и предупреждает о зависимости наблюдений", async () => {
      await renderLoaded();
      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));
      await screen.findByText("Только первая попытка");
      fireEvent.click(removeChip("Только первая попытка"));

      fireEvent.click(await screen.findByRole("button", { name: "Вернуть: только первая попытка" }));

      expect(await screen.findByText("Только первая попытка")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText("Посчитано по всем попыткам")).toBeNull());
    });
  });

  /**
   * Задачи 3.1 — 3.3 плана сверки, эскиз prd66-item-quality (состояние compare): вход в
   * сравнение — кнопкой в строке фильтра, сам режим — одна карточка «Сравнение срезов», выход —
   * переключателем «Одна выборка / Сравнение» в её шапке.
   */
  describe("сравнение срезов на «Качестве вопросов» (PRD-66 FR-04b)", () => {
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

    it("кнопка «Сравнить срезы» стоит в строке фильтра только на «Качестве вопросов»", async () => {
      await renderLoaded();
      expect(screen.queryByRole("button", { name: /Сравнить срезы/ })).toBeNull();

      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));
      const button = await screen.findByRole("button", { name: /Сравнить срезы/ });
      expect(button.closest(".ou-filterbar")).not.toBeNull();
    });

    it("режим — одна карточка со слотами PRD-56 и выходом переключателем", async () => {
      await renderLoaded();
      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));
      fireEvent.click(await screen.findByRole("button", { name: /Сравнить срезы/ }));

      expect(await screen.findByText("Сравнение срезов")).toBeInTheDocument();
      // Внутри режима вход не нужен: выход — переключатель в шапке карточки.
      expect(screen.queryByRole("button", { name: /Сравнить срезы/ })).toBeNull();
      expect(await screen.findByText("486 прохождений")).toBeInTheDocument();
      expect(screen.getByText("Условия отбора · 0")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ Добавить срез" })).toBeInTheDocument();
      expect(screen.getByText("до четырёх срезов")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Одна выборка" }));
      await waitFor(() => expect(screen.queryByText("Сравнение срезов")).toBeNull());
      expect(screen.getByRole("button", { name: /Сравнить срезы/ })).toBeInTheDocument();
    });
  });

  /** План сверки 5.6, эскиз prd66-item-quality (состояние wf-scales). */
  describe("измерительный тест на «Качестве вопросов» (PRD-66 FR-52)", () => {
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

    it("вкладка — только раздел шкал: ни плиток, ни таблицы вопросов, ни поясняющей карточки", async () => {
      await renderLoaded();
      fireEvent.click(screen.getByRole("tab", { name: "Качество вопросов" }));

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

  it("exports to Excel via the header action", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Экспорт Excel/ }));
    expect(window.open).toHaveBeenCalledWith("/api/analytics/tests/t1/export/excel", "_blank");
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
