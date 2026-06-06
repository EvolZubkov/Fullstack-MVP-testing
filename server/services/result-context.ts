/**
 * @module server/services/result-context
 *
 * Builds the runtime render context for the RESULTS screen from a computed
 * {@link AttemptResult} (PRD-12 task 2-4) — the bridge between the server-computed
 * result and the unified renderer ({@link module:shared/template/render-screen}).
 * It produces the shape the default layouts consume (`course` + `result` with
 * Core-prepared presentational fields: `passClass`, `statusLabel`, `ringDashoffset`,
 * per-topic rows), so any host can draw the real results layout. Pure — no storage,
 * no DOM — and therefore unit-testable.
 *
 * NOTE on namespaces: the default layouts currently use `course.*` / `result.*`
 * (the SCORM runtime's shape), not the draft spec §10 `test.*` / `page.*`. This
 * builder matches the working layouts; converging the namespaces to the §10
 * contract ({@link module:shared/template/context}) is a separate task
 * (PRD-12 §9.5 — context contract).
 */

import type { AttemptResult, TopicResult } from "@shared/schema";

/** Ring geometry from layouts/results.html (`<circle r="63">`). */
const RING_RADIUS = 63;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Round to one decimal (points are displayed with at most one fractional digit). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Built context for the results screen (the `course`/`result` runtime shape). */
export interface ResultRenderContext {
  course: { title: string };
  result: Record<string, unknown>;
}

/**
 * Build the results-screen context for an ADAPTIVE attempt (level-based, no
 * scores). Per topic: achieved level as a pill + feedback + recommended links.
 */
export function buildAdaptiveResultContext(result: any, testTitle: string): ResultRenderContext {
  const topics = Array.isArray(result?.topicResults) ? result.topicResults : [];
  return {
    course: { title: testTitle },
    result: {
      passed: !!result?.overallPassed,
      adaptive: true,
      topicResults: topics.map((t: any) => {
        const achieved = t?.achievedLevelIndex !== null && t?.achievedLevelIndex !== undefined;
        return {
          topicName: t?.topicName ?? "",
          levelLabel: t?.achievedLevelName || "Не достигнут",
          levelClass: achieved ? "is-info" : "is-fail",
          feedback: t?.feedback || "",
          hasFeedback: !!t?.feedback,
          hasLinks: Array.isArray(t?.recommendedLinks) && t.recommendedLinks.length > 0,
          links: (Array.isArray(t?.recommendedLinks) ? t.recommendedLinks : []).map((l: any) => ({
            title: l?.title ?? "",
            url: l?.url ?? "#",
          })),
        };
      }),
    },
  };
}

/** Map a topic result to its presentational view (Core-prepared class + label). */
function topicView(t: TopicResult) {
  const passClass = t.passed === true ? "is-pass" : t.passed === false ? "is-fail" : "";
  const statusLabel = t.passed === true ? "Пройдено" : t.passed === false ? "Не пройдено" : "";
  return {
    topicId: t.topicId,
    topicName: t.topicName,
    correct: t.correct,
    total: t.total,
    percent: Math.round(t.percent),
    earnedPoints: round1(t.earnedPoints),
    possiblePoints: round1(t.possiblePoints),
    passClass,
    statusLabel,
    passed: t.passed,
  };
}

/**
 * Build the results-screen render context from a computed attempt result. The
 * `result.*` namespace carries both the raw numbers and Core-prepared
 * presentational fields the layout binds (so the layout/DSL computes no logic).
 * The PRD-5 `scaleResults` / PRD-2 `resultVariables` / `status` namespaces are
 * passed through for layouts that display them.
 */
export function buildResultContext(result: AttemptResult, testTitle: string): ResultRenderContext {
  const passed = result.overallPassed;
  const percent = Math.round(result.overallPercent);
  return {
    course: { title: testTitle },
    result: {
      passed,
      passClass: passed ? "is-pass" : "is-fail",
      statusLabel: passed ? "Пройден" : "Не пройден",
      scorePercent: percent,
      ringDashoffset: Math.round(RING_CIRCUMFERENCE * (1 - percent / 100)),
      totalQuestions: result.totalQuestions,
      correct: result.totalCorrect,
      earnedPoints: round1(result.totalEarnedPoints),
      possiblePoints: round1(result.totalPossiblePoints),
      topicResults: result.topicResults.map(topicView),
      scaleResults: result.scaleResults ?? {},
      resultVariables: result.resultVariables ?? {},
      status: result.status ?? {},
    },
  };
}
