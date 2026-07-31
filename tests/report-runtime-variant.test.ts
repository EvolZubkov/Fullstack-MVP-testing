// @vitest-environment jsdom
/**
 * @module tests/report-runtime-variant
 *
 * PRD-27 Фаза 5 — рантайм ПАКЕТА выбирает макет отчёта по запеканию (FR-22).
 *
 * Функции `pdfExport.js` компилируются как есть (не исполняя модуль целиком) и
 * прогоняются на подставленных `TEST_DATA`/`state`. Пиннится то, что иначе всплывает
 * только в LMS: пакет собран с одним вариантом, а рисует другой — либо, для пакета
 * СТАРОЙ сборки, где запекания нет, вообще перестаёт собирать отчёт.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "server/scorm/template/app/utils/pdfExport.js"),
  "utf8",
);

/**
 * Поднять две функции выбора макета на заданном окружении пакета.
 *
 * @param env `TEST_DATA` и `state`, какими их видит рантайм.
 */
function runtime(env: { TEST_DATA: unknown; state: unknown; systemLayout?: (k: string) => string }) {
  const factory = new Function(
    "TEST_DATA",
    "state",
    "systemLayout",
    `${SRC}\nreturn { pdfReportBake: pdfReportBake, pdfReportLayout: pdfReportLayout };`,
  );
  return factory(env.TEST_DATA, env.state, env.systemLayout) as {
    pdfReportBake: () => { layoutKey?: string; values?: Record<string, unknown> } | null;
    pdfReportLayout: (key: string) => string;
  };
}

const LAYOUTS = {
  report: "<div class=\"tb-report\">канонический</div>",
  "layouts/report.certificate.html": "<div class=\"tb-report\">сертификат</div>",
};

describe("выбор макета отчёта в пакете", () => {
  it("читает запекание из TEST_DATA", () => {
    const bake = { variantKey: "report.certificate", layoutKey: "layouts/report.certificate.html", values: { a: 1 } };
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { report: bake } },
      state: { templateLayouts: LAYOUTS },
    });
    expect(rt.pdfReportBake()).toEqual(bake);
    expect(rt.pdfReportLayout(bake.layoutKey)).toContain("сертификат");
  });

  it("пакет СТАРОЙ сборки (запекания нет) отчёта не лишается", () => {
    // FR-28: до этого PRD в TEST_DATA не было `designSettings.report`. Такой пакет
    // обязан продолжать собирать отчёт по каноническому виду.
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { templateId: "default" } },
      state: { templateLayouts: LAYOUTS },
    });
    expect(rt.pdfReportBake()).toBeNull();
    expect(rt.pdfReportLayout("report")).toContain("канонический");
  });

  it("пакет вообще без designSettings не падает", () => {
    const rt = runtime({ TEST_DATA: { mode: "standard" }, state: { templateLayouts: LAYOUTS } });
    expect(rt.pdfReportBake()).toBeNull();
  });

  it("деградация: канонический ключ уходит в systemLayout, а не в макеты шаблона", () => {
    // Шаблон вида не объявил — макет лежит в ЗАПАСНЫХ, и достать его может только
    // `systemLayout`. Если рантайм полезет прямо в `templateLayouts`, отчёта не будет.
    const seen: string[] = [];
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { report: { layoutKey: "report" }, fallbackLayoutKeys: ["report"] } },
      state: { templateLayouts: {} },
      systemLayout: (k: string) => {
        seen.push(k);
        return k === "report" ? "<div class=\"tb-report\">из стандартного</div>" : "";
      },
    });
    expect(rt.pdfReportLayout("report")).toContain("из стандартного");
    expect(seen).toContain("report");
  });

  it("нет ни того ни другого — пустая строка, а не исключение", () => {
    const rt = runtime({
      TEST_DATA: { mode: "standard", designSettings: { report: { layoutKey: "layouts/нет.html" } } },
      state: { templateLayouts: {} },
    });
    expect(rt.pdfReportLayout("layouts/нет.html")).toBe("");
  });
});

describe("исходник экспорта", () => {
  it("значения полей варианта уходят в построитель контекста", () => {
    // Иначе автор задаёт параметры вида, а в PDF они не приезжают — и понять это
    // можно только скачав файл.
    expect(SRC).toMatch(/values:\s*pdfImageValues/);
  });

  it("картинки варианта инлайнятся общим модулем, а не грузятся по зашитым путям", () => {
    // FR-05: пакет не знает ни имён файлов подложки и логотипа, ни каталога, где они
    // лежали до PRD-27 — пути приходят от сборщика вместе с ключами полей.
    expect(SRC).toContain("TB.inlineReportImageValues(");
    expect(SRC).toMatch(/bake && bake\.imageKeys \? bake\.imageKeys : \[\]/);
    expect(SRC).not.toContain("assets/media/");
    expect(SRC).not.toContain("loadReportAssets");
  });

  it("сначала пробуется макет варианта, потом канонический вид", () => {
    expect(SRC).toContain("pdfReportLayout(bake.layoutKey)");
    expect(SRC).toContain("if (!layout) layout = pdfReportLayout(kind);");
  });
});
