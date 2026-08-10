// @vitest-environment jsdom
/**
 * @module tests/report-intro-block
 *
 * ВВОДНЫЙ БЛОК экрана итогов и отчёта (PRD-27 §7.1).
 *
 * Три вещи, которые здесь пиннятся и которые легко потерять по дороге:
 *   1. блок идёт ПЕРВЫМ — до сводки, тем, измерений и рекомендаций;
 *   2. тексты экрана и отчёта РАЗНЫЕ и не подменяют друг друга;
 *   3. пусто = блока нет вовсе, а не пустая рамка.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildResultContext, buildAdaptiveResultContext } from "../shared/template/result-context";
import { buildReportContext, buildAdaptiveReportContext } from "../shared/report/report-context";
import { renderScreenInto } from "../shared/template/render-screen";
import { resolveReportIntro } from "../shared/report/report-intro";
import type { ReportInput } from "../shared/report/report-html";

const RESULT = {
  passed: true,
  percent: 80,
  totalQuestions: 10,
  correct: 8,
  earnedPoints: 8,
  possiblePoints: 10,
  topicResults: [],
};

const reportInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  testName: "Демо",
  learnerName: "Слушатель",
  timestamp: "2026-08-09T12:00:00.000Z",
  result: RESULT,
  ...over,
});

describe("контекст несёт разметку вводного блока", () => {
  it("экран итогов: текст превращается в разметку", () => {
    const ctx = buildResultContext(RESULT, "Демо", {
      intro: { text: "Первая строка\nВторая строка", format: "plain" },
    });
    expect(ctx.result.introHtml).toBe("Первая строка<br>Вторая строка");
  });

  it("форматированный вводный текст печатается разметкой", () => {
    const ctx = buildResultContext(RESULT, "Демо", {
      intro: { text: "<b>Важно</b>", format: "richText" },
    });
    expect(ctx.result.introHtml).toBe("<b>Важно</b>");
  });

  it("пустой текст блока не даёт", () => {
    expect(buildResultContext(RESULT, "Демо", { intro: { text: "   " } }).result.introHtml).toBeUndefined();
    expect(buildResultContext(RESULT, "Демо", {}).result.introHtml).toBeUndefined();
    expect(buildResultContext(RESULT, "Демо", { intro: null }).result.introHtml).toBeUndefined();
  });

  it("адаптивный экран получает блок по тому же правилу", () => {
    const ctx = buildAdaptiveResultContext({ passed: true, topicResults: [] }, "Демо", {
      intro: { text: "Вводное слово" },
    });
    expect(ctx.result.introHtml).toBe("Вводное слово");
  });

  it("у отчёта СВОЙ текст, а не текст экрана", () => {
    // Адресаты разные: экран пробегают глазами, отчёт уносят с собой. Подмена одного
    // текста другим была бы молчаливой ошибкой — её и пиннит этот тест.
    const ctx = buildReportContext(reportInput({ intro: { text: "Вводное слово ОТЧЁТА" } }));
    expect(ctx.result.introHtml).toBe("Вводное слово ОТЧЁТА");

    const screen = buildResultContext(RESULT, "Демо", { intro: { text: "Вводное слово ЭКРАНА" } });
    expect(screen.result.introHtml).toBe("Вводное слово ЭКРАНА");
  });

  it("адаптивный отчёт тоже несёт свой блок", () => {
    const ctx = buildAdaptiveReportContext(
      { testName: "Демо", result: { passed: true, topicResults: [] }, intro: { text: "Вводное слово" } },
      {},
    );
    expect(ctx.result.introHtml).toBe("Вводное слово");
  });
});

describe("макеты печатают блок ПЕРВЫМ", () => {
  const dirs: Array<[string, string]> = [
    ["default", path.resolve(process.cwd(), "server", "scorm", "templates", "default")],
    ["certification", path.resolve(process.cwd(), "templates", "certification")],
  ];

  const render = (layout: string, context: unknown): HTMLElement => {
    const root = document.createElement("div");
    renderScreenInto(root, { layout, context });
    return root;
  };

  for (const [templateId, dir] of dirs) {
    const layout = (name: string) => fs.readFileSync(path.join(dir, "layouts", name), "utf8");

    it(`${templateId}: в отчёте блок стоит выше карточки результата`, () => {
      const root = render(
        layout("report.html"),
        buildReportContext(reportInput({ intro: { text: "ВВОДНОЕ СЛОВО" } })),
      );
      const intro = root.querySelector(".tb-report__intro");
      expect(intro?.textContent).toContain("ВВОДНОЕ СЛОВО");
      // «Первым» проверяется положением в документе, а не порядком в разметке файла.
      const cards = [...root.querySelectorAll(".tb-report__card")];
      expect(cards[0]).toBe(intro);
    });

    it(`${templateId}: на экране итогов блок стоит выше сводки`, () => {
      const root = render(
        layout("results.html"),
        buildResultContext(RESULT, "Демо", { intro: { text: "ВВОДНОЕ СЛОВО" } }),
      );
      const intro = root.querySelector(".tb-intro");
      expect(intro?.textContent).toContain("ВВОДНОЕ СЛОВО");
      const strip = root.querySelector(".tb-score-strip");
      expect(strip, "сводка на месте").not.toBeNull();
      // `DOCUMENT_POSITION_FOLLOWING` = сводка идёт ПОСЛЕ блока.
      expect(intro!.compareDocumentPosition(strip!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it(`${templateId}: без текста блока нет ни на экране, ни в отчёте`, () => {
      const report = render(layout("report.html"), buildReportContext(reportInput()));
      expect(report.querySelector(".tb-report__intro")).toBeNull();
      const screen = render(layout("results.html"), buildResultContext(RESULT, "Демо", {}));
      expect(screen.querySelector(".tb-intro")).toBeNull();
    });

    it(`${templateId}: разметка автора печатается тегами, а не текстом`, () => {
      const root = render(
        layout("report.html"),
        buildReportContext(reportInput({ intro: { text: "<b>Важно</b>", format: "richText" } })),
      );
      const intro = root.querySelector(".tb-report__intro");
      expect(intro?.querySelector("b")?.textContent).toBe("Важно");
    });
  }
});

describe("переключатель «в отчёте тот же текст, что в итогах»", () => {
  const results = { format: "plain" as const, text: "Текст ЭКРАНА" };
  const report = { format: "plain" as const, text: "Текст ОТЧЁТА" };

  it("выключенный — у отчёта свой текст", () => {
    expect(resolveReportIntro({ results, report })).toEqual(report);
  });

  it("включённый — отчёт печатает текст экрана", () => {
    expect(resolveReportIntro({ results, report, reportSameAsResults: true })).toEqual(results);
  });

  it("собственный текст отчёта НЕ стирается и возвращается при выключении", () => {
    // Переключатель — ссылка, а не копия: иначе выключить его значило бы потерять текст,
    // который автор писал отдельно.
    const intro = { results, report, reportSameAsResults: true };
    expect(resolveReportIntro(intro)).toEqual(results);
    expect(resolveReportIntro({ ...intro, reportSameAsResults: false })).toEqual(report);
  });

  it("включённый при пустом тексте экрана блока не даёт", () => {
    expect(resolveReportIntro({ results: { text: "  " }, report, reportSameAsResults: true })).toBeNull();
  });

  it("ничего не задано — блока нет", () => {
    expect(resolveReportIntro(null)).toBeNull();
    expect(resolveReportIntro({})).toBeNull();
    expect(resolveReportIntro({ reportSameAsResults: true })).toBeNull();
  });
});
