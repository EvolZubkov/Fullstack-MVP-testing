/**
 * @module server/utils/users-list
 *
 * Отпечаток списка пользователей — файла, которым заводят учётные записи пачкой (.xlsx или .csv).
 *
 * Одна проверка на двоих: разбор файла раздела «Импорт» по ней узнаёт вид, предпросмотр списка —
 * отличает настоящий список от текста, который лишь прочитался как CSV. Разойдись они — раздел
 * предложил бы форму списка для файла, на котором предпросмотр споткнётся.
 */

import type ExcelJS from "exceljs";
import { sheetHeaders, sheetToObjects } from "./excel";

/** Заголовок столбца адреса (без учёта регистра) — тот же, что читает предпросмотр списка. */
const EMAIL_HEADER = "email";

/**
 * Опознать список пользователей: первый лист, в шапке которого есть столбец «email».
 *
 * Ролевые листы книги («Вопросы», «Шкалы» и т. д.) такого столбца не имеют, а выгрузку LMS разбор
 * проверяет раньше — так что отпечаток ни с чем не пересекается.
 *
 * @param workbook прочитанная книга или CSV
 * @returns число строк данных списка или `null`, если это не список пользователей
 */
export function detectUsersList(workbook: ExcelJS.Workbook): number | null {
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;
  const headers = [...sheetHeaders(sheet)].map((h) => h.toLowerCase());
  return headers.includes(EMAIL_HEADER) ? sheetToObjects(sheet).length : null;
}

/**
 * Начинается ли загрузка с сигнатуры zip («PK») — то есть книга это, а не текст.
 *
 * @param buf загруженные байты
 */
export function isZipUpload(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
}
