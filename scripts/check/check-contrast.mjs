#!/usr/bin/env node
/**
 * @module scripts/check/check-contrast
 * @description Guard: colour pairs that were chosen BY MEASUREMENT must not drift
 * silently.
 *
 * Why this exists. `TONE_CHIPS` (PRD-45) holds five background/foreground pairs for the
 * level-ribbon stripes. Three obvious-looking pairs were rejected by numbers, not taste
 * (white on `--ou-success-default` is 2.16:1, on `--ou-warning-default` 1.76:1, on
 * `--ou-error-default` 3.78:1). The only thing protecting the survivors is a table in a
 * JSDoc comment: jsdom neither resolves DS tokens nor computes colour, so a unit test
 * cannot see it. Make every caption white and all 600+ tests stay green while the ribbon
 * becomes unreadable. The same hole exists in PRD-46's `categorical-palette.ts`, so this
 * guard is written to take more sources than one — see {@link SOURCES}.
 *
 * What it does, with no browser and no new dependencies:
 *   1. reads the DS custom properties out of `university-rt.css` PER THEME
 *      (`:root` primitives + the `.ou, .ou.ou--light` block, then `.ou.ou--dark` on top);
 *   2. unrolls `var(--x)` alias chains;
 *   3. evaluates `color-mix(in oklch|oklab, …)` and `oklch(…)` per CSS Color 4;
 *   4. computes the WCAG 2 contrast ratio and fails below {@link DEFAULT_THRESHOLD}.
 *
 * Usage: `npm run check:contrast` — exit code 1 if any pair is below its threshold.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The DS stylesheet the tokens are declared in. */
const DS_CSS = join(REPO_ROOT, "client", "src", "styles", "vendor", "university-rt.css");

/**
 * Declaration blocks that carry the tokens, per theme. Order matters: later blocks win,
 * exactly as CSS specificity resolves them at runtime (`.ou.ou--dark` beats `.ou`).
 */
const THEME_BLOCKS = {
  light: [":root", ".ou,\n.ou.ou--light"],
  dark: [":root", ".ou,\n.ou.ou--light", ".ou.ou--dark"],
};

/** WCAG AA for small text. The ribbon caption is `--ou-text-body-xs`. */
const DEFAULT_THRESHOLD = 4.5;

/**
 * Everything the guard checks. Add a source as ONE entry — a file, a label and an
 * extractor that returns `{ name, bg, fg }` triples straight out of that file, so the
 * values are never duplicated here.
 *
 * PRD-46's `shared/template/categorical-palette.ts` belongs in this list once that branch
 * lands; the file does not exist on this branch yet, so it is intentionally absent.
 */
const SOURCES = [
  {
    id: "tone-chips",
    label: "Тоны уровней (PRD-45)",
    file: "client/src/features/tests/editor/sections/tone-chips.tsx",
    extract: extractToneChips,
    threshold: DEFAULT_THRESHOLD,
  },
];

// ─── source extraction ────────────────────────────────────────────────────────

/**
 * Slice the balanced region opened by `open` at/after `from`.
 *
 * @param {string} src - Text to scan.
 * @param {number} from - Index of the opening bracket.
 * @param {string} open - Opening bracket.
 * @param {string} close - Closing bracket.
 * @returns {string} The text between the brackets.
 */
function balanced(src, from, open, close) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(from + 1, i);
    }
  }
  throw new Error(`Не найдена закрывающая «${close}» — формат файла изменился.`);
}

/**
 * Read the ribbon pairs out of `tone-chips.tsx` as text (a `.tsx` cannot be imported by
 * a plain node script, and copying the values here would defeat the whole point).
 * Throws — never returns a short list — if the literal no longer looks the way it did,
 * so a refactor cannot turn the guard into a no-op.
 *
 * @param {string} src - File source.
 * @returns {Array<{name: string, bg: string, fg: string}>} The measured pairs.
 */
