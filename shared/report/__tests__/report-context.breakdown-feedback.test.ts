/**
 * @module shared/report/__tests__/report-context.breakdown-feedback
 *
 * PRD-50 FR-55 в ОТЧЁТЕ: текст подтемы получает тот, чей результат по ней НИЖЕ ПОРОГА ЕЁ
 * ТЕМЫ, — при любом вердикте теста и темы; в теме без порога текстов подтем нет.
 *
 * Правило одно на все выдачи (`shared/breakdown/feedback`), поэтому экран итогов, PDF и
 * SCORM-пакет разойтись не могут — расхождение двух выдач запрещено PRD-51 §5.2. Отсюда и
 * гард именно здесь: сборщик отчёта однажды не передавал вердикт в общий построитель, и
 * скачанный PDF печатал пять рекомендаций там, где экран печатал две.
 *
 * ВЕРДИКТ ПОДТЕМЫ ПРИХОДИТ ГОТОВЫМ. С §16 его проставляет `applyBreakdownGate` на этапе
 * сборки результата: `passed` = `true`/`false`, а при отсутствии порога — `null`. Отчёт
 * ничего не пересчитывает и сравнивать порог сам не пытается: он печатает сохранённое.
 * Прежняя редакция этого гарда сравнивала долю с ОБЩИМ порогом теста и потому кормила
 * построитель записями без `passed` — правило §16 такие записи молча пропускает.
 */
import { describe, it, expect } from "vitest";
import { buildReportContext } from "../report-context";

const feedback = (text: string) => ({ format: "plain" as const, text, links: [], assets: [], events: [] });

/**
 * Одна тема: подтема «Разобрана» на 100 % и подтема «Провалена» на 40 %.
 * `passed` проставлен так, как его проставил бы гейт по порогу темы.
 */
const resultWith = (passedOfFailing: boolean | null, passedOfPassing: boolean | null) => ({
  overallPassed: true,
  overallPercent: 70,
  totalQuestions: 4,
  totalCorrect: 3,
  totalEarnedPoints: 7,
  totalPossiblePoints: 10,
  topicResults: [
    {
      topicId: "t1",
      topicName: "Часть 1",
      correct: 3,
      total: 4,
      percent: 70,
      passed: true,
      earnedPoints: 7,
      possiblePoints: 10,
      breakdown: [
        { scope: "section:t1", axis: "tag", key: "Разобрана", items: 2, answered: 2, earned: 5, possible: 5, unitEarned: 2, unitPossible: 2, percentPoints: 100, percentUnits: 100, passed: passedOfPassing },
        { scope: "section:t1", axis: "tag", key: "Провалена", items: 2, answered: 2, earned: 2, possible: 5, unitEarned: 1, unitPossible: 2, percentPoints: 40, percentUnits: 50, passed: passedOfFailing },
      ],
      breakdownFeedback: {
        Разобрана: feedback("Подтема освоена — читать нечего."),
        Провалена: feedback("Подтема просела — вот что делать."),
      },
    },
  ],
});

/** Тексты рекомендаций документа отчёта. */
function textsOf(result: unknown): string[] {
  const ctx = buildReportContext({ result, testName: "Тест" } as never, { values: {} } as never);
  return (ctx.result as { recommendations?: { texts: string[] } }).recommendations?.texts ?? [];
}

describe("тексты подтем в отчёте (PRD-50 FR-55)", () => {
  it("печатает текст просевшей подтемы и молчит о пройденной", () => {
    const texts = textsOf(resultWith(false, true));
    expect(texts, "текст просевшей подтемы обязан быть в документе").toContain(
      "Подтема просела — вот что делать.",
    );
    expect(texts, "подтема со 100 % не должна приносить рекомендацию").not.toContain(
      "Подтема освоена — читать нечего.",
    );
  });

  it("в теме без порога текстов подтем нет — вердикта не выносилось", () => {
    // `passed: null` — ровно то, что проставляет гейт, когда порога у темы нет.
    expect(textsOf(resultWith(null, null))).toHaveLength(0);
  });
});
