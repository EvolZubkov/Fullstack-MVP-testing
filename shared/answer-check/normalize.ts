/**
 * @module shared/answer-check/normalize
 *
 * The COMPARISON form of an answer (PRD-57 FR-28a). Applied to both sides — the
 * author's rule and the learner's answer — immediately before matching, and never
 * on the way into the database.
 *
 * Deliberately NOT an extension of `shared/text/normalize`: that module is the single
 * transform on the write path, and the content hash of a question depends on it, which
 * ties it to publication snapshots and to the PRD-52 comment pins. This one answers a
 * different question — «did the learner mean the same word?» — and touches nothing
 * stored.
 *
 * What is removed is technical noise only: a different keyboard layout for quotes or a
 * dash is not a different answer. Pure and framework-free — safe to bundle into the
 * SCORM runtime.
 */

/** Non-breaking, narrow no-break and figure spaces. */
const SPACES = /[   ]/g;
/** Hyphens, dashes and the minus sign — all read as a plain hyphen. */
const DASHES = /[‐-―−]/g;
/** Single quotes, apostrophes and the prime. */
const SINGLE_QUOTES = /[‘’‚‛′]/g;
/** Double quotes, guillemets and the double prime. */
const DOUBLE_QUOTES = /[“”„‟″«»]/g;

/**
 * Bring an answer to the form both sides are compared in.
 *
 * Order matters: the case is folded BEFORE `ё` is mapped to `е`, so `Ё` needs no
 * separate rule; whitespace is collapsed LAST, after the exotic spaces have become
 * ordinary ones.
 *
 * Idempotent by construction — the result of one pass is a fixed point of the next.
 *
 * @param value Raw text from either side; anything that is not a string reads as empty.
 * @returns The comparison form, or an empty string.
 */
export function normalizeForCompare(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return "";
  return value
    .replace(SPACES, " ")
    .replace(DASHES, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}
