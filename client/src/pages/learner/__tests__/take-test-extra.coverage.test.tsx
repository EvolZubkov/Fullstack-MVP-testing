/**
 * @module pages/learner/__tests__/take-test-extra.coverage.test
 *
 * Supplemental branch coverage for the learner test-taking page
 * ({@link module:pages/learner/take-test}). The base suite (`take-test.test.tsx`)
 * drives the standard happy path; this file DOES NOT repeat it. It adds the
 * under-covered standard-mode branches:
 *   - resume for the non-single question types (generated + restored shuffle
 *     mappings), the resume timer-expired gate, the resume error toast, and the
 *     «no in-progress → start fresh» fallthrough;
 *   - strict-mode «Далее» validation (unanswered / empty multiple / incomplete
 *     matching) and per-type `scoreAnswerLocally` via showCorrectAnswers feedback
 *     for multiple / matching / ranking (right AND wrong);
 *   - flexible back-nav («Назад») + pill navigation (jump + out-of-range guard);
 *   - the sectional flexible flow end-to-end (section обзор → freeze →
 *     section-results → next section → last-section finish) and the flat flexible
 *     finish-confirm modal (unanswered warning) + обзор pill jump.
 *
 * Same harness shape as the base suite: `fetch` stubbed per-URL, `wouter` + the
 * toast hook mocked, and the two template hosts replaced by light prop-exposing
 * doubles. This file's `TemplateQuestionScreen` double additionally exposes
 * per-type answer buttons and pill navigation so those branches can be driven.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildQuestionNav } from "@shared/template/question-nav";

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

// This suite exercises standard (non-restricted) sessions only; the magic-link
// scoping itself is covered in take-test.test.tsx.
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", magicScope: null } }) }));

vi.mock("@/components/template-screen", () => ({
  TemplateScreen: (props: any) => (
    <div data-testid="template-screen">
      <pre data-testid="ts-context">{JSON.stringify(props.context)}</pre>
      {[
        "start-test",
        "restart",
        "resume",
        "view-results",
        "back",
        "finish-review",
        "section-continue",
        "goto:1",
      ].map((a) => (
        <button key={a} type="button" data-testid={`ts-${a}`} onClick={() => props.onAction && props.onAction(a)}>
          {a}
        </button>
      ))}
    </div>
  ),
}));

// Richer question-screen double: renders the supplied footer (flexible / feedback
// flows) or the default nav, and always exposes per-type answer buttons + pill
// navigation so those take-test branches can be driven.
vi.mock("../template-question-screen", () => ({
  TemplateQuestionScreen: (props: any) => (
    <div data-testid="question-screen">
      <div data-testid="qs-counter">{props.counterLabel}</div>
      <div data-testid="qs-prompt">{props.question?.prompt}</div>
      {/* Verdict banner markup as the host composes it — exposed as text so the
          three-position verdict (правильно / частично / неверно) is assertable. */}
      <div data-testid="qs-feedback">{props.feedbackHtml ?? ""}</div>
      <button type="button" data-testid="qs-ans-0" onClick={() => props.onAnswer(0)}>a0</button>
      <button type="button" data-testid="qs-ans-1" onClick={() => props.onAnswer(1)}>a1</button>
      <button type="button" data-testid="qs-ans-multi" onClick={() => props.onAnswer([0, 1])}>am</button>
      <button type="button" data-testid="qs-ans-multi-empty" onClick={() => props.onAnswer([])}>ame</button>
      <button type="button" data-testid="qs-ans-multi-wrong" onClick={() => props.onAnswer([0])}>amw</button>
      {/* Nothing from the correct set — c = 0, so no tier of a graded question fires. */}
      <button type="button" data-testid="qs-ans-multi-none" onClick={() => props.onAnswer([2])}>amn</button>
      <button type="button" data-testid="qs-ans-match-full" onClick={() => props.onAnswer({ 0: 0, 1: 1 })}>mf</button>
      <button type="button" data-testid="qs-ans-match-partial" onClick={() => props.onAnswer({ 0: 0 })}>mp</button>
      <button type="button" data-testid="qs-ans-match-wrong" onClick={() => props.onAnswer({ 0: 1, 1: 0 })}>mw</button>
      <button type="button" data-testid="qs-ans-rank" onClick={() => props.onAnswer([0, 1, 2])}>rk</button>
      <button type="button" data-testid="qs-ans-rank-wrong" onClick={() => props.onAnswer([2, 1, 0])}>rkw</button>
      <button type="button" data-testid="qs-goto-0" onClick={() => props.onNavigateToQuestion?.(0)}>g0</button>
      <button type="button" data-testid="qs-goto-99" onClick={() => props.onNavigateToQuestion?.(99)}>g99</button>
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
          <button type="button" data-testid="qs-prev" disabled={!props.canPrev} onClick={props.onPrev}>prev</button>
          {props.canSkip && (
            <button type="button" data-testid="qs-skip" onClick={props.onSkip}>skip</button>
          )}
          {props.isLast ? (
            <button type="button" data-testid="qs-submit" disabled={props.isSubmitting} onClick={props.onSubmit}>submit</button>
          ) : (
            <button type="button" data-testid="qs-next" onClick={props.onNext}>next</button>
          )}
        </div>
      )}
    </div>
  ),
}));

