/**
 * @module pages/author/__tests__/analytics.test
 * @description Состав экрана аналитики (`pages/author/analytics.tsx`) и его переходы.
 *
 * PRD-56 FR-12 снял с экрана «Обзор»: средний балл и pass rate ПО ВСЕМ тестам, тренды и
 * проблемные темы вне контекста теста — величины, поверх которых нельзя принять решение, потому
 * что они смешивают разные пороги, шкалы и популяции. Здесь проверяется, что их нет НИ на экране,
 * ни в запросах: уцелевший запрос к снятой ручке — это та же нагрузка и то же обещание вернуть
 * «общее среднее», просто невидимое.
 *
 * Остальное — договор экрана: реестр открывается первым, срезы считаются только внутри выбранного
 * теста, очередь дел на своей вкладке, а окно разбора прохождения (все четыре типа ответов, веб и
 * адаптивный из LMS) и экспорт работают как прежде.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

import AnalyticsPage from "../analytics";
import { ToastProvider } from "@skillum/ui-kit";

// ---------------------------------------------------------------------------
// Fixture builders (fresh objects per test — nothing is shared/mutated).
// ---------------------------------------------------------------------------

/** Ответ `GET /api/analytics/registry` — форма строки реестра (PRD-56 FR-01). */
const registry = () => ({
  rows: [
    {
      id: "a1", participant: "Иван Петров", participantKey: null, userId: "u1",
      testId: "test1", testTitle: "Тест по финансам",
      startedAt: "2026-06-01T10:00:00Z", finishedAt: "2026-06-01T10:15:00Z",
      durationMs: 900_000, percent: 85, passed: true, outcome: "passed",
      source: "web", groupId: null,
    },
    {
      id: "s1", participant: "Мария Сидорова", participantKey: null, userId: null,
      testId: "test1", testTitle: "Тест по финансам",
      startedAt: "2026-06-02T09:00:00Z", finishedAt: "2026-06-02T09:20:00Z",
      durationMs: 1_200_000, percent: null, passed: null, outcome: "completed",
      source: "telemetry", groupId: null,
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
});

/** Ответ `GET /api/analytics/slices` — разбиение по оси (PRD-56 FR-06a). */
const slices = () => ({
  axis: "group",
  slices: [
    {
      id: "group:g1", name: "Розница", conditions: { groupIds: ["g1"] },
      started: 20, completed: 18, passed: 15, participants: 18,
      passRate: 83, avgPercent: 78, enoughData: true,
    },
  ],
  minObservations: 10,
});

/** Ответ `GET /api/analytics/attention` — очередь дел (PRD-56 FR-10). */
const attention = () => ({
  items: [
    {
      kind: "failed", participantId: "u1", participant: "Иван Петров",
      testId: "test1", testTitle: "Тест по финансам",
      observationId: "a1", startedAt: "2026-06-01T10:00:00Z",
    },
  ],
  counts: { overdue: 0, failed: 1, abandoned: 0, exhausted: 0 },
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
    { questionId: "q1", questionPrompt: "Single?", questionType: "single", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: 0, correctAnswer: { correctIndex: 1 }, options: ["A", "B"], isCorrect: false, ratio: 0, earnedPoints: 0, possiblePoints: 1, contribs: [{ scaleKey: "ee", delta: 2 }] },
    { questionId: "q2", questionPrompt: "Multiple?", questionType: "multiple", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: [0, 1], correctAnswer: { correctIndices: [1] }, options: ["X", "Y", "Z"], isCorrect: false, ratio: 0.5, earnedPoints: 0.5, possiblePoints: 1, contribs: [{ scaleKey: "ee", delta: 3 }, { scaleKey: "oc", delta: -1 }] },
    { questionId: "q3", questionPrompt: "Matching?", questionType: "matching", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: { 0: 1, 1: 0 }, correctAnswer: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] }, leftItems: ["L1", "L2"], rightItems: ["R1", "R2"], isCorrect: false, ratio: 0, earnedPoints: 0, possiblePoints: 1, levelName: "Уровень 1", contribs: [] },
    { questionId: "q4", questionPrompt: "Ranking?", questionType: "ranking", topicId: "top1", topicName: "Тема1", difficulty: 1, userAnswer: [2, 0, 1], correctAnswer: { correctOrder: [0, 1, 2] }, items: ["I1", "I2", "I3"], isCorrect: true, ratio: 1, earnedPoints: 1, possiblePoints: 1, contribs: [] },
  ],
  topicResults: [
    { topicId: "top1", topicName: "Бюджетирование", percent: 85, passed: true, earnedPoints: 17, possiblePoints: 20 },
  ],
  scaleResults: {
    ee: { raw: 5, normalized: 62.5, percent: 62.5, level: "high", label: "Высокий", hasValue: true },
    oc: { raw: -1, normalized: 0, percent: 0, level: "", label: "", hasValue: true },
  },
  resultVariables: { verdict: "passed", index: 3.5, flag: true },
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
  // PRD-56 FR-23: траектория переехала сюда со страницы теста вместе со списком попыток.
  trajectory: [
    { action: "level_up", levelName: "Средний", message: "Повышение до «Средний»" },
    { action: "level_down", levelName: "Базовый", message: "Понижение до «Базовый»" },
  ],
  source: "lms",
});

