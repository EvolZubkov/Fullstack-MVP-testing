/**
 * @module features/tests/debug-player/__tests__/debug-player-page-extra.coverage.test
 * @description PRD-18 Phase 4 — branch-coverage top-up for the debug-player window,
 * complementing `debug-player-page.test.tsx`. Targets the branches the smoke suite
 * leaves cold: the adaptive progress lane / score panel / draw path, the sectioned
 * flow lanes, the protocol verdict + skip/return status variants (partial / wrong /
 * none · skipped / unanswered), the non-variant draw sections (draw/all + tag/type
 * composition + question disclosure), the LMS long-value expand + raw-log
 * disclosure, the scales/results empty states, the cmi/suspend state sources with a
 * published score, and the toolbar actions (Пересобрать / Сброс / close / open in
 * editor). The compute layer (`window.TBInspector`) and the session hook are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DebugSessionState } from "../use-debug-session";
import type { ProtocolRow, TBInspectorApi } from "../inspector-snapshot";

// ─── Hoisted session mock (adds `rebuild`, absent from the smoke suite) ──────────

const { sessionState, resetMock, rebuildMock } = vi.hoisted(() => ({
  sessionState: { current: { status: "ready", playUrl: "/play/x", template: "rtk" } as DebugSessionState },
  resetMock: vi.fn(),
  rebuildMock: vi.fn(),
}));

vi.mock("../use-debug-session", () => ({
  useDebugSession: () => ({ state: sessionState.current, runKey: 0, reset: resetMock, rebuild: rebuildMock }),
}));
vi.mock("wouter", () => ({ useParams: () => ({ testId: "t1" }) }));

import DebugPlayerPage from "../debug-player-page";

// ─── Compute mock ────────────────────────────────────────────────────────────────

function row(over: Partial<ProtocolRow>): ProtocolRow {
  return {
    idx: 1, topicName: "Алгебра", prompt: "2+2?", type: "single", typeLabel: "Один ответ", answerStr: "4",
    answered: true, status: "answered", verdict: "correct", ratio: 1, ratioPct: 100, score: 1, sMax: 1,
    priceNote: null, earned: 1, points: 1, difficulty: null, levelName: null, contribs: [], ...over,
  };
}

/** A quota (non-adaptive, flat) draw section — the smoke-suite baseline. */
function quotaSection() {
  return {
    topicId: "topic-alg", topicName: "Алгебра", count: 2, mode: "quota" as const, formId: null, formIndex: null, formCount: null,
    forms: [], bankSize: 5, byTag: [{ tag: "Дроби", count: 1 }], byType: [{ type: "single", typeLabel: "Один ответ", count: 2 }],
    quotas: [{ tag: "Дроби", planned: 2, actual: 1, mode: "exact", short: true }],
    questions: [{ id: "q1", idx: 0, prompt: "2+2?", type: "single", typeLabel: "Один ответ", topicName: "Алгебра", delivered: true }],
    delivered: 1,
  };
}

function installTB(over: Partial<TBInspectorApi> = {}) {
  window.TBInspector = {
    readPkg: vi.fn(() => ({ hasData: true, mode: "standard", state: { answers: { q1: 0 } }, scaleErrors: [], resultErrors: [] })),
    parseInteractions: vi.fn(() => []),
    buildProtocolRows: vi.fn(() => ({ rows: [row({ idx: 1 })], note: "" })),
    buildScaleRows: vi.fn(() => [{ key: "S", raw: 3, percent: 60, level: "mid", levelLabel: "Средний", pub: null }]),
    buildResultRows: vi.fn(() => [{ name: "V", live: "7", pub: null }]),
    buildAdaptiveBar: vi.fn(() => ({ visible: false })),
    buildScore: vi.fn(() => ({
      available: true, adaptive: false, earnedPoints: 1, possiblePoints: 2, correct: 1, totalQuestions: 2,
      percent: 50, passed: false, rule: { type: "percent", value: 70 }, sections: [],
    })),
    buildDraw: vi.fn(() => ({
      available: true, adaptive: false, flat: true, started: false, sections: [quotaSection()],
    })),
    applyReference: vi.fn(),
    clearReference: vi.fn(),
    guardFinishButton: vi.fn(),
    humanizeTraffic: vi.fn(() => []),
    buildLmsTable: vi.fn(() => []),
    buildLmsRawLog: vi.fn(() => "—"),
    flattenLimited: vi.fn(() => [{ path: "answers.q1", disp: "0" }]),
    buildStateTree: vi.fn(() => [
      { id: "answers", label: "answers", meta: "1 кл.", leaf: false, children: [{ id: "answers.q1", label: "q1", meta: "0", leaf: true }] },
    ]),
    safeJson: vi.fn(() => "{}"),
    getSuspendAttempts: vi.fn(() => []),
    ...over,
  };
}

