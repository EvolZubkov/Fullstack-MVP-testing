/**
 * @module scripts/db/import-lms-export
 * @description Загрузка выгрузки отчёта LMS из файла, без интерфейса (PRD-54, инкремент 1).
 *
 * Зовёт ТОТ ЖЕ `runImport`, что и HTTP-эндпоинт: у скрипта нет своей копии логики, иначе прогон
 * доказывал бы работоспособность скрипта, а не продукта. Пока интерфейса нет, он же остаётся
 * рабочим инструментом для заливок.
 *
 * Запуск:
 *   npx tsx scripts/db/import-lms-export.ts <файл.xlsx> --user <userId> [--group <groupId>]
 *     [--link-users] [--dry-run]
 *
 * Готовил ли файл внешний обезличиватель, скрипт видит сам — по колонке `external_id`.
 *
 * Без `--dry-run` скрипт ПИШЕТ в базу. Повторный запуск на том же файле безопасен: импорт
 * идемпотентен по ключу (тест, участник, дата активации модуля).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import ExcelJS from "exceljs";
import { closeDatabaseConnection } from "../../server/db";
import { config, initConfig } from "../../server/config";
import { loadEnv } from "../../server/config-loader.mjs";
import { storage } from "../../server/storage";
import { looksLikeLmsExport, parseLmsExport } from "../../shared/lms-export/parse";
import { resolveTestByQuestionIds } from "../../server/services/lms-test-resolver";
import { runImport } from "../../server/services/lms-export-import";

/** Есть ли флаг в аргументах. */
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Значение именованного аргумента. */
function opt(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

/**
 * Лист как массив строк.
 *
 * Та же гоча дат, что в `server/routes/workbook.ts`: exceljs отдаёт ячейки дат объектами `Date`, и
 * `String(date)` даёт локализованную строку, которую на другой локали не разобрать обратно.
 */
function matrix(sheet: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    out.push((row.values as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }));
  });
  return out;
}

async function main(): Promise<void> {
  loadEnv();
  await initConfig();

  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("Укажите путь к файлу выгрузки первым аргументом");
  const userId = opt("user");
  if (!userId) throw new Error("Укажите --user <userId>: партия импорта хранит автора загрузки");

  const buffer = readFileSync(file);
  const wb = new ExcelJS.Workbook();
  // Приведение — на границе с exceljs: его типы ждут `Buffer` из более старой версии @types/node,
  // чем та, что стоит у нас. Значение то же самое, расходятся только объявления.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const sheet = wb.worksheets.map(matrix).find(looksLikeLmsExport);
  if (!sheet) throw new Error("Файл не похож на выгрузку отчёта LMS");
  const book = parseLmsExport(sheet);

  const resolved = await resolveTestByQuestionIds(book.questionIds, storage);
  if (!resolved.testId) {
    throw new Error(
      `Тест по вопросам файла не определён однозначно. Вопросов в файле: ${book.questionIds.length}, ` +
      `из них неизвестных базе: ${resolved.foreign.length}`,
    );
  }
  const test = await storage.getTest(resolved.testId);
  const dryRun = flag("dry-run");

  console.log(`тест: ${test?.title ?? resolved.testId} (${resolved.testId})`);
  console.log(`строк: ${book.rows.length} | вопросов: ${book.questionIds.length} | чужих: ${resolved.foreign.length}`);
  console.log(`шкалы: ${book.scaleKeys.join(", ") || "—"} | показатели: ${book.variableNames.join(", ") || "—"}`);
  console.log(`режим: ${dryRun ? "СУХОЙ ПРОГОН (ничего не пишется)" : "ЗАПИСЬ"}`);
  console.log(`обезличивание: ${config.analytics.lmsImport.anonymizeParticipants ? "вкл" : "выкл"}` +
    ` | external_id в файле: ${book.hasExternalId ? "да" : "нет, вычисляется"}` +
    ` | связывание: ${flag("link-users") ? "вкл" : "выкл"}`);

  const result = await runImport(
    book,
    {
      anonymize: config.analytics.lmsImport.anonymizeParticipants,
      linkUsers: flag("link-users"),
    },
    {
      testId: resolved.testId,
      groupId: opt("group"),
      fileName: basename(file),
      fileBuffer: buffer,
      userId,
      dryRun,
    },
    storage,
  );

  console.log("---");
  console.log(JSON.stringify(result, null, 2));
  await closeDatabaseConnection();
}

main().then(() => process.exit(0)).catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDatabaseConnection().catch(() => {});
  process.exit(1);
});
