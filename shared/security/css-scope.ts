/**
 * @module shared/security/css-scope
 * @description Confines author-written CSS to the region it was pasted into.
 *
 * Content fields of type `html` accept a `<style>` block (see
 * {@link module:shared/security/html-sanitize} — it is not an unsafe tag, so it
 * is not stripped). In the web host the screen renders inside a Shadow DOM, where
 * a `body { … }` rule matches nothing; inside the SCORM package the very same
 * markup lands in the real document and restyles it. That asymmetry is how a
 * pasted full HTML document could collapse a fixed-stage template to an empty
 * screen while its preview looked correct.
 *
 * The fix is to rewrite the author's selectors so they can only match inside the
 * placeholder region: document-root selectors (`html`, `body`, `:root`) BECOME the
 * region, everything else is PREFIXED by it. The same trick the web host already
 * applies to template CSS (`:root` -> `:host` in `template-screen.tsx`), here
 * applied to author CSS.
 *
 * Deliberately a hand-written scanner rather than a regex or a CSS parser
 * dependency: it must run unchanged in Node (save, package build) and in the
 * browser (paste normalisation), and selector lists / nested at-rules / comments
 * are past what a regex can safely rewrite. A scoping mistake fails safe — the
 * rule stops matching, it can no longer damage the document.
 *
 * Not a trust boundary (same caveat as the sanitiser): viewport units and
 * `position: fixed` inside the pasted CSS still escape the region, because
 * scoping constrains selector MATCHING, not property VALUES.
 */

/** Result of a scoping pass: the rewritten text and how many rules were rewritten. */
export interface ScopeResult {
  /** The transformed CSS / HTML. */
  value: string;
  /** Number of style rules whose selector was rewritten (diagnostics for the author). */
  rules: number;
}

/** Marker attribute stamped on a processed `<style>` so re-scoping is a no-op. */
export const SCOPED_MARKER = "data-tb-scoped";

/**
 * At-rules whose body is a list of style rules, so scoping must recurse into it.
 * Everything else (`@keyframes`, `@font-face`, `@page`, `@property`, …) holds
 * declarations or keyframe selectors and is copied through untouched.
 */
const NESTED_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "document",
  "-moz-document",
]);

/** Document-root selectors: inside a scoped region THEY are the region. */
const ROOT_SELECTOR = /(^|[\s>+~,(])(:root|html|body)(?![\w-])/g;

/** Advances past whitespace and comments, which are copied through verbatim. */
function readTrivia(css: string, from: number): number {
  let i = from;
  for (;;) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    return i;
  }
}

/**
 * Finds the end of a rule prelude — the first `{`, `;` or `}` that is not inside
 * a string, a comment or a bracketed group (`@media (…)`, `:not(…)`, `[…]`).
 */
function findPreludeEnd(css: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === "{" || c === ";" || c === "}")) return i;
  }
  return css.length;
}

/** Finds the `}` closing a block that starts at `from`, honouring nesting. */
function findBlockEnd(css: string, from: number): number {
  let depth = 1;
  let quote = "";
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return css.length;
}

/** Lower-cased name of an at-rule prelude (`@media (…)` -> `media`). */
function atRuleName(prelude: string): string {
  const m = /^@([-\w]+)/.exec(prelude);
  return m ? m[1].toLowerCase() : "";
}

/** Splits a selector list on top-level commas (commas inside `:is(…)` stay put). */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

/** Rewrites one selector so it can only match inside `scope`. */
function scopeSelector(selector: string, scope: string): string {
  const replaced = selector.trim().replace(ROOT_SELECTOR, (_m, lead: string) => lead + scope);
  // `html body` becomes `<scope> <scope>`, which matches nothing — collapse it.
  let collapsed = replaced;
  const doubled = scope + " " + scope;
  while (collapsed.includes(doubled)) collapsed = collapsed.replace(doubled, scope);
  return collapsed.startsWith(scope) ? collapsed : scope + " " + collapsed;
}