// ---------------------------------------------------------------------------
// Configurable fetch stub. Each test may tweak `state` before rendering.
// ---------------------------------------------------------------------------

type State = {
  tests: { id: string; title: string }[];
  webDetail: ReturnType<typeof webDetail>;
  lmsDetail: ReturnType<typeof lmsDetail>;
  registry: ReturnType<typeof registry>;
  slices: ReturnType<typeof slices>;
  attention: ReturnType<typeof attention>;
};

let state: State;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state = {
    tests: [{ id: "test1", title: "Тест по финансам" }],
    webDetail: webDetail(),
    lmsDetail: lmsDetail(),
    registry: registry(),
    slices: slices(),
    attention: attention(),
  };

  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
    headers: new Headers(),
  });
  fetchMock = vi.fn(async (input: string) => {
    const u = String(input);
    if (u.startsWith("/api/analytics/registry")) return ok(state.registry);
    if (u.startsWith("/api/analytics/slices")) return ok(state.slices);
    if (u.startsWith("/api/analytics/attention")) return ok(state.attention);
    if (u === "/api/tests") return ok(state.tests);
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
    <QueryClientProvider client={client}><ToastProvider>
      <AnalyticsPage />
    </ToastProvider></QueryClientProvider>,
  );
}

/** Render and wait until the main dashboard header is on screen. */
async function renderLoaded() {
  renderPage();
  await waitFor(() => expect(screen.getByText("Аналитика")).toBeInTheDocument());
}

/**
 * Шапка уровня: ряд с заголовком и действиями. Значки строк реестра называются так же, как кнопка
 * шапки («Аналитика теста»), поэтому кнопку ищут внутри шапки.
 */
function pageHeader(): HTMLElement {
  return screen.getByRole("heading", { level: 1, name: "Аналитика" }).parentElement!.parentElement!;
}

async function openAttemptsTab() {
  fireEvent.click(screen.getByRole("tab", { name: /Прохождения/ }));
  await waitFor(() => expect(screen.getByText("Иван Петров")).toBeInTheDocument());
}

/** Открыть вкладку «Срезы» и выбрать тест рамки — без него срезы не считаются (FR-07e). */
async function openSlicesForTest() {
  fireEvent.click(screen.getByRole("tab", { name: "Срезы" }));
  fireEvent.click(screen.getByLabelText("Тест"));
  // Список тестов приходит запросом: до его ответа выбирать нечего.
  fireEvent.click(await screen.findByText("Тест по финансам"));
  await waitFor(() => expect(screen.getByText("Розница")).toBeInTheDocument());
}

