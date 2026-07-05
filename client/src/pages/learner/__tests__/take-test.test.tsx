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

// Shared spies created before the hoisted vi.mock factories run.
const { navigateSpy, toastSpy } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ testId: "test-1" }),
  useLocation: () => ["/learner/test/test-1", navigateSpy],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// The template hosts render into a Shadow DOM via the shared renderer; replace
// them with doubles that expose the render context (JSON) and the relevant
// action/answer callbacks as buttons, so flows can be driven without the real
// framework-free renderer.
vi.mock("@/components/template-screen", () => ({
  TemplateScreen: (props: any) => (
    <div data-testid="template-screen">
      <pre data-testid="ts-context">{JSON.stringify(props.context)}</pre>
      {["start-test", "restart", "resume", "view-results", "back", "finish-review", "section-continue"].map(
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
      {props.footer !== undefined ? (
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
  noStartTpl?: boolean;
  noQuestionTpl?: boolean;
  startAttempt?: ReturnType<typeof jsonRes>;
  resume?: ReturnType<typeof jsonRes>;
  finish?: ReturnType<typeof jsonRes>;
  sectionResult?: ReturnType<typeof jsonRes>;
}

/** Install a per-URL `fetch` stub for one test. */
function installFetch(cfg: FetchCfg) {
  const fn = vi.fn(async (url: string, opts?: any) => {
    const u = String(url);
    void opts;
    if (u === "/api/learner/tests") return jsonRes(cfg.tests ?? [standardTest()]);
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
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  navigateSpy.mockClear();
  toastSpy.mockClear();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const ctx = () => JSON.parse(screen.getByTestId("ts-context").textContent || "{}");

/** Render + reach the standard start screen (template-screen visible). */
async function renderToStart(cfg: FetchCfg = {}) {
  installFetch(cfg);
  render(<TakeTestPage />);
  await screen.findByTestId("template-screen");
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
    fireEvent.click(screen.getByTestId("qs-next"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );
  });

  it("submits and navigates to the result when every question is answered", async () => {
    await renderToQuestion();
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByTestId("qs-next"));
    await screen.findByTestId("qs-submit");
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByTestId("qs-submit"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });

  it("blocks submit with a toast when questions remain unanswered (strict)", async () => {
    await renderToQuestion();
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByTestId("qs-next"));
    await screen.findByTestId("qs-submit");
    // Do NOT answer question 2.
    fireEvent.click(screen.getByTestId("qs-submit"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Не все вопросы отвечены" }),
      ),
    );
    expect(navigateSpy).not.toHaveBeenCalledWith("/learner/result/attempt-1");
  });

  it("shows the annulled-attempt screen when finish returns 404", async () => {
    await renderToQuestion({ finish: jsonRes({}, false, 404) });
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByTestId("qs-next"));
    await screen.findByTestId("qs-submit");
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByTestId("qs-submit"));
    expect(await screen.findByText("Тест обновлён")).toBeInTheDocument();
    expect(screen.getByText("Начать заново")).toBeInTheDocument();
  });

  it("toasts a submit error when finish fails with a server error", async () => {
    await renderToQuestion({ finish: jsonRes({}, false, 500) });
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByTestId("qs-next"));
    await screen.findByTestId("qs-submit");
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(screen.getByTestId("qs-submit"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Ошибка отправки" })),
    );
  });

  it("shows the «оформление недоступно» reload screen when the question template is missing", async () => {
    await renderToStart({ noQuestionTpl: true });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    expect(await screen.findByText("Оформление недоступно")).toBeInTheDocument();
  });
});

// ─── start-screen gates ────────────────────────────────────────────────────────

describe("<TakeTestPage /> start gates", () => {
  it("toasts and returns to the list when attempts are exhausted", async () => {
    await renderToStart({ startAttempt: jsonRes({ code: "ATTEMPTS_EXHAUSTED" }, false, 403) });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Попытки закончились" })),
    );
    expect(navigateSpy).toHaveBeenCalledWith("/learner");
  });

  it("folds a retake cooldown into the start context instead of navigating away", async () => {
    await renderToStart({
      startAttempt: jsonRes(
        { code: "RETAKE_COOLDOWN", cooldownPeriodDays: 7, availableDate: "2026-08-01" },
        false,
        403,
      ),
    });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await waitFor(() => expect(ctx().state.cooldown).toBeTruthy());
    expect(navigateSpy).not.toHaveBeenCalledWith("/learner");
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
  const flexAttempt = () =>
    jsonRes(standardAttempt({ allowReturnToUnanswered: true, answerCommitScope: "test" }));

  it("commits answers through the two-step footer, reaches the обзор, and finishes", async () => {
    await renderToStart({ startAttempt: flexAttempt() });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    // Q1: answer → «Отправить ответ» → «Далее →».
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее →"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );

    // Q2 (last): answer → «Отправить ответ» → «Далее →» reaches the обзор.
    fireEvent.click(screen.getByTestId("qs-answer-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее →"));

    // Review screen (template host) → finish.
    await screen.findByTestId("ts-finish-review");
    expect(ctx().review).toBeTruthy();
    fireEvent.click(screen.getByTestId("ts-finish-review"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });

  it("skips a question and exposes the «Вернуться» обзор entry", async () => {
    await renderToStart({ startAttempt: flexAttempt() });
    fireEvent.click(screen.getByTestId("ts-start-test"));
    await screen.findByTestId("question-screen");

    // «Пропустить» on Q1 (no answer required in flexible mode) → advance to Q2.
    fireEvent.click(await screen.findByText("Пропустить"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );
    // A skipped question makes «Вернуться» (обзор) available.
    fireEvent.click(await screen.findByText("Вернуться"));
    await screen.findByTestId("ts-finish-review");
    expect(ctx().review.unansweredCount).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByTestId("qs-next"));

    await screen.findByTestId("ts-section-continue");
    expect(ctx().sectionResult.scorePercent).toBe(100);

    // Continue into the next section.
    fireEvent.click(screen.getByTestId("ts-section-continue"));
    await waitFor(() =>
      expect(screen.getByTestId("qs-counter").textContent).toContain("Вопрос 2 из 2"),
    );
  });
});
