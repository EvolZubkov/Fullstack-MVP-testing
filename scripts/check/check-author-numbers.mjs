#!/usr/bin/env node
/**
 * @module scripts/check/check-author-numbers
 * @description Guard: inside the test editor, an author-typed numeric field must be
 * parsed by ONE function — `parseAuthorNumber` (features/tests/editor/numeric-input).
 *
 * Why this exists. The levels editor generates thresholds with a ru decimal comma
 * («73,5»). The editor parsed those through `parseAuthorNumber`; the save gate parsed
 * the SAME field with a bare `Number(...)` and got `NaN`. The author saw a dead
 * «Сохранить» button and no reason for it. Two parsers over one field = two answers.
 *
 * Scope of the check is deliberately NARROW. The editor is full of legitimate
 * `Number(...)` over values that are not author text (counters, indices, `NumberInput`
 * output, option keys). A blanket grep for `Number(` produces dozens of false hits and
 * gets the guard switched off in a week. So the guard only looks at the fields that are
 * declared `string` in the editor model AND are typed through an `Input` fed by
 * `sanitizeAuthorNumberInput`: the interpretation band bounds (`ScaleBandModel.min/.max`)
 * and the level-row slots of `LevelsDraft` (`start` / `cuts[]` / `end` / `slot.raw`).
 * Author number fields outside that set (e.g. the per-question scoring overrides) are
 * NOT covered — see REPORT in the PR description.
 *
 * Usage: `npm run check:author-numbers` — exit code 1 on any violation.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Directory the guard walks (recursively). */
const SCAN_DIR = join(REPO_ROOT, "client", "src", "features", "tests", "editor");

/** The one sanctioned parser: module path + exported name. */
const SANCTIONED = {
  file: join(SCAN_DIR, "numeric-input.ts"),
  name: "parseAuthorNumber",
};

/** Directory names skipped anywhere under {@link SCAN_DIR}. */
const SKIP_DIRS = new Set(["__tests__", "__mocks__"]);

/** Files exempt from the rule (the sanctioned parser implements it). */
const EXEMPT_FILES = new Set([SANCTIONED.file]);

/** Parsers that bypass the ru decimal comma and therefore may not see author text. */
const FORBIDDEN_CALLS = ["Number", "parseFloat", "parseInt"];

/**
 * Property names that hold AUTHOR TEXT in the editor model. Each entry names the
 * declaration it guards, so a model change can be traced back to the reason.
 */
const AUTHOR_STRING_PROPS = [
  { prop: "min", decl: "ScaleBandModel.min (test-editor.types.ts): граница полосы, строка" },
  { prop: "max", decl: "ScaleBandModel.max (test-editor.types.ts): граница полосы, строка" },
  { prop: "start", decl: "LevelsDraft.start (sections/levels-model.ts): начало ряда, строка" },
  { prop: "end", decl: "LevelsDraft.end (sections/levels-model.ts): конец ряда, строка" },
  { prop: "cuts", decl: "LevelsDraft.cuts[] (sections/levels-model.ts): пороги, строки" },
  { prop: "raw", decl: "Slot.raw (sections/levels-model.ts): слот ряда порогов, строка" },
];

/**
 * Receivers whose `.min` / `.max` are NUMBERS, not author text — the scale domain is
 * the live example (`domain.min` is `number | null`). Listed explicitly so the guard
 * errs toward noise only where a real receiver was renamed, never toward silence.
 */
const NUMERIC_RECEIVERS = new Set(["domain", "Math", "bounds", "range", "rect", "viewport"]);

/** Local variable names that, by convention here, hold raw author text. */
const AUTHOR_RAW_IDENTIFIERS = [
  "raw",
  "minRaw",
  "maxRaw",
  "lowerRaw",
  "upperRaw",
  "startRaw",
  "endRaw",
  "cutRaw",
  "thresholdRaw",
  "rawValue",
];

// ─── source scanning ──────────────────────────────────────────────────────────

/**
 * Blank out comments so prose describing the rule cannot trip it. Strings and regex
 * literals are tracked only well enough to keep a `//` inside them from opening a
 * comment. Newlines are preserved so reported line numbers stay true.
 *
 * @param {string} src - File source.
 * @returns {string} Source with comment bodies replaced by spaces.
 */
function stripComments(src) {
  const out = src.split("");
  let i = 0;
  // What can precede a `/` that starts a regex literal rather than a division.
  const REGEX_PRECEDERS = "=(,:[!&|?{};+-*%<>~^\n";
  let lastSignificant = "\n";
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && next === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < src.length) {
        out[i++] = " ";
        out[i++] = " ";
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      lastSignificant = c;
      continue;
    }
    if (c === "/" && REGEX_PRECEDERS.includes(lastSignificant)) {
      i++;
      let inClass = false;
      while (i < src.length && (inClass || src[i] !== "/")) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "\n") break; // not a regex after all
        i++;
      }
      i++;
      lastSignificant = "/";
      continue;
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out.join("");
}

