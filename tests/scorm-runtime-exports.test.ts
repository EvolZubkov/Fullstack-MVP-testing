/**
 * @module tests/scorm-runtime-exports
 *
 * Пакетный рантайм умеет только то, что бандл `TBTemplate` ему отдал: файлы `template/app`
 * ходят к ядру исключительно через `window.TBTemplate`. Отчёт в пакете собирает вход
 * измерений тем же сборщиком, что веб (PRD-47 §5.1), поэтому сборщик обязан быть в
 * экспортах — иначе `pdfExport.js` тихо соберёт отчёт без блока измерений, ровно как до
 * PRD-47, и разбор уйдёт в раскладку, где всё в порядке.
 */
import { describe, expect, it } from "vitest";

import * as runtime from "../shared/template/runtime-entry";

describe("экспорты рантайма пакета", () => {
  it("отдают сборщик входа отчёта", () => {
    expect(typeof runtime.buildReportMeasures).toBe("function");
  });

  it("отдают построители контекста отчёта, которыми тот же файл пользуется рядом", () => {
    expect(typeof runtime.buildReportContext).toBe("function");
    expect(typeof runtime.buildAdaptiveReportContext).toBe("function");
    expect(typeof runtime.exportReportPdf).toBe("function");
  });
});

/**
 * PRD-57 Э10. Формулировки правил словами («Засчитывается ответ от … до …») написаны для
 * АВТОРА: их читают список правил в ящике, проба и колонка аналитики. С Э10 они живут в
 * `shared/answer-check/describe`, потому что те же предложения печатает выгрузка на
 * сервере, — и ровно поэтому индекс движка сравнения их НЕ реэкспортит: индекс и есть то,
 * что забирает бандл пакета, а участник этих слов не видит никогда.
 */
describe("бандл пакета не везёт авторских формулировок", () => {
  it("ни индекс движка сравнения, ни рантайм шаблона не ссылаются на описания", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve, join } = await import("node:path");

    /** Каждый файл дерева, кроме самого модуля описаний. */
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(full);
        return entry.name.endsWith(".ts") && !full.endsWith("describe.ts") ? [full] : [];
      });

    const root = resolve(process.cwd());
    const sources = [...walk(join(root, "shared", "answer-check")), ...walk(join(root, "shared", "template"))];
    const offenders = sources.filter((file) => /from\s+"[^"]*answer-check\/describe"|from\s+"\.\/describe"/.test(
      readFileSync(file, "utf8"),
    ));
    expect(offenders).toEqual([]);
  });
});
