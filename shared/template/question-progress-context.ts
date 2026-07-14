/**
 * @module shared/template/question-progress-context
 *
 * PRD-19 Block C — the single builder that turns the runtime question statuses
 * into the Core-prepared progress-pills map ({@link CtxQuestionsProgress}). BOTH
 * hosts call it so the pills render identically (parity, PRD-12): the SCORM
 * runtime feeds `state.questionStatuses` + `state.flatQuestions`; the web host
 * feeds its `questionStatus` map + `flatQuestions`. The DSL only interpolates the
 * `statusClass` / `ariaLabel` / `clickable` this prepares — no logic in the layout.
 *
 * Scope (FR-11): sectional flows show only the CURRENT section's questions; the
 * flat flow spans the whole test. Frontier: already-issued questions — reached
 * (`index <= currentIndex`) OR already answered/skipped — of a not-yet-committed
 * section are clickable jump targets; genuinely future and frozen ones are not.
 *
 * Pure — no DOM, no host globals — unit-testable and safe to bundle for both hosts.
 */

import type { AnswerCommitScope } from "../flow/answer-commit-scope";
import type { CtxQuestionsProgress, CtxQuestionPill } from "./context";

/** Runtime question status (PRD-19 Block B). */
export type QuestionStatus = "unanswered" | "answered" | "skipped";

/** One question in the flat delivered order (host-adapted minimal shape). */
export interface QuestionProgressItem {
  id: string;
  /** Section/topic id; drives the sectional scope. Null/undefined = flat. */
  topicId?: string | null;
}

/** Inputs for {@link buildQuestionProgress}. */
export interface BuildQuestionProgressInput {
  /** Flat delivered question order. */
  questions: QuestionProgressItem[];
  /** questionId -> status; missing = `unanswered`. */
  statuses: Record<string, QuestionStatus>;
  /** Absolute 0-based index of the current question. */
  currentIndex: number;
  /** Answer-commit scope (see {@link module:shared/flow/answer-commit-scope}). */
  commitScope: AnswerCommitScope;
  /** topicId -> committed; a committed section's pills are locked (not clickable). */
  sectionCommitted?: Record<string, boolean>;
  /**
   * Explicit scope topic id. When provided, overrides the topic derived from
   * `currentIndex` — used by the review screen, which scopes to a section while
   * `currentIndex` is -1 (no «current» pill). Undefined = derive from currentIndex.
   */
  scopeTopicId?: string | null;
  /** Scope heading; defaults to «Вопросы раздела» / «Вопросы теста». */
  scopeLabel?: string;
  /**
   * Whether return to issued questions is allowed (`allowReturnToUnanswered`). In
   * strict mode (false) the pills are a READ-ONLY indicator — no pill is a jump
   * target (FR-02). Default true.
   */
  allowReturn?: boolean;
  /**
   * Treat ALL in-scope questions as issued (frontier open) — used on the review
   * screen (section-finish/test-finish) where the learner reached the end and may
   * jump to any in-scope question.
   */
  allIssued?: boolean;
  /** FR-10a: mark correctness (only when `showCorrectAnswers` is on). */
  reviewMarking?: boolean;
  /** questionId -> correctness, used only when `reviewMarking` is true. */
  correctness?: Record<string, "correct" | "incorrect">;
}

const STATUS_WORD: Record<string, string> = {
  "is-current": "текущий",
  "is-answered": "отвечен",
  "is-skipped": "пропущен",
  "is-correct": "верно",
  "is-incorrect": "неверно",
  "is-unanswered": "без ответа",
  "": "не отвечен",
};

/**
 * Build the progress-pills map for the current scope. Returns `null` when there
 * is nothing to show (no questions, or the current index is out of range — e.g.
 * a content page), so the layout's `{{#if state.questionsProgress}}` renders nothing.
 */
export function buildQuestionProgress(input: BuildQuestionProgressInput): CtxQuestionsProgress | null {
  const { questions, statuses, currentIndex, commitScope } = input;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  if (currentIndex < 0 || currentIndex >= questions.length) {
    // Allow the review screen (allIssued) to render even when currentIndex is a
    // past-the-end sentinel; otherwise (content pages etc.) there are no pills.
    if (!input.allIssued) return null;
  }

  // Resolve the in-scope question set (with absolute indices). An explicit
  // `scopeTopicId` (review screen) wins over the topic derived from currentIndex.
  const currentTopicId =
    input.scopeTopicId !== undefined ? input.scopeTopicId : (questions[currentIndex]?.topicId ?? null);
  const inScope: Array<{ index: number; q: QuestionProgressItem }> = [];
  questions.forEach((q, index) => {
    if (commitScope === "section") {
      if ((q.topicId ?? null) === currentTopicId) inScope.push({ index, q });
    } else {
      inScope.push({ index, q });
    }
  });
  if (inScope.length === 0) return null;

  const sectionLocked =
    commitScope === "section" &&
    currentTopicId != null &&
    input.sectionCommitted?.[currentTopicId] === true;

  let answeredCount = 0;
  let skippedCount = 0;

  const states: CtxQuestionPill[] = inScope.map(({ index, q }, pos) => {
    const status = statuses[q.id] ?? "unanswered";
    if (status === "answered") answeredCount++;
    else if (status === "skipped") skippedCount++;

    let statusClass = "";
    if (input.reviewMarking) {
      const c = input.correctness?.[q.id];
      statusClass = c === "correct" ? "is-correct" : c === "incorrect" ? "is-incorrect" : "is-unanswered";
    } else if (index === currentIndex) {
      statusClass = "is-current";
    } else if (status === "answered") {
      statusClass = "is-answered";
    } else if (status === "skipped") {
      statusClass = "is-skipped";
    }
    // The current question stays visually current even in review marking.
    if (!input.reviewMarking && index === currentIndex) statusClass = "is-current";

    // Frontier (FR-11): a question is "issued" (a valid jump target, rendered at full
    // opacity) once the learner has reached its position (index <= currentIndex) OR
    // already committed it (answered/skipped). The status clause keeps answered
    // questions AHEAD of the current one — reached after navigating BACK via the обзор —
    // clickable and full-opacity instead of dimmed as «не выдан» (currentIndex is the
    // CURRENT position, not a high-water mark). Genuinely future untouched questions and
    // a frozen section stay non-jumpable; strict mode (no return) makes the whole map
    // read-only (FR-02).
    const issued =
      input.allIssued || index <= currentIndex || status === "answered" || status === "skipped";
    const clickable = (input.allowReturn ?? true) && issued && !sectionLocked;

    const number = pos + 1;
    const word = STATUS_WORD[statusClass] ?? STATUS_WORD[""];
    return {
      index,
      number,
      statusClass,
      ariaLabel: `Вопрос ${number}, ${clickable || statusClass ? word : "не выдан"}`,
      clickable,
    };
  });

  return {
    scopeLabel: input.scopeLabel ?? (commitScope === "section" ? "Вопросы раздела" : "Вопросы теста"),
    total: states.length,
    answeredCount,
    skippedCount,
    states,
  };
}
