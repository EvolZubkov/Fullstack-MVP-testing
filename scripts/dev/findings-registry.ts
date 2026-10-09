/**
 * @module scripts/dev/findings-registry
 * @description Turns the markdown finding tables of the drawer acceptance report into a
 * machine-readable registry, and assigns each finding to a fix batch.
 *
 * Why this exists. The 2026-09-04 acceptance of the test-editor drawer against the approved
 * wireframe produced 221 table rows across seven sections of one report. Re-typing those ids
 * into a plan or a checklist is exactly the transcription step that loses items, and a lost
 * finding is indistinguishable from a fixed one — which is how the previous acceptance
 * managed to record two sections as delivered while they existed only in code comments.
 * Generating the registry keeps a single source of truth: the report is written once, every
 * batch of fixes is a query over this JSON, and the closing gate asserts that every id has an
 * outcome.
 *
 * Usage: `tsx scripts/dev/findings-registry.ts` — rewrites the JSON next to the report.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT = join(REPO_ROOT, "docs", "reports", "editor-drawer-wireframe-acceptance.md");
const OUT = join(REPO_ROOT, "docs", "reports", "editor-drawer-wireframe-acceptance.findings.json");

/** Batch a finding belongs to; drives the order of the fix passes. */
export type Batch =
  | "grid"
  | "sections"
  | "components"
  | "quotas"
  | "actions"
  | "texts"
  | "cosmetics"
  | "owner";

/** One row of a finding table, plus the bookkeeping the fix passes need. */
export interface Finding {
  id: string;
  area: string;
  place: string;
  expected: string;
  actual: string;
  kind: string;
  severity: string;
  code: string;
  /** Base names of the source files the finding points at; the unit of work is one file. */
  files: string[];
  batch: Batch | null;
  status: "open" | "fixed" | "deferred" | "duplicate" | "withdrawn";
  duplicateOf?: string;
}

/**
 * Findings the acceptance got wrong and that were later disproved. Kept in the registry rather
 * than deleted: a report that quietly loses a row is indistinguishable from one that fixed it,
 * and the next reader deserves to see that the measurement, not the code, was at fault.
 */
const WITHDRAWN = new Set(["G-3"]);

/**
 * Findings whose batch cannot be read off the `kind` column without guessing at Russian
 * prose. Every one of them restores a form section (`ou-formsection` + `h3`) or the card and
 * heading that stands in for it, but the report words each differently — «Отсутствующий
 * элемент», «не тот контейнер раздела», «не тот уровень заголовка». Listing the ids is
 * honest; a regex that pretends to understand the wording would misfile them silently, which
 * is the failure mode this whole registry exists to prevent.
 */
const SECTION_FINDINGS = new Set([
  "A-3", "A-4", "B-1", "B-30", "B-36", "C-1", "C-15",
  "D-6", "D-12", "D-40", "E-1", "E-25", "F-17",
]);

/**
 * Rows of section G that restate a finding already filed under section A. Both were measured
 * independently — G by computed style, A by reading the stylesheet — and the report keeps
 * both so each section reads on its own. For counting and for fixing they are one item.
 */
const G_DUPLICATES: Record<string, string> = {
  "G-1": "A-7",
  "G-2": "A-6",
};

/** Splits one markdown table row into trimmed cells, dropping the outer pipes. */
function cells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Files for the section G rows. That section reports measurements, so it names its files in
 * prose rather than in a "Ссылка на код" column and the generic extractor finds nothing.
 * Since the unit of work is one file, a finding with no file would silently fall out of every
 * pass — so the attribution is written down instead of inferred.
 */
const GRID_FILES: Record<string, string[]> = {
  "G-1": ["tb-components.css"],
  "G-2": ["tb-components.css"],
  "G-3": ["tb-components.css"],
  "G-4": ["tb-components.css"],
  "G-5": ["tb-components.css"],
  "G-6": ["tb-components.css"],
  "G-7": ["scales-section.tsx", "levels-editor.tsx"],
  "G-8": ["tb-components.css"],
  "G-9": ["tb-components.css"],
};

/**
 * Pulls the file base names out of the report's "Ссылка на код" cell. `.html` is in the list
 * because section W is fixed in the wireframe itself, not in code — a finding with no file
 * silently drops out of every pass, and "fix the drawing" is as much a unit of work as "fix
 * the component".
 */
