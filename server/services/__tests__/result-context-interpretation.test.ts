// @vitest-environment node
/**
 * @module server/services/__tests__/result-context-interpretation
 * @description Доставка толкований веб-хостом: экран итогов и вход отчёта.
 *
 * Проверяется, что адаптер ДОВОЗИТ три текста до общего построителя и что печатает их тот
 * же построитель одинаково на обоих выходах, — §5.2 PRD-51: документ не вправе показать
 * иное, чем экран, с которого его скачали. Само правило замены проверено там, где оно
 * живёт (`shared/interpretation/__tests__/resolve`), и здесь не дублируется.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext, buildReportInput, type MeasuresSource } from "../result-context";
import type { AttemptResult } from "@shared/schema";

/** Попытка с одной темой и одной подтемой: минимум, на котором видны оба уровня. */
const result = {
  overallPassed: false,
  overallPercent: 50,
  totalQuestions: 4,
  totalCorrect: 2,
  totalEarnedPoints: 2,
  totalPossiblePoints: 4,
  topicResults: [
    {
      topicId: "topic-1",
      topicName: "Управляет потенциалом команды",
      correct: 2,
      total: 4,
      percent: 50,
      earnedPoints: 2,
      possiblePoints: 4,
      passed: false,
      breakdown: [
        {
          scope: "section:s1",
          axis: "tag",
          key: "Стратегия компании",
          items: 2,
          answered: 2,
          earned: 1,
          possible: 2,
          unitEarned: 1,
          unitPossible: 2,
          percentPoints: 50,
          percentUnits: 50,
        },
      ],
    },
  ],
} as unknown as AttemptResult;

/** Материал экрана в том виде, в каком его собирает маршрут итогов. */
function material(over: Partial<MeasuresSource> = {}): MeasuresSource {
  return {
    scales: [],
    variables: [],
    breakdownDisplayJson: { visibility: "bar_and_value", basis: "points", showInterpretation: true },
    ...over,
  } as MeasuresSource;
}

const topicView = (ctx: { result: { topicResults?: unknown[] } }) =>
  ctx.result.topicResults?.[0] as { interpretationHtml?: string; breakdown?: { interpretationHtml?: string }[] };

describe("веб-хост: доставка толкований", () => {
  it("довозит текст темы до карточки экрана", () => {
    const ctx = buildResultContext(result, "Тест", material({
      interpretationsByTopic: { "topic-1": { topic: { format: "plain", text: "Формирует команду" } } },
    }));
    expect(topicView(ctx).interpretationHtml).toContain("Формирует команду");
  });

  it("довозит переопределение теста — печатается оно, а не текст темы", () => {
    const ctx = buildResultContext(result, "Тест", material({
      interpretationsByTopic: {
        "topic-1": {
          topic: { format: "plain", text: "Текст темы" },
          section: { format: "plain", text: "Текст теста" },
        },
      },
    }));
    const html = topicView(ctx).interpretationHtml ?? "";
    expect(html).toContain("Текст теста");
    expect(html).not.toContain("Текст темы");
  });

  it("довозит текст подтемы до её полосы", () => {
    const ctx = buildResultContext(result, "Тест", material({
      interpretationsByTopic: {
        "topic-1": { breakdown: { "Стратегия компании": { format: "plain", text: "Цели до 2030" } } },
      },
    }));
    expect(topicView(ctx).breakdown?.[0]?.interpretationHtml).toContain("Цели до 2030");
  });

  it("тот же материал уходит во вход ОТЧЁТА (PRD-51 §5.2)", () => {
    // Вход отчёта — не готовый контекст: печатные строки соберёт из него тот же общий
    // построитель, что и для экрана. Поэтому здесь проверяются исходные тексты: дойдут они
    // — документ не сможет показать иное, чем экран, с которого его скачали.
    const texts = {
      topic: { format: "plain" as const, text: "Формирует команду" },
      section: { format: "plain" as const, text: "Формирует команду в этом тесте" },
      breakdown: { "Стратегия компании": { format: "plain" as const, text: "Цели до 2030" } },
    };
    const input = buildReportInput(result, "Тест", {}, material({
      interpretationsByTopic: { "topic-1": texts },
    }));
    const topic = input.result.topicResults?.[0] as Record<string, unknown>;
    expect(topic.interpretation).toEqual(texts.topic);
    expect(topic.sectionInterpretation).toEqual(texts.section);
    expect(topic.breakdownInterpretation).toEqual(texts.breakdown);
  });

  it("материал без толкований оставляет карточку прежней", () => {
    const ctx = buildResultContext(result, "Тест", material());
    expect(topicView(ctx).interpretationHtml).toBeUndefined();
    expect(topicView(ctx).breakdown?.[0]?.interpretationHtml).toBeUndefined();
  });
});
