/**
 * @module shared/text/html-to-markdown
 *
 * Conversion of incoming HTML into the markdown subset the service stores.
 *
 * Two callers need it, and they need the SAME result: the Excel import, whose
 * cells come from other systems and carry `<b>`/`<br>`/Word noise, and the
 * editor's paste handler. A second implementation on either side would drift,
 * and the author would see one thing on paste and another after a re-import.
 *
 * Regex-based on purpose, like the rest of the security layer
 * ({@link module:shared/security/html-sanitize}): it must run in Node, where
 * there is no DOM, and inside the SCORM bundle, where there is no Node.
 *
 * The output is markdown TEXT, never markup — whatever cannot be expressed in
 * the subset is reduced to its words. The renderer escapes the result before
 * generating tags, so nothing here has to produce safe HTML.
 */
import { normalizeAuthorText } from "./normalize";

/** Tags that identify a value as markup rather than as text with angle brackets. */
const KNOWN_TAG =
  /<\/?(?:p|br|b|strong|i|em|u|a|div|span|li|ul|ol|h[1-6]|table|tr|td|th|font|style|script|o:p)\b[^>]*>/i;

/** Blocks whose CONTENT is noise, not text: they are dropped whole. */
const NOISE_BLOCKS = [
  /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  /<!--[\s\S]*?-->/g,
];

/** Named entities a document editor emits; everything else falls to the numeric rule. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/** Protocols a converted link may keep; anything else collapses to its label. */
const SAFE_PROTOCOL = /^(https?:\/\/|mailto:)/i;

/**
 * True when the value carries HTML markup rather than plain text.
 *
 * Deliberately keyed to a list of known tags: a question may legitimately read
 * «если a < b», and treating that as markup would mangle it.
 */
export function looksLikeHtml(value: string): boolean {
  if (!value) return false;
  return KNOWN_TAG.test(value);
}

/** Decode the HTML entities a paste or an export may contain. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const decoded = NAMED_ENTITIES[name.toLowerCase()];
      return decoded === undefined ? match : decoded;
    });
}

/**
 * Convert HTML into the stored markdown subset.
 *
 * @param html Markup from a clipboard, a spreadsheet cell or an export.
 * @returns Canonical markdown text; empty for empty input.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return "";

  let text = html;
  for (const block of NOISE_BLOCKS) text = text.replace(block, "");

  text = text
    // Links first: the rule needs both the href and the label, and the label is
    // about to lose its tags.
    .replace(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, label: string) => {
        const clean = label.replace(/<[^>]+>/g, "").trim();
        return SAFE_PROTOCOL.test(href.trim()) ? `[${clean}](${href.trim()})` : clean;
      },
    )
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) =>
      wrapEmphasis(inner, "**"),
    )
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) =>
      wrapEmphasis(inner, "*"),
    )
    .replace(/<br\b[^>]*\/?>/gi, "\n")
    // A list item is a line; the subset has no list syntax of its own.
    .replace(/<\/li>/gi, "\n")
    // Everything block-level ends a paragraph.
    .replace(/<\/(?:p|div|h[1-6]|tr|blockquote)>/gi, "\n\n")
    // Whatever is left carries no meaning we can express: drop the tag, keep the words.
    .replace(/<[^>]+>/g, "");

  return normalizeAuthorText(decodeEntities(text));
}

/**
 * Wrap emphasised content in its marker, keeping the surrounding spaces outside:
 * `<b>текст </b>` must not become `**текст **`, which no renderer would read as
 * emphasis. Empty content loses the marker altogether.
 */
function wrapEmphasis(inner: string, marker: string): string {
  const stripped = inner.replace(/<[^>]+>/g, "");
  const content = stripped.trim();
  if (!content) return "";
  const leading = stripped.slice(0, stripped.length - stripped.trimStart().length);
  const trailing = stripped.slice(stripped.trimEnd().length);
  return `${leading}${marker}${content}${marker}${trailing}`;
}
