/**
 * @module pages/learner/__tests__/take-test.test
 * @description Behavioural coverage for the learner test-taking page
 * (`take-test.tsx`). The page is a raw-`fetch` stateful flow (no react-query),
 * so the suite stubs `fetch` per-URL, mocks the two heavy template hosts
 * (`TemplateScreen` / `TemplateQuestionScreen`) with lightweight prop-exposing
 * doubles, and mocks `wouter` + the toast hook to observe navigation and
 * notifications. It drives the reachable render branches: loading/init errors,
 * the standard start screen, question delivery + navigation, submit success /
 * error / 404-annulled, the exhausted/cooldown start gates, resume, the flexible
 * (обзор + skip) flow, and the sectional section-results screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildQuestionNav } from "@shared/template/question-nav";

// Shared spies created before the hoisted vi.mock factories run.
const { navigateSpy, toastSpy, authState, downloadReportSpy } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  toastSpy: vi.fn(),
  // PRD-19 FR-20: the start screen's «Скачать отчёт» hands the prior attempt's
  // payload to the SHARED PDF generator; the generator itself is out of scope here.
  downloadReportSpy: vi.fn(async () => "report.pdf"),
  // Plain (non-restricted) session by default; individual tests opt into a
  // magic-link session by setting `magicScope`.
  authState: { user: { id: "u1", magicScope: null } as Record<string, unknown> | null },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ testId: "test-1" }),
  useLocation: () => ["/learner/test/test-1", navigateSpy],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => authState }));

vi.mock("@/features/learner/attempt-report", () => ({
  downloadAttemptReport: downloadReportSpy,
}));

// The template hosts render into a Shadow DOM via the shared renderer; replace
// them with doubles that expose the render context (JSON) and the relevant
// action/answer callbacks as buttons, so flows can be driven without the real
// framework-free renderer.
vi.mock("@/components/template-screen", () => ({
  TemplateScreen: (props: any) => (
    <div data-testid="template-screen">
      <pre data-testid="ts-context">{JSON.stringify(props.context)}</pre>
      {["start-test", "restart", "resume", "view-results", "download-report", "back", "finish-review", "section-continue"].map(
        (a) => (
          <button key={a} data-testid={`ts-${a}`} onClick={() => props.onAction && props.onAction(a)}>
            {a}
          </button>
        ),
      )}
    </div>
  ),
}));

vi.mock("../template-question-screen", () => ({
  TemplateQuestionScreen: (props: any) => (
    <div data-testid="question-screen">
      <div data-testid="qs-counter">{props.counterLabel}</div>
      <div data-testid="qs-prompt">{props.question?.prompt}</div>
      <button data-testid="qs-answer-0" onClick={() => props.onAnswer(0)}>
        a0
      </button>
      <button data-testid="qs-answer-1" onClick={() => props.onAnswer(1)}>
        a1
      </button>
      {props.nav ? (
        // The row lives in the TEMPLATE now; the double renders the same buttons the
        // layout does from the shared nav context, so the flows exercise real state.
        (() => { const n = buildQuestionNav(props.nav); return (
        <div data-testid="qs-nav">
          {n.showBack && (
            <button type="button" disabled={!n.canPrev} onClick={() => props.onNavAction?.("answer-back")}>← Назад</button>
          )}
          {n.showSkip && (
            <button type="button" onClick={() => props.onNavAction?.("answer-skip")}>Пропустить</button>
          )}
          {n.showReview && (
            <button type="button" onClick={() => props.onNavAction?.("answer-return")}>К обзору</button>
          )}
          <button type="button" disabled={!n.primaryEnabled} onClick={() => props.onNavAction?.(n.primaryAction)}>{n.primaryLabel}</button>
        </div>); })()
      ) : props.footer !== undefined ? (
        <div data-testid="qs-footer">{props.footer}</div>
      ) : (
        <div data-testid="qs-nav">
          <button data-testid="qs-prev" disabled={!props.canPrev} onClick={props.onPrev}>
            prev
          </button>
          {props.canSkip && (
            <button data-testid="qs-skip" onClick={props.onSkip}>
              skip
            </button>
          )}
          {props.isLast ? (
            <button data-testid="qs-submit" disabled={props.isSubmitting} onClick={props.onSubmit}>
              submit
            </button>
          ) : (
            <button data-testid="qs-next" onClick={props.onNext}>
              next
            </button>
          )}
        </div>
      )}
    </div>
  ),
}));

import TakeTestPage from "../take-test";

// ─── fixtures ────────────────────────────────────────────────────────────────

const TPL = () => ({
  layout: '<div data-slot="x"></div>',
  css: "",
  theme: { background: "#fff", foreground: "#111" },
  cssVars: {},
  design: {},
});

const q = (id: string, prompt: string, topicId = "topic-a", topicName = "Тема A") => ({
  id,
  type: "single",
  prompt,
  topicId,
  topicName,
  dataJson: { options: ["Вариант A", "Вариант B"] },
  correctJson: { correctIndex: 0 },
  shuffleAnswers: false,
  feedback: null,
  mediaUrl: null,
  mediaType: null,
});

const standardTest = (over: Record<string, unknown> = {}) => ({
  id: "test-1",
  title: "Тест по основам",
  description: "Краткое описание",
  mode: "standard",
  sections: [{ drawCount: 2 }],
  overallPassRuleJson: { type: "percent", value: 60 },
  inProgressAttemptId: null,
  completedAttempts: 0,
  maxAttempts: 3,
  timeLimitMinutes: null,
  startPageContent: "Добро пожаловать",
  resumeIndex: null,
  resumeTotal: null,
  lastCompletedAttemptId: null,
  retakeGate: null,
  priorResult: null,
  ...over,
});

const standardAttempt = (over: Record<string, unknown> = {}) => ({
  id: "attempt-1",
  testTitle: "Тест по основам",
  showCorrectAnswers: false,
  allowReturnToUnanswered: false,
  allowAnswerChange: false,
  showSectionResults: true,
  answerCommitScope: "test",
  timeLimitMinutes: null,
  variantJson: {
    sections: [
      { topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["q1", "q2"] },
    ],
  },
  questions: [q("q1", "Вопрос 1"), q("q2", "Вопрос 2")],
  ...over,
});

const jsonRes = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

interface FetchCfg {
  tests?: unknown[];
  // Second+ answer to `/api/learner/tests` (the ATTEMPTS_EXHAUSTED refresh re-reads
  // this endpoint). Omit to keep answering with `tests` on every call.
  testsRefetch?: ReturnType<typeof jsonRes>;
  noStartTpl?: boolean;
  noQuestionTpl?: boolean;
  startAttempt?: ReturnType<typeof jsonRes>;
  resume?: ReturnType<typeof jsonRes>;
  finish?: ReturnType<typeof jsonRes>;
  sectionResult?: ReturnType<typeof jsonRes>;
  /** `/api/attempts/:id/result` — the prior attempt's payload behind «Скачать отчёт». */
  result?: ReturnType<typeof jsonRes>;
}

