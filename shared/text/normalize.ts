/**
 * @module shared/text/normalize
 *
 * The canonical storage form of author text.
 *
 * This is the ONLY transform applied on the way into the database. Typography and
 * markdown are deliberately left out: they are applied at render time, to stored
 * and legacy content alike, so no migration is needed and the content hash of a
 * question changes only when its author actually edits it.
 *
 * What is normalised here is the invisible part — line endings, trailing spaces,
 * runs of blank lines — precisely because it is invisible: two authors who typed
 * the same text on different machines must not produce two different hashes,
 * two different snapshots and a spurious publication drift.
 */

/**
 * Bring author text to its canonical storage form: LF line endings, no leading or
 * trailing whitespace on a line, at most one blank line in a row, trimmed.
 *
 * Idempotent by construction — the write path may run it more than once.
 *
 * @param text Raw author input; anything that is not a string reads as empty.
 * @returns The canonical form, or an empty string.
 */
export function normalizeAuthorText(text: string | null | undefined): string {
  if (typeof text !== "string" || text === "") return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
