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
  };
}

/**
 * Build the standard results-screen context from a computed attempt result. No
 * SCORM-extras (the web results screen is the base layout).
 */
export function buildResultContext(result: AttemptResult, testTitle: string): ResultRenderContext {
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
          recommendedLinks: Array.isArray(t?.recommendedLinks)
            ? t.recommendedLinks.map((l: any) => ({ title: l?.title ?? "", url: l?.url ?? "#" }))
            : [],
        }),
      ),
    },
    testTitle,
  );
}
