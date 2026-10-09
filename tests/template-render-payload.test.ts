/**
 * @module tests/template-render-payload
 *
 * Locks the results render-payload wiring (PRD-12 web-host): the server assembles
 * the layout + css + context for the results screen for BOTH standard and adaptive
 * attempts, branching on `result.mode`. Guards the integration point behind the web
 * results page (result.tsx routes adaptive + render → TemplateResultPage), so the
 * adaptive results screen on the web stays template-driven, not legacy markup.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { readReportRenderPayload, readResultsRenderPayload } from "../server/services/template-render";
import { getTemplatesRootDir } from "../server/scorm/builders/template-copy";

/** The built-in `default` template directory — what the route resolves for the default id. */
const DEFAULT_DIR = path.join(getTemplatesRootDir(), "default");

const standardResult = {
  overallPassed: true,
  overallPercent: 80,
  totalQuestions: 5,
  totalCorrect: 4,
  totalEarnedPoints: 4,
  totalPossiblePoints: 5,
  topicResults: [
    {
      topicId: "t1",
      topicName: "Тема 1",
      correct: 4,
      total: 5,
      percent: 80,
      earnedPoints: 4,
      possiblePoints: 5,
      passed: true,
    },
  ],
} as any;

const adaptiveResult = {
  mode: "adaptive",
  overallPassed: false,
  topicResults: [
    {
      topicId: "t1",
      topicName: "Сети",
      achievedLevelIndex: 1,
      achievedLevelName: "Средний",
      feedback: "Хорошо",
      recommendedLinks: [{ title: "Курс", url: "https://e/x" }],
    },
    {
      topicId: "t2",
      topicName: "БД",
      achievedLevelIndex: null,
      achievedLevelName: null,
      feedback: "",
      recommendedLinks: [],
    },
  ],
} as any;

describe("readResultsRenderPayload", () => {
  it("standard: builds the results.html payload with score fields", () => {
    const p = readResultsRenderPayload(DEFAULT_DIR, standardResult, "Тест");
    expect(p).not.toBeNull();
    expect(p!.layout).toContain("tb-scene");
    const ctx = p!.context as { result: Record<string, unknown> };
    expect(ctx.result.scorePercent).toBe(80);
    expect(ctx.result.passClass).toBe("is-pass");
    expect(Array.isArray(ctx.result.topicResults)).toBe(true);
  });

  it("adaptive: builds the results.adaptive.html payload with level views", () => {
    const p = readResultsRenderPayload(DEFAULT_DIR, adaptiveResult, "Адаптивный");
    expect(p).not.toBeNull();
    // The adaptive layout has no score ring/stats — it is the level-based variant.
    // PRD-49: headings no longer live in the markup (they come from `labels`), so the
    // variant is recognised by what its markup still owns — the topics branch without
    // the score strip.
    expect(p!.layout).toContain("{{#if isTopics}}");
    expect(p!.layout).not.toContain("tb-score-strip");
    const ctx = p!.context as { result: { adaptive?: boolean; topicResults: any[] } };
    expect(ctx.result.adaptive).toBe(true);
    expect(ctx.result.topicResults[0].levelLabel).toBe("Средний");
    expect(ctx.result.topicResults[0].levelClass).toBe("ou-tag--solid ou-tag--accent");
    expect(ctx.result.topicResults[1].levelLabel).toBe("Минимально требуемый уровень не подтверждён");
    expect(ctx.result.topicResults[1].levelClass).toBe("ou-tag--solid ou-tag--error");
  });

  it("returns a theme so the embedding host can match the surface", () => {
    const p = readResultsRenderPayload(DEFAULT_DIR, standardResult, "Тест");
    expect(typeof p!.theme.background).toBe("string");
    expect(typeof p!.theme.foreground).toBe("string");
  });
});

// ─── PRD-51: документ отчёта для ВЕБ-выдачи ─────────────────────────────────────

describe("веб-выдача отчёта получает БЛОКИ документа, а не только оболочку", () => {
  /**
   * Дефект, пойманный живой приёмкой: веб печатал пустой документ — оболочку без единого
   * блока, — потому что путь браузера остался на цельной раскладке, когда эталон уже
   * переехал на блоки. Пакет при этом печатал верно, и расхождение двух выдач не видел
   * ни один тест.
   */
  const kinds = ["report", "report.adaptive"] as const;

  for (const kind of kinds) {
    it(`${kind}: блоки приходят с раскладками`, () => {
      const payload = readReportRenderPayload(DEFAULT_DIR, kind, null);
      expect(payload, "макет отчёта не разрешился").not.toBeNull();
      expect(payload!.blocks, "блоки документа отсутствуют — веб напечатает пустой лист").toBeDefined();
      expect(payload!.blocks!.length).toBeGreaterThan(0);
      for (const b of payload!.blocks!) {
        if (b.nature === "page-break") continue;
        expect(b.layout.length, `у блока ${b.block} пустая раскладка`).toBeGreaterThan(0);
      }
    });
  }

  it("строки теста задают порядок и показ, а не документ по умолчанию", () => {
    const payload = readReportRenderPayload(DEFAULT_DIR, "report", null, null, undefined, undefined, null, [
      { block: "topics", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {} },
      { block: "header", sortOrder: 1, enabled: false, templateKey: null, valuesJson: {}, settingsJson: {} },
    ]);
    const order = payload!.blocks!.map((b) => b.block);
    expect(order.slice(0, 2)).toEqual(["topics", "header"]);
    expect(payload!.blocks!.find((b) => b.block === "header")!.enabled).toBe(false);
  });
});
