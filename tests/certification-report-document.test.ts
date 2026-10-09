/**
 * @module tests/certification-report-document
 *
 * PRD-51 Э4 — ДОКУМЕНТ ОТЧЁТА шаблона «Сертификация» (FR-22).
 *
 * Пиннятся метрики, снятые с референса (§10.3), и объявления документа. Облик проверяется
 * растром в приёмке; здесь — то, чего растр не покажет: если полотно титула перестанет
 * быть белым, снимок это увидит, а вот подмену `course.title` на статику или блок,
 * объявленный без раскладки, — нет.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { templateRoot } from "./helpers/template-roots";

const CERT = templateRoot("certification");
const css = fs.readFileSync(path.join(CERT, "styles", "report.css"), "utf8");

/** Значение пиксельного CSS-токена (`--tb-sheet-pad-y: 20px` -> 20). */
function cssVarPx(source: string, name: string): number {
  const value = source.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1];
  expect(value, `токен ${name} не объявлен`).toBeTruthy();
  return Number(value);
}

/**
 * Пиксели из CSS-выражения: `calc(...)` с подстановкой пиксельных токенов. Считается
 * то, что реально стоит в правиле, — иначе тест пришлось бы переписывать на каждую
 * правку раскладки, а именно от неё он и стережёт.
 */
function evalPx(expr: string, source: string): number {
  const substituted = expr
    .replace(/var\((--[\w-]+)\)/g, (_, name: string) => String(cssVarPx(source, name)))
    .replace(/calc/g, "")
    .replace(/px/g, "")
    .trim();
  expect(substituted, `в выражении «${expr}» осталось неарифметическое`).toMatch(/^[\d\s+\-*/().]+$/);
  return Number(new Function(`return (${substituted});`)());
}

