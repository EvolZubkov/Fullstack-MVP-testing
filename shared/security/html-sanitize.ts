/**
 * @module shared/security/html-sanitize
 * @description Lightweight HTML sanitiser shared by server and editor for richText and html
 * placeholder values. Strips known XSS vectors: script / iframe / svg / object
 * tags, on* event handlers, and javascript: / external URI references. Does
 * not depend on a DOM, safe for Node.js.
 *
 * «External URI» means a RESOURCE the page fetches by itself — that is what breaks
 * the package's autonomy and hands the learner's address to a third party. A link's
 * `href` is not one: nothing is requested until the learner chooses to follow it.
 * So `src` loses an external address on every tag, while `<a>`/`<area>` keep theirs
 * and gain `target="_blank"` — the same policy the question's markdown pipeline
 * already applies (see {@link module:shared/text/markdown}). Before that split the
 * formatting toolbar offered a «Ссылка» button (PRD-22 FR-33) whose result was
 * stored as an `<a>` with no address — indistinguishable from plain text.
 *
 * Surfaces a per-field diagnostics report (PRD-7 S13.4-G18 / FR-25 sanitize)
 * so the UI can show the author exactly which tags/attributes were stripped.
 *
 * PRD-22: the editor applies the SAME function when normalising a pasted
 * fragment, so what the author sees after a paste is exactly what the server
 * would have kept. A second copy of these rules on the client would drift, and
 * the author would be told at save time about markup the field had just accepted.
 * Regex-based on purpose: no DOM, so it runs unchanged in Node and the browser.
 *
 * Beyond removals it also SCOPES author CSS when the caller names the region the
 * value renders into (see {@link module:shared/security/css-scope}): a `<style>`
 * block is safe, but its `body { … }` rule is inert inside the web host's Shadow
 * DOM and destructive inside the SCORM document. Scoping removes that asymmetry —
 * both hosts then render the same, confined CSS.
 */

import { scopeStyleBlocks } from "./css-scope";

/**
 * What the sanitiser changed in a single field. Empty when the input was already
 * safe and self-contained. `kind: "style"` is NOT a removal — it reports that the
 * field's CSS was confined to the page block, and `count` is the number of rules
 * rewritten.
 */
export type SanitizeRemoval = {
  kind: "tag" | "attribute" | "uri" | "style";
  /** Display label, e.g. `<script>` for tags, `onclick` for attributes. */
  label: string;
  /** How many occurrences of this rule fired against the input. */
  count: number;
};

/** Options for a single sanitisation pass. */
export type SanitizeOptions = {
  /**
   * CSS selector of the region this value renders into. When given, `<style>`
   * blocks in the value are rewritten so their rules cannot match outside it.
   * Omit for values whose render location is unknown — the CSS then stays as-is.
   */
  scope?: string;
};

/** Per-placeholder diagnostics from {@link sanitizeValuesWithDiagnostics}. Keyed by placeholder key. */
export type SanitizeDiagnostics = Record<string, SanitizeRemoval[]>;

