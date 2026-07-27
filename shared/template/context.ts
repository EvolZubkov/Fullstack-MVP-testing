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
  /**
   * Header subtitle under the title (wireframe: "Попытка N из M"). Core-prepared
   * by {@link module:shared/template/course-subtitle} on both hosts; empty string
   * or absent -> the layout's `{{#if course.subtitle}}` renders a title-only header.
   */
  subtitle?: string;
  description?: string;
  questionCount?: number;
  passPercent?: number | null;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  /** Legacy intro text; migrated to a content page, normally empty (PRD-7 S10). */
  startPageContent?: string;
}

/** A recommended course/event link for failed-topic guidance (SCORM-extra). */
export interface CtxRecommendation {
  title: string;
  url?: string;
}

/**
 * The unified per-topic feedback composition (spec §3.2 / plan 6.1): feedback text +
 * recommended courses + recommended events, with presence flags. The SAME shape in
 * standard and adaptive results, so the feedback block is composed identically in both
 * modes — feedback is a property of the test's settings, not the flow mode.
 */
export interface CtxTopicFeedback {
  feedback?: string;
  hasFeedback: boolean;
  recommendedCourses: CtxRecommendation[];
  recommendedEvents: CtxRecommendation[];
  hasRecommendations: boolean;
}

/** A per-topic result row for the standard results layout (`result.topicResults[]`). */
export interface CtxTopicResultView extends CtxTopicFeedback {
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
}

/** A per-topic row for the adaptive results layout (level-based, no score). */
export interface CtxAdaptiveTopicView extends CtxTopicFeedback {
  topicName: string;
  /** Achieved level name or "Не достигнут". */
  levelLabel: string;
  /** Core-prepared class: `is-info` (achieved) / `is-fail` (not). */
  levelClass: string;
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
  /** Learner guidance subtitle by question type (both hosts, see questionHint). */
  questionHint?: string;
  /** Length-fit font for the question prompt, e.g. "28px" (see fit-font). */
  questionFont?: string;
  /** Length-fit font for the answer options, e.g. "18px" (see fit-font). */
  optionFont?: string;
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
  /**
   * PRD-19 Block F (FR-20): cooldown state ON the start screen. Present ONLY when a
   * retake is blocked by the cooldown period; its presence ⇒ the start button is
   * rendered DISABLED (not hidden) and the cooldown card is shown. Replaces the
   * separate `system.blocked` wall — cooldown is now a state of the normal start.
   */
  cooldown?: CtxStartCooldown;
  /**
   * PRD-19 Block F (FR-20): prior-attempt summary on the start screen (eligible
   * retake AND cooldown). Core-prepared (verdict label/class + attempts label).
   * Set only where the host can supply prior-attempt data — absent on the SCORM
   * cooldown path (rendered pre-Initialize, where suspend_data is unavailable).
   */
  priorResult?: CtxStartPriorResult;
  /** PRD-19 Block F (FR-20): show «Скачать отчёт» — report for the prior attempt is downloadable. */
  canDownloadReport?: boolean;
}

/**
 * PRD-19 Block F (FR-20): cooldown state for the start screen ({@link CtxState.cooldown}).
 * Passthrough — the host supplies the human date (ДД.ММ.ГГГГ, as the gate's
 * `fmtDateHuman`) and optionally the derived days-until.
 */
export interface CtxStartCooldown {
  /** Date the next attempt becomes available, formatted ДД.ММ.ГГГГ. */
  availableDateHuman: string;
  /** Days until the next attempt (availableDate − today), when computable. */
  daysUntil?: number | null;
}

/**
 * PRD-19 Block F (FR-20): prior-attempt summary ({@link CtxState.priorResult}).
 * Core-prepared so the layout only interpolates: the builder computes the verdict
 * label/class and the «попытка K из M» label from the raw facts.
 */
