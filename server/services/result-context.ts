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
  type ResultRenderContext,
  type TopicInput,
  type AdaptiveTopicInput,
} from "@shared/template/result-context";

export type { ResultRenderContext };

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
 */
export function buildResultContext(result: AttemptResult, testTitle: string): ResultRenderContext {
  const failed = (result.topicResults || []).filter((t) => t.passed === false);
  const recommendedCourses = dedupRecommendations(failed.flatMap((t) => t.recommendedCourses ?? []));
  const recommendedEvents = dedupRecommendations(failed.flatMap((t) => t.recommendedEvents ?? []));
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
    },
  );
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
