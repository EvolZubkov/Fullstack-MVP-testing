/**
 * @module shared/answer-check/wildcard
 *
 * Ordinary comparison with the two wildcards the author gets (PRD-57 FR-28d1):
 * `*` — any continuation, `?` — exactly one character.
 *
 * Matching is a TWO-POINTER scan, deliberately NOT a compiled `RegExp`. A pattern
 * translated into a regular expression would bring back the backtracking surface the
 * track postponed to Э7 together with its time budget (§6.4): the measured cases blow
 * up at 24–30 characters, which is inside any sane short-answer limit. The scan below
 * is bounded by the product of the two lengths and has no catastrophic case, which is
 * what makes this stage shippable before the budget exists.
 *
 * Both arguments are expected to be in the comparison form already
 * ({@link module:shared/answer-check/normalize}) — this module does not normalise, so
 * the caller cannot normalise one side and forget the other.
 *
 * Escaping a literal `*` or `?` is NOT provided: the specification does not ask for it,
 * and inventing a syntax the author is never told about is worse than not having one.
 * If the need appears, it arrives as its own decision.
 */

/**
 * Does `text` match `pattern`?
 *
 * @param pattern Author pattern in comparison form; may contain `*` and `?`.
 * @param text    Learner answer in comparison form.
 * @returns True when the whole text is covered by the whole pattern.
 */
export function matchWildcard(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  // Position of the last `*` seen, and how much of the text it had eaten by then:
  // the single point the scan returns to instead of exploring alternatives.
  let star = -1;
  let eaten = 0;

  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === "*") {
      star = p;
      p++;
      eaten = t;
    } else if (star >= 0) {
      p = star + 1;
      eaten++;
      t = eaten;
    } else {
      return false;
    }
  }

  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}
