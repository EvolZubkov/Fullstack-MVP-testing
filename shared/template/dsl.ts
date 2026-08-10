/**
 * @module shared/template/dsl
 *
 * Path-only template DSL renderer for the unified player runtime (PRD-12 Phase 0,
 * spec-template-platform §9). It renders a layout HTML string against a public
 * render context (§10) and returns an HTML string.
 *
 * This is the single authoritative renderer shared by both runtime hosts: it is
 * imported directly by the web host and compiled into the SCORM package (PRD-12
 * §3.5, replacing hand-written ports). It is deliberately pure — no DOM, no Node
 * APIs — so it is a unit-testable `string -> string` transform and safe to bundle
 * for the browser.
 *
 * Supported (spec §9):
 *
 *   {{ path }}                     escaped text interpolation
 *   {{& path }}                    CONTROLLED HTML: the value is printed as markup.
 *                                  The only markup channel available INSIDE `{{#each}}`
 *                                  (`data-slot` addresses a named node, so a repeating
 *                                  one is out of its reach) — which is where the level
 *                                  interpretations and recommendation texts are printed.
 *                                  What lands in such a field is prepared by the CORE
 *                                  ({@link module:shared/template/rich-text}), never by
 *                                  the layout author.
 *   {{#if path}}…{{/if}}           render body when `path` is truthy
 *   {{#unless path}}…{{/unless}}   render body when `path` is falsy
 *   {{#each path}}…{{/each}}       iterate an array; the body sees the item as the
 *                                  current context plus @index / @number / @first /
 *                                  @last, and @root for the root context
 *   {{> name }}                    include a partial with the current context
 *
 * NOT supported by design: JavaScript, helper functions, expressions inside `if`,
 * and triple-brace interpolation `{{{ … }}}` (throws — controlled HTML has ONE
 * spelling, `{{& … }}`). All `{{ … }}` output is HTML-escaped; page-level rich HTML
 * is still injected post-render via data-placeholder / data-slot. Malformed templates
 * throw at compile time — the host is expected to wrap rendering in a fallback
 * (spec §8.2.1.3).
 */

/** Block helpers that open a body and require a matching close tag. */
type BlockType = "if" | "unless" | "each";

/** Lexical token produced by {@link tokenize}. */
type Token =
  | { kind: "text"; value: string }
  | { kind: "interp"; path: string }
  | { kind: "raw"; path: string }
  | { kind: "partial"; name: string }
  | { kind: "open"; type: BlockType; path: string }
  | { kind: "close"; type: BlockType };

/** Parsed AST node produced by {@link parse} and consumed by {@link renderNodes}. */
type Node =
  | { t: "text"; v: string }
  | { t: "interp"; path: string }
  | { t: "raw"; path: string }
  | { t: "partial"; name: string }
  | { t: "if"; path: string; body: Node[] }
  | { t: "unless"; path: string; body: Node[] }
  | { t: "each"; path: string; body: Node[] };

/** Resolution scope: the current data, the root context and the @-loop metas. */
interface Scope {
  data: unknown;
  root: unknown;
  meta: Record<string, unknown>;
}

/** Options for a render pass. */
export interface RenderOptions {
  /** Partial templates by name, included via `{{> name}}`. */
  partials?: Record<string, string>;
  /**
   * Fallback resolver for partials not present in {@link RenderOptions.partials}.
   * Return the partial source, or `null`/`undefined` when there is none (the
   * partial then renders to an empty string — the host may pre-supply a fallback).
   */
  resolvePartial?: (name: string) => string | null | undefined;
}

/** A compiled template: render it against a context as many times as needed. */
export type CompiledTemplate = (context: unknown, options?: RenderOptions) => string;

// ─── Escaping / coercion ────────────────────────────────────────────────────

