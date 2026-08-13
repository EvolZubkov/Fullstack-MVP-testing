/**
 * @module features/tests/assign/__tests__/bulk-invite-export.test
 * @description Unit tests for the client-side links workbook (PRD-28 раздел 7).
 * The book is assembled from the report the tab already holds — there is no
 * second request for the links, because the raw tokens exist nowhere else — so
 * these tests read the produced file back with ExcelJS and check the columns,
 * the rows that make it in and the ones that do not.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildLinksWorkbook, linksWorkbookFileName } from "../bulk-invite-export";

/**
 * Read the first worksheet back as an array of arrays.
 *
 * The bytes are handed over as a Node Buffer, not as the ArrayBuffer itself:
 * under the jsdom environment the test file and the externalised `jszip` live
 * in different realms, so jszip's `data instanceof ArrayBuffer` is false for a
 * perfectly good buffer. `Buffer.isBuffer` has no such blind spot.
 */
async function readSheetRows(buf: ArrayBuffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(new Uint8Array(buf)));
  const ws = wb.worksheets[0];
  const out: unknown[][] = [];
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    out.push(values.slice(1));
  });
  return out;
}

describe("buildLinksWorkbook", () => {
  it("собирает книгу со ссылками из отчёта", async () => {
    const buf = await buildLinksWorkbook({
      testTitle: "Основы ИБ",
      results: [
        {
          email: "a@x.ru", name: "Анна", status: "new",
          magicLink: "https://host/access/abc", delivered: false,
        },
      ],
      expiresAt: "2026-09-01T00:00:00.000Z",
    });

    const rows = await readSheetRows(buf);
    expect(rows[0]).toEqual(["Адрес", "Имя", "Статус", "Ссылка", "Действует до"]);
    expect(rows[1][0]).toBe("a@x.ru");
    expect(rows[1][1]).toBe("Анна");
    expect(rows[1][2]).toBe("Новый");
    expect(rows[1][3]).toBe("https://host/access/abc");
    expect(rows[1][4]).toBe("01.09.2026");
  });

  it("берёт только адреса, которым ссылка выпущена", async () => {
    const buf = await buildLinksWorkbook({
      testTitle: "Основы ИБ",
      results: [
        { email: "a@x.ru", name: "Анна", status: "new", magicLink: "https://host/access/abc", delivered: true },
        // Привилегированный получатель: назначение есть, разовой ссылки нет.
        { email: "b@x.ru", name: "Борис", status: "privileged", delivered: true },
      ],
      expiresAt: null,
    });

    const rows = await readSheetRows(buf);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("a@x.ru");
    // Срок не задавался оператором — колонка не выдумывает дату.
    expect(rows[1][4]).toBe("—");
  });

  it("пустое имя не роняет книгу", async () => {
    const buf = await buildLinksWorkbook({
      testTitle: "Основы ИБ",
      results: [{ email: "a@x.ru", name: null, status: "external", magicLink: "https://host/access/abc", delivered: true }],
      expiresAt: "2026-09-01",
    });

    const rows = await readSheetRows(buf);
    expect(rows[1][1]).toBe("");
    expect(rows[1][2]).toBe("Внешний участник");
  });
});

describe("linksWorkbookFileName", () => {
  it("несёт название теста и дату", () => {
    const name = linksWorkbookFileName("Основы ИБ", new Date("2026-08-13T10:00:00Z"));
    expect(name).toMatch(/^links_Основы_ИБ_2026-08-13\.xlsx$/);
  });

  it("вычищает из имени всё, что не годится файлу", () => {
    expect(linksWorkbookFileName('Тест: "А/Б"', new Date("2026-08-13T10:00:00Z")))
      .toBe("links_Тест_А_Б_2026-08-13.xlsx");
  });
});
