/**
 * @module scripts/build/gen-lucide-icons
 *
 * Generates `shared/template/lucide-icons.generated.json` — every lucide glyph as plain path
 * data (PRD-46 §8).
 *
 * Why a generated file and not a call into `lucide-react` at runtime. The library ships its
 * glyphs as React components: the geometry sits in a closure behind `createLucideIcon`, so
 * there is no way to ask it for a name's contours without rendering React — on the server, at
 * bake time, for a package that will never run React at all. The declarations ARE in the
 * shipped ES modules, so they are read once, converted once, and committed as data.
 *
 * The file has THREE consumers and that is the point of generating it rather than resolving
 * per host: the SCORM bake (contours have to be inside the package), the web results context,
 * and the editor's icon picker — which draws from the same data, so the author picks exactly
 * the glyph the chart will draw.
 *
 * Aliases (`home.js` re-exporting `house.js`) are SKIPPED. They are deprecated spellings of a
 * glyph already in the set; carrying them would add a few hundred duplicate entries to a file
 * the editor downloads, and offer the author two names for one picture.
 *
 * Run: `npm run icons:gen`. Re-run after a `lucide-react` upgrade — nothing does it
 * automatically, and a stale file simply keeps the previous set.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { iconToPaths, type LucideNode } from "../../shared/template/lucide-contours";

const ICONS_DIR = resolve("node_modules/lucide-react/dist/esm/icons");
const OUT_FILE = resolve("shared/template/lucide-icons.generated.json");
const ALIASES_FILE = resolve("shared/template/lucide-aliases.generated.json");

/**
 * `createLucideIcon("Target", [ … ])` — how lucide-react 0.x declared the geometry, read
 * from the module TEXT because nothing else exposed it.
 *
 * 1.x exports the declaration itself (`export { __iconData }`), so it is imported rather
 * than parsed — see {@link readNodes}. The old pattern stays for a downgrade.
 */
const LEGACY_DECLARATION = /createLucideIcon\("[^"]+",\s*(\[[\s\S]*?\])\s*\);/;

/**
 * Contours of one icon module, or `null` for an alias (`home.mjs` re-exporting `house.mjs`
 * carries no declaration of its own).
 *
 * The import comes first: a text pattern over a minified-ish bundle breaks on the next
 * layout change, and this one already did — 1.x moved the array into an object with a
 * trailing `aliases` key, and the regex ate past its end.
 */
/** `export { default } from './house.mjs'` — что стоит в файле-алиасе вместо объявления. */
const ALIAS_TARGET = /export\s*\{\s*default\s*\}\s*from\s*['"]\.\/([^'"]+)\.m?js['"]/;

async function readNodes(file: string): Promise<LucideNode[] | null> {
  const abs = resolve(ICONS_DIR, file);
  const mod = (await import(pathToFileURL(abs).href)) as { __iconData?: { node?: LucideNode[] } };
  if (Array.isArray(mod.__iconData?.node)) return mod.__iconData.node;

  const match = LEGACY_DECLARATION.exec(readFileSync(abs, "utf-8"));
  if (!match) return null;
  // Plain JS from a package we already execute; `Function` beats hand-parsing it, and this
  // runs at build time on a fixed input, never on anything an author supplies.
  return new Function(`return ${match[1]}`)() as LucideNode[];
}

async function main(): Promise<void> {
  const files = readdirSync(ICONS_DIR).filter(
    (f) => (f.endsWith(".js") || f.endsWith(".mjs")) && !/^index\.(m?js)$/.test(f),
  );
  if (files.length === 0) {
    throw new Error(
      `В ${ICONS_DIR} нет модулей иконок — раскладка пакета изменилась. Снимок контуров НЕ переписан.`,
    );
  }
  const out: Record<string, string[]> = {};
  // Имя -> каноническое имя. Библиотека ПЕРЕИМЕНОВЫВАЕТ глифы (0.x `circle-help` ->
  // 1.x `circle-question-mark`), оставляя старое имя алиасом. Сами алиасы в набор не
  // попадают — иначе автор видел бы два имени одной картинки, — но карта нужна: имена
  // уже лежат в тестах, выбранные до переименования, и без неё пиктограмма пропадёт.
  const aliasMap: Record<string, string> = {};
  let aliases = 0;
  let empty = 0;

  for (const file of files.sort()) {
    const nodes = await readNodes(file);
    if (!nodes) {
      aliases += 1;
      const target = ALIAS_TARGET.exec(readFileSync(resolve(ICONS_DIR, file), "utf-8"));
      if (target) aliasMap[file.replace(/\.m?js$/, "")] = target[1];
      continue;
    }
    const paths = iconToPaths(nodes);
    if (paths.length === 0) {
      empty += 1;
      continue;
    }
    out[file.replace(/\.m?js$/, "")] = paths;
  }

  const names = Object.keys(out).sort();
  // Пустой результат — это сломанный разбор, а не набор без иконок. Писать его нельзя:
  // снимок и есть единственный источник пиктограмм шаблонов.
  if (names.length === 0) {
    throw new Error(
      `Ни в одном из ${files.length} модулей не нашлось объявления контуров — формат пакета ` +
        "изменился. Снимок НЕ переписан.",
    );
  }
  const sorted: Record<string, string[]> = {};
  for (const name of names) sorted[name] = out[name];

  // Newline-per-icon: a one-line 300 KB JSON makes every future diff unreadable, and this file
  // is regenerated on library upgrades where the diff is the only review there is.
  const body = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(sorted[n])}`).join(",\n");
  writeFileSync(OUT_FILE, `{\n${body}\n}\n`, "utf-8");

  const aliasNames = Object.keys(aliasMap).sort().filter((n) => aliasMap[n] in sorted);
  const aliasBody = aliasNames
    .map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(aliasMap[n])}`)
    .join(",\n");
  writeFileSync(ALIASES_FILE, `{\n${aliasBody}\n}\n`, "utf-8");

  console.log(`lucide: ${names.length} glyphs -> ${OUT_FILE}`);
  console.log(`aliases: ${aliasNames.length} -> ${ALIASES_FILE}`);
  console.log(`skipped: ${aliases} aliases, ${empty} without drawable nodes`);
}

await main();
