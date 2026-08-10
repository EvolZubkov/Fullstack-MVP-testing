/**
 * @module server/scorm/__tests__/pdf-export-report-meta
 *
 * Пакетная сторона отчёта: `pdfReportMeta()` из `app/utils/pdfExport.js`.
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ. Файл — обычный скрипт пакета, и общий модуль в нём берут ОДНИМ
 * образцом: каждая функция объявляет свою `var TB = window.TBTemplate`. `pdfReportMeta`
 * этого не сделала и обратилась к `TB` напрямую. Проверка `TB && …` от необъявленного
 * имени не спасает — обращение к нему бросает `ReferenceError`, а не даёт `undefined`
 * (спасла бы только форма `typeof TB !== 'undefined'`). Функцию зовёт КАЖДЫЙ экспорт
 * отчёта, поэтому «Скачать отчёт» в пакете падал у любого теста, независимо от того,
 * задан ли вводный блок.
 *
 * Тест держит два факта: функция не бросает без общего модуля и читает ветвь отчёта
 * через него, когда он есть.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "..", "template", "app", "utils", "pdfExport.js");

/** Окружение скрипта пакета: глобалы рантайма объявляются вокруг его кода. */
interface Sandbox {
  window: Record<string, unknown>;
  TEST_DATA: Record<string, unknown>;
  pdfReportMeta?: () => Record<string, unknown>;
}

/**
 * Загрузить `pdfExport.js` в песочницу и вернуть `pdfReportMeta`.
 *
 * Скрипт исполняется целиком, как в пакете, — так проверяется ровно та область
 * видимости, в которой он работает в браузере, а не её пересказ.
 */
function loadPdfReportMeta(sandbox: Sandbox): () => Record<string, unknown> {
  const code = readFileSync(SOURCE, "utf8");
  const factory = new Function(
    "sandbox",
    `
    var window = sandbox.window;
    var TEST_DATA = sandbox.TEST_DATA;
    ${code}
    sandbox.pdfReportMeta = pdfReportMeta;
    `,
  );
  factory(sandbox);
  return sandbox.pdfReportMeta as () => Record<string, unknown>;
}

describe("pdfReportMeta (пакетная сторона отчёта)", () => {
  it("не падает, когда общий модуль ещё не подключён", () => {
    const sandbox: Sandbox = { window: {}, TEST_DATA: { introJson: null } };
    const pdfReportMeta = loadPdfReportMeta(sandbox);

    expect(() => pdfReportMeta()).not.toThrow();
  });

  it("берёт ветвь отчёта через общий модуль, когда он есть", () => {
    const report = { text: "Текст отчёта", format: "html" };
    const sandbox: Sandbox = {
      window: {
        TBTemplate: {
          resolveReportIntro: (intro: { report?: unknown } | null) => intro?.report ?? null,
        },
      },
      TEST_DATA: { introJson: { results: { text: "Текст экрана" }, report } },
    };
    const pdfReportMeta = loadPdfReportMeta(sandbox);

    expect(pdfReportMeta().intro).toEqual(report);
  });

  it("без общего модуля откатывается на собственную ветвь отчёта", () => {
    const report = { text: "Текст отчёта" };
    const sandbox: Sandbox = {
      window: {},
      TEST_DATA: { introJson: { results: { text: "Текст экрана" }, report } },
    };
    const pdfReportMeta = loadPdfReportMeta(sandbox);

    expect(pdfReportMeta().intro).toEqual(report);
  });
});