/** Confirmed/running/failed level set shared by the adaptive fixtures. */
const LEVELS3 = [
  { topicName: "Тема 1", levelName: "Средний", status: "confirmed" as const },
  { topicName: "Тема 2", levelName: "Базовый", status: "running" as const },
  { topicName: "Тема 3", levelName: null, status: "failed" as const },
];

function adaptiveTB(): Partial<TBInspectorApi> {
  return {
    buildScore: vi.fn(() => ({ available: true, adaptive: true, bar: { finished: false, topicLevels: LEVELS3 } }) as never),
    buildAdaptiveBar: vi.fn(() => ({ visible: true, finished: false, topicLevels: LEVELS3 })),
    buildDraw: vi.fn(() => ({
      available: true, adaptive: true,
      path: [
        { topicId: "t1", topicName: "Тема 1", status: "confirmed" as const, confirmedLevelName: "Средний", currentLevelName: null, currentArrow: "",
          steps: [
            { step: 1, levelName: "Базовый", answer: "верно", transition: "↑ повышение", current: false },
            { step: 2, levelName: "Средний", answer: "верно", transition: "подтверждён: 2 ✓", current: false },
          ] },
        { topicId: "t2", topicName: "Тема 2", status: "running" as const, confirmedLevelName: null, currentLevelName: "Базовый", currentArrow: "→",
          steps: [{ step: 1, levelName: "Базовый", answer: "—", transition: "идёт", current: true }] },
        { topicId: "t3", topicName: "Тема 3", status: "failed" as const, confirmedLevelName: null, currentLevelName: null, currentArrow: "",
          steps: [{ step: 1, levelName: "Базовый", answer: "неверно", transition: "= закрепление", current: false }] },
      ],
    })),
  };
}

beforeEach(() => {
  sessionState.current = { status: "ready", playUrl: "/play/x", template: "rtk" };
  resetMock.mockClear();
  rebuildMock.mockClear();
  installTB();
  window.__scorm = { getCmi: () => ({}), getTraffic: () => [], subscribe: () => {}, restore: () => {}, reset: () => {} };
});
afterEach(() => cleanup());

// ─── Toolbar actions ─────────────────────────────────────────────────────────────

describe("DebugPlayerPage — toolbar actions", () => {
  it("rebuilds the package via «Пересобрать»", () => {
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Пересобрать" }));
    expect(rebuildMock).toHaveBeenCalled();
  });

  it("closes the window via the close button", () => {
    const close = vi.fn();
    (window as unknown as { close: () => void }).close = close;
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть окно плеера" }));
    expect(close).toHaveBeenCalled();
  });

  it("opens the test editor from the build-error banner action", () => {
    const openMock = vi.fn();
    (window as unknown as { open: unknown }).open = openMock;
    sessionState.current = { status: "error", error: "Шаблон не поддерживается" };
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть тест в редакторе" }));
    expect(openMock).toHaveBeenCalledWith("/author/tests?edit=t1", "_blank", "noopener");
  });
});

