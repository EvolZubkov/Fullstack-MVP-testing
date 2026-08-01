/**
 * @module server/services/result-context
 *
 * Web-host adapter for the results render context (PRD-12 §10). It maps the
 * server-computed {@link AttemptResult} (overallPercent / overallPassed / total* …)
 * into the renderer's normalized input and delegates the actual shaping to the
 * SHARED builder ({@link module:shared/template/result-context}) — the SAME builder
 * the SCORM package runs via `TBTemplate`. So passClass / statusLabel / ring offset
 * / per-topic rows / adaptive level labels are produced in ONE place and cannot
 * drift between hosts. Pure — no storage, no DOM.
 */

import type { AttemptResult, TopicResult } from "@shared/schema";
import {
  buildResultContext as buildSharedResultContext,
  buildAdaptiveResultContext as buildSharedAdaptiveResultContext,
  normalizeFeedback,
  type ResultRenderContext,
  type TopicInput,
  type AdaptiveTopicInput,
} from "@shared/template/result-context";
import type { MeasureInput, MeasuresInput } from "@shared/template/result-context";
import type { ReportInput, AdaptiveReportInput, ReportMeta } from "@shared/report/report-html";
import { LEVEL_SCHEMES, type LevelRamp } from "@shared/template/level-ramp";
import { parseIndicatorInterpretation, parseScaleInterpretation } from "@shared/scales/interpretation";
import type { RenderKind } from "@shared/template/measure-view";
import type { ResultsBlockSettings } from "@shared/template/results-blocks";
import type { FeedbackContent, ResultVariable, Scale } from "@shared/schema";
import type { ScaleResult } from "@shared/formula/types";

export type { ResultRenderContext };

/** Rows and computed values the measures block needs, gathered by the caller. */
export interface MeasuresSource {
  scales: Scale[];
  variables: ResultVariable[];
  /**
   * Scale values of the attempt. Omitted by the web route: they are read from the
   * SAVED `AttemptResult` by {@link module:server/services/template-render
   * readResultsRenderPayload}, never recomputed — a later edit of the scale
   * configuration must not change what a finished attempt scored.
   */
  scaleResults?: Record<string, ScaleResult>;
  /** Indicator values of the attempt; same source and same rule as {@link scaleResults}. */
  variableValues?: Record<string, unknown>;
  /**
   * Effective design params of the test (already resolved against the template
   * manifest). Omitted by the web route: `readResultsRenderPayload` fills them from
   * the ONE resolution `readScreenTemplate` performs for the layout, so the ramp and
   * the render kinds cannot drift from the CSS the same screen is painted with.
   */
  params?: Record<string, unknown>;
  /** Settings of the chosen `results` variant. */
  blockSettings: ResultsBlockSettings;
  hasPassThreshold: boolean;
  /**
   * The test's own feedback block AS STORED (`tests.feedback_json`): text, course
   * links, events and PDF assets whose address lives in `scormHref`. PRD-29 §7.1
   * counts the test as one of the three equal sources of recommendations, so the
   * WHOLE block travels — not just its text — and goes through the same
   * {@link normalizeFeedback} the band and outcome blocks go through.
   */
  testFeedback?: Partial<FeedbackContent> | null;
}

/**
 * The ramp: a named scheme, or the author's three triples when `custom` is chosen.
 * A missing custom colour falls back to the traffic scheme's own end, so a
 * half-filled form still renders a sane ramp instead of a blank one.
 */
function resolveRamp(params: Record<string, unknown>): LevelRamp {
  const scheme = String(params.levelScheme ?? "traffic");
  if (scheme !== "custom") return LEVEL_SCHEMES[scheme === "neutral" ? "neutral" : "traffic"];
  return {
    favorable: String(params.levelColorFavorable ?? LEVEL_SCHEMES.traffic.favorable),
    mid: params.levelColorMid ? String(params.levelColorMid) : null,
    unfavorable: String(params.levelColorUnfavorable ?? LEVEL_SCHEMES.traffic.unfavorable),
  };
}