function extractToneChips(src) {
  const anchor = src.indexOf("export const TONE_CHIPS");
  if (anchor < 0) {
    throw new Error("Не найден `export const TONE_CHIPS` — обновите извлечение в этом гарде.");
  }
  const arrayStart = src.indexOf("[", src.indexOf("=", anchor));
  if (arrayStart < 0) throw new Error("Не найден массив TONE_CHIPS — формат изменился.");
  const body = balanced(src, arrayStart, "[", "]");

  const entries = [];
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open < 0) break;
    const obj = balanced(body, open, "{", "}");
    i = open + obj.length + 2;

    const label = /\blabel\s*:\s*"([^"]*)"/.exec(obj);
    const bg = /\bribbonBg\s*:\s*"([^"]*)"/.exec(obj);
    const fg = /\bribbonFg\s*:\s*"([^"]*)"/.exec(obj);
    if (!label || !bg || !fg) {
      throw new Error(
        `Элемент TONE_CHIPS без label/ribbonBg/ribbonFg — формат изменился, гард нужно обновить:\n${obj.trim()}`,
      );
    }
    entries.push({ name: label[1], bg: bg[1], fg: fg[1] });
  }
  if (entries.length === 0) throw new Error("TONE_CHIPS пуст — формат изменился.");
  return entries;
}

// ─── CSS custom property resolution ───────────────────────────────────────────

/**
 * Collect `--x: value;` declarations from the named blocks, in order.
 *
 * @param {string} css - Stylesheet source.
 * @param {string[]} selectors - Block selectors, later ones overriding earlier ones.
 * @returns {Map<string, string>} Token name (with `--`) to raw declaration value.
 */
