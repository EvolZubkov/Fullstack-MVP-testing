/**
 * @module tests/report-document-parity
 *
 * PRD-51 §9 — РАЗБОР ЭТАЛОНА НА БЛОКИ БЫЛ ПЕРЕНОСОМ, А НЕ РЕДИЗАЙНОМ.
 *
 * Сравнивается ОТРИСОВАННЫЙ DOM, а не файлы: файлы разошлись намеренно — одна раскладка
 * стала двенадцатью, — а документ разойтись не имел права. Тест, ничего не настраивавший,
 * обязан печатать ровно то же, что печатал до разбора.
 *
 * Эталон здесь — `layouts/report.html`, прежняя цельная раскладка. Она сохранена в
 * шаблоне именно как эталон и как путь совместимости, и ПРАВИТЬ ЕЁ РАДИ ЗЕЛЁНОГО ТЕСТА
 * нельзя: тогда сравнение потеряет смысл.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderScreenInto } from "@shared/template/render-screen";
import { renderReportInto } from "@shared/report/render-report";
import { resolveReportDocument } from "@shared/report/report-document";
import {
  buildReportFixtureContext,
  buildAdaptiveReportFixtureContext,
} from "./helpers/report-fixture";

const DIR = path.resolve(__dirname, "../server/scorm/templates/default");
const read = (p: string): string => fs.readFileSync(path.join(DIR, p), "utf8");
const MANIFEST = JSON.parse(read("manifest.json"));

/**
 * Приводит разметку к тому, что реально ПЕЧАТАЕТСЯ.
 *
 * Снимаются две вещи, и обе — не документ:
 *
 * 1. Пробелы МЕЖДУ узлами: в цельной раскладке блоки разделены переводами строк
 *    исходника, а собранный документ склеивает их встык.
 * 2. Комментарии. Они переносятся в документ (см. `renderReportInto`) и остаются
 *    читаемыми в отладке, но при разрезе у них законно сменился отступ: блок больше не
 *    вложен в корневой элемент, и продолжения строк сдвинулись на два пробела. Гейтить
 *    паритет отступом внутри комментария значило бы проверять форматирование исходника,
 *    а не документ.
 *
 * Всё остальное — включая пробелы ВНУТРИ текста — сравнивается как есть.
 */
const normalize = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();

function renderMonolithic(context: unknown, layoutFile: string): string {
  const stage = document.createElement("div");
  renderScreenInto(stage, { layout: read(layoutFile), context });
  return (stage.firstElementChild as HTMLElement).innerHTML;
}

function renderFromBlocks(context: unknown, kind: "report" | "report.adaptive", shellFile: string): string {
  const doc = resolveReportDocument(MANIFEST, kind);
  expect(doc.monolithic, "шаблон обязан быть переведён на блоки").toBe(false);
  const stage = document.createElement("div");
  renderReportInto(stage, {
    shell: read(shellFile),
    context,
    blocks: doc.blocks.map((b) => ({ ...b, layout: b.layoutFile ? read(b.layoutFile) : "" })),
  });
  return (stage.firstElementChild as HTMLElement).innerHTML;
}

describe("паритет документа отчёта", () => {
  const context = buildReportFixtureContext(MANIFEST);
  const fromBlocks = renderFromBlocks(context, "report", "layouts/report/shell.html");
  const monolithic = renderMonolithic(context, "layouts/report.html");

  // Фикстура обязана открыть гейты: сравнение двух пустых документов сошлось бы и не
  // доказало бы ничего. Маркеры проверяются на ЭТАЛОНЕ — если раздел не родился там,
  // виновата фикстура, а не разбор.
  it.each([
    ["шапка", "tb-report__title--head"],
    ["вводный блок", "tb-report__intro"],
    ["сводка баллов", "tb-report__ring"],
    ["темы", "tb-report__topic"],
    ["разрезы в теме", "tb-report__breakdown-row"],
    ["сводный разрез", "tb-report__breakdown--block"],
    ["рекомендации", "tb-report__rec"],
    ["зонтичный заголовок", "tb-report__title--tight"],
  ])("фикстура наполнила раздел: %s", (_name, marker) => {
    expect(monolithic).toContain(marker);
  });

  it("документ из блоков совпадает с цельной раскладкой", () => {
    expect(normalize(fromBlocks)).toBe(normalize(monolithic));
  });
});

describe("паритет документа адаптивного отчёта", () => {
  const context = buildAdaptiveReportFixtureContext(MANIFEST);
  const fromBlocks = renderFromBlocks(context, "report.adaptive", "layouts/report/adaptive/shell.html");
  const monolithic = renderMonolithic(context, "layouts/report.adaptive.html");

  it.each([
    ["шапка", "tb-report__headline"],
    ["вводный блок", "tb-report__intro"],
    ["карточка названия", "tb-report__title--solid"],
    ["зонтичный заголовок", "tb-report__title--tight"],
    ["темы", "tb-report__topic"],
    ["сводный разрез", "tb-report__breakdown--block"],
    ["рекомендации", "tb-report__rec"],
  ])("фикстура наполнила раздел: %s", (_name, marker) => {
    expect(monolithic).toContain(marker);
  });

  it("документ из блоков совпадает с цельной раскладкой", () => {
    expect(normalize(fromBlocks)).toBe(normalize(monolithic));
  });
});
