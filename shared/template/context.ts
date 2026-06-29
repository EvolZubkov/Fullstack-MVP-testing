/**
 * @module shared/template/context
 *
 * The public render context contract (PRD-12; spec-template-platform §10). This is
 * the single typed surface that BOTH runtime hosts produce and feed to the unified
 * renderer ({@link module:shared/template/render-screen}); layouts read only from
 * it (spec §10.1: templates get no direct access to the internal `TEST_DATA`).
 *
 * The namespaces below — `course` / `result` / `state` / `retake` — are the ones
 * the real default-template layouts bind against (`data-path="course.title"`,
 * `{{ result.scorePercent }}`, `{{#if state.canResume}}`). Fields named
 * `*Class`/`statusLabel`/`ringDashoffset` are Core-prepared presentational values
 * (spec §10: the DSL computes no classes/labels via expressions — the builder does).
 *
 * Type-only module. The shared builders that produce conforming values live in
 * {@link module:shared/template/result-context} and
 * {@link module:shared/template/start-state}; each host adapts its own data shape
 * into the builders' normalized inputs.
 */

/** Test-level info shown on the start screen and as the screen title (`course.*`). */
export interface CtxCourse {
  title: string;
  description?: string;
  questionCount?: number;
  passPercent?: number | null;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  /** Legacy intro text; migrated to a content page, normally empty (PRD-7 S10). */
  startPageContent?: string;
}

/** A per-topic result row for the standard results layout (`result.topicResults[]`). */
export interface CtxTopicResultView {
  topicId?: string;
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  /** Core-prepared class, e.g. `is-pass` / `is-fail` / `""`. */
  passClass: string;
  /** Core-prepared label, e.g. `Пройдено` / `Не пройдено` / `""`. */
  statusLabel: string;
  /** SCORM-extra (gated layout blocks; web omits): formatted points "x / y". */
  pointsLabel?: string;
  /** SCORM-extra: per-topic pass threshold, e.g. "Требуется: 70%". */
  requiredLabel?: string;
  /** SCORM-extra: per-topic feedback text. */
  topicFeedback?: string;
}

/** A per-topic row for the adaptive results layout (level-based, no score). */
export interface CtxAdaptiveTopicView {
  topicName: string;
  /** Achieved level name or "Не достигнут". */
  levelLabel: string;
  /** Core-prepared class: `is-info` (achieved) / `is-fail` (not). */
  levelClass: string;
  feedback?: string;
  hasFeedback: boolean;
  hasLinks: boolean;
  links: Array<{ title: string; url: string }>;
}

/** A recommended course/event link for failed-topic guidance (SCORM-extra). */
export interface CtxRecommendation {
  title: string;
  url?: string;
}

/**
 * The computed result namespace (`result.*`). Standard fields are always present;
 * adaptive results set `adaptive: true` and use the adaptive `topicResults` shape.
 * SCORM-richer fields (recommendations, back action, adaptive action flags) are
 * gated layout blocks the web context simply omits. The index signature carries
 * PRD-2 custom result variables and any other Core-prepared field.
 */
export interface CtxResult {
  passed: boolean;
  /** Core-prepared class `is-pass`/`is-fail`. */
  passClass?: string;
  statusLabel?: string;
  scorePercent?: number;
  /** Core-prepared SVG ring dash offset (precomputed; layout binds it directly). */
  ringDashoffset?: number;
  totalQuestions?: number;
  correct?: number;
  earnedPoints?: number;
  possiblePoints?: number;
  topicResults?: Array<CtxTopicResultView | CtxAdaptiveTopicView>;
  // Adaptive variant:
  adaptive?: boolean;
  // SCORM-extras (web omits → gated layout blocks render nothing):
  recommendedCourses?: CtxRecommendation[];
  recommendedEvents?: CtxRecommendation[];
  backAction?: string;
  backLabel?: string;
  showPdf?: boolean;
  canRetry?: boolean;
  showFinish?: boolean;
  hasScormActions?: boolean;
  [key: string]: unknown;
}

/**
 * Per-screen UI state (`state.*`): the question counter label and the start-screen
 * action flags. The flags are a host superset — the web sets a subset (no saved-
 * results review / resume-position / restart-anew), so those gated buttons never
 * appear on the web.
 */
export interface CtxState {
  questionCounterLabel?: string;
  exhausted?: boolean;
  canStart?: boolean;
  startLabel?: string;
  canResume?: boolean;
  resumeLabel?: string;
  resumeNote?: string;
  canRestart?: boolean;
  canViewResults?: boolean;
  /** Web-only: show the "back to list" action (the SCORM host omits it). */
  showBack?: boolean;
  /** PRD-19 Block C: clickable progress pills for the current scope (replaces the linear bar). */
  questionsProgress?: CtxQuestionsProgress;
}

