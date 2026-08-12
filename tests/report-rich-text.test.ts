// @vitest-environment jsdom
/**
 * @module tests/report-rich-text
 *
 * Формат авторского текста доезжает до выдачи (PRD-7 §3.4: `feedback_json.format`).
 *
 * Редактор обратной связи с самого начала предлагал «Обычный / Форматированный / HTML»,
 * формат сохранялся в базе — и терялся по дороге к слушателю: выдача везла голый `text`,
 * а макеты печатали его экранированной строкой. Здесь пиннится вся цепочка: правило
 * разметки, перенос формата сборщиком контекста и печать в макетах обоих шаблонов.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { richTextToHtml } from "../shared/template/rich-text";
import { buildResultContext } from "../shared/template/result-context";
import { buildReportContext } from "../shared/report/report-context";
import { renderScreenInto } from "../shared/template/render-screen";
import { LEVEL_SCHEMES } from "../shared/template/level-ramp";
import type { ReportInput } from "../shared/report/report-html";

describe("richTextToHtml", () => {
  it("обычный текст экранируется, а переводы строк становятся переносами", () => {
    // Ровно то, что продукт уже делает с полем контентной страницы: абзацы автора
    // сохраняются, а разметка, набранная им в обычном поле, остаётся текстом.
    expect(richTextToHtml("Первый\nВторой", "plain")).toBe("Первый<br>Второй");
    expect(richTextToHtml("<b>x</b>", "plain")).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(richTextToHtml("a\r\nb")).toBe("a<br>b");
  });

  it("форматированный текст и HTML печатаются разметкой", () => {
    expect(richTextToHtml("<b>жирно</b>", "richText")).toBe("<b>жирно</b>");
    expect(richTextToHtml("<p>абзац</p>", "html")).toBe("<p>абзац</p>");
  });

  it("пустому тексту разметки не достаётся", () => {
    expect(richTextToHtml("   ", "html")).toBe("");
    expect(richTextToHtml(null)).toBe("");
    expect(richTextToHtml(undefined, "richText")).toBe("");
  });
});

const LEVEL_TEXT = "Первая строка\nВторая строка";

const measures = (format?: "plain" | "richText" | "html") => ({
  ramp: LEVEL_SCHEMES.traffic,
  scaleKind: "band_ruler" as const,
  indicatorKind: "label" as const,
  scales: [],
  indicators: [
    {
      key: "profile",
      name: "Профиль",
      value: "ok",
      visibility: "level" as const,
      interpretation: {
        domainMin: null,
        domainMax: null,
        displayMax: null,
        valence: "none" as const,
        bands: [],
        outcomes: [{ code: "ok", label: "Устойчивый", text: LEVEL_TEXT }],
      },
    },
  ],
  hasPassThreshold: true,
});

const withFeedback = (format: "plain" | "richText" | "html", text: string): ReportInput => ({
  testName: "Демо",
  learnerName: "Слушатель",
  timestamp: "2026-08-09T12:00:00.000Z",
  hasPassThreshold: true,
  feedback: { format, text, links: [], events: [], assets: [] },
  result: {
    passed: false,
    percent: 50,
    totalQuestions: 2,
    correct: 1,
    earnedPoints: 1,
    possiblePoints: 2,
    topicResults: [],
  },
});

describe("контекст несёт разметку рядом с текстом", () => {
  it("толкование уровня приходит и строкой, и разметкой", () => {
    const ctx = buildResultContext(withFeedback("plain", "x").result, "Демо", { measures: measures() });
    const card = (ctx.result.indicators ?? [])[0] as Record<string, unknown>;
    // Строка остаётся на месте: на неё опираются макеты внешних шаблонов.
    expect(card.text).toBe(LEVEL_TEXT);
    expect(card.textHtml).toBe("Первая строка<br>Вторая строка");
  });

  it("формат обратной связи теста доезжает до блока рекомендаций", () => {
    const rich = buildReportContext(withFeedback("richText", "<b>Совет</b>"));
    const texts = (rich.result.recommendations?.texts ?? []) as unknown[];
    const html = (rich.result.recommendations?.textsHtml ?? []) as unknown[];
    expect(texts).toEqual(["<b>Совет</b>"]);
    expect(html).toEqual(["<b>Совет</b>"]);

    // Тот же текст, объявленный обычным, разметкой НЕ становится.
    const plain = buildReportContext(withFeedback("plain", "<b>Совет</b>"));
    expect((plain.result.recommendations?.textsHtml ?? [])[0]).toBe("&lt;b&gt;Совет&lt;/b&gt;");
  });
});

describe("макеты печатают разметку, а не её исходник", () => {
  const layouts: Array<[string, string]> = [
    ["default", path.resolve(process.cwd(), "server", "scorm", "templates", "default")],
    ["certification", path.resolve(process.cwd(), "templates", "certification")],
  ];

  for (const [templateId, dir] of layouts) {
    it(`${templateId}: отчёт печатает форматированную рекомендацию тегами`, () => {
      const root = document.createElement("div");
      renderScreenInto(root, {
        layout: fs.readFileSync(path.join(dir, "layouts", "report.html"), "utf8"),
        context: buildReportContext(withFeedback("richText", "<b>Совет</b>")),
      });
      const card = root.querySelector(".tb-report__event");
      // Тег стал разметкой: в узле лежит <b>, а не текст «<b>Совет</b>».
      expect(card?.querySelector("b")?.textContent).toBe("Совет");
      expect(card?.textContent).toBe("Совет");
    });

    it(`${templateId}: обычный текст остаётся текстом и не превращается в разметку`, () => {
      const root = document.createElement("div");
      renderScreenInto(root, {
        layout: fs.readFileSync(path.join(dir, "layouts", "report.html"), "utf8"),
        context: buildReportContext(withFeedback("plain", "<b>Совет</b>")),
      });
      const card = root.querySelector(".tb-report__event");
      expect(card?.querySelector("b")).toBeNull();
      expect(card?.textContent).toBe("<b>Совет</b>");
    });
  }
});
