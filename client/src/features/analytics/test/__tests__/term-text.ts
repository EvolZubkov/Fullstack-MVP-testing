/**
 * @module features/analytics/test/__tests__/term-text
 * @description Text matcher for tests of screens with `TermHint` terms.
 *
 * A term keeps its lucide `Info` icon glued to its LAST word: the last word and the
 * icon sit in one no-wrap block (`.tb-term-hint__tail`), so the term's text is split
 * across two elements. Testing Library's plain text query compares an element's OWN
 * text nodes and no longer sees «Время, медиана» as one string. For a person nothing
 * changes — adjacent inline spans read as one line, page search and screen readers
 * see one phrase — so the tests are what has to adapt.
 *
 * `termOrText` behaves exactly like the plain query for every element except a term:
 * the term wrapper (`.tb-term-hint__term`) is matched by its whole text, and the
 * pieces inside it are not matched on their own.
 */
import type { MatcherFunction } from "@testing-library/react";

/** Whitespace normalised the way Testing Library's default normaliser does it. */
function normalise(text: string): string {
  // A soft hyphen (a narrow column's «Дискриминативность», Э4а) is invisible to a reader.
  return text.replace(/­/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Match `text` as plain text, or a `TermHint` term by its whole wording.
 *
 * @param text - exact string (after whitespace normalisation) or a pattern
 * @returns matcher for `getByText` and friends
 */
export function termOrText(text: string | RegExp): MatcherFunction {
  const matches = (value: string) =>
    typeof text === "string" ? normalise(value) === normalise(text) : text.test(value);

  return (content, element) => {
    if (!element) return false;
    if (element.classList.contains("tb-term-hint__term")) return matches(element.textContent ?? "");
    // A piece of a term (its first words, or its last word with the icon) is not the term.
    if (element.closest(".tb-term-hint__term")) return false;
    return matches(content);
  };
}
