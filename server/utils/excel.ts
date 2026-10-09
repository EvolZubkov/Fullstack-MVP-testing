/**
 * @module server/utils/excel
 *
 * Thin wrappers around the `exceljs` library to mimic the small subset of the
 * old SheetJS (`xlsx`) API the project relied on. Centralising the API surface
 * keeps the route code terse and limits the blast radius if `exceljs` is ever
 * swapped out.
 */

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Readable } from "node:stream";

/** Width spec for a single column (matches the old `ws["!cols"] = [{wch: N}]` shape). */
export interface ColumnWidth {
  width: number;
}

/**
 * Append a worksheet built from an array of objects (header derived from keys).
 *
 * Equivalent to `XLSX.utils.json_to_sheet(rows)` + `book_append_sheet`.
 *
 * @param wb Target workbook to mutate.
 * @param name Worksheet name.
 * @param rows Data rows; keys of the first row define column order and headers.
 * @param widths Optional column widths in characters (same order as headers).
 */
export function addJsonSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: Record<string, unknown>[],
  widths?: number[],
): ExcelJS.Worksheet {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const ws = wb.addWorksheet(name);
  ws.columns = headers.map((header, i) => ({
    header,
    key: header,
    width: widths?.[i],
  }));
  for (const row of rows) {
    ws.addRow(headers.map((h) => row[h] ?? ""));
  }
  return ws;
}

/**
 * Append a worksheet built from an array-of-arrays (first row is the header
 * when the caller embeds it; this helper makes no assumptions).
 *
 * Equivalent to `XLSX.utils.aoa_to_sheet(rows)` + `book_append_sheet`.
 *
 * @param wb Target workbook to mutate.
 * @param name Worksheet name.
 * @param rows Rows as arrays of cell values.
 * @param widths Optional column widths in characters.
 */
export function addAoaSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: unknown[][],
  widths?: number[],
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  if (widths && widths.length > 0) {
    ws.columns = widths.map((w) => ({ width: w }));
  }
  ws.addRows(rows as any[][]);
  return ws;
}

/** Unwrap an ExcelJS cell value to a plain JS scalar. */
function unwrapCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") {
    // Rich text — concatenate runs.
    if ("richText" in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((rt: any) => rt.text).join("");
    }
    // Formula cell — prefer the cached result.
    if ("result" in value) {
      return (value as any).result ?? undefined;
    }
    // Hyperlink — keep displayed text.
    if ("text" in value && "hyperlink" in value) {
      return (value as any).text;
    }
    // Error — drop.
    if ("error" in value) return undefined;
  }
  return value;
}

/**
 * Read the first (or named) worksheet as an array of objects keyed by header.
 *
 * Equivalent to `XLSX.utils.sheet_to_json(sheet, opts)`.
 *
 * @param ws Worksheet to read.
 * @param opts Behaviour flags.
 *   - `defval`: substitute value for empty cells; when omitted, empty cells
 *     are simply absent from the row object (matching SheetJS default).
 */
export function sheetToObjects(
  ws: ExcelJS.Worksheet,
  opts: { defval?: unknown } = {},
): Record<string, unknown>[] {
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  const columnCount = ws.actualColumnCount || ws.columnCount;
  for (let c = 1; c <= columnCount; c++) {
    const raw = unwrapCellValue(headerRow.getCell(c).value);
    headers[c - 1] = raw === undefined ? "" : String(raw).trim();
  }

  const out: Record<string, unknown>[] = [];
  const lastRow = ws.actualRowCount || ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    for (let c = 1; c <= headers.length; c++) {
      const header = headers[c - 1];
      if (!header) continue;
      const value = unwrapCellValue(row.getCell(c).value);
      if (value !== undefined && value !== "") {
        obj[header] = value;
        hasAny = true;
      } else if ("defval" in opts) {
        obj[header] = opts.defval;
      }
    }
    if (hasAny) out.push(obj);
  }
  return out;
}

/**
 * Read the trimmed header names from row 1 as a set. Used by the question
 * import to tell "column present but empty" (reset field) from "column absent"
 * (leave field unchanged) — a distinction `sheetToObjects` erases by omitting
 * empty cells from the row object (PRD-14 FR-11).
 */
export function sheetHeaders(ws: ExcelJS.Worksheet): Set<string> {
  const headerRow = ws.getRow(1);
  const columnCount = ws.actualColumnCount || ws.columnCount;
  const out = new Set<string>();
  for (let c = 1; c <= columnCount; c++) {
    const raw = unwrapCellValue(headerRow.getCell(c).value);
    const name = raw === undefined ? "" : String(raw).trim();
    if (name) out.add(name);
  }
  return out;
}