describe("лист документа «Сертификации» светлый", () => {
  it("фон листа — серый референса, а не тёмный эталона", () => {
    expect(css).toMatch(/\.tb-report\s*\{[^}]*background:\s*#E2E2E2/i);
  });

  it("полотно титула белое", () => {
    expect(css).toMatch(/\.tb-report__cover\s*\{[^}]*background:\s*#FFFFFF/i);
  });

  it("титул растянут в лист, а не обрезан по содержимому", () => {
    // Плита росла по содержимому, и первый лист оставался пустым больше чем наполовину
    // (382 px при 816 px полезной высоты), тогда как референс печатает титул страницей.
    // Растру такое видно, но растр в приёмке смотрели на наличие узлов, а не на заполнение.
    const rule = css.match(/\.tb-report__cover:not\(:has\(\+ \.tb-report__intro\)\)\s*\{[^}]*\}/)?.[0];
    expect(rule, "правило растяжения титула снято").toBeTruthy();
    // Без border-box поля плиты ложатся ПОВЕРХ высоты, титул выходит за лист и уезжает
    // на второй, оставляя на первом один логотип.
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    const expr = rule?.match(/min-height:\s*([^;]+);/)?.[1] ?? "";
    // Предел обязан считаться ОТ поля листа: голое число расходится с полями молча —
    // так и случилось, когда поля выросли 13 -> 20, а число осталось прежним.
    expect(expr, "предел высоты титула задан числом, а не полем листа").toContain("--tb-sheet-pad-y");
    const min = evalPx(expr, css);
    const usable = 842 - 2 * cssVarPx(css, "--tb-sheet-pad-y");
    expect(min).toBeGreaterThan(600);
    // Выше полезной высоты листа титул на него не влезает.
    expect(min).toBeLessThanOrEqual(usable);
  });

  it("карточка вердикта тёмная — единственный тёмный узел документа", () => {
    expect(css).toMatch(/\.tb-report__card--verdict\s*\{[^}]*background:\s*#101828/i);
  });

  it("бейдж счётчика оранжевый", () => {
    expect(css).toMatch(/\.tb-report__topic-group-counter\s*\{[^}]*background:\s*#FF4F12/i);
  });

  it("цвета исхода объявлены оба", () => {
    expect(css).toContain("#FF4F12");
    expect(css).toContain("#19D7A4");
  });

  it("знак исхода рисуется стилем по классу вердикта, а не ветвлением в разметке", () => {
    expect(css).toMatch(/\.tb-report\.is-pass\s+\.tb-report__mark::before/);
    expect(css).toMatch(/\.tb-report\.is-fail\s+\.tb-report__mark::before/);
  });
});

const manifest = JSON.parse(fs.readFileSync(path.join(CERT, "manifest.json"), "utf8"));
const blocks = (manifest.contentTemplates as Array<Record<string, unknown>>).filter(
  (v) => v.kind === "report.block",
);

/** Виды, которым служит вариант: без `kinds` — оба. */
const kindsOf = (b: Record<string, unknown>): string[] =>
  Array.isArray(b.kinds) ? (b.kinds as string[]) : ["report", "report.adaptive"];

describe("манифест «Сертификации» объявляет документ", () => {
  it("объявляет вариант каждого системного блока обычного отчёта", () => {
    // Сравниваются РАЗНЫЕ блоки, а не все объявления: у блока вправе быть несколько
    // видов строки (у `topics` их два — карточки со счётчиком и строка в две колонки),
    // и список объявлений тогда несёт его дважды. Стеречь здесь надо покрытие блоков —
    // что ни один системный блок документа не остался без раскладки.
    const forReport = blocks.filter((b) => kindsOf(b).includes("report") && b.block !== "page");
    expect([...new Set(forReport.map((b) => b.block))].sort()).toEqual([
      "breakdown", "courses", "events", "header", "indicators",
      "intro", "recommendations", "scales", "summary", "topics",
    ]);
  });

  it("у блока разделов объявлен вариант «строка в две колонки»", () => {
    // Референсный отчёт РТК печатается именно им; вариант объявляет ШАБЛОН, и его
    // пропажа обнаружилась бы только сборкой документа, уже потерявшего вид.
    const split = blocks.find((b) => b.key === "report.block.topics.split");
    expect(split, "вариант report.block.topics.split не объявлен").toBeTruthy();
    expect(split?.block).toBe("topics");
    expect(split?.isDefault).not.toBe(true);
  });

  it("на блок ровно одно умолчание для каждого вида", () => {
    for (const kind of ["report", "report.adaptive"]) {
      const seen = new Map<string, number>();
      for (const b of blocks) {
        if (!kindsOf(b).includes(kind) || !b.isDefault) continue;
        seen.set(String(b.block), (seen.get(String(b.block)) ?? 0) + 1);
      }
      for (const [block, n] of seen) {
        expect(n, `${kind}: у блока ${block} умолчаний ${n}`).toBe(1);
      }
    }
  });

  it("объявляет документ по умолчанию для обоих видов", () => {
    expect(manifest.reportDocument.report).toEqual([
      "header", "intro", "page-break", "topics", "page-break",
      "summary", "breakdown", "scales", "indicators", "recommendations", "courses", "events",
    ]);
    expect(manifest.reportDocument["report.adaptive"][0]).toBe("header");
  });

  it("каждая объявленная раскладка лежит в шаблоне", () => {
    for (const b of blocks) {
      expect(fs.existsSync(path.join(CERT, String(b.layoutFile))), `нет файла ${b.layoutFile}`).toBe(true);
    }
  });

  it("даёт автору пять вариантов страницы, включая связки «заголовок + колонки»", () => {
    const pages = blocks.filter((b) => b.block === "page");
    expect(pages.map((p) => p.key).sort()).toEqual([
      "report.block.page.cols2",
      "report.block.page.cols3",
      "report.block.page.text",
      "report.block.page.textCols2",
      "report.block.page.textCols3",
    ]);
    // Связки — не украшение: постраничная раскладка режет документ МЕЖДУ блоками, и
    // пара «страница с текстом» + «страница с колонками» разъезжалась по листам,
    // оставляя заголовок сиротой внизу предыдущего.
    for (const key of ["report.block.page.textCols2", "report.block.page.textCols3"]) {
      const v = pages.find((p) => p.key === key)!;
      const keys = (v.placeholders as Array<{ key: string }>).map((p) => p.key);
      expect(keys.slice(0, 2), `${key}: заголовок и вводный текст`).toEqual(["title", "body"]);
    }
    // Страница служит ОБОИМ видам: авторский текст не зависит от того, адаптивен ли тест.
    for (const p of pages) expect(p.kinds, `${p.key} привязан к виду`).toBeUndefined();
  });
});

describe("оболочка отчёта указывает на раскладку ДОКУМЕНТА, а не на цельную", () => {
  // Цельная `layouts/report.html` осталась в шаблоне ради шаблонов, которые ещё не
  // переехали, но сам вид обязан вести на оболочку документа: указывая на цельную,
  // «Сертификация» печатала бы весь старый отчёт, а поверх него — блоки.
  for (const [kind, file] of [
    ["report", "layouts/report/shell.html"],
    ["report.adaptive", "layouts/report/adaptive/shell.html"],
  ] as const) {
    it(`${kind} → ${file}`, () => {
      const shell = (manifest.contentTemplates as Array<Record<string, unknown>>).find((v) => v.kind === kind);
      expect(shell?.layoutFile).toBe(file);
    });
  }
});
