/**
 * @module shared/template/results-order
 *
 * Order of the four sub-blocks under the results umbrella (PRD-49 §3).
 *
 * The saved order is a HINT, not a contract: a template may add a sub-block later, and a
 * test saved before that must not lose it. So the resolver keeps what the author arranged
 * and appends whatever the template knows and the author never saw.
 *
 * Pure — no DOM, no Node.
 */

export type ResultsBlockKey = "summary" | "scales" | "indicators" | "topics";

/** Shipped order: the one the screen printed before this PRD, so nothing moves by itself. */
export const DEFAULT_BLOCK_ORDER: readonly ResultsBlockKey[] = ["summary", "scales", "indicators", "topics"];

/** The author's order, cleaned against what the template declares. */
export function resolveBlockOrder(
  saved: readonly ResultsBlockKey[] | undefined | null,
  templateOrder: readonly ResultsBlockKey[],
): ResultsBlockKey[] {
  const known = new Set(templateOrder);
  const out: ResultsBlockKey[] = [];
  for (const key of saved ?? []) {
    if (known.has(key) && !out.includes(key)) out.push(key);
  }
  for (const key of templateOrder) {
    if (!out.includes(key)) out.push(key);
  }
  return out;
}
