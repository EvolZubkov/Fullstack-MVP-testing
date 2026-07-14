/**
 * @module shared/template/review-context
 *
 * PRD-19 Block D — builder for the review/finish (обзор) screen context
 * (section-finish / test-finish, FR-08). Returns the pills map (all issued, so
 * every in-scope question is a jump target) PLUS the explicit unanswered list and
 * the «Завершить …» action. BOTH hosts call it so the обзор renders identically
 * (parity, PRD-12). Pure — reuses {@link buildQuestionProgress} for the pills.
 */

import { buildQuestionProgress, type QuestionStatus, type QuestionProgressItem } from "./question-progress-context";
import type { AnswerCommitScope } from "../flow/answer-commit-scope";
import type { CtxReview, CtxQuestionsProgress, CtxReviewUnanswered } from "./context";

/** A question for the review screen (adds the prompt for the explicit list). */
export interface ReviewQuestionItem extends QuestionProgressItem {
  prompt: string;
}

/** Inputs for {@link buildReviewContext}. */
export interface BuildReviewContextInput {
  /** Flat delivered question order. */
  questions: ReviewQuestionItem[];
  /** questionId -> status; missing = `unanswered`. */
  statuses: Record<string, QuestionStatus>;
  /** Answer-commit scope. */
  commitScope: AnswerCommitScope;
  /** Section topic id being reviewed (sectional); null/undefined = whole test. */
  scopeTopicId?: string | null;
  /** True for the test-finish обзор (whole test), false for a section обзор. */
  isTest: boolean;
  /** Heading, e.g. «Раздел «Сеть»» / «Обзор теста». */
  scopeLabel: string;
  /** Finish-button label, e.g. «Завершить раздел» / «Завершить тест». */
  finishLabel: string;
}

/**
 * Build the обзор context: `{ questionsProgress, review }`. The host spreads
 * `questionsProgress` into `state` and `review` into the top-level context. Pills
 * are built with `allIssued` (every in-scope question reachable) and no «current»
 * (currentIndex -1), scoped by `scopeTopicId`.
 */
export function buildReviewContext(input: BuildReviewContextInput): {
  questionsProgress: CtxQuestionsProgress | null;
  review: CtxReview;
} {
  const sectionScope = input.commitScope === "section";
  const scopeTopicId = sectionScope ? (input.scopeTopicId ?? null) : null;

  const questionsProgress = buildQuestionProgress({
    questions: input.questions,
    statuses: input.statuses,
    currentIndex: -1, // обзор has no «current» pill
    commitScope: input.commitScope,
    scopeTopicId: sectionScope ? scopeTopicId : undefined,
    allIssued: true,
    allowReturn: true,
    scopeLabel: input.scopeLabel,
  });

  let answeredCount = 0;
  const unanswered: CtxReviewUnanswered[] = [];
  let pos = 0;
  input.questions.forEach((q, index) => {
    if (sectionScope && (q.topicId ?? null) !== scopeTopicId) return;
    pos += 1;
    const status = input.statuses[q.id] ?? "unanswered";
    if (status === "answered") answeredCount++;
    else unanswered.push({ index, number: pos, prompt: q.prompt });
  });

  const review: CtxReview = {
    scopeLabel: input.scopeLabel,
    isTest: input.isTest,
    finishLabel: input.finishLabel,
    unanswered,
    unansweredCount: unanswered.length,
    answeredCount,
    total: pos,
    hint:
      unanswered.length > 0
        ? "Проверьте перед завершением. Неотвеченные засчитываются как неверные."
        : "Все вопросы отвечены.",
  };

  return { questionsProgress, review };
}
