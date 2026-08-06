/**
 * @module shared/template/course-subtitle
 *
 * The single builder for the attempt line both hosts render beside the course
 * title ("Попытка N из M"): the start screen's cover eyebrow and the retake wall's
 * subtitle. BOTH hosts call it so the text is byte-identical (parity, PRD-12): the
 * SCORM runtime feeds `Telemetry.getAttemptNumber()` + `TEST_DATA.maxAttempts`,
 * the web host feeds its live attempt number + the test's `maxAttempts`. The
 * RESULTS header does not carry it — run parameters are not header material.
 *
 * The wireframe mock also shows a leading course-category label ("Обязательный
 * курс"), but the test entity carries no such field — fabricating one per test
 * would be dishonest — so the subtitle shows only the attempt progress, which is
 * real data on both hosts. A host may prepend its own label to the returned text.
 *
 * Pure — no DOM, no host globals — unit-testable and safe to bundle for both hosts.
 */

/** Inputs for {@link buildCourseSubtitle}. */
export interface CourseSubtitleInput {
  /** Current attempt number (1-based). Absent/invalid -> no line. */
  attemptNumber?: number | null;
  /** Attempt cap. Absent/non-positive (unlimited) -> no line either. */
  maxAttempts?: number | null;
}

/**
 * Build the attempt line. It is shown ONLY when BOTH numbers are real data: the
 * attempt's position AND the cap it counts against. Without a cap there is no
 * budget to track, so a bare «Попытка 3» reports a fact the learner cannot act on
 * — the line is dropped instead (the layout's `{{#if course.subtitle}}` then
 * renders a title-only header). Same rule as the start screen's prior-attempt
 * label (`state.priorResult.attemptsLabel`, see start-state).
 *
 * @param input attempt number + cap
 * @returns "Попытка N из M", or "" when either number is unknown
 */
export function buildCourseSubtitle(input: CourseSubtitleInput): string {
  const n = input?.attemptNumber;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return "";
  const max = input?.maxAttempts;
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return "";
  return `Попытка ${n} из ${max}`;
}
