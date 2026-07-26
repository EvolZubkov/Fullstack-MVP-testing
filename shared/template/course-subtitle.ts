/**
 * @module shared/template/course-subtitle
 *
 * The single builder for the header subtitle line both hosts render under the
 * course title (`course.subtitle`, wireframe «Прохождение теста»: "Попытка N из
 * M"). BOTH hosts call it so the text is byte-identical (parity, PRD-12): the
 * SCORM runtime feeds `Telemetry.getAttemptNumber()` + `TEST_DATA.maxAttempts`,
 * the web host feeds its live attempt number + the test's `maxAttempts`.
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
  /** Current attempt number (1-based). Absent/invalid -> no subtitle. */
  attemptNumber?: number | null;
  /** Attempt cap; absent/non-positive drops the "из M" tail (unlimited). */
  maxAttempts?: number | null;
}

/**
 * Build the header subtitle string. Returns "" (the layout's `{{#if
 * course.subtitle}}` then renders nothing) when the attempt number is unknown,
 * so a host that cannot supply it degrades gracefully to a title-only header.
 *
 * @param input attempt number + optional cap
 * @returns "Попытка N из M", "Попытка N" (no cap), or "" (unknown attempt)
 */
export function buildCourseSubtitle(input: CourseSubtitleInput): string {
  const n = input?.attemptNumber;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return "";
  const max = input?.maxAttempts;
  const capped = typeof max === "number" && Number.isFinite(max) && max > 0;
  return capped ? `Попытка ${n} из ${max}` : `Попытка ${n}`;
}
