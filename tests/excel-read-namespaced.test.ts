/**
 * @module tests/excel-read-namespaced
 *
 * `readWorkbookFromBuffer` must accept a book whose OOXML parts carry the
 * spreadsheetml namespace on a PREFIX (`<x:workbook>`) rather than as the
 * default namespace. Such files are valid OOXML but exceljs builds its SAX
 * parser without namespace support (`new SaxesParser()`), so every xform
 * matches the raw qualified name and a prefixed book fails to load at all.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  addJsonSheet,
  workbookToBuffer,
  readWorkbookFromBuffer,
  sheetToObjects,
  WorkbookReadError,
} from "../server/utils/excel";

const SML_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const DRAWINGML = "http://schemas.openxmlformats.org/drawingml/2006/main";

/**
 * Rewrite every spreadsheetml part of a book so its ELEMENTS sit on the `x:`
 * prefix — the inverse of what the reader has to undo. Parts on other
 * namespaces (the drawingml theme) are left exactly as they were, which is
 * what makes this fixture able to catch an over-broad "strip every prefix".
 */
async function prefixSpreadsheetmlParts(buf: Buffer, prefix = "x"): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const out = new JSZip();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!/\.(xml|rels)$/i.test(name)) {
      out.file(name, await entry.async("nodebuffer"));
      continue;
    }
    let xml = await entry.async("string");
    if (xml.includes(`xmlns="${SML_MAIN}"`)) {
      xml = xml
        .replace(/<([a-zA-Z][\w.-]*)/g, `<${prefix}:$1`)
        .replace(/<\/([a-zA-Z][\w.-]*)/g, `</${prefix}:$1`)
        .replace(new RegExp(`xmlns="${SML_MAIN}"`, "g"), `xmlns:${prefix}="${SML_MAIN}"`);
    }
    out.file(name, xml);
  }
  return out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** A small two-sheet book with values a reader can be checked against. */
async function sampleBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addJsonSheet(wb, "Вопросы", [
    { "Ключ строки": "Q1", "Текст вопроса": "Первый вопрос", "Балл": 2 },
    { "Ключ строки": "Q2", "Текст вопроса": "Второй вопрос", "Балл": 1 },
  ]);
  addJsonSheet(wb, "Шкалы", [{ "Ключ": "scale_a", "Название": "Шкала А" }]);
  return workbookToBuffer(wb);
}

describe("readWorkbookFromBuffer: prefixed spreadsheetml namespace", () => {
  it("reads a book whose elements sit on a namespace prefix", async () => {
    const prefixed = await prefixSpreadsheetmlParts(await sampleBook());

    // Guard the fixture itself: a raw exceljs load MUST fail, otherwise the
    // test would pass without the reader doing anything.
    await expect(new ExcelJS.Workbook().xlsx.load(prefixed as any)).rejects.toThrow();

    const wb = await readWorkbookFromBuffer(prefixed);

    expect(wb.worksheets.map((w) => w.name)).toEqual(["Вопросы", "Шкалы"]);
    expect(sheetToObjects(wb.getWorksheet("Вопросы")!)).toEqual([
      { "Ключ строки": "Q1", "Текст вопроса": "Первый вопрос", "Балл": 2 },
      { "Ключ строки": "Q2", "Текст вопроса": "Второй вопрос", "Балл": 1 },
    ]);
    expect(sheetToObjects(wb.getWorksheet("Шкалы")!)).toEqual([
      { "Ключ": "scale_a", "Название": "Шкала А" },
    ]);
  });

  it("works for a prefix other than «x»", async () => {
    const prefixed = await prefixSpreadsheetmlParts(await sampleBook(), "ss");

    const wb = await readWorkbookFromBuffer(prefixed);

    expect(sheetToObjects(wb.getWorksheet("Вопросы")!)).toHaveLength(2);
  });

  it("leaves parts on other namespaces untouched", async () => {
    // The drawingml theme legitimately uses the `a:` prefix; stripping it would
    // break theme parsing. Reading must not rewrite that part.
    const prefixed = await prefixSpreadsheetmlParts(await sampleBook());
    await readWorkbookFromBuffer(prefixed);

    const theme = await (await JSZip.loadAsync(prefixed)).file("xl/theme/theme1.xml")?.async("string");
    expect(theme).toBeDefined();
    expect(theme).toContain(`xmlns:a="${DRAWINGML}"`);
    expect(theme).toContain("<a:theme");
  });

  it("still reads an ordinary book unchanged", async () => {
    const wb = await readWorkbookFromBuffer(await sampleBook());

    expect(sheetToObjects(wb.getWorksheet("Вопросы")!)).toHaveLength(2);
  });
});

describe("readWorkbookFromBuffer: failure reasons", () => {
  it("reports «not_a_zip» when the upload is not an OOXML package", async () => {
    const notAZip = Buffer.from("Ключ строки;Текст вопроса\nQ1;Первый вопрос\n", "utf8");

    await expect(readWorkbookFromBuffer(notAZip)).rejects.toThrow(WorkbookReadError);
    await expect(readWorkbookFromBuffer(notAZip)).rejects.toMatchObject({ reason: "not_a_zip" });
  });

  it("reports «unparsable» when the package is a zip with a broken workbook part", async () => {
    // A zip WITH an `xl/workbook.xml` exceljs cannot make sense of — the class the
    // prefix normalization cannot rescue either. (A zip with no `xl/` parts at all
    // is not this case: exceljs happily returns an empty workbook for it.)
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
    zip.file("xl/workbook.xml", "это не xml вовсе");
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    await expect(readWorkbookFromBuffer(buf)).rejects.toMatchObject({ reason: "unparsable" });
  });
});
