/**
 * @module shared/template/result-context
 *
 * The single, browser-safe builder for the RESULTS screen render context
 * (PRD-12 §10): it turns a host's computed result into the `{ course, result }`
 * shape the `results.html` / `results.adaptive.html` layouts consume. Both hosts
 * call it on the SAME normalized input, so the presentational shaping (passClass /
 * statusLabel / ring offset / per-topic rows / adaptive level labels) cannot drift
 * between the web server and the SCORM package:
 *
 *   - web server adapts its `AttemptResult` (overallPercent / overallPassed / …);
 *   - SCORM adapts its runtime result (percent / passed / …) and reaches this via
 *     the `TBTemplate` bundle.
 *
 * Pure — no DOM, no Node — so it is unit-testable and safe to bundle for the browser.
 */

import type {
  CtxCourse,
  CtxResult,
  CtxSectionResult,
  CtxSectionIntro,
  CtxTopicResultView,
  CtxAdaptiveTopicView,
  CtxRecommendation,
} from "./context";

/** Ring geometry from `layouts/results.html` (`<circle r="63">`). */
const RING_RADIUS = 63;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Round to one decimal (points show at most one fractional digit). */
function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/** Normalized per-topic input (host adapts its own field names into this). */
export interface TopicInput {
  topicId?: string;
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  earnedPoints: number;
  possiblePoints: number;
  passed: boolean | null;
  /** SCORM-extra: per-topic pass threshold label, e.g. "Требуется: 70%". */
  requiredLabel?: string;
  /** SCORM-extra: per-topic feedback. */
  topicFeedback?: string;
}

/** Normalized standard result input. */
export interface ResultInput {
  passed: boolean;
  percent: number;
  totalQuestions: number;
  correct: number;
  earnedPoints: number;
  possiblePoints: number;
  topicResults: TopicInput[];
}

/** Optional SCORM-richer additions to the standard results context. */
export interface ResultContextOptions {
  /** Add the per-topic "Баллов" row (`pointsLabel`) — SCORM shows it, web omits. */
  withTopicPoints?: boolean;
  recommendedCourses?: CtxRecommendation[];
  recommendedEvents?: CtxRecommendation[];
  backAction?: string;
  backLabel?: string;
}

/** Built `{ course, result }` for the results layouts. */
export interface ResultRenderContext {
  course: CtxCourse;
  result: CtxResult;
}

/** Map a normalized topic to its presentational view (Core-prepared class + label). */
function topicView(t: TopicInput, withPoints: boolean): CtxTopicResultView {
  const passed = t.passed;
  const view: CtxTopicResultView = {
    topicId: t.topicId,
    topicName: t.topicName || "",
    correct: t.correct != null ? t.correct : 0,
    total: t.total,
    percent: Math.round(t.percent || 0),
    passClass: passed === true ? "is-pass" : passed === false ? "is-fail" : "",
    statusLabel: passed === true ? "Пройдено" : passed === false ? "Не пройдено" : "",
  };
  if (withPoints) view.pointsLabel = round1(t.earnedPoints) + " / " + round1(t.possiblePoints);
  if (t.requiredLabel) view.requiredLabel = t.requiredLabel;
  if (t.topicFeedback && String(t.topicFeedback).trim()) view.topicFeedback = t.topicFeedback;
  return view;
}

/**
 * Build the STANDARD results context. `result.*` carries both raw numbers and
 * Core-prepared presentational fields (the layout/DSL computes no logic). The
 * `opts` enable the SCORM-richer (gated) extras; with no opts the output matches
 * the web results screen exactly.
 */
export function buildResultContext(
  input: ResultInput,
  title: string,
  opts: ResultContextOptions = {},
): ResultRenderContext {
  const passed = !!input.passed;
  const percent = Math.round(input.percent || 0);
  const result: CtxResult = {
    passed,
    passClass: passed ? "is-pass" : "is-fail",
    statusLabel: passed ? "Пройден" : "Не пройден",
    scorePercent: percent,
    ringDashoffset: Math.round(RING_CIRCUMFERENCE * (1 - percent / 100)),
    totalQuestions: input.totalQuestions,
    correct: input.correct,
    earnedPoints: round1(input.earnedPoints),
    possiblePoints: round1(input.possiblePoints),
    topicResults: (input.topicResults || []).map((t) => topicView(t, !!opts.withTopicPoints)),
  };
  if (opts.recommendedCourses && opts.recommendedCourses.length) result.recommendedCourses = opts.recommendedCourses;
  if (opts.recommendedEvents && opts.recommendedEvents.length) result.recommendedEvents = opts.recommendedEvents;
  if (opts.backAction) {
    result.backAction = opts.backAction;
    result.backLabel = opts.backLabel;
  }
  return { course: { title }, result };
}

/** Normalized input for the staged section-results screen (PRD-19 FR-05a). */
export interface SectionResultInput {
  /** Section/topic name (heading). */
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  /** null = the section has no pass rule (no verdict tag). */
  passed: boolean | null;
  /** Override the «Продолжить» label (e.g. the last section before test-finish). */
  continueLabel?: string;
}

/**
 * Build the COMPUTED section-results context (`{ course, sectionResult }`, PRD-19
 * FR-05a). Reuses the same ring geometry as the test results screen; the verdict
 * tag is gated by `hasVerdict` so a section without a pass rule (passed === null)
 * shows the score without a pass/fail label. Pure — both hosts call it on their
 * own normalized section result so the numbers/markup cannot drift.
 */
