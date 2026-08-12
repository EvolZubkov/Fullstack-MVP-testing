/**
 * @module shared/text/escape
 *
 * HTML escaping for author-supplied text.
 *
 * This is the first step of the markdown pipeline, and the reason the pipeline is
 * safe by construction: the author's text is neutralised BEFORE any tag is
 * generated, so markup he typed can only ever come out as visible characters,
 * and the only tags in the result are the ones the renderer itself emitted.
 *
 * Pure `unknown -> string`, no DOM, no Node APIs — usable in Node, in the browser
 * and inside the SCORM bundle.
 */

/**
 * Escape the five characters that allow HTML or attribute injection.
 *
 * The ampersand is replaced first; doing it later would re-escape the entities
 * produced by the other replacements.
 *
 * @param value Any value; `null` and `undefined` become an empty string.
 * @returns HTML-safe text.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
