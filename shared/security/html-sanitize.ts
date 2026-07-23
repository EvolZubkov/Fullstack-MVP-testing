/**
 * @module shared/security/html-sanitize
 * @description Lightweight HTML sanitiser shared by server and editor for richText and html
 * placeholder values. Strips known XSS vectors: script / iframe / svg / object
 * tags, on* event handlers, and javascript: / external URI references. Does
 * not depend on a DOM, safe for Node.js.
 *
 * Surfaces a per-field diagnostics report (PRD-7 S13.4-G18 / FR-25 sanitize)
 * so the UI can show the author exactly which tags/attributes were stripped.
 *
 * PRD-22: the editor applies the SAME function when normalising a pasted
 * fragment, so what the author sees after a paste is exactly what the server
 * would have kept. A second copy of these rules on the client would drift, and
 * the author would be told at save time about markup the field had just accepted.
 * Regex-based on purpose: no DOM, so it runs unchanged in Node and the browser.
 */

/** What was removed from a single field. Empty when the input was already safe. */
export type SanitizeRemoval = {
  kind: "tag" | "attribute" | "uri";
  /** Display label, e.g. `<script>` for tags, `onclick` for attributes. */
  label: string;
  /** How many occurrences of this rule fired against the input. */
  count: number;
};

/** Per-placeholder diagnostics from {@link sanitizeValuesWithDiagnostics}. Keyed by placeholder key. */
export type SanitizeDiagnostics = Record<string, SanitizeRemoval[]>;

const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const IFRAME_TAG = /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi;
const SVG_TAG = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
const OBJECT_TAG_PAIR = /<(object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi;
const OBJECT_TAG_VOID = /<(object|embed|link|meta)\b[^>]*\/?>/gi;
const ON_HANDLER_ATTR = /\s+(on\w+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const JAVASCRIPT_URI = /(href|src)\s*=\s*["']?\s*javascript:[^"'\s>]*/gi;
const HTTP_SRC_HREF_QUOTED = /\s(src|href)\s*=\s*(["'])https?:\/\/[^"']*\2/gi;
const HTTP_SRC_HREF_UNQUOTED = /\s(src|href)\s*=\s*https?:\/\/[^\s>]*/gi;

type Rule = { pattern: RegExp; kind: SanitizeRemoval["kind"]; label: string };

/** Bucketed by `label` so the diagnostics list doesn't duplicate entries. */
const RULES: Rule[] = [
  { pattern: SCRIPT_TAG, kind: "tag", label: "<script>" },
  { pattern: IFRAME_TAG, kind: "tag", label: "<iframe>" },
  { pattern: SVG_TAG, kind: "tag", label: "<svg>" },
  { pattern: OBJECT_TAG_PAIR, kind: "tag", label: "<object>/<embed>/<link>/<meta>" },
  { pattern: OBJECT_TAG_VOID, kind: "tag", label: "<object>/<embed>/<link>/<meta>" },
  { pattern: JAVASCRIPT_URI, kind: "uri", label: "javascript:" },
  { pattern: HTTP_SRC_HREF_QUOTED, kind: "uri", label: "external src/href" },
  { pattern: HTTP_SRC_HREF_UNQUOTED, kind: "uri", label: "external src/href" },
];

/** Extracts the concrete event-handler attribute name (e.g. "onclick") from a match. */
function extractOnAttrName(match: string): string {
  const m = /\s+(on\w+)/i.exec(match);
  return m ? m[1].toLowerCase() : "on*";
}

/**
 * Sanitises one string and returns both the cleaned value and the list of
 * removal records. Records are de-duplicated by label and carry a `count`.
 */
export function sanitizeHtmlWithDiagnostics(input: string): {
  value: string;
  removed: SanitizeRemoval[];
} {
  const removalsByLabel = new Map<string, SanitizeRemoval>();

  for (const rule of RULES) {
    const matches = input.match(rule.pattern);
    if (matches && matches.length > 0) {
      const existing = removalsByLabel.get(rule.label);
      if (existing) {
        existing.count += matches.length;
      } else {
        removalsByLabel.set(rule.label, {
          kind: rule.kind,
          label: rule.label,
          count: matches.length,
        });
      }
    }
  }

  // on* handlers are reported per-attribute (onclick, onmouseover, ...)
  const onMatches = input.match(ON_HANDLER_ATTR);
  if (onMatches) {
    for (const m of onMatches) {
      const name = extractOnAttrName(m);
      const existing = removalsByLabel.get(name);
      if (existing) {
        existing.count += 1;
      } else {
        removalsByLabel.set(name, { kind: "attribute", label: name, count: 1 });
      }
    }
  }

  const value = input
    .replace(SCRIPT_TAG, "")
    .replace(IFRAME_TAG, "")
    .replace(SVG_TAG, "")
    .replace(OBJECT_TAG_PAIR, "")
    .replace(OBJECT_TAG_VOID, "")
    .replace(ON_HANDLER_ATTR, "")
    .replace(JAVASCRIPT_URI, '$1="#"')
    .replace(HTTP_SRC_HREF_QUOTED, "")
    .replace(HTTP_SRC_HREF_UNQUOTED, "");

  return { value, removed: Array.from(removalsByLabel.values()) };
}

/** Back-compat wrapper: returns only the cleaned string, discarding diagnostics. */
export function sanitizeHtml(input: string): string {
  return sanitizeHtmlWithDiagnostics(input).value;
}

/**
 * Sanitises all richText and html fields within a values record, based on the
 * placeholder type definitions from a template manifest. Discards diagnostics
 * (use {@link sanitizeValuesWithDiagnostics} when the caller needs them).
 */
export function sanitizeValues(
  values: Record<string, unknown>,
  placeholders: Array<{ key: string; type: string }>,
): Record<string, unknown> {
  const result = { ...values };
  for (const ph of placeholders) {
    if (ph.type === "richText" || ph.type === "html") {
      const v = result[ph.key];
      if (typeof v === "string") {
        result[ph.key] = sanitizeHtml(v);
      }
    }
  }
  return result;
}

/**
 * Same as {@link sanitizeValues} but also returns per-placeholder diagnostics,
 * which the content-pages PUT forwards to the UI so the `s-sanitize` warning
 * banner can list exactly what was stripped from each placeholder.
 */
export function sanitizeValuesWithDiagnostics(
  values: Record<string, unknown>,
  placeholders: Array<{ key: string; type: string }>,
): { values: Record<string, unknown>; diagnostics: SanitizeDiagnostics } {
  const cleaned = { ...values };
  const diagnostics: SanitizeDiagnostics = {};
  for (const ph of placeholders) {
    if (ph.type === "richText" || ph.type === "html") {
      const v = cleaned[ph.key];
      if (typeof v === "string") {
        const { value, removed } = sanitizeHtmlWithDiagnostics(v);
        cleaned[ph.key] = value;
        if (removed.length > 0) diagnostics[ph.key] = removed;
      }
    }
  }
  return { values: cleaned, diagnostics };
}