/**
 * Read the first (or named) worksheet as an array of arrays. Matches
 * `XLSX.utils.sheet_to_json(sheet, { header: 1 })`.
 */
export function sheetToArrays(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  const lastRow = ws.actualRowCount || ws.rowCount;
  const lastCol = ws.actualColumnCount || ws.columnCount;
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const arr: unknown[] = [];
    for (let c = 1; c <= lastCol; c++) {
      arr.push(unwrapCellValue(row.getCell(c).value));
    }
    out.push(arr);
  }
  return out;
}

// ─── Reading uploads: prefixed-namespace tolerance ───────────────────────────
//
// exceljs builds its SAX parser as `new SaxesParser()` — WITHOUT namespace
// support (`lib/utils/parse-sax.js`). Namespaces are therefore never resolved:
// every xform compares the raw qualified name (`'workbook'`, `'sheetData'`,
// `'c'`). A book that puts spreadsheetml on a prefix — `<x:workbook>` instead of
// `<workbook xmlns="…">` — is valid OOXML but unreadable for exceljs, and some
// third-party generators emit exactly that. The fix is to undo the prefix before
// handing the package over, as a FALLBACK: it costs nothing on ordinary books
// because it runs only after a real load has already failed.

/** The spreadsheetml-main namespace — the only one exceljs reads by raw name. */
const SPREADSHEETML_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Why {@link readWorkbookFromBuffer} could not produce a workbook. */
export type WorkbookReadFailure =
  /** Not an OOXML package at all (not even a zip) — e.g. a .csv renamed to .xlsx. */
  | "not_a_zip"
  /** A zip, but exceljs cannot read a workbook out of it even after normalization. */
  | "unparsable";

/**
 * A failed workbook read, carrying WHY it failed so callers can say something
 * more useful than "check the format".
 */
export class WorkbookReadError extends Error {
  constructor(
    readonly reason: WorkbookReadFailure,
    options?: { cause?: unknown },
  ) {
    super(
      reason === "not_a_zip"
        ? "Upload is not an OOXML (.xlsx) package"
        : "Upload is a zip but not a readable workbook",
      options,
    );
    this.name = "WorkbookReadError";
  }
}

/**
 * The prefix `ns` is bound to in this XML part, or null when it is the default
 * namespace (the ordinary case) or absent.
 *
 * The whole part is scanned rather than just its root element: a generator may
 * declare the binding on an inner element, and stripping the prefix is the right
 * move wherever the declaration sits.
 *
 * @param xml One OOXML part as text.
 * @param ns Namespace URI to look for.
 */
