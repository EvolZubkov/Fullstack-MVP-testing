/**
 * @module server/utils/excel
 *
 * Thin wrappers around the `exceljs` library to mimic the small subset of the
 * old SheetJS (`xlsx`) API the project relied on. Centralising the API surface
 * keeps the route code terse and limits the blast radius if `exceljs` is ever
 * swapped out.
 */

import ExcelJS from "exceljs";

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

/**
 * Load a workbook from a `Buffer` (e.g. a multer upload).
 */
export async function readWorkbookFromBuffer(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // `exceljs/index.d.ts` declares `interface Buffer extends ArrayBuffer {}` in
  // the global scope, which merges with Node's `Buffer<TArrayBuffer>` and makes
  // the `load(buffer: Buffer)` parameter unmatchable from a real Node Buffer.
  // Pass the Buffer through as `any` — at runtime exceljs accepts it fine.
  await wb.xlsx.load(buf as any);
  return wb;
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
