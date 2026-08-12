/**
 * @module server/services/required-fields-validator
 * @description Required-field validation for content_pages against the
 * variant schema in the active template (PRD-1 §4.3.6, PRD-7 §1.4).
 *
 * Pure helper `findMissingRequiredFields` returns the keys of placeholders
 * marked `required: true` whose value is missing or empty for a single page.
 * `RequiredFieldsMissingError` aggregates violations across multiple pages
 * so route handlers can render a structured 422 payload.
 *
 * Empty rules:
 *   - undefined / null               → missing
 *   - "" or whitespace-only string   → missing
 *   - empty array                    → missing
 *   - everything else (incl. `false` and `0`) → present
 */

interface PlaceholderShape {
  key: string;
  required?: boolean;
}

/** A single content_pages row violation: missing required placeholder keys. */
export interface RequiredFieldsViolation {
  pageId: string;
  templateKey: string | null;
  missingFields: string[];
}

export class RequiredFieldsMissingError extends Error {
  readonly violations: RequiredFieldsViolation[];

  constructor(violations: RequiredFieldsViolation[]) {
    super("required_fields_missing");
    this.name = "RequiredFieldsMissingError";
    this.violations = violations;
  }
}

/** Returns true when `value` should count as "filled". */
function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Returns the keys of placeholders marked `required: true` that are missing
 * a value in `values`. Caller decides what to do with the result (frontend
 * warning, server 422, etc.).
 */
export function findMissingRequiredFields(
  placeholders: ReadonlyArray<PlaceholderShape>,
  values: Record<string, unknown> | undefined,
): string[] {
  const safe = values ?? {};
  const missing: string[] = [];
  for (const ph of placeholders) {
    if (!ph.required) continue;
    if (!isFilled(safe[ph.key])) missing.push(ph.key);
  }
  return missing;
}
