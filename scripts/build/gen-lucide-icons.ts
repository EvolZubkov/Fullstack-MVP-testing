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
import { iconToPaths, type LucideNode } from "../../shared/template/lucide-contours";

const ICONS_DIR = resolve("node_modules/lucide-react/dist/esm/icons");
const OUT_FILE = resolve("shared/template/lucide-icons.generated.json");

/** `createLucideIcon("Target", [ … ])` — the declaration every non-alias module ends with. */
const DECLARATION = /createLucideIcon\("[^"]+",\s*(\[[\s\S]*?\])\s*\);/;

function main(): void {
  const files = readdirSync(ICONS_DIR).filter((f) => f.endsWith(".js") && f !== "index.js");
  const out: Record<string, string[]> = {};
  let aliases = 0;
  let empty = 0;

  for (const file of files.sort()) {
    const source = readFileSync(resolve(ICONS_DIR, file), "utf-8");
    const match = DECLARATION.exec(source);
    if (!match) {
      aliases += 1;
      continue;
    }
    // The literal is plain JS from a package we already execute; `Function` beats hand-parsing
    // it, and this runs at build time on a fixed input, never on anything an author supplies.
    const nodes = new Function(`return ${match[1]}`)() as LucideNode[];
    const paths = iconToPaths(nodes);
    if (paths.length === 0) {
      empty += 1;
      continue;
    }
    out[file.replace(/\.js$/, "")] = paths;
  }

  const names = Object.keys(out).sort();
  const sorted: Record<string, string[]> = {};
  for (const name of names) sorted[name] = out[name];

  // Newline-per-icon: a one-line 300 KB JSON makes every future diff unreadable, and this file
  // is regenerated on library upgrades where the diff is the only review there is.
  const body = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(sorted[n])}`).join(",\n");
  writeFileSync(OUT_FILE, `{\n${body}\n}\n`, "utf-8");

  console.log(`lucide: ${names.length} glyphs -> ${OUT_FILE}`);
  console.log(`skipped: ${aliases} aliases, ${empty} without drawable nodes`);
}

main();
