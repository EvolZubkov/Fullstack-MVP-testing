/**
 * @module shared/template/start-state
 *
 * The single, browser-safe builder for the START screen render context
 * (PRD-12 §10): it turns a host's attempt/session facts into the `{ course, state }`
 * shape the `start.html` layout consumes. Both hosts call it so the start action
 * model (resume-with-position / restart-anew / review / exhausted) is assembled in
 * ONE place:
 *
 *   - SCORM host adapts its package state (attempts used, suspended session);
 *   - web host adapts its server metadata (completed/in-progress attempts) and
 *     reaches this via the `TBTemplate` bundle is NOT needed — the web imports it
 *     directly (Vite).
 *
 * Each host decides RESUME ELIGIBILITY itself (e.g. the SCORM session-staleness /
 * time-limit checks) and passes `resume` only when a resume is actually offered;
 * this builder owns only the flag assembly. Pure — no DOM, no Node.
 */

import type { CtxCourse, CtxState, CtxStartCooldown } from "./context";

/** Test info shown on the start screen (maps to `course.*`). */
export interface StartInfo {
  title: string;
  description?: string;
  questionCount?: number;
  passPercent?: number | null;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  startPageContent?: string;
}

/** Normalized start-screen facts (host adapts its own state into this). */
export interface StartStateInput {
  info: StartInfo;
  maxAttempts: number | null;
  completedAttempts: number;
  /** Position of the resumable in-progress session, or null when none is offered. */
  resume?: { index: number; total: number } | null;
  /** Whether the learner has a completed attempt to review ("Мой результат"). */
  hasCompletedResults: boolean;
  /** Whether a fresh attempt may be started (attempts remain). */
  canStartNew: boolean;
  /** Web-only "back to list" action (the SCORM host omits it). */
  showBack?: boolean;
  /**
   * PRD-19 Block F (FR-20): cooldown facts when a retake is blocked. Presence ⇒
   * the start button renders disabled and the cooldown card shows. Pass null/omit
   * when the learner is eligible.
   */
  cooldown?: CtxStartCooldown | null;
  /**
   * PRD-19 Block F (FR-20): raw prior-attempt facts (eligible retake AND cooldown);
   * the builder derives the verdict label/class + attempts label. Omit when the
   * host cannot supply prior-attempt data (e.g. SCORM cooldown, pre-Initialize).
   */
  priorResult?: {
    percent: number;
    passed: boolean | null;
    attemptNumber?: number | null;
    maxAttempts?: number | null;
  } | null;
  /** PRD-19 Block F (FR-20): the prior attempt's report is downloadable («Скачать отчёт»). */
  canDownloadReport?: boolean;
}

/** Built `{ course, state }` for the start layout. */
export interface StartRenderContext {
  course: CtxCourse;
  state: CtxState;
}

/**
 * Assemble the start-screen action state. Mirrors the four cases of the bespoke
 * SCORM chrome, now shared so the web produces the identical model:
 *   1. no attempts + nothing to review        → exhausted note
 *   2. no attempts + has results              → "Мой результат" only
 *   3. resumable session                      → continue (with position) + restart + review?
 *   4. attempts remain + has results          → restart-anew + review
 *   5. first entry / exhausted                → start / exhausted
 */
export function buildStartState(input: StartStateInput): StartRenderContext {
  const noAttempts = input.maxAttempts != null && input.completedAttempts >= input.maxAttempts;
  const hasCompleted = input.hasCompletedResults;
  // FR-20: a cooldown block any new attempt — it overrides resume/start (the
  // learner cannot proceed), so resume is suppressed while blocked.
  const blocked = !!input.cooldown;
  const canResume = !!input.resume && !blocked;

  const state: CtxState = {
    exhausted: false,
    canStart: false,
    startLabel: "",
    canResume: false,
    resumeLabel: "",
    resumeNote: "",
    canRestart: false,
    canViewResults: false,
    showBack: !!input.showBack,
  };

  if (blocked) {
    // FR-20: cooldown — start disabled (the layout renders a disabled button from
    // `state.cooldown`), no resume/restart. Reviewing the prior result stays
    // available where the host can supply it (web; SCORM only post-Initialize).
    state.cooldown = input.cooldown as CtxStartCooldown;
    state.canViewResults = hasCompleted;
  } else if (noAttempts && !hasCompleted) {
    state.exhausted = true;
  } else if (noAttempts && hasCompleted) {
    state.canViewResults = true;
  } else if (canResume) {
    const r = input.resume as { index: number; total: number };
    state.canResume = true;
    state.resumeLabel = "Продолжить с места остановки";
    state.resumeNote = "Незавершённый тест — вопрос " + (r.index + 1) + " из " + r.total;
    state.canRestart = true;
    state.canViewResults = hasCompleted;
  } else if (input.canStartNew && hasCompleted) {
    state.canStart = true;
    state.startLabel = "Начать тестирование заново";
    state.canViewResults = true;
  } else {
    if (noAttempts) state.exhausted = true;
    else {
      state.canStart = true;
      state.startLabel = "Начать тестирование";
    }
  }

  // FR-20: prior-attempt summary (eligible retake AND cooldown), Core-prepared so
  // the layout only interpolates. Set only where the host supplies the facts.
  if (input.priorResult) {
    const p = input.priorResult;
    state.priorResult = {
      percent: Math.round(p.percent),
      verdictLabel: p.passed === null ? "" : p.passed ? "пройдено" : "не пройдено",
      verdictClass: p.passed === false ? "prior-fail" : "",
      attemptsLabel:
        p.attemptNumber != null && p.maxAttempts != null
          ? "попытка " + p.attemptNumber + " из " + p.maxAttempts
          : "",
    };
    // «Скачать отчёт» is meaningful only when a prior attempt exists.
    if (input.canDownloadReport) state.canDownloadReport = true;
  }

  const i = input.info;
  const course: CtxCourse = {
    title: i.title,
    description: i.description || "",
    questionCount: i.questionCount,
    passPercent: i.passPercent,
    timeLimitMinutes: i.timeLimitMinutes,
    maxAttempts: i.maxAttempts,
    startPageContent: i.startPageContent || "",
  };

  return { course, state };
}
