/**
 * @module features/tests/debug-player/__tests__/debug-player-page.test
 * @description PRD-18 Phase 4 — component tests for the debug-player window. The
 * session hook (network + asset hosting) and `window.TBInspector` (compute) are
 * mocked; this asserts the DS shell: the status panel, every inspector tab, the
 * access/error/loading states, reset, and CSV export.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DebugSessionState } from "../use-debug-session";
import type { ProtocolRow, TBInspectorApi } from "../inspector-snapshot";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────────

const { sessionState, resetMock } = vi.hoisted(() => ({
  sessionState: { current: { status: "ready", playUrl: "/play/x" } as DebugSessionState },
  resetMock: vi.fn(),
}));

vi.mock("../use-debug-session", () => ({
  useDebugSession: () => ({ state: sessionState.current, runKey: 0, reset: resetMock }),
}));
vi.mock("wouter", () => ({ useParams: () => ({ testId: "t1" }) }));

import DebugPlayerPage from "../debug-player-page";

// ─── Compute mock ───────────────────────────────────────────────────────────────

function row(over: Partial<ProtocolRow>): ProtocolRow {
  return {
    idx: 1, topicName: "Алгебра", prompt: "2+2?", type: "single", typeLabel: "Один ответ", answerStr: "4",
    answered: true, verdict: "correct", ratio: 1, ratioPct: 100, score: 1, sMax: 1, earned: 1, points: 1,
    difficulty: null, levelName: null, contribs: [], ...over,
  };
}

function installTB(over: Partial<TBInspectorApi> = {}) {
  window.TBInspector = {
    readPkg: vi.fn(() => ({ hasData: true, mode: "standard", state: { answers: { q1: 0 } }, scaleErrors: [], resultErrors: [] })),
    parseInteractions: vi.fn(() => []),
    buildProtocolRows: vi.fn(() => ({ rows: [row({ idx: 1 }), row({ idx: 2, prompt: "3+3?", answered: false, verdict: "none" })], note: "" })),
    buildScaleRows: vi.fn(() => [{ key: "S", raw: 3, percent: 60, level: "mid", levelLabel: "Средний", pub: null }]),
    buildResultRows: vi.fn(() => [{ name: "V", live: "7", pub: null }]),
    buildAdaptiveBar: vi.fn(() => ({ visible: false })),
    buildScore: vi.fn(() => ({
      available: true, adaptive: false, earnedPoints: 1, possiblePoints: 2, correct: 1, totalQuestions: 2,
      percent: 50, passed: false, rule: { type: "percent", value: 70 },
      sections: [{ topicName: "Алгебра", earnedPoints: 1, possiblePoints: 2, percent: 50, passed: false, correct: 1, total: 2 }],
    })),
    buildDraw: vi.fn(() => ({
      available: true, adaptive: false,
      sections: [{ topicName: "Алгебра", count: 2, mode: "quota" as const, formId: null, formIndex: null, formCount: null, quotas: [{ tag: "Дроби", planned: 2, actual: 1, mode: "exact", short: true }] }],
    })),
    applyReference: vi.fn(),
    clearReference: vi.fn(),
    humanizeTraffic: vi.fn(() => [{ kind: "sess", text: "Сеанс открыт", sub: "" }]),
    flattenLimited: vi.fn(() => [{ path: "answers.q1", disp: "0" }]),
    safeJson: vi.fn(() => "{}"),
    getSuspendAttempts: vi.fn(() => []),
    ...over,
  };
}

beforeEach(() => {
  sessionState.current = { status: "ready", playUrl: "/play/x" };
  resetMock.mockClear();
  installTB();
  window.__scorm = { getCmi: () => ({}), getTraffic: () => [], subscribe: () => {}, restore: () => {}, reset: () => {} };
});
afterEach(() => cleanup());

describe("DebugPlayerPage — states", () => {
  it("shows the loading state while the session is built", () => {
    sessionState.current = { status: "loading" };
    render(<DebugPlayerPage />);
    expect(screen.getByText(/Готовим тестовый прогон/)).toBeInTheDocument();
  });

  it("shows the «нет доступа» screen on a forbidden session (no edit scope)", () => {
    sessionState.current = { status: "forbidden" };
    render(<DebugPlayerPage />);
    expect(screen.getByText(/Нет доступа к отладке/)).toBeInTheDocument();
  });

  it("shows the build-error screen", () => {
    sessionState.current = { status: "error", error: "Шаблон не поддерживается" };
    render(<DebugPlayerPage />);
    expect(screen.getByText(/Не удалось собрать/)).toBeInTheDocument();
    expect(screen.getByText(/Шаблон не поддерживается/)).toBeInTheDocument();
  });
});

describe("DebugPlayerPage — ready", () => {
  it("renders the stage iframe and the status panel from the live snapshot", () => {
    render(<DebugPlayerPage />);
    expect(screen.getByTitle("Тестовый прогон")).toHaveAttribute("src", "/play/x");
    expect(screen.getByText("Прогресс")).toBeInTheDocument();
    expect(screen.getByText("1 из 2")).toBeInTheDocument(); // 1 answered of 2 drawn
  });

  it("shows the score aggregate on the default «Результаты» tab", () => {
    render(<DebugPlayerPage />);
    expect(screen.getByText("Не пройден")).toBeInTheDocument();
    expect(screen.getByText("порог 70%")).toBeInTheDocument();
  });

  it("renders the protocol table and exports CSV", () => {
    const createUrl = vi.fn(() => "blob:x");
    // jsdom has no object-URL support — stub it for the download path.
    (window.URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (window.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();

    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Протокол" }));
    expect(screen.getByText("2+2?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Экспорт CSV/ }));
    expect(createUrl).toHaveBeenCalled();
  });

  it("shows the per-section quota plan-vs-actual on the «Выдача» tab", () => {
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Выдача" }));
    expect(screen.getByText("квоты по тегам")).toBeInTheDocument();
    expect(screen.getByText("Дроби")).toBeInTheDocument();
  });

  it("switches through the scales, results, state and LMS tabs", () => {
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Шкалы" }));
    expect(screen.getByText("Средний")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Показатели" }));
    expect(screen.getByText("V")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Состояние" }));
    expect(screen.getByText("answers.q1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "LMS" }));
    expect(screen.getByText("Сеанс открыт")).toBeInTheDocument();
  });

  it("filters the state table by path", () => {
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Состояние" }));
    fireEvent.change(screen.getByPlaceholderText(/Фильтр по пути/), { target: { value: "zzz" } });
    expect(screen.queryByText("answers.q1")).not.toBeInTheDocument();
  });

  it("collapses and re-expands the inspector", () => {
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Свернуть инспектор" }));
    expect(screen.queryByRole("tab", { name: "Протокол" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть инспектор" }));
    expect(screen.getByRole("tab", { name: "Протокол" })).toBeInTheDocument();
  });

  it("paints the «Эталон» overlay when the toggle is enabled, and clears it when off", () => {
    render(<DebugPlayerPage />);
    // Off by default → the overlay is cleared on each tick.
    expect(window.TBInspector!.clearReference).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Эталон"));
    expect(window.TBInspector!.applyReference).toHaveBeenCalled();
  });

  it("restarts the run via «Сбросить прогон»", () => {
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("button", { name: /Сбросить прогон/ }));
    expect(resetMock).toHaveBeenCalled();
  });

  it("raises the calculation alarm in the status panel", () => {
    installTB({ readPkg: vi.fn(() => ({ hasData: true, mode: "standard", state: {}, engineError: "formula broke" })) });
    render(<DebugPlayerPage />);
    expect(screen.getByText("formula broke")).toBeInTheDocument();
  });
});
