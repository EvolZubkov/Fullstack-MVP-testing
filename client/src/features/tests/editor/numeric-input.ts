/**
 * @module features/tests/editor/numeric-input
 * @description Locale-aware parsing and formatting for the author's numeric
 * fields in the test editor — scale contributions («Вклады вопросов») and scale
 * band thresholds. Authors enter fractional values with a comma decimal
 * separator (ru locale); a dot is accepted as an alias and normalised to a
 * comma on display, so only the comma variant is ever shown. Values are stored
 * as plain JS numbers — only their presentation uses the comma.
 */

/** Matches a (possibly incomplete) decimal: optional minus, digits, one dot. */
const DECIMAL_RE = /^-?\d*\.?\d*$/;

/**
 * Parse one author-typed numeric field. Accepts a comma or dot decimal
 * separator and a single leading minus (so negative contributions are
 * preserved). Returns the parsed number, or `null` when the text is empty or
 * not yet a complete number (e.g. "-", ",", "-,") — letting callers keep the
 * previous value instead of committing garbage or silently coercing to zero.
 *
 * @param raw - Raw field text as typed by the author.
 * @returns The finite number the text denotes, or `null` if it denotes none.
 */
export function parseAuthorNumber(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "" || !DECIMAL_RE.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Format a stored number for an author field using a comma decimal separator.
 *
 * @param value - The stored numeric value.
 * @returns Its string form with `.` replaced by `,` (e.g. `-0.5` → `"-0,5"`).
 */
export function formatAuthorNumber(value: number): string {
  return String(value).replace(".", ",");
}

/**
 * Sanitise raw field text as the author types: convert dots to commas, drop any
 * character that is not a digit, comma or minus, and keep only a single leading
 * minus. Keeps the field to a single visible (comma) variant without reordering
 * the caret. Malformed leftovers (e.g. a stray second comma) are rejected later
 * by {@link parseAuthorNumber}, so they never corrupt the stored value.
 *
 * @param raw - Raw field text from the change event.
 * @returns The sanitised text to show in the field.
 */
export function sanitizeAuthorNumberInput(raw: string): string {
  return raw
    .replace(/\./g, ",")
    .replace(/[^0-9,-]/g, "")
    .replace(/(?!^)-/g, "");
}
