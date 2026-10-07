/**
 * @module client/features/tests/list/delete-impact
 * @description What deleting a test takes with it, as the delete dialog says it
 * (PRD-15 FR-07a, approved wireframe `test-delete-lms-impact.html`).
 *
 * The numbers come from `GET /api/tests/:id/delete-impact`. The text is built here,
 * not in the dialog, so its Russian plural forms can be tested without rendering.
 */
import { pluralize } from "@/lib/i18n";

/** Answer of `GET /api/tests/:id/delete-impact`. */
export interface TestDeleteImpact {
  /** Attempts taken in the service itself. */
  webAttempts: number;
  /** LMS attempts: telemetry and uploaded report exports together. */
  lmsAttempts: number;
  /** Uploaded LMS report exports (PRD-54). */
  importBatches: number;
  /** Exported SCORM packages: they stop reporting results after the deletion. */
  packages: number;
}

/** The warning banner of the delete dialog. */
export interface DeleteImpactWarning {
  title: string;
  /** Absent when every attempt was taken in the service: there is nothing about LMS to say. */
  description?: string;
}

/**
 * The warning the delete dialog shows, or `null` when the test has no attempts and
 * no packages — then the dialog stays as the approved prd7 wireframe draws it.
 *
 * @param impact - Counts of what the deletion takes.
 * @returns The banner text, or `null` when there is nothing to warn about.
 */
export function describeDeleteImpact(impact: TestDeleteImpact): DeleteImpactWarning | null {
  const total = impact.webAttempts + impact.lmsAttempts;
  const packagesLine = impact.packages === 1
    ? "Выгруженный пакет перестанет передавать результаты в аналитику."
    : `Выгруженные пакеты (${impact.packages}) перестанут передавать результаты в аналитику.`;
  if (total === 0) return impact.packages > 0 ? { title: packagesLine } : null;

  const title = `${pluralize(total, "Будет удалено", "Будут удалены", "Будут удалены")} ${total} ${pluralize(
    total, "прохождение", "прохождения", "прохождений",
  )}`;
  if (impact.lmsAttempts === 0 && impact.packages === 0) return { title };

  const parts: string[] = [];
  if (impact.lmsAttempts > 0) {
    let where = `${impact.webAttempts} — в сервисе, ${impact.lmsAttempts} — из LMS`;
    if (impact.importBatches > 0) {
      where += `, в том числе ${impact.importBatches} ${pluralize(
        impact.importBatches, "загруженная выгрузка", "загруженные выгрузки", "загруженных выгрузок",
      )}`;
    }
    parts.push(`${where}.`);
  }
  if (impact.packages > 0) parts.push(packagesLine);
  return { title, description: parts.join(" ") };
}