/**
 * One progress pill (PRD-19 Block C). Core-prepared so the DSL only interpolates:
 * the builder ({@link module:shared/template/question-progress-context}) computes
 * the status class, a11y label and frontier (`clickable`); the layout renders a
 * `<button class="tb-pill {{statusClass}}">` with `data-action="goto:{{index}}"`.
 */
export interface CtxQuestionPill {
  /** Absolute 0-based question index — the `goto:<index>` jump target. */
  index: number;
  /** Display number, 1-based within the current navigation scope. */
  number: number;
  /** Status class: `is-answered`/`is-current`/`is-skipped`/`""` (+ review: `is-correct`/`is-incorrect`/`is-unanswered`). */
  statusClass: string;
  /** A11y label, e.g. «Вопрос 3, текущий» (FR-12). */
  ariaLabel: string;
  /** Reachable jump target? Frontier (FR-11): future / committed-section pills are not clickable. */
  clickable: boolean;
}

/**
 * Progress-pills map for the CURRENT navigation scope (`state.questionsProgress`,
 * PRD-19 Block C). Sectional flows scope it to the current section; the flat flow
 * spans the whole test. Absent on screens without a question map (e.g. content pages).
 */
export interface CtxQuestionsProgress {
  /** Scope heading, e.g. «Вопросы раздела «Сеть»» / «Вопросы теста». */
  scopeLabel: string;
  /** Questions in scope. */
  total: number;
  answeredCount: number;
  skippedCount: number;
  /** One entry per in-scope question, in display order. */
  states: CtxQuestionPill[];
}

/** One unanswered question in the review screen's explicit list (PRD-19 FR-08). */
export interface CtxReviewUnanswered {
  /** Absolute 0-based question index — the `goto:<index>` jump target. */
  index: number;
  /** Display number, 1-based within the review scope. */
  number: number;
  /** Question prompt (escaped by the renderer). */
  prompt: string;
}

/**
 * Review/finish screen namespace (`review.*`, PRD-19 Block D, FR-08). The system
 * обзор screen (section-finish / test-finish) shows the pills
 * ({@link CtxState.questionsProgress}, built with all pills issued) PLUS this
 * explicit unanswered list and the «Завершить …» action. Runtime-rendered on both
 * hosts from the shared `review` layout (no content_pages row — incremental model).
 */
export interface CtxReview {
  /** Heading, e.g. «Раздел «Сеть» · обзор» / «Обзор теста». */
  scopeLabel: string;
  /** True for the test-finish обзор, false for a section-finish обзор. */
  isTest: boolean;
  /** Finish-button label: «Завершить раздел» / «Завершить тест». */
  finishLabel: string;
  /** Explicit list of still-unanswered (or skipped) questions in scope. */
  unanswered: CtxReviewUnanswered[];
  unansweredCount: number;
  answeredCount: number;
  total: number;
  /** Pre-answer hint shown above the list. */
  hint: string;
}

/** Adaptive inter-level/topic transition interstitial (`transition.*`). */
export interface CtxTransition {
  isCorrect: boolean;
  /** Core-prepared icon class: `is-pass` / `is-fail`. */
  iconClass: string;
  /** Core-prepared status label: `Правильно!` / `Неправильно`. */
  title: string;
  /** Level change, when present. */
  level?: {
    /** Core-prepared class: `is-up` / `is-down` / `is-complete`. */
    class: string;
    isUp: boolean;
    isDown: boolean;
    isComplete: boolean;
    message: string;
  };
  /** Topic change, when present. */
  topic?: { toTopic: string };
  /** Whether to render an explicit "Продолжить" action (SCORM) vs auto-advance (web). */
  showContinue?: boolean;
}

/** Retake gate data for the block screen (`retake.*`, PRD-6). */
export interface CtxRetake {
  cooldownPeriodDays?: number;
  availableDate?: string;
  availableDateHuman?: string;
  reason?: string;
}

/**
 * Per-test branding shown across learner screens (`design.*`, PRD-7). Carried in
 * the render context so the SAME layout binding works on both hosts. Built from
 * the test's design params — the value is already RESOLVED to a plain URL string
 * (the author stores a `{ url, name, … }` media envelope; each host extracts
 * `.url` before it reaches the context, never the envelope).
 */
export interface CtxDesign {
  /** Logo URL; absent → the `{{#if design.logoUrl}}` layout block renders nothing. */
  logoUrl?: string;
}

/**
 * The public render context handed to the unified renderer for any screen. Every
 * namespace is optional — present only on the screens that use it (`course` on
 * start/question/results; `result` on results; `state` on start/question; `retake`
 * on the block screen).
 */
export interface PublicRenderContext {
  course?: CtxCourse;
  result?: CtxResult;
  state?: CtxState;
  retake?: CtxRetake;
  transition?: CtxTransition;
  /** Per-test branding (logo); present on every learner screen that shows it. */
  design?: CtxDesign;
  /** PRD-19 Block D: review/finish (обзор) screen data. */
  review?: CtxReview;
}