import TakeTestPage from "../take-test";

// ─── fixtures ──────────────────────────────────────────────────────────────────

const TPL = () => ({ layout: "<div></div>", css: "", theme: { background: "#fff", foreground: "#111" }, cssVars: {}, design: {} });

const qSingle = (id: string, prompt: string, topicId = "topic-a", topicName = "Тема A") => ({
  id, type: "single", prompt, topicId, topicName,
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  shuffleAnswers: false, feedback: "Пояснение", mediaUrl: null, mediaType: null,
});
const qMultiple = (id: string, prompt: string) => ({
  id, type: "multiple", prompt, topicId: "topic-a", topicName: "Тема A",
  dataJson: { options: ["A", "B", "C"] }, correctJson: { correctIndices: [0, 1] },
  shuffleAnswers: true, feedback: null, mediaUrl: null, mediaType: null,
});
const qMatching = (id: string, prompt: string) => ({
  id, type: "matching", prompt, topicId: "topic-a", topicName: "Тема A",
  dataJson: { left: ["l0", "l1"], right: ["r0", "r1"] }, correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
  shuffleAnswers: true, feedback: null, mediaUrl: null, mediaType: null,
});
const qRanking = (id: string, prompt: string) => ({
  id, type: "ranking", prompt, topicId: "topic-a", topicName: "Тема A",
  dataJson: { items: ["i0", "i1", "i2"] }, correctJson: { correctOrder: [0, 1, 2] },
  shuffleAnswers: true, feedback: null, mediaUrl: null, mediaType: null,
});

const standardTest = (over: Record<string, unknown> = {}) => ({
  id: "test-1", title: "Тест", description: "Описание", mode: "standard",
  sections: [{ drawCount: 2 }], overallPassRuleJson: { type: "percent", value: 60 },
  inProgressAttemptId: null, completedAttempts: 0, maxAttempts: 3, timeLimitMinutes: null,
  startPageContent: "Старт", resumeIndex: null, resumeTotal: null,
  lastCompletedAttemptId: null, retakeGate: null, priorResult: null, ...over,
});

const attemptBody = (over: Record<string, unknown> = {}) => ({
  id: "attempt-1", testTitle: "Тест", showCorrectAnswers: false,
  allowReturnToUnanswered: false, allowAnswerChange: false, showSectionResults: true,
  answerCommitScope: "test", timeLimitMinutes: null,
  variantJson: { sections: [{ topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["q1", "q2"] }] },
  questions: [qSingle("q1", "Вопрос 1"), qSingle("q2", "Вопрос 2")],
  ...over,
});

const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });

interface FetchCfg {
  tests?: unknown[];
  startAttempt?: ReturnType<typeof jsonRes>;
  resume?: ReturnType<typeof jsonRes>;
  finish?: ReturnType<typeof jsonRes>;
  sectionResult?: ReturnType<typeof jsonRes>;
  noSectionResultsTpl?: boolean;
}