/** Rewrites every selector of a list. */
function scopeSelectorList(selector: string, scope: string): string {
  return splitSelectorList(selector)
    .map((part) => scopeSelector(part, scope))
    .join(", ");
}

/**
 * Rewrites a stylesheet so every rule it contains can only match inside `scope`.
 *
 * @param css Author CSS (the text content of one `<style>` block).
 * @param scope Selector of the region the CSS was pasted into, e.g.
 *   `[data-placeholder="body"]`.
 * @returns The scoped CSS and the number of rewritten rules.
 */
export function scopeCss(css: string, scope: string): ScopeResult {
  let out = "";
  let rules = 0;
  let i = 0;

  while (i < css.length) {
    const afterTrivia = readTrivia(css, i);
    if (afterTrivia > i) {
      out += css.slice(i, afterTrivia);
      i = afterTrivia;
      continue;
    }
    if (css[i] === "}") {
      // Stray closer (malformed input) — keep it, do not try to interpret it.
      out += "}";
      i++;
      continue;
    }

    const preludeEnd = findPreludeEnd(css, i);
    const preludeRaw = css.slice(i, preludeEnd);
    const prelude = preludeRaw.trim();
    const terminator = preludeEnd < css.length ? css[preludeEnd] : "";

    if (terminator === "{") {
      const bodyStart = preludeEnd + 1;
      const bodyEnd = findBlockEnd(css, bodyStart);
      const body = css.slice(bodyStart, bodyEnd);
      if (prelude.startsWith("@")) {
        if (NESTED_AT_RULES.has(atRuleName(prelude))) {
          const inner = scopeCss(body, scope);
          rules += inner.rules;
          out += prelude + " {" + inner.value + "}";
        } else {
          out += prelude + " {" + body + "}";
        }
      } else if (prelude.length > 0) {
        out += scopeSelectorList(prelude, scope) + " {" + body + "}";
        rules++;
      } else {
        out += "{" + body + "}";
      }
      i = bodyEnd < css.length ? bodyEnd + 1 : css.length;
      continue;
    }

    if (terminator === ";") {
      // Statement at-rule. `@import` pulls an external stylesheet, which a SCORM
      // package must not do — dropped for the same reason external src/href are.
      if (atRuleName(prelude) !== "import") out += preludeRaw + ";";
      i = preludeEnd + 1;
      continue;
    }

    // A `}` we did not open, or trailing text with no block: copy and move on.
    out += preludeRaw;
    i = terminator === "}" ? preludeEnd : css.length;
  }

  return { value: out, rules };
}

/** Matches one `<style …>…</style>` block; style content cannot contain `</style>`. */
const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;

/**
 * Scopes the CSS of every `<style>` block inside an HTML fragment and stamps each
 * processed block with {@link SCOPED_MARKER}, so repeated passes (save, then every
 * package build) do not stack prefixes.
 *
 * @param html Sanitised author markup.
 * @param scope Selector of the region the markup renders into.
 * @returns The rewritten markup and the number of rewritten rules.
 */
export function scopeStyleBlocks(html: string, scope: string): ScopeResult {
  // Case-insensitive: `<Style>` is as valid as `<style>`, and a substring check
  // per casing would let the mixed-case form slip past the whole rewrite.
  if (!/<style\b/i.test(html)) return { value: html, rules: 0 };
  let rules = 0;
  const value = html.replace(STYLE_BLOCK, (whole, attrs: string, css: string) => {
    if (new RegExp("\\b" + SCOPED_MARKER + "\\b", "i").test(attrs)) return whole;
    const scoped = scopeCss(css, scope);
    rules += scoped.rules;
    return "<style" + attrs.replace(/\s+$/, "") + " " + SCOPED_MARKER + ">" + scoped.value + "</style>";
  });
  return { value, rules };
}
