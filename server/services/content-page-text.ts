/**
 * @module server/services/content-page-text
 *
 * The ONE rule for the stored form of a content page's values, shared by the
 * write path (`POST`/`PUT /api/tests/:id/content-pages`) and the deploy backfill
 * (`script/backfill-page-text.ts`).
 *
 * Two copies of this rule would drift, and the drift would be invisible: a page
 * saved by an author and the same page rewritten by the migration would differ by
 * a non-breaking space nobody can see in a diff.
 *
 * What it does: canonical whitespace plus Russian typography, applied to TEXT
 * only. Markup is preserved to the byte — tags, attributes, `<style>` blocks and
 * preformatted regions are never touched — and markdown is never interpreted,
 * because a page field holding HTML is written by an author who means `*` as a
 * character (see {@link module:shared/text/html-text}).
 *
 * The markup-aware pass is applied to every string regardless of its declared
 * placeholder type: on a value with no tags it reduces to exactly the plain pass,
 * so the backfill does not need each page's template manifest to do the right thing.
 */
import { normalizeAuthorHtml } from "@shared/text";

/** The `values_json` column shape: author values plus per-placeholder styles. */
export type PageValuesJson = {
  values?: Record<string, unknown>;
  placeholderStyles?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Normalise every string value of a page.
 *
 * @param valuesJson The stored `values_json`; anything malformed passes through.
 * @returns The normalised payload and whether anything actually changed — the
 *   backfill writes only rows that changed, so a re-run touches nothing.
 */
export function normalizePageValuesJson(valuesJson: unknown): {
  valuesJson: PageValuesJson;
  changed: boolean;
} {
  if (!valuesJson || typeof valuesJson !== "object" || Array.isArray(valuesJson)) {
    return { valuesJson: (valuesJson ?? {}) as PageValuesJson, changed: false };
  }

  const source = valuesJson as PageValuesJson;
  const values = source.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { valuesJson: source, changed: false };
  }

  let changed = false;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string") {
      normalized[key] = value;
      continue;
    }
    const next = normalizeAuthorHtml(value);
    if (next !== value) changed = true;
    normalized[key] = next;
  }

  return { valuesJson: { ...source, values: normalized }, changed };
}