const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const IFRAME_TAG = /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi;
const SVG_TAG = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
const OBJECT_TAG_PAIR = /<(object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi;
const OBJECT_TAG_VOID = /<(object|embed|link|meta)\b[^>]*\/?>/gi;
const ON_HANDLER_ATTR = /\s+(on\w+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
/**
 * Ветви разделены по виду кавычек намеренно: общее `["']?` съедало открывающую
 * кавычку, но не закрывающую, и замена оставляла за собой `href="#""` — лишний
 * безымянный атрибут и испорченная разметка, которой автор не писал.
 */
const JAVASCRIPT_URI =
  /(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]*)/gi;
/**
 * `src` always names a RESOURCE the page fetches by itself: an external one breaks
 * the SCORM package's autonomy and hands the learner's address to a third party.
 * Stripped on every tag.
 */
const HTTP_SRC_QUOTED = /\s(src)\s*=\s*(["'])https?:\/\/[^"']*\2/gi;
const HTTP_SRC_UNQUOTED = /\s(src)\s*=\s*https?:\/\/[^\s>]*/gi;
/** External `href`. Stripped on every tag EXCEPT the ones where it is a link ({@link LINK_TAG}). */
const HTTP_HREF_QUOTED = /\s(href)\s*=\s*(["'])https?:\/\/[^"']*\2/gi;
const HTTP_HREF_UNQUOTED = /\s(href)\s*=\s*https?:\/\/[^\s>]*/gi;

type Rule = { pattern: RegExp; kind: SanitizeRemoval["kind"]; label: string };

/**
 * One diagnostics entry for both halves of the rule — an external `src` anywhere and
 * an external `href` on a non-link tag. To the author they are the same prohibition:
 * no external resource.
 */
const EXTERNAL_URI_LABEL = "external src/href";

/** Bucketed by `label` so the diagnostics list doesn't duplicate entries. */
const RULES: Rule[] = [
  { pattern: SCRIPT_TAG, kind: "tag", label: "<script>" },
  { pattern: IFRAME_TAG, kind: "tag", label: "<iframe>" },
  { pattern: SVG_TAG, kind: "tag", label: "<svg>" },
  { pattern: OBJECT_TAG_PAIR, kind: "tag", label: "<object>/<embed>/<link>/<meta>" },
  { pattern: OBJECT_TAG_VOID, kind: "tag", label: "<object>/<embed>/<link>/<meta>" },
  { pattern: JAVASCRIPT_URI, kind: "uri", label: "javascript:" },
  { pattern: HTTP_SRC_QUOTED, kind: "uri", label: EXTERNAL_URI_LABEL },
  { pattern: HTTP_SRC_UNQUOTED, kind: "uri", label: EXTERNAL_URI_LABEL },
];

/**
 * Tags where `href` is a DESTINATION the learner chooses to follow, not a resource
 * the page fetches. Such an address requests nothing until the click, so it does not
 * contradict the package's autonomy and is kept.
 */
const LINK_TAG = /^(a|area)$/i;

/** An opening tag with its attribute chunk; a quoted value may contain `>`. */
const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** Whether the attribute chunk carries an external `href` — quoted or bare. */
const HAS_EXTERNAL_HREF = /\shref\s*=\s*(?:["']\s*https?:\/\/|https?:\/\/)/i;

/** How many times a rule fires against a string. */
function countMatches(input: string, pattern: RegExp): number {
  return input.match(pattern)?.length ?? 0;
}

/**
 * Walks the opening tags and settles their external `href`: a non-link loses the
 * attribute, a link keeps it and gains `target="_blank" rel="noopener noreferrer"`.
 *
 * The new window is not decoration: inside an LMS the package lives in a frame, and
 * navigating that frame would take the learner away from an unfinished attempt. The
 * question's markdown pipeline already applies exactly this rule
 * ({@link module:shared/text/markdown}).
 *
 * Attributes the author wrote are never overridden, which is also what makes a second
 * pass over a stored value a no-op.
 *
 * @param input Markup with unsafe tags and `javascript:` already dealt with.
 * @returns The processed markup and the number of external `href`s REMOVED.
 */
function normalizeExternalLinks(input: string): { value: string; removed: number } {
  let removed = 0;
  const value = input.replace(OPEN_TAG, (whole, name: string, attrs: string) => {
    if (!LINK_TAG.test(name)) {
      const stripped = attrs.replace(HTTP_HREF_QUOTED, "").replace(HTTP_HREF_UNQUOTED, "");
      if (stripped === attrs) return whole;
      removed += countMatches(attrs, HTTP_HREF_QUOTED) + countMatches(attrs, HTTP_HREF_UNQUOTED);
      return `<${name}${stripped}>`;
    }
    if (!HAS_EXTERNAL_HREF.test(attrs)) return whole;
    // A void tag's trailing slash stays trailing: the attributes go in before it.
    const tail = /\s*\/$/.exec(attrs)?.[0] ?? "";
    let body = tail ? attrs.slice(0, attrs.length - tail.length) : attrs;
    if (!/\starget\s*=/i.test(body)) body += ' target="_blank"';
    if (!/\srel\s*=/i.test(body)) body += ' rel="noopener noreferrer"';
    return `<${name}${body}${tail}>`;
  });
  return { value, removed };
}

/** Extracts the concrete event-handler attribute name (e.g. "onclick") from a match. */
function extractOnAttrName(match: string): string {
  const m = /\s+(on\w+)/i.exec(match);
  return m ? m[1].toLowerCase() : "on*";
}

/**
 * Region a placeholder value renders into — the scope its CSS is confined to.
 * Template variants render one `[data-placeholder]` region per key; an `html`-mode
 * page renders as a whole into `.content-page--html` (see
 * {@link module:shared/template/content-page buildFallbackContentHtml}).
 */
/**
 * PRD-59 §8: region the TEST DESCRIPTION renders into on the start screen. A pasted
 * `<style>` is confined to it, so an author's stray `body { … }` restyles their own
 * description instead of the whole player.
 *
 * A constant rather than a function: unlike a placeholder, there is one description per
 * test and its class is fixed by the template contract.
 */
export const DESCRIPTION_SCOPE = ".tb-cover__desc";

export function placeholderScope(key: string): string {
  if (key === "__html") return ".content-page--html";
  return '[data-placeholder="' + key.replace(/["\\]/g, "") + '"]';
}

/**
 * Sanitises one string and returns both the cleaned value and the list of
 * removal records. Records are de-duplicated by label and carry a `count`.
 *
 * @param input Raw author markup.
 * @param options Pass `scope` to also confine the value's CSS to that region.
 */
export function sanitizeHtmlWithDiagnostics(
  input: string,
  options?: SanitizeOptions,
): {
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

  let value = input
    .replace(SCRIPT_TAG, "")
    .replace(IFRAME_TAG, "")
    .replace(SVG_TAG, "")
    .replace(OBJECT_TAG_PAIR, "")
    .replace(OBJECT_TAG_VOID, "")
    .replace(ON_HANDLER_ATTR, "")
    .replace(JAVASCRIPT_URI, '$1="#"')
    .replace(HTTP_SRC_QUOTED, "")
    .replace(HTTP_SRC_UNQUOTED, "");

  // The `href` pass runs AFTER `javascript:` is defused — that one already replaced the
  // address with `#`, so nothing here reads it as external. It walks tags rather than
  // attributes because the verdict depends on the tag, not on the attribute.
  const links = normalizeExternalLinks(value);
  value = links.value;
  if (links.removed > 0) {
    const existing = removalsByLabel.get(EXTERNAL_URI_LABEL);
    if (existing) existing.count += links.removed;
    else removalsByLabel.set(EXTERNAL_URI_LABEL, {
      kind: "uri",
      label: EXTERNAL_URI_LABEL,
      count: links.removed,
    });
  }

  // Scoping runs LAST, on already-cleaned markup: the removals above may delete
  // whole elements, and there is no point rewriting CSS that is about to go.
  if (options?.scope) {
    const scoped = scopeStyleBlocks(value, options.scope);
    value = scoped.value;
    if (scoped.rules > 0) {
      removalsByLabel.set("<style>", { kind: "style", label: "<style>", count: scoped.rules });
    }
  }

  return { value, removed: Array.from(removalsByLabel.values()) };
}

/** Back-compat wrapper: returns only the cleaned string, discarding diagnostics. */
export function sanitizeHtml(input: string, options?: SanitizeOptions): string {
  return sanitizeHtmlWithDiagnostics(input, options).value;
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
        result[ph.key] = sanitizeHtml(v, { scope: placeholderScope(ph.key) });
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
        const { value, removed } = sanitizeHtmlWithDiagnostics(v, { scope: placeholderScope(ph.key) });
        cleaned[ph.key] = value;
        if (removed.length > 0) diagnostics[ph.key] = removed;
      }
    }
  }
  return { values: cleaned, diagnostics };
}
