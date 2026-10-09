/**
 * @module shared/template/__tests__/result-context-interpretation
 * @description Толкование темы и подтемы в контексте выдачи.
 *
 * Проверяются ПРАВИЛА, а не вёрстка: толкование печатается при любом вердикте, текст теста
 * заменяет текст темы, в сводный блок «Рекомендации» оно не попадает, а толкования подтем
 * печатаются только при включённом показе.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";
import type { CtxTopicResultView } from "../context";

const DISPLAY_BARS = { visibility: "bar_and_value" as const, basis: "points" as const };

/** Одна тема с подтемой: минимум, на котором видно оба уровня толкования. */
function input(topic: Record<string, unknown>) {
  return {
    passed: false,
    percent: 50,
    totalQuestions: 4,
    correct: 2,
    earnedPoints: 2,
    possiblePoints: 4,
    topicResults: [
      {
        topicId: "t1",
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
        ...topic,
      },
    ],
  };
}

const firstTopic = (ctx: { result: { topicResults?: unknown[] } }) =>
  ctx.result.topicResults?.[0] as CtxTopicResultView;

describe("толкование темы", () => {
  it("печатается у НЕ взятой темы", () => {
    const ctx = buildResultContext(
      input({ interpretation: { format: "plain", text: "Формирует эффективную команду" } }),
      "Тест",
    );
    expect(firstTopic(ctx).interpretationHtml).toContain("Формирует эффективную команду");
  });

  it("печатается и у ВЗЯТОЙ темы — вердикт на толкование не влияет", () => {
    const ctx = buildResultContext(
      input({ passed: true, interpretation: { text: "Формирует эффективную команду" } }),
      "Тест",
    );
    expect(firstTopic(ctx).interpretationHtml).toContain("Формирует эффективную команду");
  });

  it("текст теста заменяет текст темы", () => {
    const ctx = buildResultContext(
      input({
        interpretation: { text: "Текст темы" },
        sectionInterpretation: { text: "Текст теста" },
      }),
      "Тест",
    );
    const html = firstTopic(ctx).interpretationHtml ?? "";
    expect(html).toContain("Текст теста");
    expect(html).not.toContain("Текст темы");
  });

  it("в сводный блок «Рекомендации» не попадает", () => {
    const ctx = buildResultContext(
      input({ interpretation: { text: "Толкование компетенции" } }),
      "Тест",
    );
    const texts = (ctx.result.recommendations?.texts ?? []) as string[];
    expect(texts.join(" ")).not.toContain("Толкование компетенции");
  });

  it("без текста поля нет вовсе: пустая строка печатала бы пустой блок", () => {
    const ctx = buildResultContext(input({}), "Тест");
    expect(firstTopic(ctx).interpretationHtml).toBeUndefined();
  });
});

describe("толкование подтемы", () => {
  const texts = { "Стратегия компании": { format: "plain" as const, text: "Понимание целей до 2030" } };

  it("печатается под своей полосой, когда показ включён", () => {
    const ctx = buildResultContext(input({ breakdownInterpretation: texts }), "Тест", {
      breakdownDisplay: { ...DISPLAY_BARS, showInterpretation: true },
    });
    expect(firstTopic(ctx).breakdown?.[0]?.interpretationHtml).toContain("Понимание целей до 2030");
  });

  it("по умолчанию скрыто: настройка решает, а не наличие текста", () => {
    const ctx = buildResultContext(input({ breakdownInterpretation: texts }), "Тест", {
      breakdownDisplay: DISPLAY_BARS,
    });
    expect(firstTopic(ctx).breakdown?.[0]?.interpretationHtml).toBeUndefined();
  });

  it("признак раскладки поднимается, когда хоть одна полоса несёт текст", () => {
    // Модификатор стоит на ВСЕЙ сетке разрезов, поэтому ответ нужен на уровне темы:
    // включённое толкование разворачивает три колонки в список, и построчно этого не решить.
    const ctx = buildResultContext(input({ breakdownInterpretation: texts }), "Тест", {
      breakdownDisplay: { ...DISPLAY_BARS, showInterpretation: true },
    });
    expect(firstTopic(ctx).hasBreakdownNotes).toBe(true);
  });

  it("без текстов признака нет: сетка остаётся сеткой", () => {
    const ctx = buildResultContext(input({ breakdownInterpretation: texts }), "Тест", {
      breakdownDisplay: DISPLAY_BARS,
    });
    expect(firstTopic(ctx).hasBreakdownNotes).toBeUndefined();
  });

  it("подтема без своего текста остаётся без поля", () => {
    const ctx = buildResultContext(
      input({ breakdownInterpretation: { "Другая подтема": { text: "Не про эту" } } }),
      "Тест",
      { breakdownDisplay: { ...DISPLAY_BARS, showInterpretation: true } },
    );
    expect(firstTopic(ctx).breakdown?.[0]?.interpretationHtml).toBeUndefined();
  });
});

describe("совместимость", () => {
  it("тест без толкований даёт карточку темы без новых полей", () => {
    const ctx = buildResultContext(input({}), "Тест", { breakdownDisplay: DISPLAY_BARS });
    const topic = firstTopic(ctx);
    expect(topic.interpretationHtml).toBeUndefined();
    expect(topic.breakdown?.[0]?.interpretationHtml).toBeUndefined();
    // Остальная строка разреза не поехала: значение и ключ на месте.
    expect(topic.breakdown?.[0]?.key).toBe("Стратегия компании");
    expect(topic.breakdown?.[0]?.valueLabel).toBe("50 %");
  });
});