export interface CtxStartPriorResult {
  /** Rounded percent score of the prior attempt. */
  percent: number;
  /** «пройдено» / «не пройдено» / "" (no resolved verdict). */
  verdictLabel: string;
  /** "" | "prior-fail" (verdict colour class for a failed attempt). */
  verdictClass: string;
  /** «попытка 2 из 3» when attempt counts are known, else "". */
  attemptsLabel: string;
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

/**
 * Computed section-results namespace (`sectionResult.*`, PRD-19 Block D / FR-05a).
 * The optional staged screen shown after «Завершить раздел» when `showSectionResults`
 * is on: the section's score ring + a one-line summary + an optional pass/fail verdict
 * tag + «Продолжить». A COMPUTED screen (from the results engine), NOT an author
 * `summary` content page. Both hosts build it from {@link
 * module:shared/template/result-context}.buildSectionResultContext so the numbers
 * never drift (SCORM computes the section offline; the web grades it on the server).
 */
export interface CtxSectionResult {
  /** Section/topic name for the heading. */
  topicName: string;
  scorePercent: number;
  /** Core-prepared SVG ring dash offset (precomputed; layout binds it directly). */
  ringDashoffset: number;
  /** Core-prepared class: `is-pass`/`is-fail`/`""` (empty when the section has no pass rule). */
  passClass: string;
  /** Verdict label: «Раздел пройден»/«Раздел не пройден»/`""`. */
  statusLabel: string;
  /** True when a pass/fail verdict applies — gates the verdict tag. */
  hasVerdict: boolean;
  correct: number;
  total: number;
  /** One-line summary, e.g. «6 из 8 верно · 75%». */
  summaryLabel: string;
  /** «Продолжить» action label. */
  continueLabel: string;
  /** Header caption "Раздел N из M" (position among sections); absent when unknown. */
  sectionLabel?: string;
  /** Header progress-bar fill percent (section position / total); absent when unknown. */
  progressPercent?: number;
}

/**
 * PRD-1 §4.3: «Введение раздела» (section-intro) screen data (`sectionIntro.*`).
 * Shown at the START of a section: topic name, description (from topic properties),
 * question count, time limit (when set), and an author instruction. Both hosts build
 * it from {@link module:shared/template/result-context}.buildSectionIntroContext.
 */
export interface CtxSectionIntro {
  /** «Раздел N из M» (or «Раздел N» without a total) eyebrow + header-tag label. */
  eyebrow: string;
  /** Header progress-bar fill percent (section position / total); absent when unknown. */
  progressPercent?: number;
  /** Section/topic name (heading). */
  topicName: string;
  /** Topic description from its properties; empty string when absent. */
  description: string;
  /** Gates the description block. */
  hasDescription: boolean;
  /** Number of questions delivered in the section. */
  questionCount: number;
  /** Localized count label, e.g. «16 вопросов». */
  questionCountLabel: string;
  /** Gates the time-limit meta item. */
  hasTimeLimit: boolean;
  /** Localized time-limit label, e.g. «20 мин». */
  timeLimitLabel: string;
  /** Gates the author instruction block (set when the instruction is non-empty). */
  hasInstruction: boolean;
  /** Author section illustration URL; empty string when absent. */
  illustrationUrl: string;
  /** Gates the illustration column. */
  hasIllustration: boolean;
  /** «Далее» action label. */
  continueLabel: string;
}

/** Adaptive inter-level/topic transition interstitial (`transition.*`). */
export interface CtxTransition {
  /**
   * The topic the level is DETERMINED FOR (eyebrow). This screen is a level change
   * WITHIN a topic (adaptive_by_section / adaptive+router) — NOT a topic move (flat
   * adaptive is a deferred future PRD) and NOT a per-answer verdict.
   */
  topicName: string;
  /** Level-change title, e.g. «Сложность повышена» — never an answer verdict. */
  title: string;
  /** The level change (always present — the screen exists because the level changed). */
  level: {
    /** Core-prepared class: `is-up` / `is-down` / `is-complete`. */
    class: string;
    isUp: boolean;
    isDown: boolean;
    isComplete: boolean;
    /** Supporting line, e.g. «Следующие вопросы будут сложнее». */
    message: string;
  };
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
  /** PRD-19 Block D / FR-05a: computed section-results (итоги раздела) screen data. */
  sectionResult?: CtxSectionResult;
  /** PRD-1 §4.3: «Введение раздела» (section-intro) screen data. */
  sectionIntro?: CtxSectionIntro;
}
