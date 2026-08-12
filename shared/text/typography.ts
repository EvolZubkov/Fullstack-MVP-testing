/**
 * @module shared/text/typography
 *
 * Russian typography pass for author text (question prompts, answer options,
 * page text fields).
 *
 * Operates on PLAIN text only — never on HTML. In this codebase the markdown
 * renderer calls it per text segment, so a URL, an attribute or a generated tag
 * can never be reached by these rules. That is what lets the whole pass be a
 * plain `string -> string` transform with no DOM, safe in Node, in the browser
 * and inside the SCORM bundle alike.
 *
 * Every rule is idempotent: applying the pass to its own output is a no-op. Both
 * hosts render stored text through it on every screen, so a second application
 * must not drift the result.
 */
import { HANGING_WORDS } from "./hanging-words";

/** Non-breaking space — the character every binding rule below inserts. */
const NBSP = "\u00A0";

/**
 * Replace straight double quotes with Russian guillemets. State toggles across
 * the whole string, so an unpaired quote degrades to a stray opening « rather
 * than to broken text.
 */
function replaceQuotes(text: string): string {
  let open = false;
  return text.replace(/"/g, () => {
    open = !open;
    return open ? "«" : "»";
  });
}

/**
 * Replace a hyphen-minus with an em dash where Russian punctuation calls for one:
 * spaced between words, opening a list item, or following sentence punctuation.
 *
 * A hyphen is deliberately left alone inside a compound word (`из-за`), next to
 * digits (`5-10`, `-3`) and inside a URL — in all of those it carries no dash
 * meaning. Spacing around the resulting dash is then normalised to exactly one
 * ordinary space per side, which also tidies dashes the author typed himself.
 *
 * Newlines are excluded from the spacing normalisation on purpose: line breaks
 * are structure, and collapsing one into a space would silently reflow the text.
 */
function replaceDashes(text: string): string {
  return text
    .replace(/^(\s*)-(?=\s+\S)/, "$1—")
    .replace(/([,.!?;:])\s*-(?=\s)/g, "$1—")
    .replace(/(?<=\s)-(?=\s)/g, "—")
    .replace(/[ \t\u00A0]*—[ \t\u00A0]*/g, " — ")
    .replace(/^ — /, "— ");
}

/**
 * A Russian word, hyphenated compounds included, that starts on a word boundary
 * and is followed by ONE ordinary space and a visible character. Matching an
 * ordinary space only is what makes the rule idempotent: a bound pair already
 * carries U+00A0 and can never match again.
 */
const HANGING_RE = /(?<![А-Яа-яЁё-])([А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*) (?=\S)/g;

/**
 * True when a word must not be left at the end of a line: either it is in the
 * dictionary, or it is one or two letters long.
 *
 * The length cutoff is deliberately 2, not the 3 of the module this was ported
 * from. There the cutoff stood in for a dictionary that loaded asynchronously and
 * was often absent; with the dictionary always present it only over-binds — three
 * letters covers ordinary nouns («дом», «год»), and gluing those to the next word
 * is not a typographic rule.
 */
function shouldBind(word: string): boolean {
  const lower = word.toLowerCase();
  return HANGING_WORDS.has(lower) || lower.length <= 2;
}

/** Bind hanging words to the word after them with a non-breaking space. */
function bindHangingWords(text: string): string {
  return text.replace(HANGING_RE, (match, word: string) =>
    shouldBind(word) ? word + NBSP : match,
  );
}

/**
 * Apply the full typography pass to a plain-text segment.
 *
 * @param text Plain text (no markup).
 * @returns The same text with typographic characters substituted.
 */
export function applyTypography(text: string): string {
  if (!text) return text;
  let result = replaceQuotes(text);
  result = replaceDashes(result);
  result = bindHangingWords(result);
  return result;
}