function filesOf(...cellsWithCode: string[]): string[] {
  const found = cellsWithCode
    .join(" ")
    .matchAll(/([A-Za-z0-9._-]+\.(?:tsx|ts|css|mjs|json|html))/g);
  return [...new Set([...found].map((m) => m[1]))];
}

/**
 * Parses every finding row of the report. A finding row is recognised by its id (`A-12`);
 * headers, separators, prose and the plain data tables that carry no id are skipped, so the
 * parser survives edits to the surrounding text.
 *
 * Three column layouts occur and are told apart by cell count, not by section letter — the
 * section G measurement table has seven columns (selector, property, wireframe,
 * implementation, where, severity), its component-substitution table has five (place,
 * wireframe, implementation, severity), and sections A-F have seven of their own. Reading G's
 * second table with the first table's layout silently shifted every field by one and left
 * severity empty, which is how this function was wrong on its first outing.
 */
export function parseFindings(markdown: string): Finding[] {
  const rows: Finding[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const c = cells(line);
    const id = c[0];
    if (!/^[A-GW]-\d+$/.test(id)) continue;
    const area = id.split("-")[0];
    const duplicateOf = G_DUPLICATES[id];
    const gridMeasurement = area === "G" && c.length >= 7;
    const gridSubstitution = area === "G" && c.length < 7;

    let place: string;
    let expected: string;
    let actual: string;
    let kind: string;
    let severity: string;
    let code: string;
    if (gridMeasurement) {
      [place, expected, actual, severity, code] = [`${c[1]} ${c[2]}`.trim(), c[3], c[4], c[6] ?? "", c[5] ?? ""];
      kind = "нарушение сетки";
    } else if (gridSubstitution) {
      [place, expected, actual, severity, code] = [c[1], c[2], c[3], c[4] ?? "", ""];
      kind = "не тот тип контрола";
    } else {
      [place, expected, actual, kind, severity, code] = [c[1], c[2], c[3], c[4], c[5] ?? "", c[6] ?? ""];
    }

    rows.push({
      id,
      area,
      place,
      expected,
      actual,
      kind: kind.toLowerCase(),
      severity: severity.toLowerCase(),
      code: code.replace(/`/g, ""),
      files: GRID_FILES[id] ?? filesOf(code, place, expected, actual),
      batch: null,
      status: duplicateOf ? "duplicate" : WITHDRAWN.has(id) ? "withdrawn" : "open",
      ...(duplicateOf ? { duplicateOf } : {}),
    });
  }
  return rows;
}

/**
 * Assigns a batch to every finding that does not have one yet. The rules read the `kind` and
 * `place` columns the report already fills in, so the split is derived from the findings
 * rather than hand-maintained. An already-set batch is never overwritten: the owner-decision
 * items are marked by hand and must survive a regeneration.
 */
export function assignBatches(rows: Finding[]): Finding[] {
  for (const row of rows) {
    if (row.batch) continue;
    const kind = row.kind.toLowerCase();
    const place = row.place.toLowerCase();
    // Section W collects design-system violations of the WIREFRAMES themselves — an invented
    // `ou-*` class cannot be fixed in code at all, only in the drawing, and only after the
    // owner approves the change. They go straight to the owner batch.
    if (row.area === "W") row.batch = "owner";
    else if (SECTION_FINDINGS.has(row.id)) row.batch = "sections";
    else if (place.startsWith("состав, блок квот")) row.batch = "quotas";
    else if (/сетк|фиксированн/.test(kind)) row.batch = "grid";
    else if (/не тот тип контрола|обход дс|не тот контейнер/.test(kind)) row.batch = "components";
    else if (/отсутствующ|потерянн/.test(kind)) row.batch = "actions";
    else if (/подпис|текст|порядок/.test(kind)) row.batch = "texts";
    else row.batch = "cosmetics";
  }
  return rows;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");

if (invokedDirectly) {
  const rows = assignBatches(parseFindings(readFileSync(REPORT, "utf8")));
  writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  const unique = rows.filter((r) => r.status !== "duplicate").length;
  console.log(`Реестр собран: строк ${rows.length}, из них уникальных находок ${unique} -> ${OUT}`);
}