/** Build the PRD-29 measures input for the results context. */
export function buildMeasuresInput(source: MeasuresSource): MeasuresInput {
  const params = source.params ?? {};
  const scaleResults = source.scaleResults ?? {};
  const variableValues = source.variableValues ?? {};
  const scales: MeasureInput[] = source.scales
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      key: s.key,
      name: s.label || s.key,
      value: scaleResults[s.key]?.raw ?? null,
      visibility: s.learnerVisibility,
      interpretation: parseScaleInterpretation(s.configJson),
    }));

  const indicators: MeasureInput[] = source.variables
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((v) => ({
      key: v.name,
      name: v.label || v.name,
      value: variableValues[v.name] as number | string | boolean | null,
      visibility: v.learnerVisibility,
      interpretation: parseIndicatorInterpretation(v.configJson),
    }));

  return {
    ramp: resolveRamp(params),
    scaleKind: String(params.scaleRenderKind ?? "band_ruler") as RenderKind,
    indicatorKind: String(params.indicatorRenderKind ?? "label") as RenderKind,
    scales,
    indicators,
    // The stored block carries PDF assets addressed by `scormHref`; the shared
    // builder consumes `RecommendationLink`, so the test's feedback is adapted here
    // — the SAME normaliser the fired band/outcome blocks pass through.
    testFeedback: normalizeFeedback(source.testFeedback),
    hasPassThreshold: source.hasPassThreshold,
    blockSettings: source.blockSettings,
    // PRD-35. Lives in the SAME `settings_json` of the results page as the block
    // settings, so nothing new travels from the route — only the reading of it.
    showRadar: source.blockSettings?.showCompetencyRadar === true,
  };
}

/** Map a server topic result to the normalized topic input. */
function toTopicInput(t: TopicResult): TopicInput {
  return {
    topicId: t.topicId,
    topicName: t.topicName,
    correct: t.correct,
    total: t.total,
    percent: t.percent,
    earnedPoints: t.earnedPoints,
    possiblePoints: t.possiblePoints,
    passed: t.passed,
    // Per-topic feedback composition (plan 6.1): feedback + courses + events, the
    // SAME shape adaptive uses — the shared builder renders one feedback block.
    feedback: (t as { feedback?: string | null }).feedback ?? null,
    recommendedCourses: t.recommendedCourses ?? [],
    recommendedEvents: t.recommendedEvents ?? [],
  };
}

