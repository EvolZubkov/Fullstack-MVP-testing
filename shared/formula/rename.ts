/**
 * @module shared/formula/rename
 *
 * Keeps `topicByName("…")` references intact when a topic is renamed (PRD-2 §4.2).
 * Because a formula is test-scoped and may only reference topics present in its
 * test, a rename of that topic resolves unambiguously, so the stored argument can
 * be rewritten safely. Matches the CANONICAL form the visual builder emits
 * (`topicByName(<JSON-string>)`); hand-written variants with different whitespace
 * are intentionally left untouched.
 */

/**
 * Rewrite every `topicByName("<oldName>")` to `topicByName("<newName>")` in one
 * formula. Literal (split/join) replacement on the canonical, JSON-escaped form —
 * no regex, so names with special characters are safe. Returns the formula
 * unchanged when the name is unchanged or the reference is absent.
 */
export function renameTopicByNameInFormula(formula: string, oldName: string, newName: string): string {
  if (oldName === newName) return formula;
  const oldRef = `topicByName(${JSON.stringify(oldName)})`;
  const newRef = `topicByName(${JSON.stringify(newName)})`;
  return formula.includes(oldRef) ? formula.split(oldRef).join(newRef) : formula;
}
