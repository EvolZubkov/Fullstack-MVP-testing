/**
 * @module server/services/analytics/category-colors
 * @description Categorical colours of the analytics screens, taken VERBATIM from the approved
 * wireframes — the design-system tokens `--ou-cat-*`, in the order the wireframes use them.
 *
 * Two lists, because the wireframes paint two different things:
 *
 *  - LEVELS of a scale or numeric indicator WITHOUT a direction (`valence: none`) and without an
 *    author's tone — approved/slice-compare-answers.html paints «Низкий / Средний / Высокий» of a
 *    typology scale digital, bti, business. A grey ramp, which the code used before, made the
 *    levels of such a scale indistinguishable, while the wireframe had already agreed a palette;
 *  - OUTCOMES of a string or boolean indicator without a tone — analytics-indicators.html paints
 *    them business, bti, digital, leadership.
 *
 * The values are CSS variables, not literals: the screen prints them as they are, and the theme
 * resolves them (the same way the answer distribution of the «Вопросы» tab does).
 */

/** Levels without a direction, in band order (approved/slice-compare-answers.html). */
export const LEVEL_CATEGORY_COLORS: readonly string[] = [
  "var(--ou-cat-digital)",
  "var(--ou-cat-bti)",
  "var(--ou-cat-business)",
  "var(--ou-cat-b2c)",
  "var(--ou-cat-leadership)",
  "var(--ou-cat-b2o)",
];

/** Outcomes without a tone, in outcome order (analytics-indicators.html). */
export const OUTCOME_CATEGORY_COLORS: readonly string[] = [
  "var(--ou-cat-business)",
  "var(--ou-cat-bti)",
  "var(--ou-cat-digital)",
  "var(--ou-cat-leadership)",
  "var(--ou-cat-b2c)",
  "var(--ou-cat-b2o)",
];

/** «Прочее» — values outside the outcomes (analytics-indicators.html). */
export const REST_CATEGORY_COLOR = "var(--ou-fg-muted)";

/**
 * Colour at `index` of a palette, cycling past its end.
 *
 * @param palette one of the lists above
 * @param index position of the level or outcome
 */
export function categoryColor(palette: readonly string[], index: number): string {
  return palette[index % palette.length];
}
