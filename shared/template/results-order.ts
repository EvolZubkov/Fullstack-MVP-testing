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

/**
 * Per-screen declaration of which sub-blocks a template prints, and in what order
 * (`manifest.resultsBlockOrder`).
 *
 * `default` answers every screen the template says nothing special about; a named screen
 * key (`"results.adaptive"`) overrides it — the same «default + per-screen default» shape
 * the label declarations already use, so a template author meets ONE convention.
 */
export interface TemplateBlockOrder {
  default?: ResultsBlockKey[];
  [screen: string]: ResultsBlockKey[] | undefined;
}

/** Is this a key the product knows? A manifest is data, so it may carry anything. */
function isBlockKey(value: unknown): value is ResultsBlockKey {
  return value === "summary" || value === "scales" || value === "indicators" || value === "topics";
}

/** The declared list for one screen, cleaned; `null` when the declaration says nothing. */
function declaredFor(
  declared: TemplateBlockOrder | ResultsBlockKey[] | null | undefined,
  screen: string,
): ResultsBlockKey[] | null {
  if (!declared) return null;
  // A flat array is the whole template's answer — the shape shipped before screens were
  // told apart, and the natural way to write «all my screens print these four».
  const raw = Array.isArray(declared) ? declared : (declared[screen] ?? declared.default);
  if (!Array.isArray(raw)) return null;
  return raw.filter(isBlockKey);
}

/**
 * The order a TEMPLATE declares for one screen.
 *
 * Screens differ in COMPOSITION, not only in order — the adaptive results screen has never
 * printed the score summary — so the screen's own list wins over the shared one, and the
 * shipped constant answers a template that declares nothing. Composition rides on the same
 * list because {@link resolveBlockOrder} drops whatever the template does not know: leaving
 * `summary` out of the adaptive screen's list IS «this screen has no summary».
 *
 * An unknown key inside a declaration is dropped rather than made to invalidate the whole
 * list: the product cannot render a block it has no data for, and the author's remaining
 * keys are still an instruction. A declaration that survives cleaning as EMPTY is honoured
 * as empty — falling back to the shipped constant there would resurrect exactly the block
 * the template took out, which is the failure this function exists to prevent.
 */
export function templateBlockOrder(
  declared: TemplateBlockOrder | ResultsBlockKey[] | null | undefined,
  screen: string,
): readonly ResultsBlockKey[] {
  return declaredFor(declared, screen) ?? DEFAULT_BLOCK_ORDER;
}

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