/** HTML-escapes text so interpolated values cannot inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Coerces a resolved value to text. Objects/arrays/functions render as empty. */
function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  const t = typeof v;
  if (t === "string") return v as string;
  if (t === "number" || t === "boolean" || t === "bigint") return String(v);
  return "";
}

/** Truthiness for `{{#if}}` / `{{#unless}}`. An empty array is falsy (Handlebars-like). */
function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

// ─── Path resolution ────────────────────────────────────────────────────────

/** Resolves a dot-notation path against an object; missing segments yield undefined. */
function resolvePath(obj: unknown, path: string): unknown {
  if (path === "" || path === "this" || path === ".") return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (part === "this") continue;
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Resolves a path within a scope, honouring @root and the @-loop metas. */
function resolveInScope(path: string, scope: Scope): unknown {
  if (path === "@root") return scope.root;
  if (path.startsWith("@root.")) return resolvePath(scope.root, path.slice("@root.".length));
  if (path === "@index" || path === "@number" || path === "@first" || path === "@last") {
    return scope.meta[path];
  }
  return resolvePath(scope.data, path);
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

/** Validates that a path carries no whitespace (no expressions/helpers, spec §9). */
function assertPath(raw: string, where: string): void {
  if (raw === "" || /\s/.test(raw)) {
    throw new Error(`Invalid ${where} "${raw}": expressions and helpers are not supported`);
  }
}

/** Splits a template into a flat token list. Throws on `{{{ }}}` and unclosed tags. */
function tokenize(tpl: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < tpl.length) {
    const open = tpl.indexOf("{{", i);
    if (open === -1) {
      if (i < tpl.length) tokens.push({ kind: "text", value: tpl.slice(i) });
      break;
    }
    if (open > i) tokens.push({ kind: "text", value: tpl.slice(i, open) });
    if (tpl[open + 2] === "{") {
      throw new Error("Raw HTML interpolation ({{{ }}}) is not supported");
    }
    const close = tpl.indexOf("}}", open + 2);
    if (close === -1) throw new Error("Unclosed {{ in template");
    tokens.push(classify(tpl.slice(open + 2, close).trim()));
    i = close + 2;
  }
  return tokens;
}

/** Classifies the trimmed inner text of a `{{ … }}` tag into a token. */
function classify(raw: string): Token {
  if (raw.startsWith("#")) {
    const m = /^#(if|unless|each)\b([\s\S]*)$/.exec(raw);
    if (!m) throw new Error(`Unknown block helper "{{${raw}}}"`);
    const path = m[2].trim();
    assertPath(path, "block path");
    return { kind: "open", type: m[1] as BlockType, path };
  }
  if (raw.startsWith("/")) {
    const m = /^\/(if|unless|each)$/.exec(raw);
    if (!m) throw new Error(`Invalid closing tag "{{${raw}}}"`);
    return { kind: "close", type: m[1] as BlockType };
  }
  if (raw.startsWith(">")) {
    const name = raw.slice(1).trim();
    assertPath(name, "partial name");
    return { kind: "partial", name };
  }
  if (raw.startsWith("&")) {
    const path = raw.slice(1).trim();
    assertPath(path, "raw interpolation path");
    return { kind: "raw", path };
  }
  assertPath(raw, "interpolation path");
  return { kind: "interp", path: raw };
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/** Builds the AST from tokens, matching nested block open/close tags. */
function parse(tokens: Token[]): Node[] {
  let pos = 0;

  function parseNodes(stop?: BlockType): Node[] {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.kind === "close") {
        if (tok.type === stop) {
          pos++;
          return nodes;
        }
        throw new Error(`Unexpected closing tag {{/${tok.type}}}`);
      }
      pos++;
      if (tok.kind === "text") nodes.push({ t: "text", v: tok.value });
      else if (tok.kind === "interp") nodes.push({ t: "interp", path: tok.path });
      else if (tok.kind === "raw") nodes.push({ t: "raw", path: tok.path });
      else if (tok.kind === "partial") nodes.push({ t: "partial", name: tok.name });
      else {
        const body = parseNodes(tok.type);
        nodes.push({ t: tok.type, path: tok.path, body });
      }
    }
    if (stop !== undefined) throw new Error(`Unclosed {{#${stop}}} block`);
    return nodes;
  }

  return parseNodes();
}