/** Dedup recommendations across failed topics by title + url (mirrors SCORM vrRecommended). */
function dedupRecommendations(items: { title: string; url?: string }[]): { title: string; url?: string }[] {
  const seen = new Set<string>();
  const out: { title: string; url?: string }[] = [];
  for (const it of items) {
    const key = `${it.title}|${it.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/**
 * Build the standard results-screen context from a computed attempt result.
 * Recommended courses (links) and events from FAILED topics are aggregated and
 * deduped, matching the SCORM runtime, so the web template results screen shows
 * them too (TD-02). The shared builder owns the actual shaping/rendering.
 *
 * PRD-29: `measures` is passed on to the shared builder ONLY when the test actually
 * defines scales or indicators — otherwise `opts.measures` stays undefined and the
 * control-test screen keeps exactly the context it has always had.
 */
export function buildResultContext(
  result: AttemptResult,
  testTitle: string,
  measures?: MeasuresSource,
): ResultRenderContext {
  const failed = (result.topicResults || []).filter((t) => t.passed === false);
  const recommendedCourses = dedupRecommendations(failed.flatMap((t) => t.recommendedCourses ?? []));
  const recommendedEvents = dedupRecommendations(failed.flatMap((t) => t.recommendedEvents ?? []));
  const hasMeasures = !!measures && (measures.scales.length > 0 || measures.variables.length > 0);
  return buildSharedResultContext(
    {
      passed: result.overallPassed,
      percent: result.overallPercent,
      totalQuestions: result.totalQuestions,
      correct: result.totalCorrect,
      earnedPoints: result.totalEarnedPoints,
      possiblePoints: result.totalPossiblePoints,
      topicResults: (result.topicResults || []).map(toTopicInput),
    },
    testTitle,
    {
      ...(recommendedCourses.length ? { recommendedCourses } : {}),
      ...(recommendedEvents.length ? { recommendedEvents } : {}),
      ...(hasMeasures ? { measures: buildMeasuresInput(measures as MeasuresSource) } : {}),
    },
  );
}

/**
 * Build the input for the shared PDF report (`shared/report/report-html`) from a
 * computed attempt result.
 *
 * The report is NOT built from the render context: that one is presentational
 * (`pointsLabel`, `passClass`), while the report needs the raw per-topic numbers and
 * verdicts. Both therefore start from the SAME normalized topic input, so the report
 * and the screen can never disagree about what the attempt was.
 *
 * @param result Computed attempt result.
 * @param testTitle Test title (the report headline + the file name).
 * @param meta Who took it and when, plus the attempt count for the «Лучший результат» line.
 */
export function buildReportInput(
  result: AttemptResult,
  testTitle: string,
  meta: Omit<ReportMeta, "testName"> = {},
): ReportInput {
  return {
    ...meta,
    testName: testTitle,
    result: {
      passed: result.overallPassed,
      percent: result.overallPercent,
      totalQuestions: result.totalQuestions,
      correct: result.totalCorrect,
      earnedPoints: result.totalEarnedPoints,
      possiblePoints: result.totalPossiblePoints,
      topicResults: (result.topicResults || []).map(toTopicInput),
    },
  };
}

/** {@link buildReportInput} for an adaptive attempt (levels, no score). */
export function buildAdaptiveReportInput(
  result: any,
  testTitle: string,
  meta: Omit<ReportMeta, "testName"> = {},
): AdaptiveReportInput {
  const topics = Array.isArray(result?.topicResults) ? result.topicResults : [];
  return {
    ...meta,
    adaptive: true,
    testName: testTitle,
    result: {
      passed: !!result?.overallPassed,
      topicResults: topics.map((t: any) => ({
        topicName: t?.topicName ?? "",
        achievedLevelIndex: t?.achievedLevelIndex ?? null,
        achievedLevelName: t?.achievedLevelName ?? null,
        totalQuestionsAnswered: t?.totalQuestionsAnswered,
        totalCorrect: t?.totalCorrect,
        feedback: t?.feedback ?? "",
        recommendedCourses: Array.isArray(t?.recommendedCourses)
          ? t.recommendedCourses.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
          : Array.isArray(t?.recommendedLinks)
            ? t.recommendedLinks.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
            : [],
        recommendedEvents: Array.isArray(t?.recommendedEvents)
          ? t.recommendedEvents.map((l: any) => ({ title: l?.title ?? "" }))
          : [],
      })),
    },
  };
}

/**
 * Build the adaptive results-screen context (level-based). No SCORM action flags —
 * the web adaptive results screen shows the base "Пройти снова" action.
 */
export function buildAdaptiveResultContext(result: any, testTitle: string): ResultRenderContext {
  const topics = Array.isArray(result?.topicResults) ? result.topicResults : [];
  return buildSharedAdaptiveResultContext(
    {
      passed: !!result?.overallPassed,
      topicResults: topics.map(
        (t: any): AdaptiveTopicInput => ({
          topicName: t?.topicName ?? "",
          achievedLevelIndex: t?.achievedLevelIndex ?? null,
          achievedLevelName: t?.achievedLevelName ?? null,
          feedback: t?.feedback ?? "",
          // Unified per-topic recommendations (plan 6.1): courses (was recommendedLinks)
          // + events, so the adaptive feedback block matches the standard one.
          recommendedCourses: Array.isArray(t?.recommendedCourses)
            ? t.recommendedCourses.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
            : Array.isArray(t?.recommendedLinks)
              ? t.recommendedLinks.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
              : [],
          recommendedEvents: Array.isArray(t?.recommendedEvents)
            ? t.recommendedEvents.map((l: any) => ({ title: l?.title ?? "" }))
            : [],
        }),
      ),
    },
    testTitle,
  );
}
