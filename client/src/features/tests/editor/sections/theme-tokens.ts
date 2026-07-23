/**
 * @module features/tests/editor/sections/theme-tokens
 * @description Reads a design template's colour TOKENS out of its stylesheet, so
 * the «Брендирование» pane can show the colour a parameter actually paints with
 * instead of a placeholder.
 *
 * A template may ship its palette in two places: as manifest `params[].default`
 * (the built-in `default` does) or purely in `theme.css` with `default: null` (the
 * `certification` template does, so the same package follows the viewer's light or
 * dark system theme). In the second case the editor had NO value to show and fell
 * back to `#000000` — every field read as black while the learner saw an orange
 * brand palette. Resolving the token here is what makes the pane honest.
 *
 * Both theme blocks are returned because a template that ships a dark palette
 * paints DIFFERENT colours depending on the viewer's system setting; a caller that
 * shows only one must say which.
 *
 * Pure string processing — no DOM, no CSSOM (the stylesheet arrives as text from
 * `/api/templates/:id/bundle`, never parsed into the page).
 */

/** Colour tokens of a template, split by the theme block that declares them. */
export interface ThemeTokens {
  /** `:root` / `:root[data-theme="light"]` — the base palette. */
  light: Record<string, string>;
  /** `@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]`. */
  dark: Record<string, string>;
}

/** True when the template declares a dark palette of its own. */
export function hasDarkTheme(tokens: ThemeTokens): boolean {
  return Object.keys(tokens.dark).length > 0;
}

/** Index of the `}` closing the `{` at `open`, or -1 when unbalanced. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Collects `--name: value` declarations of one rule body. */
function collectDeclarations(body: string, into: Record<string, string>): void {
  const re = /(--[\w-]+)\s*:\s*([^;}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    into[m[1]] = m[2].trim();
  }
}

/**
 * Extracts the custom properties declared on `:root` in a template stylesheet.
 *
 * Rules are attributed to the DARK palette when they sit inside a
 * `prefers-color-scheme: dark` media query or carry `[data-theme="dark"]`;
 * everything else on `:root` is the base (light) palette — including
 * `:root:not([data-theme="light"])`, which is only ever dark by virtue of the
 * media query that wraps it.
 *
 * @param css  Concatenated template stylesheet (`bundle.css`)
 */
export function extractThemeTokens(css: string): ThemeTokens {
  const out: ThemeTokens = { light: {}, dark: {} };
  if (typeof css !== "string" || css === "") return out;
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const scan = (text: string, inDark: boolean): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) return;
      const close = matchBrace(text, open);
      if (close === -1) return;
      const prelude = text.slice(i, open).trim();
      const body = text.slice(open + 1, close);

      if (prelude.startsWith("@")) {
        // Only conditional groups can hold further rules; @media is the one that
        // switches the palette. Other at-rules (@font-face, @keyframes) are skipped.
        if (/^@media\b/i.test(prelude)) {
          scan(body, inDark || /prefers-color-scheme\s*:\s*dark/i.test(prelude));
        } else if (/^@(supports|layer|container)\b/i.test(prelude)) {
          scan(body, inDark);
        }
      } else if (/(^|,)\s*:root\b/.test(prelude)) {
        const isDark = inDark || /\[\s*data-theme\s*=\s*["']?dark["']?\s*\]/i.test(prelude);
        collectDeclarations(body, isDark ? out.dark : out.light);
      }
      i = close + 1;
    }
  };

  scan(src, false);
  return out;
}
