/**
 * @module shared/scoring/lms-score
 * @description What a finished run reports to the LMS as `cmi.score` (technical debt closed
 * 2026-09-12; discovered by the WebTutor export review, PRD-54 §14.1).
 *
 * One rule, one place, because the package has TWO finish paths — the adaptive one and the
 * standard one — and they used to send the score independently.
 */
import { nothingToGrade } from "./pass-rule";

/** The run, reduced to what the score decision actually reads. */
export interface LmsScoreInput {
  /** The run's percent, 0..100, as the results screen computes it. */
  percent: number;
  /**
   * The run's total possible points — zero when there was nothing to grade.
   *
   * `undefined` / `null` is UNKNOWN, not zero: an attempt restored from a record written by
   * an older package carries `percent` and no points at all.
   */
  possiblePoints: number | null | undefined;
  /**
   * The verdict the package reached by the test's full rule (overall rule, required topics,
   * status-controlling indicators). `null` / absent — no verdict to carry (the adaptive path,
   * a run that is not graded, callers that predate it).
   */
  passed?: boolean | null;
  /**
   * The passing score, 0..100, the LMS compares the points with — the test's overall
   * threshold, which the administrator sets on the WebTutor course card at publication.
   * `0` / absent — the LMS counts every outcome as a pass, nothing to carry.
   */
  lmsThreshold?: number | null;
}

/** `cmi.score.raw` out of `cmi.score.max`, or nothing to report at all. */
export interface LmsScore {
  raw: number;
  max: number;
}

/**
 * The score to send to the LMS, or `null` when the run has none to speak of.
 *
 * A measurement run (a questionnaire, an allocation of points — anything a threshold cannot
 * be applied to) passes by construction, and sending `raw = 0 / max = 100` alongside that
 * verdict makes the customer's report say «Пройден, 0 баллов» under a declared threshold.
 * SCORM 2004 allows `cmi.score` to be absent, so the honest answer is silence: the same
 * choice `buildTopicObjective` already makes one level down, for the objective of a
 * measurement topic.
 *
 * A graded run that earned ZERO still reports zero — the learner did answer wrongly, and
 * that is a measured fact rather than a missing measurement.
 *
 * Silence falls only on what is KNOWN to have nothing to grade. An attempt whose possible
 * points are unknown keeps its score: the figure is missing from records written by older
 * packages, and reading «unknown» as «nothing» would drop the score of every graded test
 * restored from one. The same asymmetry {@link hasPronouncedVerdict} makes for the verdict.
 */
export function lmsScoreFor(run: LmsScoreInput): LmsScore | null {
  const points = run.possiblePoints;
  const known = points !== null && points !== undefined;
  if (known && nothingToGrade(points)) return null;
  const raw = Math.round(Number(run.percent) || 0);
  return { raw: alignWithVerdict(raw, run.passed, run.lmsThreshold), max: 100 };
}

/**
 * The points moved to the LMS threshold exactly when, and only as far as, they disagree with
 * the package's verdict. WebTutor records «Пройден» / «Не пройден» by comparing the points
 * with the course's passing score and ignores `success_status` and `scaled` (checked live on
 * testuniver.rt.ru, 2026-09-30), so a verdict the score alone does not express — a failed
 * required topic at 90 %, a certification passed by its indicators at 60 % — reaches it only
 * this way. The real points stay everywhere else: the report, the results screen, telemetry,
 * `cmi.objectives` and `cmi.interactions`.
 */
function alignWithVerdict(raw: number, passed: boolean | null | undefined, threshold: number | null | undefined): number {
  const t = Number(threshold);
  if (typeof passed !== "boolean" || !Number.isFinite(t) || t <= 0) return raw;
  if (!passed && raw >= t) return Math.max(0, Math.ceil(t) - 1);
  if (passed && raw < t) return Math.ceil(t);
  return raw;
}