function installFetch(cfg: FetchCfg = {}) {
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/learner/tests") return jsonRes(cfg.tests ?? [standardTest()]);
    if (u.includes("/screen-template/start")) return jsonRes(TPL());
    if (u.includes("/screen-template/question")) return jsonRes(TPL());
    if (u.includes("/screen-template/review")) return jsonRes(TPL());
    if (u.includes("/screen-template/section-results")) return cfg.noSectionResultsTpl ? jsonRes({}, false, 404) : jsonRes(TPL());
    if (u.includes("/attempts/start")) return cfg.startAttempt ?? jsonRes(attemptBody());
    if (u.includes("/resume")) return cfg.resume ?? jsonRes({ hasInProgress: false });
    if (u.includes("/save-progress")) return jsonRes({});
    if (u.includes("/section-result")) return cfg.sectionResult ?? jsonRes({ topicName: "Тема A", correct: 1, total: 1, percent: 100, passed: true });
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
const counter = () => screen.getByTestId("qs-counter").textContent || "";

async function renderToStart(cfg: FetchCfg = {}) {
  installFetch(cfg);
  render(<TakeTestPage />);
  await screen.findByTestId("template-screen");
}
async function renderToQuestion(cfg: FetchCfg = {}) {
  await renderToStart(cfg);
  fireEvent.click(screen.getByTestId("ts-start-test"));
  await screen.findByTestId("question-screen");
}

// ─── resume variants ─────────────────────────────────────────────────────────

describe("<TakeTestPage /> resume variants", () => {
  const resumeAttempt = (questions: unknown[], questionIds: string[], extra: Record<string, unknown> = {}) => ({
    hasInProgress: true,
    savedAnswers: {},
    currentIndex: 0,
    questionStatus: {},
    attempt: {
      id: "attempt-r", testTitle: "Тест", showCorrectAnswers: false,
      allowReturnToUnanswered: false, allowAnswerChange: false, showSectionResults: true,
      answerCommitScope: "test", timeLimitMinutes: null, startedAt: new Date().toISOString(),
      variantJson: { sections: [{ topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds }], ...extra },
      questions,
    },
  });

  it("generates shuffle mappings for multiple / matching / ranking on resume", async () => {
    await renderToStart({
      tests: [standardTest({ inProgressAttemptId: "attempt-r", resumeIndex: 0, resumeTotal: 3 })],
      resume: jsonRes(resumeAttempt([qMultiple("m1", "Множ."), qMatching("mt1", "Соп."), qRanking("rk1", "Ранж.")], ["m1", "mt1", "rk1"])),
    });
    fireEvent.click(screen.getByTestId("ts-resume"));
    await screen.findByTestId("question-screen");
    expect(counter()).toContain("Вопрос 1 из 3");
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Тест восстановлен" }));
  });

  it("restores saved shuffle mappings from the variant when present", async () => {
    await renderToStart({
      tests: [standardTest({ inProgressAttemptId: "attempt-r", resumeIndex: 0, resumeTotal: 1 })],
      resume: jsonRes(
        resumeAttempt([qMultiple("m1", "Множ.")], ["m1"], { shuffleMappings: { m1: [2, 0, 1] } }),
      ),
    });
    fireEvent.click(screen.getByTestId("ts-resume"));
    await screen.findByTestId("question-screen");
    expect(counter()).toContain("Вопрос 1 из 1");
  });

  it("aborts resume with a toast when the elapsed time already exceeds the limit", async () => {
    const stale = resumeAttempt([qSingle("q1", "В1")], ["q1"]);
    (stale.attempt as any).timeLimitMinutes = 30;
    (stale.attempt as any).startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await renderToStart({
      tests: [standardTest({ inProgressAttemptId: "attempt-r", resumeIndex: 0, resumeTotal: 1 })],
      resume: jsonRes(stale),
    });
    fireEvent.click(screen.getByTestId("ts-resume"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner"));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Время истекло" }));
  });

  it("toasts a restore error when the resume request fails", async () => {
    await renderToStart({
      tests: [standardTest({ inProgressAttemptId: "attempt-r", resumeIndex: 0, resumeTotal: 1 })],
      resume: jsonRes({}, false, 500),
    });
    fireEvent.click(screen.getByTestId("ts-resume"));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: "Не удалось восстановить тест" })),
    );
  });

  it("starts a fresh attempt when resume reports no in-progress attempt", async () => {
    await renderToStart({
      tests: [standardTest({ inProgressAttemptId: "attempt-r" })],
      resume: jsonRes({ hasInProgress: false }),
    });
    fireEvent.click(screen.getByTestId("ts-resume"));
    await screen.findByTestId("question-screen");
    expect(counter()).toContain("Вопрос 1 из 2");
  });
});

