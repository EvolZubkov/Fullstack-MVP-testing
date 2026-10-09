/**
 * @module server/routes/__tests__/workbook-inspect-lms
 * @description PRD-54 раздел 6.1: опознание выгрузки отчёта LMS среди листов книги.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { detectLmsExport } from "../workbook";

/** Шапка выгрузки: девять служебных колонок и один блок взаимодействия из четырёх подколонок. */
function lmsSheet(): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([
    "Пользователь", "Код", "Организация", "Подразделение", "Должность",
    "Дата активации курса", "Дата активации модуля", "Статус", "Баллы",
    "q_80a5957f-cdc7-4490-b4c9-bcedcb973c26", "", "", "",
  ]);
  ws.addRow([
    "", "", "", "", "", "", "", "", "",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
  ]);
  return ws;
}

describe("detectLmsExport", () => {
  it("опознаёт выгрузку и возвращает идентификаторы вопросов", () => {
    expect(detectLmsExport(lmsSheet())?.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
  });

  it("на книге теста возвращает null", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Вопросы");
    ws.addRow(["Текст вопроса", "Тип"]);
    expect(detectLmsExport(ws)).toBeNull();
  });

  it("дата приходит в ISO, а не локализованной строкой", () => {
    // ГОЧА, найденная на реальной выгрузке: exceljs отдаёт ячейки дат объектами `Date`, и голый
    // `String(date)` даёт «Wed Sep 09 2026 16:39:00 GMT+0300 (Москва, стандартное время)». На
    // машине разработчика такая строка разбирается обратно, на хосте с другой локалью — может и нет.
    const ws = lmsSheet();
    ws.addRow([
      "Контента Контроль", "", "ПАО", "", "",
      new Date("2026-09-09T13:35:00Z"), new Date("2026-09-09T13:39:00Z"), "Пройден", 0,
      "другое", "", "neutral", "0[.]7,1[.]0",
    ]);

    const row = detectLmsExport(ws)!.rows[0];
    expect(row.moduleActivatedAt).toBe("2026-09-09T13:39:00.000Z");
    expect(new Date(row.moduleActivatedAt).getTime()).not.toBeNaN();
  });
});
