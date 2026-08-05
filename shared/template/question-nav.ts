/**
 * @module shared/template/question-nav
 *
 * Navigation STATE of the question screen — data, not markup.
 *
 * The row itself lives in the template's `question.html` (a `.tb-scene__foot`
 * footer, the same one the SCORM runtime used to build by hand), so the design is
 * where every other design decision is: in the template. Each host only resolves
 * the run state below and puts it in the render context as `state.nav`; the layout
 * decides which buttons exist, in what order and with what classes.
 *
 * That split is what makes the two hosts render one screen: a host cannot invent a
 * button any more, and a template author can restyle the row without touching
 * either runtime (PRD-12).
 */

/** Actions the footer buttons carry; the host binds each to its own handler. */
export const QUESTION_NAV_ACTIONS = {
  back: "answer-back",
  skip: "answer-skip",
  submit: "answer-submit",
  review: "answer-return",
  next: "answer-next",
  finish: "test-finish",
} as const;

/** Run state the row is built from — resolved by the host, not by this module. */
export interface QuestionNavState {
  /**
   * PRD-19 Block B: flexible mode (`allowReturnToUnanswered`) offers «Назад» +
   * «Пропустить» + «Отправить ответ»; strict-linear keeps one forward button.
   * Independent of {@link quickAdvance} (PRD-43) — flexible only decides whether
   * these three controls exist, not how many clicks fixing an answer takes.
   */
  flexible: boolean;
  /**
   * PRD-43: whether fixing the current answer and moving to the next question
   * happen in the SAME click (`true`) or need a separate «Далее» click after
   * (`false`). Independent of {@link flexible} — all 4 combinations are valid.
   * Has no effect when {@link showAccept} is set: showing the correctness
   * feedback always needs its own step before the learner moves on.
   */
  quickAdvance: boolean;
  /** The answer is fixed (committed, or its feedback is on screen). */
  committed: boolean;
  /** An accessible previous question exists (bounded by the section in sectional flows). */
  canPrev: boolean;
  /** The current answer is usable — the forward button's gate. */
  answerReady: boolean;
  /** A next step exists; otherwise the strict row finishes the test. */
  hasNext: boolean;
  /** Strict mode with «показывать верный ответ» before confirmation → «Принять». */
  showAccept: boolean;
  /** «К обзору» — skipped questions in scope, or the learner came FROM the обзор. */
  showReview: boolean;
}

/** What the layout binds against (`state.nav`). Booleans gate, strings print. */
export interface CtxQuestionNav {
  /** Render «← Назад» (flexible mode only). */
  showBack: boolean;
  /** Enable it — a previous accessible question exists. */
  canPrev: boolean;
  /** Render «Пропустить» (flexible, before fixation). */
  showSkip: boolean;
  /** Render «К обзору». */
  showReview: boolean;
  /** `data-action` of the primary button. */
  primaryAction: string;
  /** Its caption. */
  primaryLabel: string;
  /** Whether it is enabled (the answer gate). */
  primaryEnabled: boolean;
}

/**
 * Resolve the footer state for the current question.
 *
 * @param state See {@link QuestionNavState}.
 * @returns The `state.nav` block the question layout renders from.
 */
export function buildQuestionNav(state: QuestionNavState): CtxQuestionNav {
  const A = QUESTION_NAV_ACTIONS;

  // PRD-43: showing the correctness feedback always needs its own step before
  // advancing, regardless of quickAdvance — the learner has to be able to SEE it.
  const twoStep = state.showAccept || !state.quickAdvance;

  if (state.committed) {
    // Already fixed (either just now, or the learner navigated back to an
    // answered question) — the only thing left to do is move on. Flexible mode
    // never finishes the test straight from here (FR-16): «Далее» walks on and
    // завершение happens on the обзор. Strict mode finishes directly.
    const primary = !state.flexible && !state.hasNext
      ? { primaryAction: A.finish, primaryLabel: "Завершить тест" }
      : { primaryAction: A.next, primaryLabel: "Далее" };
    return {
      showBack: state.flexible,
      canPrev: state.flexible && state.canPrev,
      showSkip: false,
      showReview: state.flexible && state.showReview,
      primaryEnabled: true,
      ...primary,
    };
  }

  if (twoStep) {
    // Not yet committed, and fixing needs its own step: «Отправить ответ» / «Принять».
    const primary = state.showAccept
      ? { primaryAction: A.submit, primaryLabel: "Принять" }
      : { primaryAction: A.submit, primaryLabel: "Отправить ответ" };
    return {
      showBack: state.flexible,
      canPrev: state.flexible && state.canPrev,
      showSkip: state.flexible,
      showReview: state.flexible && state.showReview,
      primaryEnabled: state.answerReady,
      ...primary,
    };
  }

  // Not committed, quickAdvance ON, no feedback to show: one click fixes AND
  // advances. In flexible mode this is still «Далее» (обзор owns finishing,
  // FR-16); in strict mode it finishes directly when there's no next question.
  const primary = !state.flexible && !state.hasNext
    ? { primaryAction: A.finish, primaryLabel: "Завершить тест" }
    : { primaryAction: A.next, primaryLabel: "Далее" };
  return {
    showBack: state.flexible,
    canPrev: state.flexible && state.canPrev,
    showSkip: state.flexible,
    showReview: state.flexible && state.showReview,
    primaryEnabled: state.answerReady,
    ...primary,
  };
}