// ─── strict «Далее» validation ─────────────────────────────────────────────────

describe("<TakeTestPage /> strict next validation", () => {
  // The shared nav row (renderQuestionNav) disables the forward button until the
  // answer is usable — the same gate the SCORM runtime applies, so the learner is
  // stopped BEFORE the click instead of by a toast after it.
  it("держит «Далее» неактивной, пока текущий вопрос без ответа", async () => {
    await renderToQuestion();
    expect(screen.getByText("Далее")).toBeDisabled();
    fireEvent.click(screen.getByText("Далее")); // no answer selected
    expect(counter()).toContain("Вопрос 1 из 2");
  });

  it("держит «Далее» неактивной при пустом множественном выборе", async () => {
    await renderToQuestion({
      startAttempt: jsonRes(
        attemptBody({
          variantJson: { sections: [{ topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["m1", "q2"] }] },
          questions: [qMultiple("m1", "Множ."), qSingle("q2", "В2")],
        }),
      ),
    });
    fireEvent.click(screen.getByTestId("qs-ans-multi-empty")); // []
    expect(screen.getByText("Далее")).toBeDisabled();
  });

  it("держит «Далее» неактивной при неполном сопоставлении", async () => {
    await renderToQuestion({
      startAttempt: jsonRes(
        attemptBody({
          variantJson: { sections: [{ topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["mt1", "q2"] }] },
          questions: [qMatching("mt1", "Соп."), qSingle("q2", "В2")],
        }),
      ),
    });
    fireEvent.click(screen.getByTestId("qs-ans-match-partial")); // { 0: 0 } — left 1 unmatched
    expect(screen.getByText("Далее")).toBeDisabled();
  });
});

// ─── showCorrectAnswers feedback per type (scoreAnswerLocally) ──────────────────

