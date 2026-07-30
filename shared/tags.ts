/**
 * @module shared/tags
 *
 * Tag (sub-topic) normalization for PRD-11 stratified draw quotas. A tag is a
 * free-form, human-readable label set on a question (PRD-11 §3a). Per the
 * approved naming rules:
 *
 * - spaces inside a tag are allowed (it is a label, not an identifier);
 * - on save the tag is trimmed and internal whitespace runs collapse to one
 *   space; the storage form preserves the author's casing;
 * - comparison, dedup and the draw match are case-insensitive, so a near-miss
 *   ("Финансы" on a question vs "финансы" in a quota) still matches and the
 *   quota does not silently under-fill.
 *
 * Used by the Zod schemas (shared/schema.ts) and the question API on save, and
 * by the draw engine (shared/draw/blueprint.ts, plus its plain-JS twin in
 * server/scorm/assets/app.js) on match — both sides go through the same
 * `tagKey`, so storage and matching can never drift apart.
 */

/**
 * Maximum tag length (characters) after normalization (PRD-11 §3a).
 *
 * Raised from 50 to 100: real sub-topics are competence wordings, and 50 cut
 * them mid-phrase — «Принимает комплексные решения и мыслит завтрашним днем»
 * (54) was stored on the question as «…и мыслит завтрашним». That silently
 * de-synced the question's tag from the quota's (which was not capped at all,
 * see `parseQuotaRow`), so the quota matched nothing AND the test could no
 * longer be saved: the stored quota tag failed the 50-char rule of
 * `drawStratumSchema`.
 */
export const TAG_MAX_LENGTH = 100;

/**
 * Storage form of a tag: trim ends and collapse internal whitespace runs to a
 * single space. Casing is preserved for display. May return "" (caller drops).
 */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Case-insensitive comparison/dedup key for a tag (storage form, lower-cased).
 * Plain `toLowerCase` is used (not locale-aware) so the TypeScript engine and
 * its plain-JS SCORM twin produce byte-identical keys.
 */
export function tagKey(raw: string): string {
  return normalizeTag(raw).toLowerCase();
}

/**
 * Normalize a list of tags for storage: trim/collapse each, drop empties, cap
 * each at {@link TAG_MAX_LENGTH}, and dedup case-insensitively (the first form
 * encountered wins, preserving its casing).
 */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") continue;
    let t = normalizeTag(r);
    if (!t) continue;
    if (t.length > TAG_MAX_LENGTH) t = t.slice(0, TAG_MAX_LENGTH).trim();
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
