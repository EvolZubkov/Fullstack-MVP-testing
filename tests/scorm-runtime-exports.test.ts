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
