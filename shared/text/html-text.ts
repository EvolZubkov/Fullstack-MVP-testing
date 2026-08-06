/**
 * @module shared/text/html-text
 *
 * The author-text pass for fields that legitimately hold MARKUP — the `richText`
 * and `html` placeholders of a page variant.
 *
 * These fields get the same two things a plain-text field gets — canonical
 * whitespace and Russian typography — and deliberately NOT the third: markdown is
 * never interpreted here, because the author is writing HTML, and `*` or `[…](…)`
 * in his text are characters, not markup.
 *
 * Typography cannot be run over raw markup: a quote inside `class="x"` would come
 * out as a guillemet and the attribute would break. So the value is walked as a
 * sequence of tags and text runs, and only the text runs are transformed. Three
 * regions are skipped entirely — `<style>` (CSS is not prose), `<pre>` and
 * `<code>` (whitespace and punctuation there are content).
 *
 * Regex-based, no DOM: it runs on the server on save, and it is bundled for both
 * runtime hosts.
 */
import { applyTypography } from "./typography";
import { normalizeAuthorText } from "./normalize";

/** One tag, one protected block (with its content), or one run of text. */
const HTML_TOKEN =
  /<(style|pre|code)\b[^>]*>[\s\S]*?<\/\1>|<[^>]*>|[^<]+/gi;

/** True for a token that is a tag or a protected block — never transformed. */
function isProtected(token: string): boolean {
  return token.startsWith("<");
}

/**
 * Apply the typography pass to the TEXT of an HTML fragment, leaving tags,
 * attributes, style blocks and preformatted regions untouched.
 *
 * Quotes are paired across the whole value, so `"<strong>x</strong>"` becomes
 * `«<strong>x</strong>»` rather than two unmatched marks.
 */
export function applyTypographyToHtml(html: string): string {
  if (!html) return "";

  // Quotes first, over the whole string: a pair may span tags, so the toggle has
  // to survive them. Tags and protected blocks are consumed whole by the token
  // regex and pass through unchanged.
  let quoteOpen = false;
  const withQuotes = html.replace(HTML_TOKEN, (token) => {
    if (isProtected(token)) return token;
    return token.replace(/"/g, () => {
      quoteOpen = !quoteOpen;
      return quoteOpen ? "«" : "»";
    });
  });

  // Dashes and hanging words, per text run: both rules are local to a run, and a
  // run never contains a tag.
  return withQuotes.replace(HTML_TOKEN, (token) =>
    isProtected(token) ? token : applyTypography(token),
  );
}

/**
 * Bring a PLAIN author field to its stored form: canonical whitespace plus
 * typography. Used for the `text`/`textarea` placeholders of a page, which the
 * renderer escapes — so the typography has to be in the stored value, there is no
 * later pass that could add it.
 *
 * @param text Author text.
 * @returns The canonical form; empty string for a blank value.
 */
export function normalizeAuthorPlain(text: string): string {
  if (!text || !text.trim()) return "";
  return applyTypography(normalizeAuthorText(text));
}

/**
 * Bring a markup field to its stored form: canonical whitespace plus typography.
 *
 * Whitespace is canonicalised on the value as a whole (line endings, edge spaces,
 * runs of blank lines) — that is invisible in rendered HTML but decides whether
 * two authors who typed the same fragment produce the same bytes. Preformatted
 * regions are exempt: there whitespace IS content.
 *
 * @param html Author markup, already passed through the XSS sanitiser.
 * @returns The canonical form; empty string for a blank value.
 */
export function normalizeAuthorHtml(html: string): string {
  if (!html || !html.trim()) return "";

  // Protect <pre>/<code>/<style> from the whitespace pass by parking them aside.
  const parked: string[] = [];
  const masked = html.replace(
    /<(style|pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (block) => {
      parked.push(block);
      return "\u0000" + (parked.length - 1) + "\u0000";
    },
  );

  const canonical = normalizeAuthorText(masked);
  const typographed = applyTypographyToHtml(canonical);

  return typographed.replace(/\u0000(\d+)\u0000/g, (_, i: string) => parked[Number(i)]);
}