describe("<TakeTestPage /> showCorrectAnswers per type", () => {
  const feedbackAttempt = (question: unknown, id: string) =>
    jsonRes(
      attemptBody({
        showCorrectAnswers: true,
        variantJson: { sections: [{ topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: [id] }] },
        questions: [question],
      }),
    );

  async function confirmAndFinish(answerTestId: string, question: unknown, id: string) {
    await renderToQuestion({ startAttempt: feedbackAttempt(question, id) });
    fireEvent.click(screen.getByTestId(answerTestId));
    fireEvent.click(await screen.findByText("Принять"));
    fireEvent.click(await screen.findByText("Завершить тест"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  }

  it("grades a correct multiple answer and finishes", async () => {
    await confirmAndFinish("qs-ans-multi", qMultiple("m1", "Множ."), "m1");
  });
  it("grades a wrong multiple answer (size mismatch) and finishes", async () => {
    await confirmAndFinish("qs-ans-multi-wrong", qMultiple("m1", "Множ."), "m1");
  });
  it("grades a correct matching answer and finishes", async () => {
    await confirmAndFinish("qs-ans-match-full", qMatching("mt1", "Соп."), "mt1");
  });
  it("grades a wrong matching answer and finishes", async () => {
    await confirmAndFinish("qs-ans-match-wrong", qMatching("mt1", "Соп."), "mt1");
  });
  it("grades a correct ranking answer and finishes", async () => {
    await confirmAndFinish("qs-ans-rank", qRanking("rk1", "Ранж."), "rk1");
  });
  it("grades a wrong ranking answer and finishes", async () => {
    await confirmAndFinish("qs-ans-rank-wrong", qRanking("rk1", "Ранж."), "rk1");
  });

  // PRD-10 (FR-12): a graded (tiered/weighted) question earns PARTIAL credit, and the
  // instant verdict must say so — the same three tones the SCORM package emits from
  // the same `scoreRatio`. Absent `scoring` = exact = the legacy two-tone verdict.
  describe("частичный балл в мгновенном фидбеке", () => {
    // c >= 1 → 1 балл, c == T → 2 балла. Ответ [0] при верных [0, 1] = частично.
    const qTiered = () => ({
      ...qMultiple("m1", "Множ."),
      scoring: {
        kind: "tiered",
        tiers: [
          { when: { all: [{ lhs: "c", op: "==", rhs: "T" }] }, score: 2 },
          { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
        ],
        sMax: 2,
      },
    });

    async function verdictAfter(answerTestId: string, question: unknown) {
      await renderToQuestion({ startAttempt: feedbackAttempt(question, "m1") });
      fireEvent.click(screen.getByTestId(answerTestId));
      fireEvent.click(await screen.findByText("Принять"));
      return screen.getByTestId("qs-feedback").textContent ?? "";
    }

    it("показывает «Частично правильно» при частично верном ответе", async () => {
      expect(await verdictAfter("qs-ans-multi-wrong", qTiered())).toContain("Частично правильно");
    });

    it("оставляет «Правильно!» при полностью верном ответе", async () => {
      expect(await verdictAfter("qs-ans-multi", qTiered())).toContain("Правильно!");
    });

    it("оставляет «Неверно», когда ступенчатая таблица не дала ни балла", async () => {
      const verdict = await verdictAfter("qs-ans-multi-none", qTiered());
      expect(verdict).toContain("Неверно");
      expect(verdict).not.toContain("Частично");
    });

    it("без ступенчатой цены тот же частичный ответ остаётся «Неверно»", async () => {
      const verdict = await verdictAfter("qs-ans-multi-wrong", qMultiple("m1", "Множ."));
      expect(verdict).toContain("Неверно");
      expect(verdict).not.toContain("Частично");
    });
  });

  // issue #34: у вопроса с условной обратной связью общий `feedback` пуст — веб-хост
  // обязан выбрать ветку по вердикту тем же правилом, что и пакет, иначе баннер
  // выходит вообще без пояснения.
  describe("условная обратная связь", () => {
    const qConditional = () => ({
      ...qSingle("q1", "В1"),
      feedback: null,
      feedbackMode: "conditional",
      feedbackCorrect: "Верно: это база",
      feedbackIncorrect: "Неверно: перечитайте раздел",
    });

    async function verdictAfter(answerTestId: string, question: unknown) {
      await renderToQuestion({ startAttempt: feedbackAttempt(question, "q1") });
      fireEvent.click(screen.getByTestId(answerTestId));
      fireEvent.click(await screen.findByText("Принять"));
      return screen.getByTestId("qs-feedback").textContent ?? "";
    }

    it("показывает ветку верного ответа", async () => {
      expect(await verdictAfter("qs-ans-0", qConditional())).toContain("Верно: это база");
    });

    it("показывает ветку неверного ответа", async () => {
      const verdict = await verdictAfter("qs-ans-1", qConditional());
      expect(verdict).toContain("Неверно: перечитайте раздел");
      expect(verdict).not.toContain("Верно: это база");
    });

    it("в общем режиме по-прежнему показывает общий текст", async () => {
      expect(await verdictAfter("qs-ans-1", qSingle("q1", "В1"))).toContain("Пояснение");
    });
  });

  it("«Принять» is disabled until the question is answered", async () => {
    await renderToQuestion({ startAttempt: feedbackAttempt(qSingle("q1", "В1"), "q1") });
    // Unified gate: the submit button is disabled (not a toast) while empty.
    expect(await screen.findByText("Принять")).toBeDisabled();
  });

  it("«Принять» stays disabled on an empty multiple selection", async () => {
    await renderToQuestion({ startAttempt: feedbackAttempt(qMultiple("m1", "Множ."), "m1") });
    fireEvent.click(screen.getByTestId("qs-ans-multi-empty")); // onAnswer([])
    expect(await screen.findByText("Принять")).toBeDisabled();
  });

  it("«Принять» is disabled while a matching answer is incomplete, enables when full", async () => {
    await renderToQuestion({ startAttempt: feedbackAttempt(qMatching("mt1", "Соп."), "mt1") });
    fireEvent.click(screen.getByTestId("qs-ans-match-partial")); // { 0: 0 } — left 1 unmatched
    expect(await screen.findByText("Принять")).toBeDisabled();
    fireEvent.click(screen.getByTestId("qs-ans-match-full")); // { 0: 0, 1: 1 }
    expect(await screen.findByText("Принять")).toBeEnabled();
  });

  it("«Принять» is disabled for an untouched ranking, enables after a reorder", async () => {
    await renderToQuestion({ startAttempt: feedbackAttempt(qRanking("rk1", "Ранж."), "rk1") });
    // No mount-seed anymore → an untouched ranking has no answer.
    expect(await screen.findByText("Принять")).toBeDisabled();
    fireEvent.click(screen.getByTestId("qs-ans-rank")); // onAnswer([0, 1, 2])
    expect(await screen.findByText("Принять")).toBeEnabled();
  });
});

// ─── flexible back-nav + pill navigation ────────────────────────────────────────

describe("<TakeTestPage /> flexible navigation", () => {
  const flexAttempt = () => jsonRes(attemptBody({ allowReturnToUnanswered: true }));

  async function toQ2Flexible() {
    await renderToQuestion({ startAttempt: flexAttempt() });
    fireEvent.click(screen.getByTestId("qs-ans-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));
    await waitFor(() => expect(counter()).toContain("Вопрос 2 из 2"));
  }

  it("returns to the previous question with «Назад»", async () => {
    await toQ2Flexible();
    fireEvent.click(screen.getByText(/Назад/));
    await waitFor(() => expect(counter()).toContain("Вопрос 1 из 2"));
  });

  it("jumps to a question via a progress pill and ignores an out-of-range pill", async () => {
    await toQ2Flexible();
    fireEvent.click(screen.getByTestId("qs-goto-99")); // out of range → ignored
    expect(counter()).toContain("Вопрос 2 из 2");
    fireEvent.click(screen.getByTestId("qs-goto-0")); // valid jump
    await waitFor(() => expect(counter()).toContain("Вопрос 1 из 2"));
  });
});

// ─── sectional flexible flow (обзор → section-results → next → finish) ───────────

describe("<TakeTestPage /> sectional flexible flow", () => {
  const sectionalFlex = (over: Record<string, unknown> = {}) =>
    jsonRes(
      attemptBody({
        allowReturnToUnanswered: true,
        // PRD-19 обзор gate: these walks answer every question, so the обзор is
        // due only because answers stay editable.
        allowAnswerChange: true,
        answerCommitScope: "section",
        showSectionResults: true,
        variantJson: {
          sections: [
            { topicName: "Тема A", topicId: "topic-a", timeLimitMinutes: null, questionIds: ["q1"] },
            { topicName: "Тема B", topicId: "topic-b", timeLimitMinutes: null, questionIds: ["q2"] },
          ],
        },
        questions: [qSingle("q1", "Вопрос 1", "topic-a", "Тема A"), qSingle("q2", "Вопрос 2", "topic-b", "Тема B")],
        ...over,
      }),
    );

  it("walks section обзор → freeze → section-results → next section → last-section finish", async () => {
    await renderToQuestion({
      startAttempt: sectionalFlex(),
      sectionResult: jsonRes({ topicName: "Тема A", correct: 1, total: 1, percent: 100, passed: true }),
    });

    // Section A: answer, commit, «Далее» crosses the boundary → section обзор.
    fireEvent.click(screen.getByTestId("qs-ans-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));
    await screen.findByTestId("ts-finish-review");

    // Finish the section → computed section-results screen.
    fireEvent.click(screen.getByTestId("ts-finish-review"));
    await screen.findByTestId("ts-section-continue");
    expect(ctx().sectionResult.scorePercent).toBe(100);

    // Continue into section B.
    fireEvent.click(screen.getByTestId("ts-section-continue"));
    await waitFor(() => expect(counter()).toContain("Вопрос 2 из 2"));

    // Section B (last): commit, «Далее» → section обзор → finish → section-results.
    fireEvent.click(screen.getByTestId("qs-ans-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));
    fireEvent.click(await screen.findByTestId("ts-finish-review"));
    await screen.findByTestId("ts-section-continue");

    // «Завершить тест» from the last section-results → submit the whole test.
    fireEvent.click(screen.getByTestId("ts-section-continue"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });

  // PRD-19 обзор gate: nothing was skipped and nothing may be edited, so the
  // обзор would list questions the learner can no longer touch — the section goes
  // straight to its results instead.
  it("skips the обзор when every answer is in and none can be changed", async () => {
    await renderToQuestion({
      startAttempt: sectionalFlex({ allowAnswerChange: false }),
      sectionResult: jsonRes({ topicName: "Тема A", correct: 1, total: 1, percent: 100, passed: true }),
    });

    fireEvent.click(screen.getByTestId("qs-ans-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));

    // The stub renders a button per action id, so the SCREEN is identified by the
    // context it received: section-results, with no обзор in between.
    await waitFor(() => expect(ctx().sectionResult).toBeTruthy());
    expect(ctx().review).toBeUndefined();
    expect(ctx().sectionResult.scorePercent).toBe(100);
  });

  it("advances directly to the next section when section-results is unavailable", async () => {
    await renderToQuestion({ startAttempt: sectionalFlex({ showSectionResults: false }) });
    fireEvent.click(screen.getByTestId("qs-ans-0"));
    fireEvent.click(await screen.findByText("Отправить ответ"));
    fireEvent.click(await screen.findByText("Далее"));
    fireEvent.click(await screen.findByTestId("ts-finish-review"));
    // No section-results screen → straight to section B.
    await waitFor(() => expect(counter()).toContain("Вопрос 2 из 2"));
  });
});

// ─── flat flexible: обзор pill jump + finish-confirm modal ───────────────────────

describe("<TakeTestPage /> flat flexible обзор", () => {
  const flexAttempt = () => jsonRes(attemptBody({ allowReturnToUnanswered: true }));

  it("warns via the finish-confirm modal when finishing with unanswered questions", async () => {
    await renderToQuestion({ startAttempt: flexAttempt() });
    // Skip both questions → both count as unanswered; the last skip opens the обзор.
    fireEvent.click(await screen.findByText("Пропустить"));
    await waitFor(() => expect(counter()).toContain("Вопрос 2 из 2"));
    fireEvent.click(await screen.findByText("Пропустить"));

    await screen.findByTestId("ts-finish-review");
    expect(ctx().review.unansweredCount).toBe(2);

    // Finish with unanswered → confirmation modal, then confirm → submit.
    fireEvent.click(screen.getByTestId("ts-finish-review"));
    const confirmBtn = await screen.findByText("Завершить тест");
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/learner/result/attempt-1"));
  });

  it("jumps from the обзор back to a question via a pill", async () => {
    await renderToQuestion({ startAttempt: flexAttempt() });
    fireEvent.click(await screen.findByText("Пропустить")); // Q1 → Q2, скип открывает «К обзору»
    await waitFor(() => expect(counter()).toContain("Вопрос 2 из 2"));
    fireEvent.click(await screen.findByText("К обзору"));
    await screen.findByTestId("ts-goto:1");
    fireEvent.click(screen.getByTestId("ts-goto:1")); // обзор pill → jump to question 2
    await screen.findByTestId("question-screen");
  });
});