/** Open a labelled DS Select (its trigger button is a sibling of the label). */
function openSelectByLabel(labelText: string) {
  const label = screen.getByText(labelText);
  const trigger = label.parentElement!.querySelector("button");
  fireEvent.click(trigger!);
}

describe("<AnalyticsPage /> — состав экрана", () => {
  it("открывается на реестре прохождений", async () => {
    await renderLoaded();

    // Первое, что видит пришедший на экран, — прохождения, а не сводка по всему продукту.
    expect(screen.getByRole("tab", { name: /Прохождения/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Иван Петров")).toBeInTheDocument();
  });

  it("не показывает величин, посчитанных по всем тестам сразу", async () => {
    await renderLoaded();

    // FR-12: «Обзор» снят целиком. Средний балл и pass rate поверх РАЗНЫХ тестов складывают
    // разные пороги, шкалы и популяции — по такому числу нельзя ничего сделать.
    expect(screen.queryByRole("tab", { name: "Обзор" })).toBeNull();
    expect(screen.queryByText("Pass Rate")).toBeNull();
    expect(screen.queryByText("Средний балл")).toBeNull();
    expect(screen.queryByText("Проблемные темы")).toBeNull();
    expect(screen.queryByText("Тренды (30 дней)")).toBeNull();
  });

  it("не зовёт снятые ручки общей сводки", async () => {
    await renderLoaded();
    await screen.findByText("Иван Петров");

    // Уцелевший запрос к снятой ручке — это та же нагрузка и то же обещание «общего среднего»,
    // просто невидимое: экран считался бы очищенным, оставаясь на прежнем источнике.
    const called = fetchMock.mock.calls.map(call => String(call[0]));
    expect(called.some(url => url.includes("/api/analytics/combined"))).toBe(false);
    expect(called.some(url => url.includes("/api/analytics/summary"))).toBe(false);
  });

  it("даёт три вкладки: реестр, срезы и дела, требующие внимания", async () => {
    await renderLoaded();

    for (const name of [/Прохождения/, "Срезы", /Требует внимания/]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("не считает срезы, пока тест не выбран, и говорит почему", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Срезы" }));

    // FR-07e: рамка расчёта — один тест. Средние поверх нескольких тестов и есть то, что
    // FR-12 убирает, поэтому «посчитаем по всем» здесь не предлагается вовсе.
    expect(screen.getByText(/Срезы считаются внутри одного теста/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/api/analytics/slices"))).toBe(false);
  });

  it("считает срезы внутри выбранного теста", async () => {
    await renderLoaded();
    await openSlicesForTest();

    const sliced = fetchMock.mock.calls
      .map(call => String(call[0]))
      .find(url => url.includes("/api/analytics/slices"));
    expect(sliced).toContain("testId=test1");
    expect(screen.getByText("83 %")).toBeInTheDocument();
  });

  it("на вкладке очереди — число дел, как в эскизе", async () => {
    // Сколько дел ждёт, видно ещё до того, как вкладку открыли: ради этого она и существует.
    await renderLoaded();
    const tab = screen.getByRole("tab", { name: /Требует внимания/ });
    await waitFor(() => expect(tab.querySelector(".ou-tabs__badge")?.textContent).toBe("1"));
  });

  it("показывает очередь дел на своей вкладке", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: /Требует внимания/ }));

    expect(await screen.findByText("Не сдали")).toBeInTheDocument();
    expect(screen.getByText(/Иван Петров/)).toBeInTheDocument();
  });

  it("«Сравнить со срезом» уносит в сравнение вариант и версию отбора", async () => {
    window.history.replaceState(null, "", "/author/analytics?testId=test1&formId=form-b&snapshotId=snap-3");
    try {
      await renderLoaded();
      fireEvent.click(await screen.findByRole("button", { name: "Сравнить со срезом" }));

      // Без варианта и версии отбор «Вариант Б» сравнивался бы как тест целиком.
      await waitFor(() => {
        const asked = fetchMock.mock.calls
          .map(call => String(call[0]))
          .find(url => url.includes("/api/analytics/slices") && url.includes("conditions="));
        expect(asked).toBeTruthy();
        const conditions = JSON.parse(new URL(asked!, "http://x").searchParams.get("conditions")!);
        expect(conditions).toMatchObject({ formIds: ["form-b"], snapshotIds: ["snap-3"] });
      });
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("при отборе ровно по одному тесту в шапке — «Аналитика теста», ведёт на его уровень (Э2)", async () => {
    window.history.replaceState(null, "", "/author/analytics?testId=test1&groupId=g1");
    try {
      await renderLoaded();
      fireEvent.click(within(pageHeader()).getByRole("button", { name: /Аналитика теста/ }));
      expect(`${window.location.pathname}${window.location.search}`).toBe("/author/analytics/tests/test1?groupId=g1");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("без отбора по одному тесту кнопки «Аналитика теста» в шапке нет (Э2)", async () => {
    await renderLoaded();
    expect(within(pageHeader()).queryByRole("button", { name: /Аналитика теста/ })).toBeNull();
  });

  it("«Сравнить со срезом» уносит в сравнение оргусловия отбора (FR-06b)", async () => {
    window.history.replaceState(
      null, "", `/author/analytics?testId=test1&unit=${encodeURIComponent("Отдел продаж")}&position=${encodeURIComponent("Кладовщик")}`,
    );
    try {
      await renderLoaded();
      fireEvent.click(await screen.findByRole("button", { name: "Сравнить со срезом" }));

      await waitFor(() => {
        const asked = fetchMock.mock.calls
          .map(call => String(call[0]))
          .find(url => url.includes("/api/analytics/slices") && url.includes("conditions="));
        expect(asked).toBeTruthy();
        const conditions = JSON.parse(new URL(asked!, "http://x").searchParams.get("conditions")!);
        expect(conditions).toMatchObject({ units: ["Отдел продаж"], positions: ["Кладовщик"] });
      });
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("ведёт из строки среза в реестр с предзаполненными условиями", async () => {
    await renderLoaded();
    await openSlicesForTest();

    fireEvent.click(screen.getByRole("button", { name: "Действия со срезом: Розница" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Открыть прохождения" }));

    // FR-08: переход не просто открывает список, он показывает ТОТ ЖЕ состав — иначе строка
    // среза и открытый по ней реестр отвечали бы на один вопрос разными числами (FR-25).
    expect(screen.getByRole("tab", { name: /Прохождения/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      const asked = fetchMock.mock.calls
        .map(call => String(call[0]))
        .filter(url => url.includes("/api/analytics/registry"))
        .at(-1);
      expect(asked).toContain("groupId=g1");
      expect(asked).toContain("testId=test1");
    });
  });

  it("ведёт из очереди дел в разбор прохождения", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: /Требует внимания/ }));

    // FR-11: каждая позиция ведёт к участнику и его прохождению. Список дел, из которого
    // некуда пойти, заставляет искать человека руками в другом списке.
    fireEvent.click(await screen.findByRole("button", { name: /Разбор прохождения/ }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Детали попытки")).toBeInTheDocument());
  });

  it("renders the registry with web and LMS passages", async () => {
    await renderLoaded();
    await openAttemptsTab();
    expect(screen.getByText("Мария Сидорова")).toBeInTheDocument();
    // Источник и исход подписаны словами: из какой системы строка и чем кончилась.
    expect(screen.getByText("веб")).toBeInTheDocument();
    expect(screen.getByText("телеметрия LMS")).toBeInTheDocument();
    expect(screen.getByText("сдал")).toBeInTheDocument();
    // У прохождения без оценивания результата нет — прочерк, а не ноль (PRD-29 §6.7).
    expect(screen.getByText("завершено")).toBeInTheDocument();
  });

  // Отбор, сортировка и постраничность списка сняты со страницы сознательно (PRD-56 Э2):
  // условия живут в адресе и применяются запросом, порции приходят при прокрутке. Поведение
  // проверяется там, где теперь живёт, — `features/analytics/registry`.

  it("opens the web attempt-details modal and formats every answer type", async () => {
    await renderLoaded();
    await openAttemptsTab();
    // Строка реестра ведёт в разбор целиком: отдельной кнопки у неё нет (FR-01).
    fireEvent.click(screen.getByText("Иван Петров").closest("tr")!);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Детали попытки")).toBeInTheDocument());
    // Overview tab: percent + points.
    // Единый формат процентов (Э1): «85 %», пробел неразрывный — сравнение его схлопывает.
    await waitFor(() => expect(within(dialog).getByText("85 %")).toBeInTheDocument());

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

  it("показывает траекторию адаптивного прохождения", async () => {
    // FR-23: список попыток со страницы теста уходит, и окно разбора там же. Траектория была
    // видна ТОЛЬКО в нём — если не перенести, функция исчезнет молча.
    await renderLoaded();
    await openAttemptsTab();
    fireEvent.click(screen.getByText("Мария Сидорова").closest("tr")!);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Траектория прохождения")).toBeInTheDocument());
    expect(within(dialog).getByText("Повышение до «Средний»")).toBeInTheDocument();
    expect(within(dialog).getByText("Понижение до «Базовый»")).toBeInTheDocument();
  });

  it("opens the adaptive LMS attempt-details modal with achieved levels", async () => {
    await renderLoaded();
    await openAttemptsTab();
    fireEvent.click(screen.getByText("Мария Сидорова").closest("tr")!);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("ЗАВЕРШЁН")).toBeInTheDocument());
    // Achieved level card.
    expect(within(dialog).getByText("Средний")).toBeInTheDocument();
    // Answers tab is empty for the adaptive attempt.
    fireEvent.click(within(dialog).getByRole("tab", { name: /Ответы \(0\)/ }));
    await waitFor(() => expect(within(dialog).getByText("Нет данных об ответах")).toBeInTheDocument());
  });

  /**
   * D3: протокол попытки собирает сервер книгой Excel — содержимое книги проверяется тестами
   * `attempt-protocol`, здесь — что окно спрашивает нужную ручку и отдаёт файл.
   */
  it("скачивает протокол веб-попытки книгой с сервера", async () => {
    await renderLoaded();
    await openAttemptsTab();
    fireEvent.click(screen.getByText("Иван Петров").closest("tr")!);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Скачать детали/ }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map(call => String(call[0])))
      .toContainEqual(expect.stringMatching(/^\/api\/analytics\/attempts\/[^/]+\/export\/excel$/));
    expect(alert).not.toHaveBeenCalled();
  });

  it("скачивает протокол прохождения из LMS своей ручкой", async () => {
    await renderLoaded();
    await openAttemptsTab();
    fireEvent.click(screen.getByText("Мария Сидорова").closest("tr")!);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Скачать детали/ }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map(call => String(call[0])))
      .toContainEqual(expect.stringMatching(/^\/api\/analytics\/scorm-attempts\/[^/]+\/export\/excel$/));
  });

  it("сообщает, что скачать не удалось, когда сервер отказал", async () => {
    await renderLoaded();
    await openAttemptsTab();
    fireEvent.click(screen.getByText("Иван Петров").closest("tr")!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Скачать детали/ })).toBeInTheDocument());

    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 403 }) as never);
    fireEvent.click(within(dialog).getByRole("button", { name: /Скачать детали/ }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Не удалось скачать данные попытки"));
  });

  it("отдельной вкладки «Экспорт» нет: выгрузка — кнопкой в реестре (FR-04)", async () => {
    // Решение владельца 2026-09-25 (вариант «б»): «только лучшая попытка» переехала в окно
    // выгрузки реестра, вкладка со своим набором галочек снята.
    await renderLoaded();
    expect(screen.queryByRole("tab", { name: "Экспорт" })).toBeNull();
  });

  it("загрузки выгрузки LMS в аналитике нет — она в разделе «Импорт» (Э6)", async () => {
    await renderLoaded();
    expect(screen.queryByRole("button", { name: /Загрузить выгрузку LMS/ })).toBeNull();
  });

});
