/**
 * @module features/templates/template-status
 * @description Maps a template's lifecycle status, structural-validation report
 * and smoke-test report to a `{ label, tone }` pair for the DS `Tag` badge
 * (PRD-3 DS Mapping gate 3.5: status indicator = Tag with tone). Tones come from
 * the ui-kit `Tone` union (neutral/success/warning/error/...).
 */
import type { Tone } from "@universityrt/ui-kit";
import type { AdminTemplate, TemplateStatus, ValidationReport } from "./use-admin-templates";
import type { SmokeReport } from "@shared/template/smoke-runner";

export interface Badge {
  label: string;
  tone: Tone;
}

const STATUS_BADGES: Record<TemplateStatus, Badge> = {
  draft: { label: "Черновик", tone: "neutral" },
  active: { label: "Активный", tone: "success" },
  inactive: { label: "Неактивный", tone: "neutral" },
  invalid: { label: "Невалидный", tone: "error" },
};

/** Lifecycle status badge. */
export function statusBadge(status: TemplateStatus): Badge {
  return STATUS_BADGES[status] ?? { label: status, tone: "neutral" };
}

/** Structural-completeness badge from the validation report. */
export function validationBadge(report: ValidationReport | null): Badge {
  if (!report) return { label: "Не проверялась", tone: "neutral" };
  if (!report.ok) return { label: "Не пройдена", tone: "error" };
  if (report.warnings && report.warnings.length > 0) return { label: "Предупреждения", tone: "warning" };
  return { label: "В порядке", tone: "success" };
}

/** Health (smoke-test) badge from the smoke report. */
export function smokeBadge(report: SmokeReport | null): Badge {
  if (!report) return { label: "Не проверялась", tone: "neutral" };
  if (!report.ok) {
    return { label: `Не пройдена · ${report.failed} с ошибками`, tone: "error" };
  }
  const passed = `${report.passed}/${report.total} экранов`;
  if (report.warned > 0) return { label: `Пройдена · ${passed} (${report.warned} с предупр.)`, tone: "warning" };
  return { label: `Пройдена · ${passed}`, tone: "success" };
}

/**
 * Whether the template is activatable from the UI's perspective (mirrors the
 * server gate NFR-01): built-ins always; uploaded need validation.ok && smoke.ok.
 */
export function canActivate(t: AdminTemplate): boolean {
  if (t.isBuiltin) return true;
  return !!t.validationJson?.ok && !!t.smokeTestJson?.ok;
}
