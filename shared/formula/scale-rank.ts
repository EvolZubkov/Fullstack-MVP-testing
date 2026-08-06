/**
 * @module shared/formula/scale-rank
 *
 * Ranking a group of scales by their value (PRD-44 §5) — the arithmetic behind the
 * `topScale(...)` / `bottomScale(...)` formula sources.
 *
 * The type this serves is ipsative: the scales of a budget question share a constant sum,
 * so the interesting fact about a learner is not the size of one scale but their ORDER —
 * which style leads, which trails, and by how much. That ordering needs three decisions,
 * each of which the reference questionnaire forced:
 *
 *  1. **Rank by the NORMALIZED value, never by `raw`** (FR-20). Raw values of scales with
 *     different domains are not comparable, and `direction: inverse` has already been
 *     applied to the normalized one — ranking on `raw` would put an inverted scale at the
 *     wrong end of its own group.
 *  2. **Break ties by the AUTHORED order of the test's scales** (FR-21), not by the order
 *     the keys happen to appear in the formula. Otherwise the same answer recomputed in
 *     the web host, in the package and from a snapshot could crown different leaders.
 *  3. **Make the tie visible** (FR-22). The reference file resolves it silently: its
 *     `MATCH(MAX(...))` returns whichever column stands further left, and two styles there
 *     really do tie at 34. `tiedCount` and `margin` let a report say «два равно выраженных
 *     стиля» instead of inventing a winner.
 *
 * Pure and framework-free — the SCORM runtime bundles it, and a plain-JS twin lives in
 * `server/scorm/template/app/dsl/formula.js`.
 */

import type { ScaleResult } from "./types";

/** One place in the ranking — the shape `topScale(...).prop` reads. */
export interface ScaleRankEntry {
  /** The scale's key. */
  key: string;
  /** Its interpretation-band label (empty when the scale has no bands). */
  label: string;
  /** The normalized value the ranking was built on. */
  value: number;
  /** Distance to the next DIFFERENT value; `0` at the end of the ranking. */
  margin: number;
  /** How many scales share this place — `1` when the place is unambiguous. */
  tiedCount: number;
}

/**
 * Rank `keys` from the highest normalized value to the lowest.
 *
 * Scales without a value (`hasValue: false`) are left out: an unanswered scale has no
 * place in a ranking, and treating its zero as a real value would hand it the bottom
 * place ahead of scales that were actually measured. Unknown keys are skipped for the
 * same reason the evaluator never throws on absent data — a formula must not break an
 * attempt.
 *
 * @param keys        The group named in the formula.
 * @param values      The computed `scale.*` namespace.
 * @param authorOrder The test's scales in `sort_order` — the tie-break (FR-21).
 */
export function rankScales(
  keys: readonly string[],
  values: Record<string, ScaleResult>,
  authorOrder: readonly string[],
): ScaleRankEntry[] {
  const authorIndex = new Map(authorOrder.map((key, i) => [key, i]));
  const present = keys
    .filter((key) => values[key]?.hasValue === true)
    // A key listed twice in the formula must not occupy two places.
    .filter((key, i, all) => all.indexOf(key) === i);

  const sorted = [...present].sort((a, b) => {
    const byValue = values[b].normalized - values[a].normalized;
    if (byValue !== 0) return byValue;
    // Equal values: the authored order decides, identically on every host. A key missing
    // from the authored order sorts last among its ties rather than at random.
    const ia = authorIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ib = authorIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });

  return sorted.map((key, i) => {
    const value = values[key].normalized;
    // The gap to the next DIFFERENT value, not to the next row: with a tie the neighbour
    // is the tied scale itself, and a margin of 0 would read as «выражены одинаково» for
    // a place that is in fact clearly ahead of the rest.
    const nextDifferent = sorted.slice(i + 1).find((k) => values[k].normalized !== value);
    return {
      key,
      label: values[key].label ?? "",
      value,
      margin: nextDifferent === undefined ? 0 : value - values[nextDifferent].normalized,
      tiedCount: sorted.filter((k) => values[k].normalized === value).length,
    };
  });
}

/**
 * The scale at `place` of the ranking, counted from 1 — from the top for `topScale`,
 * from the bottom for `bottomScale`.
 *
 * `null` when the ranking cannot answer: an empty ranking, a place below 1, or a place
 * past the number of ranked scales (FR-23). The evaluator then behaves as with any other
 * undefined value rather than inventing one.
 */
export function scaleAtRank(
  keys: readonly string[],
  values: Record<string, ScaleResult>,
  authorOrder: readonly string[],
  place: number,
  fromBottom: boolean,
): ScaleRankEntry | null {
  if (!Number.isInteger(place) || place < 1) return null;
  const ranked = rankScales(keys, values, authorOrder);
  if (place > ranked.length) return null;
  return fromBottom ? ranked[ranked.length - place] : ranked[place - 1];
}