// ─── Renderer ───────────────────────────────────────────────────────────────

/** Resolves (and caches) a partial's AST; missing partials yield an empty body. */
function getPartialAst(
  name: string,
  options: RenderOptions,
  cache: Map<string, Node[]>,
): Node[] {
  const cached = cache.get(name);
  if (cached) return cached;
  let src: string | null | undefined;
  if (options.partials && Object.prototype.hasOwnProperty.call(options.partials, name)) {
    src = options.partials[name];
  } else if (options.resolvePartial) {
    src = options.resolvePartial(name);
  }
  const ast = src === null || src === undefined ? [] : parse(tokenize(src));
  cache.set(name, ast);
  return ast;
}

/** Renders an AST node list against a scope into an HTML string. */
function renderNodes(
  nodes: Node[],
  scope: Scope,
  options: RenderOptions,
  partialCache: Map<string, Node[]>,
  stack: Set<string>,
): string {
  let out = "";
  for (const node of nodes) {
    switch (node.t) {
      case "text":
        out += node.v;
        break;
      case "interp":
        out += escapeHtml(stringify(resolveInScope(node.path, scope)));
        break;
      // КОНТРОЛИРУЕМЫЙ HTML. Значение печатается разметкой, поэтому оно и не приходит от
      // автора макета: в контекст его кладёт ЯДРО, из полей, которые само же и подготовило
      // (`shared/template/rich-text`). Разметку в них пишет автор ТЕСТА — тот же
      // доверенный источник, что наполняет `richText`/`html` контентных страниц, где
      // продукт вставляет её ровно так же.
      case "raw":
        out += stringify(resolveInScope(node.path, scope));
        break;
      case "if":
        if (truthy(resolveInScope(node.path, scope))) {
          out += renderNodes(node.body, scope, options, partialCache, stack);
        }
        break;
      case "unless":
        if (!truthy(resolveInScope(node.path, scope))) {
          out += renderNodes(node.body, scope, options, partialCache, stack);
        }
        break;
      case "each": {
        const arr = resolveInScope(node.path, scope);
        if (Array.isArray(arr)) {
          for (let idx = 0; idx < arr.length; idx++) {
            const child: Scope = {
              data: arr[idx],
              root: scope.root,
              meta: {
                "@index": idx,
                "@number": idx + 1,
                "@first": idx === 0,
                "@last": idx === arr.length - 1,
              },
            };
            out += renderNodes(node.body, child, options, partialCache, stack);
          }
        }
        break;
      }
      case "partial": {
        if (stack.has(node.name)) throw new Error(`Partial recursion: ${node.name}`);
        const ast = getPartialAst(node.name, options, partialCache);
        if (ast.length) {
          stack.add(node.name);
          out += renderNodes(ast, scope, options, partialCache, stack);
          stack.delete(node.name);
        }
        break;
      }
    }
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compiles a template once into a reusable render function. Throws on malformed
 * templates (unclosed/mismatched blocks, `{{{ }}}`, expressions).
 */
export function compileTemplate(template: string): CompiledTemplate {
  const ast = parse(tokenize(template));
  return (context: unknown, options: RenderOptions = {}): string => {
    const scope: Scope = { data: context, root: context, meta: {} };
    return renderNodes(ast, scope, options, new Map<string, Node[]>(), new Set<string>());
  };
}

/**
 * Renders a template against a context in one call. Equivalent to
 * `compileTemplate(template)(context, options)`.
 */
export function renderTemplate(
  template: string,
  context: unknown,
  options?: RenderOptions,
): string {
  return compileTemplate(template)(context, options);
}
