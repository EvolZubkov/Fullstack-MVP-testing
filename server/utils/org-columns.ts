/**
 * @module server/utils/org-columns
 * @description Org-structure and LMS-id columns of an uploaded list — the users
 * bulk import and the participants list of an assignment read them the same way
 * (org-structure plan, task 2; PRD-54 BR-54-29).
 *
 * The lists are filled in by people, not exported by a system, so each column is
 * read under the template spelling and under the Russian one a person would type.
 * Demanding one exact header is a sure way to get a column skipped in silence.
 * Values go through the shared normalisation, so a list and a profile form store
 * the same spelling of the same unit.
 */
import { normalizeOrgValue, type OrgField } from "@shared/org-fields";

/** Header spellings per field, template spelling first. */
const ORG_HEADERS: Record<OrgField, readonly string[]> = {
  organization: ["organization", "Организация", "организация"],
  unit: ["unit", "Подразделение", "подразделение"],
  position: ["position", "Должность", "должность"],
};

/** Header spellings of the LMS learner id: template, Russian, and the LMS's own name. */
const LMS_LEARNER_ID_HEADERS = ["lms_learner_id", "Идентификатор в LMS", "идентификатор в LMS", "learner_id"];

/** The first non-empty cell among `headers`, or `""`. */
function cell(row: Record<string, unknown>, headers: readonly string[]): unknown {
  for (const header of headers) {
    const value = row[header];
    if (value !== undefined && String(value).trim() !== "") return value;
  }
  return "";
}

/**
 * The three org-structure values of a list row.
 *
 * @param row Row of the uploaded sheet, keyed by header.
 * @returns Normalised values; `null` where the column is missing or empty.
 */
export function readOrgColumns(row: Record<string, unknown>): Record<OrgField, string | null> {
  return {
    organization: normalizeOrgValue(cell(row, ORG_HEADERS.organization)),
    unit: normalizeOrgValue(cell(row, ORG_HEADERS.unit)),
    position: normalizeOrgValue(cell(row, ORG_HEADERS.position)),
  };
}

/**
 * The LMS learner id of a list row (PRD-54 BR-54-31).
 *
 * @param row Row of the uploaded sheet, keyed by header.
 * @returns The trimmed id, or `null` where the column is missing or empty.
 */
export function readLmsLearnerIdColumn(row: Record<string, unknown>): string | null {
  const value = String(cell(row, LMS_LEARNER_ID_HEADERS)).trim();
  return value === "" ? null : value;
}
