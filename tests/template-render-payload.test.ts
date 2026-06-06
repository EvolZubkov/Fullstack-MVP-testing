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
import { readResultsRenderPayload } from "../server/services/template-render";

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
    const p = readResultsRenderPayload("default", standardResult, "Тест");
    expect(p).not.toBeNull();
    expect(p!.layout).toContain("results-page");
    const ctx = p!.context as { result: Record<string, unknown> };
    expect(ctx.result.scorePercent).toBe(80);
    expect(ctx.result.passClass).toBe("is-pass");
    expect(Array.isArray(ctx.result.topicResults)).toBe(true);
  });

  it("adaptive: builds the results.adaptive.html payload with level views", () => {
    const p = readResultsRenderPayload("default", adaptiveResult, "Адаптивный");
    expect(p).not.toBeNull();
    // The adaptive layout has no score ring/stats — it is the level-based variant.
    expect(p!.layout).toContain("Результаты по темам");
    const ctx = p!.context as { result: { adaptive?: boolean; topicResults: any[] } };
    expect(ctx.result.adaptive).toBe(true);
    expect(ctx.result.topicResults[0].levelLabel).toBe("Средний");
    expect(ctx.result.topicResults[0].levelClass).toBe("is-info");
    expect(ctx.result.topicResults[1].levelLabel).toBe("Не достигнут");
    expect(ctx.result.topicResults[1].levelClass).toBe("is-fail");
  });

  it("returns a theme so the embedding host can match the surface", () => {
    const p = readResultsRenderPayload("default", standardResult, "Тест");
    expect(typeof p!.theme.background).toBe("string");
    expect(typeof p!.theme.foreground).toBe("string");
  });
});
