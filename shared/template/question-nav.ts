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
   */
  flexible: boolean;
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
  if (!state.flexible) {
    // Strict-linear: one forward button, right-aligned.
    const primary = state.showAccept
      ? { primaryAction: A.submit, primaryLabel: "Принять" }
      : state.hasNext
        ? { primaryAction: A.next, primaryLabel: "Далее" }
        : { primaryAction: A.finish, primaryLabel: "Завершить тест" };
    return {
      showBack: false,
      canPrev: false,
      showSkip: false,
      showReview: false,
      primaryEnabled: state.answerReady,
      ...primary,
    };
  }

  // Flexible. PRD-19 Block D / FR-16: a committed question never finishes the test —
  // «Далее» walks on and завершение happens on the обзор.
  const primary = state.committed
    ? { primaryAction: A.next, primaryLabel: "Далее", primaryEnabled: true }
    : { primaryAction: A.submit, primaryLabel: "Отправить ответ", primaryEnabled: state.answerReady };
  return {
    showBack: true,
    canPrev: state.canPrev,
    showSkip: !state.committed,
    showReview: state.showReview,
    ...primary,
  };
}