// ─── Adaptive flow ───────────────────────────────────────────────────────────────

describe("DebugPlayerPage — adaptive", () => {
  it("shows the adaptive score panel and the adaptive progress lane", () => {
    installTB(adaptiveTB());
    render(<DebugPlayerPage />);
    // Status-bar adaptive lane.
    expect(screen.getByText(/Прогресс · адаптив/)).toBeInTheDocument();
    // «Результаты» tab → adaptive KPI + per-topic status table.
    expect(screen.getByText("Подтверждено тем")).toBeInTheDocument();
    expect(screen.getByText("1 из 3")).toBeInTheDocument();
    expect(screen.getByText("подтверждён ✓")).toBeInTheDocument();
    expect(screen.getByText("не подтверждён")).toBeInTheDocument();
  });

  it("renders the adaptive draw path per topic on «Выдача»", () => {
    installTB(adaptiveTB());
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Выдача" }));
    expect(screen.getByText(/подтверждён уровень Средний/)).toBeInTheDocument();
    expect(screen.getByText(/идёт \(текущий: Базовый →\)/)).toBeInTheDocument();
    expect(screen.getByText("↑ повышение")).toBeInTheDocument();
  });

  it("collapses confirmed levels behind «+N подтверждено» at scale (>6 topics)", () => {
    const many = [
      ...Array.from({ length: 4 }, (_, i) => ({ topicName: `К${i}`, levelName: "Ур", status: "confirmed" as const })),
      { topicName: "Идёт", levelName: "Ур", status: "running" as const },
      { topicName: "Ждёт-1", levelName: null, status: "pending" as const },
      { topicName: "Ждёт-2", levelName: null, status: "pending" as const },
    ];
    installTB({
      buildScore: vi.fn(() => ({ available: true, adaptive: true, bar: { finished: false, topicLevels: many } }) as never),
      buildAdaptiveBar: vi.fn(() => ({ visible: true, finished: false, topicLevels: many })),
    });
    render(<DebugPlayerPage />);
    // Two confirmed shown, the rest folded; pending tail folded to «осталось 2».
    expect(screen.getByRole("button", { name: /\+2 подтверждено/ })).toBeInTheDocument();
    expect(screen.getByText("осталось 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /\+2 подтверждено/ }));
    // Expanded → «свернуть» + the pending topics unfold.
    expect(screen.getByRole("button", { name: /свернуть/ })).toBeInTheDocument();
    expect(screen.getByText("Ждёт-1 — не начато")).toBeInTheDocument();
  });

  it("renders empty adaptive panels when no levels are reached yet", () => {
    installTB({
      buildScore: vi.fn(() => ({ available: true, adaptive: true, bar: { finished: false, topicLevels: [] } }) as never),
      buildAdaptiveBar: vi.fn(() => ({ visible: false })),
      buildDraw: vi.fn(() => ({ available: true, adaptive: true, path: [] })),
    });
    render(<DebugPlayerPage />);
    expect(screen.getByText(/подтверждённые уровни появятся/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Выдача" }));
    expect(screen.getByText(/путь по уровням появится/)).toBeInTheDocument();
  });
});

// ─── Sectioned flow ──────────────────────────────────────────────────────────────

describe("DebugPlayerPage — sectioned flow", () => {
  it("renders the sectioned progress lane and the per-section results table", () => {
    installTB({
      buildScore: vi.fn(() => ({
        available: true, adaptive: false, sectioned: true, earnedPoints: 3, possiblePoints: 6,
        correct: 3, totalQuestions: 6, percent: 50, passed: false, rule: { type: "percent", value: 70 },
        sections: [
          { topicName: "Раздел A", earnedPoints: 2, possiblePoints: 2, percent: 100, passed: true, correct: 2, total: 2, completed: true },
          { topicName: "Раздел B", earnedPoints: 1, possiblePoints: 4, percent: 25, passed: null, correct: 1, total: 4, completed: false },
        ],
      })),
    });
    render(<DebugPlayerPage />);
    // Status-bar sectioned lane: A done ✓, B still «в процессе».
    expect(screen.getByText(/Прогресс · разделы/)).toBeInTheDocument();
    expect(screen.getByText("Раздел A — 100% ✓")).toBeInTheDocument();
    expect(screen.getByText("Раздел B — в процессе")).toBeInTheDocument();
    // «Результаты» tab section table.
    expect(screen.getByText("Результаты по разделам")).toBeInTheDocument();
    expect(screen.getByText("пройден")).toBeInTheDocument();
  });
});

// ─── Protocol verdict + skip/return status variants ─────────────────────────────

describe("DebugPlayerPage — protocol variants", () => {
  it("renders every verdict and skip/return status with scale contributions", () => {
    installTB({
      buildProtocolRows: vi.fn(() => ({
        rows: [
          row({ idx: 1, verdict: "partial", status: "skipped", ratio: 0.5, ratioPct: 50, contribs: [{ scaleKey: "S1", delta: 2 }], priceNote: "цена: частичная" }),
          row({ idx: 2, prompt: "Второй", verdict: "wrong", status: "unanswered", answered: false }),
          row({ idx: 3, prompt: "Третий", verdict: "none", status: "answered", answered: false, earned: 0 }),
        ],
        note: "",
      })),
    });
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Протокол" }));
    expect(screen.getByText("частично 50%")).toBeInTheDocument();
    expect(screen.getByText("неверно")).toBeInTheDocument();
    expect(screen.getByText("нет ответа")).toBeInTheDocument();
    expect(screen.getByText("пропущен")).toBeInTheDocument();
    expect(screen.getByText("не отвечен")).toBeInTheDocument();
    expect(screen.getByText("шкала S1 +2")).toBeInTheDocument();
    expect(screen.getByText("цена: частичная")).toBeInTheDocument();
  });
});

// ─── Non-variant draw sections (draw / all) ──────────────────────────────────────

describe("DebugPlayerPage — draw sections", () => {
  it("renders draw/all sections with tag + type composition and expands the questions", () => {
    installTB({
      buildDraw: vi.fn(() => ({
        available: true, adaptive: false, flat: false, started: false,
        sections: [
          { topicId: "a", topicName: "Тема A", count: 3, mode: "draw" as const, formId: null, formIndex: null, formCount: null, forms: [], bankSize: 10,
            byTag: [{ tag: "Дроби", count: 2 }, { tag: "Проценты", count: 1 }],
            byType: [{ type: "single", typeLabel: "Один ответ", count: 2 }, { type: "multiple", typeLabel: "Неск.", count: 1 }],
            quotas: null,
            questions: [
              { id: "q1", idx: 0, prompt: "2+2?", type: "single", typeLabel: "Один ответ", topicName: "Тема A", delivered: true },
              { id: "q2", idx: 1, prompt: "3+3?", type: "multiple", typeLabel: "Неск.", topicName: "Тема A", delivered: false },
            ],
            delivered: 1 },
          { topicId: "b", topicName: "Тема B", count: 2, mode: "all" as const, formId: null, formIndex: null, formCount: null, forms: [], bankSize: 2,
            byTag: [], byType: [{ type: "ranking", typeLabel: "Ранж.", count: 2 }], quotas: null,
            questions: [{ id: "q3", idx: 2, prompt: "Порядок?", type: "ranking", typeLabel: "Ранж.", topicName: "Тема B", delivered: false }],
            delivered: 0 },
        ],
      })),
    });
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Выдача" }));
    expect(screen.getByText(/случайная выборка/)).toBeInTheDocument();
    expect(screen.getByText(/все вопросы/)).toBeInTheDocument();
    expect(screen.getByText("Дроби")).toBeInTheDocument();
    expect(screen.getByText(/По типам: одиночный 2 · множественный 1/)).toBeInTheDocument();
    expect(screen.getByText(/Итого выдано/)).toBeInTheDocument();
    // Expand the first section's question list → the delivered question shows.
    const disclosures = screen.getAllByLabelText("Развернуть вопросы");
    fireEvent.click(disclosures[0]);
    expect(screen.getByText("2+2?")).toBeInTheDocument();
    expect(screen.getByText("выдан")).toBeInTheDocument();
  });
});

// ─── LMS tab: long-value expand + raw-log disclosure ────────────────────────────

describe("DebugPlayerPage — LMS tab", () => {
  it("expands a long suspend_data value and the raw RTE call log", () => {
    const longVal = JSON.stringify({ answers: Array.from({ length: 12 }, (_, i) => ({ q: i, v: i })) });
    installTB({
      buildLmsTable: vi.fn(() => [
        { idx: 0, call: "Initialize", key: "", value: "сеанс открыт", marker: true },
        { idx: 1, call: "Set", key: "cmi.suspend_data", value: longVal, marker: false },
        { idx: 2, call: "Set", key: "cmi.score.raw", value: "5", marker: false },
      ]),
      buildLmsRawLog: vi.fn(() => 'Initialize("") → "true"\nSetValue("cmi.score.raw","5") → "true"'),
    });
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "LMS" }));
    // Structured rows: marker chip, short kbd value, long-value disclosure.
    expect(screen.getByText("сеанс открыт")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть данные" }));
    expect(screen.getByText(/"answers"/)).toBeInTheDocument();
    // Raw RTE call log disclosure.
    fireEvent.click(screen.getByRole("button", { name: "Развернуть сырые вызовы" }));
    expect(screen.getByText(/SetValue\("cmi.score.raw","5"\)/)).toBeInTheDocument();
  });
});

// ─── Empty scales / results ──────────────────────────────────────────────────────

describe("DebugPlayerPage — empty inspector panels", () => {
  it("shows «нет шкал» / «нет показателей» when the package has data but none defined", () => {
    installTB({ buildScaleRows: vi.fn(() => []), buildResultRows: vi.fn(() => []) });
    render(<DebugPlayerPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Шкалы" }));
    expect(screen.getByText("В тесте нет шкал.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Показатели" }));
    expect(screen.getByText("В тесте нет показателей.")).toBeInTheDocument();
  });
});

// ─── State sources + published score ─────────────────────────────────────────────

describe("DebugPlayerPage — state sources & published score", () => {
  it("reads the cmi / suspend_data sources and computes the published, completed score", () => {
    const cmi: Record<string, string> = {
      "cmi.completion_status": "completed",
      "cmi.success_status": "passed",
      "cmi.score.raw": "5",
      "cmi.score.max": "10",
      "cmi.score.scaled": "0.5",
      "cmi.suspend_data": JSON.stringify({ answers: { q1: 0 } }),
    };
    window.__scorm = { getCmi: () => cmi, getTraffic: () => [], subscribe: () => {}, restore: () => {}, reset: () => {} };
    installTB({
      buildScore: vi.fn(() => ({
        available: true, adaptive: false, earnedPoints: 5, possiblePoints: 10, correct: 1, totalQuestions: 2,
        percent: 50, passed: false, rule: { type: "percent", value: 70 }, sections: [],
      })),
      getSuspendAttempts: vi.fn(() => [{ attemptNumber: 1, percent: 80 }]),
    });
    render(<DebugPlayerPage />);
    // Completed run → status-bar verdict is a hard pass/fail, not «в процессе».
    expect(screen.getAllByText("Не пройден").length).toBeGreaterThan(0);
    // «Состояние» tab: switch the source across cmi and suspend_data.
    fireEvent.click(screen.getByRole("tab", { name: "Состояние" }));
    fireEvent.click(screen.getByRole("tab", { name: "cmi" }));
    expect(screen.getByText("answers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "suspend_data" }));
    expect(screen.getByText("answers")).toBeInTheDocument();
  });
});