export function buildSectionResultContext(input: SectionResultInput): {
  course: CtxCourse;
  sectionResult: CtxSectionResult;
} {
  const percent = Math.round(input.percent || 0);
  const hasVerdict = input.passed === true || input.passed === false;
  const sectionResult: CtxSectionResult = {
    topicName: input.topicName || "",
    scorePercent: percent,
    ringDashoffset: Math.round(RING_CIRCUMFERENCE * (1 - percent / 100)),
    passClass: input.passed === true ? "is-pass" : input.passed === false ? "is-fail" : "",
    statusLabel: input.passed === true ? "Раздел пройден" : input.passed === false ? "Раздел не пройден" : "",
    hasVerdict,
    correct: input.correct != null ? input.correct : 0,
    total: input.total,
    summaryLabel: (input.correct != null ? input.correct : 0) + " из " + input.total + " верно · " + percent + "%",
    continueLabel: input.continueLabel || "Продолжить",
  };
  return { course: { title: input.topicName || "" }, sectionResult };
}

/** Russian plural for «вопрос» (1 вопрос / 2 вопроса / 5 вопросов). */
function pluralQuestions(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return "вопросов";
  if (d === 1) return "вопрос";
  if (d > 1 && d < 5) return "вопроса";
  return "вопросов";
}

/** Normalized input for the «Введение раздела» screen (PRD-1 §4.3). */
export interface SectionIntroInput {
  /** 1-based section index (for the «Раздел N» eyebrow). */
  sectionNumber: number;
  topicName: string;
  /** Topic description from its properties. */
  description?: string | null;
  questionCount: number;
  timeLimitMinutes?: number | null;
  /** Author instruction (HTML/text); non-empty → the instruction block shows. */
  instruction?: string | null;
  continueLabel?: string;
}

/**
 * Build the «Введение раздела» context: `{ course, sectionIntro }`. The host injects
 * the author instruction HTML via the layout's `instruction` slot; this builder only
 * derives `hasInstruction` (gating the block) by stripping tags + whitespace.
 */
export function buildSectionIntroContext(input: SectionIntroInput): {
  course: CtxCourse;
  sectionIntro: CtxSectionIntro;
} {
  const count = Math.max(0, Math.round(input.questionCount || 0));
  const desc = (input.description ?? "").trim();
  const hasTime = !!(input.timeLimitMinutes && input.timeLimitMinutes > 0);
  const instrRaw = typeof input.instruction === "string" ? input.instruction : "";
  const instrText = instrRaw.replace(/<[^>]*>/g, "").trim();
  const sectionIntro: CtxSectionIntro = {
    eyebrow: "Раздел " + (input.sectionNumber || 1),
    topicName: input.topicName || "",
    description: desc,
    hasDescription: desc.length > 0,
    questionCount: count,
    questionCountLabel: count + " " + pluralQuestions(count),
    hasTimeLimit: hasTime,
    timeLimitLabel: hasTime ? String(input.timeLimitMinutes) + " мин" : "",
    hasInstruction: instrText.length > 0,
    continueLabel: input.continueLabel || "Далее",
  };
  return { course: { title: input.topicName || "" }, sectionIntro };
}

/** Normalized adaptive per-topic input. */
export interface AdaptiveTopicInput {
  topicName: string;
  achievedLevelIndex: number | null;
  achievedLevelName?: string | null;
  feedback?: string | null;
  recommendedLinks?: Array<{ title: string; url: string }>;
}

/** Normalized adaptive result input. */
export interface AdaptiveResultInput {
  passed?: boolean;
  topicResults: AdaptiveTopicInput[];
}

/** Optional SCORM action flags for the adaptive results layout. */
export interface AdaptiveResultContextOptions {
  hasScormActions?: boolean;
  showPdf?: boolean;
  canRetry?: boolean;
  showFinish?: boolean;
}

/** Map a normalized adaptive topic to its level-based view. */
function adaptiveTopicView(t: AdaptiveTopicInput): CtxAdaptiveTopicView {
  const achieved = t.achievedLevelIndex !== null && t.achievedLevelIndex !== undefined;
  const links = (t.recommendedLinks || []).map((l) => ({ title: l.title, url: l.url }));
  return {
    topicName: t.topicName || "",
    levelLabel: achieved ? (t.achievedLevelName as string) : "Не достигнут",
    levelClass: achieved ? "is-info" : "is-fail",
    feedback: t.feedback || "",
    hasFeedback: !!(t.feedback && String(t.feedback).trim()),
    hasLinks: links.length > 0,
    links,
  };
}

/**
 * Build the ADAPTIVE results context (level-based, no score ring). With no opts the
 * output matches the web adaptive results screen; the `opts` enable the SCORM
 * actions (Скачать PDF / Пройти заново / Завершить).
 */
export function buildAdaptiveResultContext(
  input: AdaptiveResultInput,
  title: string,
  opts: AdaptiveResultContextOptions = {},
): ResultRenderContext {
  const result: CtxResult = {
    passed: !!input.passed,
    adaptive: true,
    topicResults: (input.topicResults || []).map(adaptiveTopicView),
  };
  if (opts.hasScormActions) {
    result.hasScormActions = true;
    result.showPdf = !!opts.showPdf;
    result.canRetry = !!opts.canRetry;
    result.showFinish = !!opts.showFinish;
  }
  return { course: { title }, result };
}