/**
 * Extract the argument text of every `fn(...)` call, with balanced parentheses.
 *
 * @param {string} src - Comment-free source.
 * @param {string} fn - Callee name.
 * @returns {Array<{index: number, arg: string}>} Call sites with their argument text.
 */
function callArguments(src, fn) {
  const found = [];
  const re = new RegExp(`(^|[^\\w$.])${fn}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (i >= src.length) continue; // unbalanced — not our business
    found.push({ index: open + 1, arg: src.slice(open + 1, i) });
  }
  return found;
}

/**
 * Decide whether a call argument reads an author-text field.
 *
 * @param {string} arg - The argument source text.
 * @returns {string | null} A human reason, or `null` when the argument is not author text.
 */
function authorTextReason(arg) {
  const props = new Map(AUTHOR_STRING_PROPS.map((p) => [p.prop, p.decl]));
  const access = /(?:([A-Za-z_$][\w$]*)|\]|\))\s*\??\.\s*([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = access.exec(arg)) !== null) {
    const [, receiver, prop] = m;
    if (!props.has(prop)) continue;
    if (receiver && NUMERIC_RECEIVERS.has(receiver)) continue;
    return `поле автора «${receiver ?? "…"}.${prop}» — ${props.get(prop)}`;
  }
  for (const name of AUTHOR_RAW_IDENTIFIERS) {
    if (new RegExp(`(^|[^\\w$.])${name}\\b`).test(arg)) {
      return `переменная «${name}» — сырой текст поля автора`;
    }
  }
  return null;
}

/**
 * Recursively collect the TypeScript sources in scope.
 *
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function collectSources(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      files.push(...collectSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (entry.endsWith(".d.ts")) continue;
    if (EXEMPT_FILES.has(full)) continue;
    files.push(full);
  }
  return files;
}

// ─── self-check ───────────────────────────────────────────────────────────────

/**
 * Fail loudly if the sanctioned parser moved or was renamed — otherwise the guard
 * would keep passing while guarding nothing.
 *
 * @returns {string[]} Problems found (empty = healthy).
 */
function checkSanctionedParser() {
  try {
    const src = readFileSync(SANCTIONED.file, "utf8");
    if (!new RegExp(`export function ${SANCTIONED.name}\\s*\\(`).test(src)) {
      return [
        `Гард сломан: в ${relative(REPO_ROOT, SANCTIONED.file)} нет экспорта ${SANCTIONED.name}(). ` +
          `Обновите константу SANCTIONED в этом скрипте.`,
      ];
    }
  } catch {
    return [
      `Гард сломан: не найден файл ${relative(REPO_ROOT, SANCTIONED.file)}. ` +
        `Обновите константу SANCTIONED в этом скрипте.`,
    ];
  }
  return [];
}

// ─── main ─────────────────────────────────────────────────────────────────────

const broken = checkSanctionedParser();
if (broken.length > 0) {
  for (const line of broken) console.error(line);
  process.exit(1);
}

const violations = [];
const files = collectSources(SCAN_DIR);

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const src = stripComments(raw);
  for (const fn of FORBIDDEN_CALLS) {
    for (const { index, arg } of callArguments(src, fn)) {
      const reason = authorTextReason(arg);
      if (!reason) continue;
      const line = src.slice(0, index).split("\n").length;
      violations.push({
        file: relative(REPO_ROOT, file).split(sep).join("/"),
        line,
        snippet: raw.split("\n")[line - 1].trim(),
        call: fn,
        reason,
      });
    }
  }
}

console.log(`Проверено файлов: ${files.length} (каталог client/src/features/tests/editor, без __tests__)`);
console.log(
  `Охраняемые поля автора: ${AUTHOR_STRING_PROPS.map((p) => p.prop).join(", ")} ` +
    `+ переменные ${AUTHOR_RAW_IDENTIFIERS.join(", ")}`,
);

if (violations.length === 0) {
  console.log(`OK: числа автора разбираются только через ${SANCTIONED.name}().`);
  process.exit(0);
}

console.error("");
console.error(`НАЙДЕНО НАРУШЕНИЙ: ${violations.length}`);
for (const v of violations) {
  console.error("");
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.snippet}`);
  console.error(`    ${v.call}(...) применён к: ${v.reason}`);
}
console.error("");
console.error(
  `Автор вводит дробные числа с запятой («73,5»). ${FORBIDDEN_CALLS.join("/")} на таком тексте ` +
    `дают NaN, и поле молча «не сохраняется».`,
);
console.error(
  `Разбирайте такие поля ТОЛЬКО через ${SANCTIONED.name}() из ` +
    `${relative(REPO_ROOT, SANCTIONED.file).split(sep).join("/")}.`,
);
process.exit(1);
