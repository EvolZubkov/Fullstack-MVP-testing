/**
 * @module pages/review/__tests__/review-player-page.test
 *
 * PRD-52 FR-08..FR-14: окно рецензента. Проверяется то, что отличает его от
 * отладчика автора: ровно три вкладки, выключенные по умолчанию тумблеры, гашение
 * вердикта в режиме полной выдачи и экран отказа без гранта.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

const { sessionMock, snapshotMock } = vi.hoisted(() => ({
  sessionMock: { state: {} as Record<string, unknown>, runKey: 0, reset: vi.fn(), rebuild: vi.fn() },
  snapshotMock: { buildSnapshot: vi.fn() },
}));

vi.mock("wouter", () => ({ useParams: () => ({ testId: "t1" }) }));
vi.mock("@/features/tests/debug-player/use-debug-session", () => ({
  useDebugSession: () => sessionMock,
}));
vi.mock("@/features/tests/debug-player/inspector-snapshot", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildSnapshot: snapshotMock.buildSnapshot,
}));

import ReviewPlayerPage from "../review-player-page";

/** Страница держит панель комментариев, а та ходит в API через react-query. */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewPlayerPage />
    </QueryClientProvider>,
  );
}

/** Снимок инспектора с минимумом, который читают панели. */
function snapshot(over: Record<string, unknown> = {}) {
  return {
    hasData: true,
    status: { drawn: 4, answered: 3, percentDone: 25, score: null, verdict: null, completed: false, alarm: null },
    score: {
      available: true, adaptive: false, earnedPoints: 9, possiblePoints: 16, percent: 56,
      passed: false, rule: { type: "percent", value: 80 }, sections: [],
    },
    protocol: { rows: [], note: "" },
    draw: { started: false, sections: [] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.state = { status: "ready", playUrl: "/api/tests/t1/review/play/tok/index.html", title: "Тест", template: "default" };
  snapshotMock.buildSnapshot.mockReturnValue(snapshot());
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as { TBInspector?: unknown }).TBInspector;
});

describe("окно рецензента", () => {
  it("показывает ровно три вкладки инспектора", async () => {
    renderPage();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Комментарии", "Результаты", "Протокол"]);
  });

  it("оба режимных тумблера выключены при открытии", async () => {
    renderPage();
    expect(await screen.findByTestId("toggle-reference")).not.toBeChecked();
    expect(screen.getByTestId("toggle-full-draw")).not.toBeChecked();
  });

  it("эталон возвращается на следующем вопросе сам, без выкл/вкл тумблера", async () => {
    const applyReference = vi.fn();
    const clearReference = vi.fn();
    (window as { TBInspector?: unknown }).TBInspector = { applyReference, clearReference };
    renderPage();
    // Ждём первый снимок: после него `status.drawn` постоянен до конца прогона,
    // поэтому переход к следующему вопросу его уже не меняет.
    await waitFor(() => expect(snapshotMock.buildSnapshot).toHaveBeenCalled());
    await userEvent.click(await screen.findByTestId("toggle-reference"));
    const onToggle = applyReference.mock.calls.length;
    expect(onToggle).toBeGreaterThan(0);
    // Переход к следующему вопросу перерисовывает экран внутри пакета — разметка
    // эталона стирается вместе со старым DOM, а `status.drawn` при этом не меняется.
    // Оверлей обязан вернуться сам, на ближайшем тике.
    await waitFor(
      () => expect(applyReference.mock.calls.length).toBeGreaterThan(onToggle),
      { timeout: 3000 },
    );
  });

  it("включение полной выдачи перестраивает прогон и уходит в стейдж хешем", async () => {
    renderPage();
    await userEvent.click(await screen.findByTestId("toggle-full-draw"));
    expect(sessionMock.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTitle("stage")).toHaveAttribute("src", expect.stringContaining("#tbfa=1"));
    });
  });

  it("после старта прогона тумблер полной выдачи недоступен", async () => {
    snapshotMock.buildSnapshot.mockReturnValue(snapshot({ draw: { started: true, sections: [] } }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("toggle-full-draw")).toBeDisabled());
  });

  it("в режиме полной выдачи вердикт не показывается, а объясняется", async () => {
    renderPage();
    await userEvent.click(await screen.findByTestId("toggle-full-draw"));
    await userEvent.click(screen.getByRole("tab", { name: "Результаты" }));
    // Точным текстом, а не подстрокой: иначе проверка совпадает с нижней плашкой
    // прогона («оценка не считается…») и проходит, даже если баннера в панели нет.
    expect(await screen.findByText("Не считается в режиме полной выдачи")).toBeInTheDocument();
    expect(screen.queryByText("Не пройден")).not.toBeInTheDocument();
  });

  it("без гранта показывает экран отказа, а не пустой прогон", async () => {
    sessionMock.state = { status: "forbidden" };
    renderPage();
    expect(await screen.findByText("Нет доступа к рецензированию")).toBeInTheDocument();
    expect(screen.queryByTitle("stage")).not.toBeInTheDocument();
  });

  it("ошибка сборки объясняется текстом, а не молчанием", async () => {
    sessionMock.state = { status: "error", error: "422: в теме нет вопросов" };
    renderPage();
    expect(await screen.findByText("Не удалось открыть прогон")).toBeInTheDocument();
    expect(screen.getByText(/в теме нет вопросов/)).toBeInTheDocument();
  });
});