function readTokens(css, selectors) {
  const tokens = new Map();
  for (const selector of selectors) {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) {
      throw new Error(
        `В university-rt.css нет блока «${selector.replace(/\n/g, " ")}» — ` +
          `структура токенов изменилась, обновите THEME_BLOCKS.`,
      );
    }
    const body = balanced(css, css.indexOf("{", at), "{", "}");
    const decl = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let m;
    while ((m = decl.exec(body)) !== null) tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

/**
 * Replace `var(--x[, fallback])` with the token's value, repeatedly, until none remain.
 *
 * @param {string} value - Declaration value.
 * @param {Map<string, string>} tokens - Resolved token table.
 * @returns {string} The value with every alias expanded.
 */
function expandVars(value, tokens) {
  let out = value;
  for (let guard = 0; guard < 32; guard++) {
    const at = out.indexOf("var(");
    if (at < 0) return out.trim();
    const inner = balanced(out, out.indexOf("(", at), "(", ")");
    const comma = inner.indexOf(",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    const resolved = tokens.get(name) ?? fallback;
    if (resolved === null || resolved === undefined) {
      throw new Error(`Токен ${name} не объявлен в этой теме.`);
    }
    out = `${out.slice(0, at)}${resolved}${out.slice(at + 4 + inner.length + 1)}`;
  }
  throw new Error(`Цикл в цепочке var(): ${value}`);
}

// ─── colour maths (CSS Color 4) ───────────────────────────────────────────────

/** sRGB channel (0..1) to linear-light. @param {number} c @returns {number} */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear-light channel to sRGB (0..1). @param {number} c @returns {number} */
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** @param {number} v @returns {number} v clamped to 0..1 */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Linear sRGB to OkLab (Ottosson's matrices, as adopted by CSS Color 4).
 *
 * @param {[number, number, number]} rgb - Linear-light r, g, b.
 * @returns {[number, number, number]} L, a, b.
 */
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * OkLab back to linear sRGB.
 *
 * @param {[number, number, number]} lab - L, a, b.
 * @returns {[number, number, number]} Linear-light r, g, b.
 */
function oklabToLinear([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * A colour as it will actually be painted: 8-bit sRGB. Quantising here is deliberate —
 * the browser measurement the JSDoc table records was taken on painted pixels.
 *
 * @typedef {{r: number, g: number, b: number}} Rgb8
 */

/** @param {[number, number, number]} lin @returns {Rgb8} */
const linearToRgb8 = (lin) => ({
  r: Math.round(clamp01(toGamma(lin[0])) * 255),
  g: Math.round(clamp01(toGamma(lin[1])) * 255),
  b: Math.round(clamp01(toGamma(lin[2])) * 255),
});

/** @param {Rgb8} c @returns {[number, number, number]} linear-light r, g, b */
const rgb8ToLinear = (c) => [toLinear(c.r / 255), toLinear(c.g / 255), toLinear(c.b / 255)];

/**
 * Parse a colour value that has already had its `var()`s expanded.
 *
 * @param {string} raw - Colour text.
 * @returns {Rgb8} The painted colour.
 */
function parseColour(raw) {
  const value = raw.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
      };
    }
    if (h.length === 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    throw new Error(`Цвет с альфой «${value}» — контраст не определён без подложки.`);
  }

  const named = { white: "#ffffff", black: "#000000" };
  if (named[value.toLowerCase()]) return parseColour(named[value.toLowerCase()]);
  if (value.toLowerCase() === "transparent" || /^rgba?\(/i.test(value)) {
    if (/^rgb\(/i.test(value)) {
      const [r, g, b] = value
        .slice(4, -1)
        .split(/[,\s]+/)
        .map(Number);
      return { r, g, b };
    }
    throw new Error(`Полупрозрачный цвет «${value}» — контраст не определён без подложки.`);
  }

  if (/^oklch\(/i.test(value)) {
    const parts = balanced(value, value.indexOf("("), "(", ")").trim().split(/[\s/]+/);
    if (parts.length < 3) throw new Error(`Не разобран oklch(): ${value}`);
    const L = parts[0].endsWith("%") ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const C = parts[1].endsWith("%") ? (parseFloat(parts[1]) / 100) * 0.4 : parseFloat(parts[1]);
    const H = parseFloat(parts[2]);
    return linearToRgb8(oklabToLinear(lchToLab([L, C, H])));
  }

  if (/^color-mix\(/i.test(value)) return parseColourMix(value);

  throw new Error(`Неподдерживаемая запись цвета: «${value}»`);
}

/** @param {[number, number, number]} lch @returns {[number, number, number]} OkLab */
function lchToLab([L, C, H]) {
  const rad = (H * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

/** @param {[number, number, number]} lab @returns {[number, number, number]} OkLCH */
function labToLch([L, A, B]) {
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

/**
 * Evaluate `color-mix(in oklch|oklab, A [p%], B [q%])`.
 *
 * In `oklch` the mix is polar: L and C interpolate linearly, hue takes the shortest arc.
 * A colour with zero chroma has a POWERLESS hue (CSS Color 4 §12.2), so it adopts the
 * other side's hue — which is why every `color-mix(in oklch, #000 …, X)` in this DS
 * gives the same answer as a rectangular OkLab mix would.
 *
 * @param {string} value - The `color-mix(...)` text.
 * @returns {Rgb8} The painted colour.
 */
function parseColourMix(value) {
  const inner = balanced(value, value.indexOf("("), "(", ")");
  const parts = splitTopLevel(inner);
  if (parts.length !== 3) throw new Error(`Не разобран color-mix(): ${value}`);

  const space = parts[0].trim().replace(/^in\s+/i, "").toLowerCase();
  if (space !== "oklch" && space !== "oklab") {
    throw new Error(`color-mix в пространстве «${space}» не поддержан этим гардом.`);
  }

  const side = (text) => {
    const pct = /(-?[\d.]+)%\s*$/.exec(text.trim());
    const colour = pct ? text.trim().slice(0, pct.index).trim() : text.trim();
    return { colour, weight: pct ? parseFloat(pct[1]) / 100 : null };
  };
  const a = side(parts[1]);
  const b = side(parts[2]);

  // CSS Color 4 §-mix: a single omitted percentage is `100% - other`; both omitted = 50/50.
  let wa = a.weight;
  let wb = b.weight;
  if (wa === null && wb === null) [wa, wb] = [0.5, 0.5];
  else if (wa === null) wa = 1 - wb;
  else if (wb === null) wb = 1 - wa;
  const total = wa + wb;
  if (total <= 0) throw new Error(`Нулевые доли в color-mix(): ${value}`);
  wa /= total;
  wb /= total;

  const labA = linearToOklab(rgb8ToLinear(parseColour(a.colour)));
  const labB = linearToOklab(rgb8ToLinear(parseColour(b.colour)));

  if (space === "oklab") {
    return linearToRgb8(oklabToLinear([0, 1, 2].map((i) => labA[i] * wa + labB[i] * wb)));
  }

  const [La, Ca, Ha] = labToLch(labA);
  const [Lb, Cb, Hb] = labToLch(labB);
  const POWERLESS = 1e-6;
  let hueA = Ca < POWERLESS ? Hb : Ha;
  let hueB = Cb < POWERLESS ? Ha : Hb;
  if (Ca < POWERLESS && Cb < POWERLESS) hueA = hueB = 0;
  // Shortest arc (the CSS default hue interpolation).
  let delta = hueB - hueA;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const H = hueA + delta * wb;
  return linearToRgb8(oklabToLinear(lchToLab([La * wa + Lb * wb, Ca * wa + Cb * wb, H])));
}

/**
 * Split a comma-separated argument list, ignoring commas nested in parentheses.
 *
 * @param {string} text - Argument list.
 * @returns {string[]} Top-level arguments.
 */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/** WCAG 2 relative luminance. @param {Rgb8} c @returns {number} */
function luminance(c) {
  const [r, g, b] = rgb8ToLinear(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2 contrast ratio between two painted colours.
 *
 * @param {Rgb8} a - First colour.
 * @param {Rgb8} b - Second colour.
 * @returns {number} Ratio in 1..21.
 */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** @param {Rgb8} c @returns {string} `#rrggbb` */
const hex = (c) =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

// ─── main ─────────────────────────────────────────────────────────────────────

// Line endings are normalised because THEME_BLOCKS spells its multi-line selectors with
// `\n`. On Windows `core.autocrlf=true` checks the stylesheet out with CRLF, and the guard
// then failed to find a block that was right there — a red guard on a fresh clone, blamed
// on whatever landed last.
const css = readFileSync(DS_CSS, "utf8").replace(/\r\n/g, "\n");
const themes = Object.fromEntries(
  Object.entries(THEME_BLOCKS).map(([theme, selectors]) => [theme, readTokens(css, selectors)]),
);

const rows = [];
const failures = [];
const errors = [];

for (const source of SOURCES) {
  let pairs;
  try {
    pairs = source.extract(readFileSync(join(REPO_ROOT, source.file), "utf8"));
  } catch (e) {
    errors.push(`${source.file}: ${e.message}`);
    continue;
  }
  for (const pair of pairs) {
    for (const [theme, tokens] of Object.entries(themes)) {
      try {
        const bg = parseColour(expandVars(pair.bg, tokens));
        const fg = parseColour(expandVars(pair.fg, tokens));
        const ratio = contrast(bg, fg);
        const row = {
          source: source.label,
          name: pair.name,
          theme,
          bg: hex(bg),
          fg: hex(fg),
          ratio,
          threshold: source.threshold ?? DEFAULT_THRESHOLD,
        };
        rows.push(row);
        if (ratio < row.threshold) failures.push(row);
      } catch (e) {
        errors.push(`${source.label} / ${pair.name} / ${theme}: ${e.message}`);
      }
    }
  }
}

const THEME_RU = { light: "светлая", dark: "тёмная" };
const pad = (s, n) => String(s).padEnd(n);

console.log("Контраст измеренных цветовых пар (WCAG 2, порог 4.5 для мелкого текста)");
console.log("");
console.log(
  `  ${pad("тон", 16)}${pad("тема", 10)}${pad("фон", 10)}${pad("текст", 10)}${pad("контраст", 10)}`,
);
console.log(`  ${"-".repeat(56)}`);
for (const r of rows) {
  const mark = r.ratio < r.threshold ? "  ← НИЖЕ ПОРОГА" : "";
  console.log(
    `  ${pad(r.name, 16)}${pad(THEME_RU[r.theme] ?? r.theme, 10)}${pad(r.bg, 10)}${pad(r.fg, 10)}` +
      `${pad(r.ratio.toFixed(2), 10)}${mark}`,
  );
}
console.log("");

if (errors.length > 0) {
  console.error("ОШИБКИ РАЗБОРА:");
  for (const e of errors) console.error(`  ${e}`);
  console.error("");
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`ПАР НИЖЕ ПОРОГА: ${failures.length}`);
  for (const f of failures) {
    console.error(
      `  «${f.name}» / ${THEME_RU[f.theme] ?? f.theme}: ${f.ratio.toFixed(2)} < ${f.threshold} ` +
        `(${f.fg} на ${f.bg})`,
    );
  }
  console.error("");
  console.error(
    "Эти пары подобраны замером, а не на глаз. Подберите другую пару и обновите таблицу " +
      "замеров в JSDoc источника — не понижайте порог.",
  );
  process.exit(1);
}

console.log(`OK: проверено пар ${rows.length}, все не ниже порога.`);
