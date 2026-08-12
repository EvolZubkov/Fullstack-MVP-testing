/**
 * @module shared/flow/review-gate
 *
 * PRD-19 — the single rule deciding whether the обзор screen is shown when a
 * section (sectional flows) or the whole test (flat flow) ends. Both runtime
 * hosts read it, so the boundary cannot drift between the web player and the
 * SCORM package (PRD-12 parity): the web host imports it directly, the package
 * gets it through the `TBTemplate` bundle.
 *
 * The обзор exists to let the learner ACT — walk back to a skipped question or
 * revise an answer. When neither is possible it has nothing to offer: it lists
 * questions the learner can no longer touch and delays the section results they
 * have already earned. So it is shown when, and only when, something can still
 * be done there.
 */

/** Inputs of {@link shouldShowReview}. */
export interface ReviewGateInput {
  /** PRD-19 FR-01: the learner may skip a question and come back to it. */
  allowReturnToUnanswered?: boolean;
  /** PRD-19 FR-04a: a committed answer may still be changed before the finish. */
  allowAnswerChange?: boolean;
  /** Whether the scope (section / test) still holds a question without an answer. */
  hasUnanswered: boolean;
  /**
   * Авторское «когда отвечено всё, обзор не нужен» (`tests.skip_review_when_complete`).
   *
   * Правило ниже выводит показ из ПРАВ навигации, и по этим правам обзор при разрешённой
   * правке остаётся полезным всегда. Но польза эта — суждение о методике, а не о правах:
   * у опросника, который проходят подряд и ни к чему не возвращаются, экран со списком
   * отвеченных вопросов стоит между учащимся и результатом. Решить это может только автор,
   * поэтому признак отдельный, а не вывод из существующих двух.
   *
   * Отсутствие = прежнее поведение: ни один уже настроенный тест не меняет выдачу.
   */
  skipReviewWhenComplete?: boolean;
}

/**
 * Whether the обзор is worth showing at the end of the scope.
 *
 * @param input Navigation settings + whether anything was left unanswered.
 * @returns `true` when the learner can still act: return to something skipped,
 *   or revise an answer. `false` sends the flow straight to the section results.
 */
export function shouldShowReview(input: ReviewGateInput): boolean {
  const canReturn = input.allowReturnToUnanswered ?? true;
  const canEdit = input.allowAnswerChange ?? false;
  // Авторский признак идёт ПЕРВЫМ и только при полностью отвеченном объёме: пока
  // что-то пропущено, обзор — единственный путь к пропущенному, и отнимать его
  // нельзя ни по какому пожеланию оформления.
  if (input.skipReviewWhenComplete && !input.hasUnanswered) return false;
  // Editing re-opens EVERY answered question, so the обзор is the way to reach
  // them — it stays useful even when nothing was skipped.
  if (canEdit) return true;
  return canReturn && input.hasUnanswered;
}
