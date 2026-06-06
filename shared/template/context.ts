/**
 * @module shared/template/context
 *
 * The public render context contract (PRD-12 Phase 0, task 0-3;
 * spec-template-platform §10). This is the single typed surface that BOTH runtime
 * hosts must produce and feed to the DSL renderer ({@link module:shared/template/dsl}):
 *
 *   - SCORM host — builds it on the client from the package state (client compute);
 *   - Web host  — builds it on the server from `@shared` engines (server compute,
 *                 PRD-12 §3.3) and ships it over REST.
 *
 * Layouts read only from this context (spec §10.1: templates get no direct access
 * to internal `TEST_DATA`). Fields named `*ClassName`/`*Class`/`statusLabel` are
 * Core-prepared presentational values (spec §10: "Core подготавливает классы
 * состояния … DSL шаблона не вычисляет классы через выражения").
 *
 * Type-only module: it defines the contract, not behaviour. The host-specific
 * builders (SCORM client / web server) are implemented in later phases and must
 * conform to {@link PublicRenderContext}.
 */

/** A progress reading: numerator, denominator and the derived percent (0..100). */
export interface ProgressMetric {
  current: number;
  total: number;
  percent: number;
}

/** Effective navigation mode after intersecting test policy with template caps (spec §11). */
export type NavMode = "linear" | "free" | "locked";

/** Result/section lifecycle status used by layouts and renderers (spec §8.2.1.2). */
export type ResultStatus = "notStarted" | "inProgress" | "passed" | "failed" | "partial";

/** Test-level metadata (spec §10 `test.*`). */
export interface CtxTest {
  id: string;
  title: string;
  description: string;
  navigationPolicy: NavMode;
}

/** The current question's public projection (no correct-answer key unless allowed). */
export interface CtxQuestion {
  id: string;
  type: "single" | "multiple" | "matching" | "ranking";
  media: unknown | null;
}

/** Answer/feedback gating for the current page (spec §10.1). */
export interface CtxAnswerState {
  hasAnswer: boolean;
  locked: boolean;
  feedbackVisible: boolean;
  /** Present only after submit when feedback may be shown. */
  scoreRatio?: number;
  status?: ResultStatus;
}

/** Feedback payload; `correctAnswerPublic` appears only when policy allows (spec §10.1). */
export interface CtxFeedback {
  text?: string;
  correctAnswerPublic?: Record<string, unknown>;
}

/** The page currently being rendered (spec §10 `page.*`). */
export interface CtxPage {
  id: string;
  /** Coarse page family: question | content | results | system | router. */
  type: string;
  /** Specific layout key, e.g. `question.single`, `content.intro`, `results`. */
  kind: string;
  title: string;
  question?: CtxQuestion;
  answerState?: CtxAnswerState;
  feedback?: CtxFeedback | null;
  /** Author-filled placeholder values for content pages (spec §8.2.2). */
  values?: Record<string, unknown>;
}

/** A topic/section nav entry with Core-prepared state class (spec §10 `sections[]`). */
export interface CtxSection {
  id: string;
  title: string;
  isActive: boolean;
  isPassed: boolean;
  className: string;
}

/** The three progress readings (spec §6 `progress.mode`, §10 `progress.*`). */
export interface CtxProgress {
  /** Active reading per the template's `progress.mode` (mirrors question or page). */
  active: ProgressMetric;
  question: ProgressMetric;
  page: ProgressMetric;
}

/** Navigation state + labels + Core-prepared classes (spec §10 `nav.*`). */
export interface CtxNav {
  mode: NavMode;
  canPrev: boolean;
  canNext: boolean;
  canSubmitAnswer: boolean;
  canFinish: boolean;
  nextLabel: string;
  prevLabel?: string;
  submitAnswerLabel: string;
  finishLabel: string;
  nextClassName?: string;
  prevClassName?: string;
}

/** A per-topic result row for the results layout. */
export interface CtxTopicResult {
  topicId?: string;
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  passed?: boolean | null;
  /** Core-prepared presentational class, e.g. `is-pass`/`is-fail`. */
  passClass?: string;
  /** Core-prepared status label, e.g. `Пройдено`. */
  statusLabel?: string;
  earnedPoints?: number;
  possiblePoints?: number;
}

/** A scale's public projection (PRD-5; mirrors `@shared/formula/types` ScaleResult). */
export interface CtxScale {
  raw: number;
  normalized: number;
  percent: number;
  level: string | null;
  label: string | null;
  hasValue: boolean;
}

/**
 * The computed result namespace (spec §8.2.1.2 `result.*`, §13). Standard fields
 * are typed; PRD-2 custom result variables (`result.{name}`) and Core-prepared
 * presentational fields (e.g. `passClass`, `statusLabel`, `ringDashoffset`) are
 * accessed by layouts via the index signature.
 */
export interface CtxResult {
  scoreRaw: number;
  scoreMax: number;
  scorePercent: number;
  status: ResultStatus;
  passed: boolean;
  topicResults?: CtxTopicResult[];
  /** PRD-5 scales by key (also addressable via the top-level `scale.*` namespace). */
  scales?: Record<string, CtxScale>;
  [key: string]: unknown;
}

/** Result of the current section/topic for `content.summary` (spec §8.2.4). */
export interface CtxSectionResult {
  scoreRaw: number;
  scoreMax: number;
  percent: number;
  status: ResultStatus;
}

/** Retake gate data for the block screen (spec §8.2.1.2 `retake.availableDate`). */
export interface CtxRetake {
  availableDate?: string;
  reason?: string;
}

/** Runtime metadata exposed to layouts (spec §10 `runtime.*`). */
export interface CtxRuntime {
  templateApiVersion: string;
}

/**
 * The complete public render context handed to the DSL renderer for any screen.
 * Optional namespaces are present only on the screens that need them (e.g.
 * `result`/`sectionResult` on results/summary, `retake` on the block screen).
 */
export interface PublicRenderContext {
  test: CtxTest;
  page: CtxPage;
  sections: CtxSection[];
  progress: CtxProgress;
  nav: CtxNav;
  /** Effective template params (also surfaced as CSS variables, spec §6). */
  params: Record<string, unknown>;
  /** Computed result namespace; present once `result:calculated`. */
  result?: CtxResult;
  /** Scales namespace `scale.*` (PRD-5), present once computed. */
  scale?: Record<string, CtxScale>;
  sectionResult?: CtxSectionResult;
  retake?: CtxRetake;
  assets?: Record<string, unknown>;
  runtime?: CtxRuntime;
}