/** Install a per-URL `fetch` stub for one test. */
function installFetch(cfg: FetchCfg) {
  let testsCalls = 0;
  const fn = vi.fn(async (url: string, opts?: any) => {
    const u = String(url);
    void opts;
    if (u === "/api/learner/tests") {
      testsCalls += 1;
      if (testsCalls > 1 && cfg.testsRefetch) return cfg.testsRefetch;
      return jsonRes(cfg.tests ?? [standardTest()]);
    }
    if (u.includes("/screen-template/start"))
      return cfg.noStartTpl ? jsonRes({}, false, 404) : jsonRes(TPL());
    if (u.includes("/screen-template/question"))
      return cfg.noQuestionTpl ? jsonRes({}, false, 404) : jsonRes(TPL());
    if (u.includes("/screen-template/review")) return jsonRes(TPL());
    if (u.includes("/screen-template/section-results")) return jsonRes(TPL());
    if (u.includes("/screen-template/blocked")) return jsonRes(TPL());
    if (u.includes("/attempts/start-adaptive")) return jsonRes({});
    if (u.includes("/attempts/start")) return cfg.startAttempt ?? jsonRes(standardAttempt());
    if (u.includes("/resume")) return cfg.resume ?? jsonRes({ hasInProgress: false });
    if (u.includes("/save-progress")) return jsonRes({});
    if (u.includes("/section-result")) return cfg.sectionResult ?? jsonRes({});
    if (u.includes("/finish")) return cfg.finish ?? jsonRes({ id: "attempt-1" });
    if (/\/api\/attempts\/[^/]+\/result$/.test(u))
      return cfg.result ?? jsonRes({ report: { title: "T" }, reportRender: { layout: "<div></div>" } });
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  navigateSpy.mockClear();
  toastSpy.mockClear();
  downloadReportSpy.mockClear();
  localStorage.clear();
  authState.user = { id: "u1", magicScope: null };
});
afterEach(() => vi.unstubAllGlobals());

const ctx = () => JSON.parse(screen.getByTestId("ts-context").textContent || "{}");

/** Render + reach the standard start screen (template-screen visible). */
async function renderToStart(cfg: FetchCfg = {}) {
  installFetch(cfg);
  render(<TakeTestPage />);
  await screen.findByTestId("template-screen");
}

/** Render to a start screen that HAS a prior completed attempt («Скачать отчёт»). */
async function renderReportStart(cfg: FetchCfg = {}) {
  const fn = installFetch({
    tests: [
      standardTest({
        completedAttempts: 1,
        lastCompletedAttemptId: "prev-att",
        priorResult: { percent: 80, passed: true, attemptNumber: 1, maxAttempts: 3 },
      }),
    ],
    ...cfg,
  });
  render(<TakeTestPage />);
  await screen.findByTestId("template-screen");
  return fn;
}

/** Render, start the standard attempt, and wait for the first question. */
async function renderToQuestion(cfg: FetchCfg = {}) {
  await renderToStart(cfg);
  fireEvent.click(screen.getByTestId("ts-start-test"));
  await screen.findByTestId("question-screen");
}

// ─── init / loading ──────────────────────────────────────────────────────────

describe("<TakeTestPage /> init", () => {
  it("navigates back to the list and toasts when the tests fetch fails", async () => {
    const fn = vi.fn(async (url: string) =>
      String(url) === "/api/learner/tests" ? jsonRes({}, false, 500) : jsonRes({}),
    );
    vi.stubGlobal("fetch", fn);
    render(<TakeTestPage />);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner"));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("navigates back when the requested test id is not in the list", async () => {
    installFetch({ tests: [standardTest({ id: "other" })] });
    render(<TakeTestPage />);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner"));
  });

  it("renders the standard start screen with the test title in the context", async () => {
    await renderToStart();
    expect(ctx().course.title).toBe("Тест по основам");
    expect(ctx().state.canStart).toBe(true);
  });

  // Regression: the templated start branch was gated on `testMode === "standard"`,
  // and the legacy React start screen it replaced was removed — so an adaptive test
  // matched NO render branch and hung on the "Подготовка теста..." fallthrough.
  it("renders the start screen for an adaptive test", async () => {
    installFetch({ tests: [standardTest({ mode: "adaptive", sections: [{ drawCount: 0 }] })] });
    render(<TakeTestPage />);
    await screen.findByTestId("template-screen");
    expect(ctx().course.title).toBe("Тест по основам");
    expect(ctx().state.canStart).toBe(true);
  });

  // Adaptive draws from levels, not from section quotas, so the up-front count is
  // unknown: it must be ABSENT (the layout hides the fact) rather than a bare "0".
  it("omits the question count on the adaptive start screen", async () => {
    installFetch({ tests: [standardTest({ mode: "adaptive", sections: [{ drawCount: 0 }] })] });
    render(<TakeTestPage />);
    await screen.findByTestId("template-screen");
    expect(ctx().course.questionCount).toBeUndefined();
  });

  it("shows the neutral service error and reports it when the start template is missing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = installFetch({ noStartTpl: true });
    render(<TakeTestPage />);
    expect(await screen.findByText("Ошибка сервиса")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]) === "/api/logs/client")).toBe(true),
    );
    consoleSpy.mockRestore();
  });
});