function boundPrefix(xml: string, ns: string): string | null {
  const m = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*"${ns}"`).exec(xml);
  return m ? m[1] : null;
}

/**
 * Move the elements of one part off `prefix` and back onto the default
 * namespace. Only ELEMENT names are rewritten; prefixed attributes (`r:id`) and
 * their own `xmlns:` declarations are left alone, since exceljs reads those by
 * qualified name too.
 *
 * @param xml One OOXML part as text.
 * @param prefix Prefix to remove.
 * @param ns Namespace URI the prefix is bound to.
 */
function stripElementPrefix(xml: string, prefix: string, ns: string): string {
  return xml
    .replace(new RegExp(`<${prefix}:`, "g"), "<")
    .replace(new RegExp(`</${prefix}:`, "g"), "</")
    .replace(new RegExp(`xmlns:${prefix}\\s*=\\s*"${ns}"`, "g"), `xmlns="${ns}"`);
}

/**
 * Rebuild the package with spreadsheetml elements on the default namespace.
 *
 * The prefix is detected PER PART and only through its binding to
 * spreadsheetml-main, which is what keeps parts on other namespaces intact —
 * `xl/theme/theme1.xml` legitimately uses `a:` for drawingml, and stripping that
 * would break theme parsing.
 *
 * @param buf The original package.
 * @returns The rewritten package, or null when nothing was prefixed (so the
 *   original failure had another cause and re-reading would be pointless).
 */
async function normalizeNamespacePrefixes(buf: Buffer): Promise<Buffer | null> {
  const zip = await JSZip.loadAsync(buf);
  const out = new JSZip();
  let rewritten = 0;

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!/\.(xml|rels)$/i.test(name)) {
      out.file(name, await entry.async("nodebuffer"));
      continue;
    }
    let xml = await entry.async("string");
    const prefix = boundPrefix(xml, SPREADSHEETML_MAIN);
    if (prefix) {
      xml = stripElementPrefix(xml, prefix, SPREADSHEETML_MAIN);
      rewritten++;
    }
    out.file(name, xml);
  }

  if (rewritten === 0) return null;
  return out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Load a workbook from a `Buffer` (e.g. a multer upload).
 *
 * Accepts books whose parts carry spreadsheetml on a namespace prefix by
 * normalizing them and retrying — see the note above.
 *
 * @param buf The uploaded package.
 * @throws {WorkbookReadError} When no workbook can be read; `reason` tells
 *   whether the upload was not a package at all or could not be parsed.
 */
export async function readWorkbookFromBuffer(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    // `exceljs/index.d.ts` declares `interface Buffer extends ArrayBuffer {}` in
    // the global scope, which merges with Node's `Buffer<TArrayBuffer>` and makes
    // the `load(buffer: Buffer)` parameter unmatchable from a real Node Buffer.
    // Pass the Buffer through as `any` — at runtime exceljs accepts it fine.
    await wb.xlsx.load(buf as any);
    return wb;
  } catch (directFailure) {
    let normalized: Buffer | null;
    try {
      normalized = await normalizeNamespacePrefixes(buf);
    } catch (zipFailure) {
      // The package cannot even be opened as a zip, so the original failure was
      // never about namespaces.
      throw new WorkbookReadError("not_a_zip", { cause: zipFailure });
    }
    if (!normalized) throw new WorkbookReadError("unparsable", { cause: directFailure });

    const retry = new ExcelJS.Workbook();
    try {
      await retry.xlsx.load(normalized as any);
    } catch (retryFailure) {
      throw new WorkbookReadError("unparsable", { cause: retryFailure });
    }
    return retry;
  }
}

// ─── Reading uploads: CSV ────────────────────────────────────────────────────
//
// The users list has always been offered as «CSV/XLSX», but the upload went
// straight to `xlsx.load`, which rejects a .csv as "not a zip". Excel on a
// Russian Windows saves «CSV (разделители — запятые)» with `;` and in
// windows-1251, «CSV UTF-8» with a BOM — both are read here. exceljs ships its
// own CSV reader and Node's TextDecoder knows windows-1251, so no new
// dependency is needed.

/** Delimiters a CSV upload may use, in order of preference on a tie. */
const CSV_DELIMITERS = [";", ",", "\t"] as const;

/**
 * Decode CSV bytes: UTF-8 when the bytes are valid UTF-8 (BOM dropped),
 * windows-1251 otherwise — the encoding of a plain «CSV» saved by Russian Excel.
 *
 * @param buf The uploaded bytes.
 * @returns The text.
 */
function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    return new TextDecoder("windows-1251").decode(buf);
  }
}

/**
 * The delimiter of a CSV text: the candidate met most often in its first line.
 *
 * @param text The decoded CSV.
 * @returns The delimiter.
 */
function detectCsvDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best: string = CSV_DELIMITERS[0];
  let bestCount = -1;
  for (const delimiter of CSV_DELIMITERS) {
    const count = firstLine.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Load a CSV upload as a one-sheet workbook, so the callers read it with the
 * same `sheetToObjects` they use for .xlsx.
 *
 * Cells stay TEXT: exceljs would otherwise turn «00123» into 123 and an ISO-like
 * string into a Date, and a key or a phone number must survive as written.
 *
 * @param buf The uploaded bytes.
 * @returns The workbook with a single worksheet.
 */
export async function readCsvFromBuffer(buf: Buffer): Promise<ExcelJS.Workbook> {
  const text = decodeCsv(buf);
  const wb = new ExcelJS.Workbook();
  await wb.csv.read(Readable.from([text]), {
    parserOptions: { delimiter: detectCsvDelimiter(text) },
    map: (value: unknown) => value,
  } as any);
  return wb;
}

/**
 * Load a tabular upload — an .xlsx book or a CSV text.
 *
 * The package is tried first; only an upload that is not even a zip is read as
 * CSV. A zip that fails to parse keeps its `unparsable` error: it is a broken
 * book, not a text file.
 *
 * @param buf The uploaded bytes.
 * @throws {WorkbookReadError} When the upload is a zip but not a readable book.
 */
export async function readTableFromBuffer(buf: Buffer): Promise<ExcelJS.Workbook> {
  try {
    return await readWorkbookFromBuffer(buf);
  } catch (error) {
    if (error instanceof WorkbookReadError && error.reason === "not_a_zip") {
      return readCsvFromBuffer(buf);
    }
    throw error;
  }
}

/**
 * Serialise a workbook to a `Buffer` suitable for `res.send(...)`.
 */
export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

/** Convenience re-export so callers can `import { ExcelJS } from "@/utils/excel"`. */
export { ExcelJS };
