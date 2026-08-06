/**
 * @module shared/template/__tests__/runtime-entry-exports
 * @description Гард: набор публичных экспортов TBTemplate не должен молча
 * сузиться — оба хоста (веб-импорт и SCORM-IIFE) зависят от этих имён.
 */
import { describe, it, expect } from "vitest";
import * as entry from "../runtime-entry";

const REQUIRED = [
  "renderScreenInto",
  "buildQuestionProgress",
  "buildReviewContext",
  "shouldShowReview",
  "renderResultField",
  // Ревизия «Стандартный»: единая эмиссия интерактива вопросов.
  "buildPaletteBridge",
  "renderSingleChoice",
  "renderMultiple",
  "renderRanking",
  "renderMatching",
  // PRD-26: шкала и её клавиатура — рантайм пакета зовёт их через TBTemplate.
  "renderScale",
  "nextScaleIndex",
  "isSingleIndexChoice",
  "isMeasurementOnly",
  "questionHint",
  "answerTexts",
  "fitFont",
  "questionFont",
  "optionFont",
  "fitQuestionScene",
  "feedbackBanner",
  "feedbackDesc",
  // issue #34: выбор текста обратной связи по режиму — рантайм пакета зовёт его
  // через TBTemplate вместо трёх собственных копий правила.
  "feedbackTextFor",
] as const;

describe("runtime-entry public surface", () => {
  it("exposes every symbol both hosts rely on", () => {
    for (const name of REQUIRED) {
      expect(typeof (entry as Record<string, unknown>)[name]).not.toBe("undefined");
    }
  });
});