// ─── question delivery + navigation ───────────────────────────────────────────

describe("<TakeTestPage /> standard flow", () => {
  it("starts the attempt and shows the first question", async () => {
    await renderToQuestion();
    expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 1 из 2");
    expect(screen.getByTestId("qs-prompt").textContent).toBe("Вопрос 1");
  });

  it("advances to the next question after answering and pressing next", async () => {
    await renderToQuestion();
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Далее"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );
  });

  it("submits and navigates to the result when every question is answered", async () => {
    await renderToQuestion();
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Далее"));
    await screen.findByText("Завершить тест");
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Завершить тест"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });

  // The shared nav row gates the forward button on a usable answer — the SAME gate
  // the SCORM runtime applies (`submitDisabledAttr`). So an unanswered last question
  // cannot reach submit at all: the button is inert rather than toasting afterwards.
  it("keeps the strict finish button inert while the question has no answer", async () => {
    await renderToQuestion();
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Далее"));
    const finish = await screen.findByText("Завершить тест");
    // Do NOT answer question 2.
    expect(finish).toBeDisabled();
    fireEvent.click(finish);
    await waitFor(() => expect(navigateSpy).not.toHaveBeenCalledWith("/learner/result/attempt-1"));
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Тест завершён" }),
    );
  });

  it("shows the annulled-attempt screen when finish returns 404", async () => {
    await renderToQuestion({ finish: jsonRes({}, false, 404) });
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Далее"));
    await screen.findByText("Завершить тест");
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Завершить тест"));
    expect(await screen.findByText("Тест обновлён")).toBeInTheDocument();
    expect(screen.getByText("Начать заново")).toBeInTheDocument();
  });

  it("toasts a submit error when finish fails with a server error", async () => {
    await renderToQuestion({ finish: jsonRes({}, false, 500) });
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Далее"));
    await screen.findByText("Завершить тест");
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Завершить тест"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Ошибка отправки" })),
    );
  });

  // The learner is told nothing technical («оформление недоступно» named a concept
  // they cannot act on); the cause goes to the console and the server log instead.
  it("shows the neutral service error when the question template is missing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderToStart({ noQuestionTpl: true });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    expect(await screen.findByText("Ошибка сервиса")).toBeInTheDocument();
    expect(screen.getByText("Обратитесь к администратору.")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ─── start-screen gates ────────────────────────────────────────────────────────

describe("<TakeTestPage /> start gates", () => {
  it("folds exhausted attempts into the start context instead of navigating away", async () => {
    // The learner must keep access to their result: a magic-link session has no
    // test list to fall back to, so the exhausted state renders where they are.
    // The refresh answers with the post-race facts (a real attempt id) — matching
    // the server invariant that ATTEMPTS_EXHAUSTED never fires without one.
    await renderToStart({
      startAttempt: jsonRes({ code: "ATTEMPTS_EXHAUSTED" }, false, 403),
      testsRefetch: jsonRes([standardTest({ completedAttempts: 3, lastCompletedAttemptId: "attempt-1" })]),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() => expect(ctx().state.canViewResults).toBe(true));
    expect(ctx().state.canStart).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalledWith("/learner");
  });

  // The concrete failure this guards: a hand-faked `completedAttempts` counter
  // flips `canViewResults` to true while `lastCompletedAttemptId` stays whatever
  // the stale initial load had — here `null` — leaving «Мой результат» dead. The
  // fix re-reads `/api/learner/tests` so the id is real.
  it("re-reads the server facts after a race that exhausts the last attempt, and «Мой результат» opens the real attempt", async () => {
    await renderToStart({
      tests: [standardTest({ maxAttempts: 1, completedAttempts: 0, lastCompletedAttemptId: null })],
      startAttempt: jsonRes({ code: "ATTEMPTS_EXHAUSTED" }, false, 403),
      testsRefetch: jsonRes([
        standardTest({ maxAttempts: 1, completedAttempts: 1, lastCompletedAttemptId: "attempt-42" }),
      ]),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() => expect(ctx().state.canViewResults).toBe(true));
    fireEvent.click(screen.getByTestId("ts-view-results"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-42");
  });

  // When the refresh itself cannot be completed (offline / 500), the local
  // fallback must stop offering a start WITHOUT pretending there is a result to
  // view — `lastCompletedAttemptId` is left untouched (still null here), so
  // `hasCompletedResults` (Part 2) keeps «Мой результат» off the screen too.
  it("falls back to a safe exhausted state (no dead result button) when the refresh itself fails", async () => {
    await renderToStart({
      tests: [standardTest({ maxAttempts: 1, completedAttempts: 0, lastCompletedAttemptId: null })],
      startAttempt: jsonRes({ code: "ATTEMPTS_EXHAUSTED" }, false, 403),
      testsRefetch: jsonRes({}, false, 500),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() => expect(ctx().state.canStart).toBe(false));
    expect(ctx().state.canViewResults).toBe(false);
  });

  it("folds a retake cooldown into the start context instead of navigating away", async () => {
    await renderToStart({
      // daysUntil is deliberately NOT derivable from availableDate under the
      // suite's clock — this is the guard that would catch a regression back to
      // a client-side, clock-based countdown.
      startAttempt: jsonRes(
        { code: "RETAKE_COOLDOWN", cooldownPeriodDays: 7, availableDate: "2026-08-01", daysUntil: 99 },
        false,
        403,
      ),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() => expect(ctx().state.cooldown).toBeTruthy());
    // The countdown comes from the SERVER date, not from the browser clock.
    expect(ctx().state.cooldown.daysUntil).toBe(99);
    expect(navigateSpy).not.toHaveBeenCalledWith("/learner");
  });

  it("delivers a retake cooldown with the start-screen data and blocks the start button", async () => {
    // Path (a): the cooldown arrives with the initial /api/learner/tests fetch
    // (testMetadata.retakeGate), not via a 403 on start — this is the primary
    // delivery path and must be covered separately from the 403 fallback above.
    await renderToStart({
      tests: [
        standardTest({
          retakeGate: { cooldownPeriodDays: 30, availableDate: "2026-08-01", daysUntil: 99 },
        }),
      ],
    });
    expect(ctx().state.cooldown.daysUntil).toBe(99);
    expect(ctx().state.canStart).toBe(false);
  });

  // PRD-19 FR-20: the package's start screen offers «Скачать отчёт» by the prior
  // attempt (`startPage.js` → `canDownloadReport: !!best`); the web omitted it, so a
  // blocked learner could see the verdict but not take the document with them.
  it("offers «Скачать отчёт» once a prior attempt has a saved result", async () => {
    await renderToStart({
      tests: [
        standardTest({
          completedAttempts: 1,
          lastCompletedAttemptId: "prev-att",
          priorResult: { percent: 80, passed: true, attemptNumber: 1, maxAttempts: 3 },
        }),
      ],
    });
    expect(ctx().state.canDownloadReport).toBe(true);
  });

  it("does not offer «Скачать отчёт» on a first entry (no prior attempt)", async () => {
    await renderToStart();
    expect(ctx().state.canDownloadReport).toBeUndefined();
  });

  it("builds the report from the PRIOR attempt's payload, not the running one", async () => {
    const fn = await renderReportStart();
    fireEvent.click(screen.getByTestId("ts-download-report"));
    await waitFor(() => expect(downloadReportSpy).toHaveBeenCalled());
    // The payload is fetched on the CLICK — the start screen must not pay for a
    // report render on every entry into the test.
    expect(fn).toHaveBeenCalledWith("/api/attempts/prev-att/result", expect.anything());
    const [report, render] = downloadReportSpy.mock.calls[0] as unknown as unknown[];
    expect(report).toEqual({ title: "T" });
    expect(render).toEqual({ layout: "<div></div>" });
  });

  it("reports an unavailable report instead of failing silently", async () => {
    await renderReportStart({ result: jsonRes({ report: null, reportRender: null }) });
    fireEvent.click(screen.getByTestId("ts-download-report"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
    expect(downloadReportSpy).not.toHaveBeenCalled();
  });

  it("navigates to the prior result from the start «view-results» action", async () => {
    await renderToStart({
      tests: [standardTest({ completedAttempts: 1, lastCompletedAttemptId: "prev-att" })],
    });
    fireEvent.click(screen.getByTestId("ts-view-results"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/result/prev-att");
  });

  it("returns to the list from the start «back» action", async () => {
    await renderToStart();
    fireEvent.click(screen.getByTestId("ts-back"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner");
  });
});

// ─── magic-link (restricted) session ──────────────────────────────────────────

describe("<TakeTestPage /> magic-link scope", () => {
  // A magic-link session has no test list to fall back to (the guard would just
  // bounce a "/learner" navigation to /login), so the start screen must not offer
  // the ghost "back to list" control at all.
  it("offers the start-screen back control in a normal session", async () => {
    await renderToStart();
    expect(ctx().state.showBack).toBe(true);
  });

  it("hides the start-screen back control in a restricted (magic-link) session", async () => {
    authState.user = { id: "u1", magicScope: { testId: "test-1" } };
    await renderToStart();
    expect(ctx().state.showBack).toBe(false);
  });

  // Defensive: even if the "back" action were somehow triggered in a restricted
  // session (the button is hidden via showBack above), it must resolve to the
  // learner's own test rather than the out-of-scope list.
  it("sends a restricted session's «back» action to its own test, not the list", async () => {
    authState.user = { id: "u1", magicScope: { testId: "test-1" } };
    await renderToStart();
    fireEvent.click(screen.getByTestId("ts-back"));
    expect(navigateSpy).toHaveBeenCalledWith("/learner/test/test-1");
  });
});

// ─── resume ────────────────────────────────────────────────────────────────────

describe("<TakeTestPage /> resume", () => {
  it("restores an in-progress attempt and delivers the resumed question", async () => {
    await renderToStart({
      tests: [standardTest({ inProgressAttemptId: "attempt-r", resumeIndex: 0, resumeTotal: 1 })],
      resume: jsonRes({
        hasInProgress: true,
        savedAnswers: {},
        currentIndex: 0,
        questionStatus: {},
        attempt: {
          id: "attempt-r",
          testTitle: "Тест по основам",
          showCorrectAnswers: false,
          allowReturnToUnanswered: false,
          allowAnswerChange: false,
          showSectionResults: true,
          answerCommitScope: "test",
          timeLimitMinutes: null,
          startedAt: new Date().toISOString(),
          variantJson: {
            sections: [
              { topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["q1"] },
            ],
          },
          questions: [q("q1", "Восстановленный вопрос")],
        },
      }),
    });
    fireEvent.click(screen.getByTestId("ts-resume"));
    await screen.findByTestId("question-screen");
    expect(screen.getByTestId("qs-prompt").textContent).toBe("Восстановленный вопрос");
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Тест восстановлен" }));
  });
});

// ─── flexible (PRD-19) flow ────────────────────────────────────────────────────

describe("<TakeTestPage /> flexible flow", () => {
  // PRD-19 обзор gate: with every question answered the обзор only appears when
  // answers may still be edited — that is the case this suite walks.
  const flexAttempt = () =>
    jsonRes(standardAttempt({ allowReturnToUnanswered: true, allowAnswerChange: true, answerCommitScope: "test" }));

  it("commits answers through the two-step footer, reaches the обзор, and finishes", async () => {
    await renderToStart({ startAttempt: flexAttempt() });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    // Q1: answer → «Отправить ответ» → «Далее».
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );

    // Q2 (last): answer → «Отправить ответ» → «Далее» reaches the обзор.
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));

    // Review screen (template host) → finish.
    await screen.findByTestId("ts-finish-review");
    expect(ctx().review).toBeTruthy();
    fireEvent.click(screen.getByTestId("ts-finish-review"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });

  it("skips a question and exposes the «К обзору» обзор entry", async () => {
    await renderToStart({ startAttempt: flexAttempt() });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    // «Пропустить» on Q1 (no answer required in flexible mode) → advance to Q2.
    fireEvent.click(await screen.findByText("Пропустить"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );
    // A skipped question makes «К обзору» (обзор) available.
    fireEvent.click(await screen.findByText("К обзору"));
    await screen.findByTestId("ts-finish-review");
    expect(ctx().review.unansweredCount).toBeGreaterThan(0);
  });

  it("PRD-43: flexible + quickAdvance — one click fixes the answer and advances, Назад/Пропустить still show", async () => {
    await renderToStart({
      startAttempt: jsonRes(
        standardAttempt({ allowReturnToUnanswered: true, allowAnswerChange: true, quickAdvance: true, answerCommitScope: "test" }),
      ),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    // Skip/Back still available even though the primary click is single-step now.
    expect(screen.getByText("Пропустить")).toBeInTheDocument();

    // Q1: one click on «Далее» both fixes the answer and advances — no
    // intermediate «Отправить ответ» step.
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    expect(screen.queryByText("Отправить ответ")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("Далее"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );

    // Q2 (last): same one click reaches the обзор (flexible mode never finishes
    // straight from a committed question, FR-16).
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Далее"));
    await screen.findByTestId("ts-finish-review");
  });
});

describe("<TakeTestPage /> strict flow without quick advance (PRD-43)", () => {
  it("two-step footer with NO Назад/Пропустить: «Отправить ответ» then «Далее»", async () => {
    await renderToStart({
      startAttempt: jsonRes(
        standardAttempt({ allowReturnToUnanswered: false, quickAdvance: false, answerCommitScope: "test" }),
      ),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    expect(screen.queryByText("Пропустить")).not.toBeInTheDocument();
    expect(screen.queryByText("← Назад")).not.toBeInTheDocument();

    // Q1: two clicks — «Отправить ответ» fixes, «Далее» (separate) advances.
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );

    // Q2 (last): same two-click shape, ending in «Завершить тест».
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Завершить тест"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });
});

// ─── shuffle mappings + per-answer feedback ────────────────────────────────────

describe("<TakeTestPage /> answer types & feedback", () => {
  it("builds shuffle mappings for every question type on start", async () => {
    const attempt = jsonRes(
      standardAttempt({
        variantJson: {
          sections: [
            {
              topicName: "Тема A",
              topicId: "topic-a",
              timeLimitMinutes: null,
              questionIds: ["s1", "m1", "mt1", "rk1"],
            },
          ],
        },
        questions: [
          { ...q("s1", "Одиночный"), shuffleAnswers: true },
          {
            id: "m1",
            type: "multiple",
            prompt: "Множественный",
            topicId: "topic-a",
            topicName: "Тема A",
            dataJson: { options: ["A", "B", "C"] },
            correctJson: { correctIndices: [0, 1] },
            shuffleAnswers: true,
          },
          {
            id: "mt1",
            type: "matching",
            prompt: "Сопоставление",
            topicId: "topic-a",
            topicName: "Тема A",
            dataJson: { left: ["l1", "l2"], right: ["r1", "r2"] },
            correctJson: { pairs: [{ left: 0, right: 0 }] },
            shuffleAnswers: true,
          },
          {
            id: "rk1",
            type: "ranking",
            prompt: "Ранжирование",
            topicId: "topic-a",
            topicName: "Тема A",
            dataJson: { items: ["i1", "i2", "i3"] },
            correctJson: { correctOrder: [0, 1, 2] },
            shuffleAnswers: true,
          },
        ],
      }),
    );
    await renderToQuestion({ startAttempt: attempt });
    expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 1 из 4");
  });

  it("shows per-question feedback in showCorrectAnswers mode and then submits", async () => {
    const attempt = jsonRes(
      standardAttempt({
        showCorrectAnswers: true,
        variantJson: {
          sections: [
            { topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["q1"] },
          ],
        },
        questions: [q("q1", "Единственный вопрос")],
      }),
    );
    await renderToStart({ startAttempt: attempt });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");
    // Answer incorrectly (correct index is 0) to exercise the wrong-answer feedback.
    fireEvent.click(screen.getByTestId("qs-answer-1"));
    fireEvent.click(await screen.findByText("Принять"));
    // Feedback shown → the primary action becomes the finish button (last question).
    fireEvent.click(await screen.findByText("Завершить тест"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });
});

// ─── sectional section-results ─────────────────────────────────────────────────

describe("<TakeTestPage /> sectional flow", () => {
  it("shows the section-results screen when crossing a section boundary", async () => {
    const sectionalAttempt = jsonRes(
      standardAttempt({
        answerCommitScope: "section",
        showSectionResults: true,
        variantJson: {
          sections: [
            { topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["q1"] },
            { topicName: "Тема B", topicId: "topic-b", timeLimitMinutes: null, questionIds: ["q2"] },
          ],
        },
        questions: [q("q1", "Вопрос 1", "topic-a", "Тема A"), q("q2", "Вопрос 2", "topic-b", "Тема B")],
      }),
    );
    await renderToStart({
      startAttempt: sectionalAttempt,
      sectionResult: jsonRes({ topicName: "Тема A", correct: 1, total: 1, percent: 100, passed: true }),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    // Answer the sole question of section A and advance → intercepts with results.
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByText("Далее"));

    await screen.findByTestId("ts-section-continue");
    expect(ctx().sectionResult.scorePercent).toBe(100);

    // Continue into the next section.
    fireEvent.click(screen.getByTestId("ts-section-continue"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );
  });
});
