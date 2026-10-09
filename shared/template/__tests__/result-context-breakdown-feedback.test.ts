/**
 * @module shared/template/__tests__/result-context-breakdown-feedback.test
 * @description PRD-50 FR-55: текст подтемы доходит до блока «Рекомендации» по ИСХОДУ записи —
 * подтема не взята по порогу своей темы, при ЛЮБОМ вердикте теста и темы.
 *
 * Проверяется здесь, у общего построителя: он один на веб-хост и на рантайм пакета, и
 * если тексты собираются тут, то и экран, и пакет печатают одно и то же.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const entry = (key: string, passed: boolean | null) => ({
  scope: "section:law",
  axis: "tag",
  key,
  items: 2,
  answered: 2,
  earned: 1,
  possible: 2,
  unitEarned: 1,
  unitPossible: 2,
  percentPoints: 45,
  percentUnits: 45,
  passed,
  thresholdPercent: passed === null ? null : 70,
});

const TEXTS = {
  pd: { text: "Повторите тему персональных данных" },
  kt: { text: "Освежите правила коммерческой тайны" },
};

function resultWith(passed: boolean, topicPassed: boolean | null, keyPassed: boolean | null = false) {
  return {
    passed,
    percent: 80,
    totalQuestions: 4,
    correct: 3,
    earnedPoints: 8,
    possiblePoints: 10,
    topicResults: [
      {
        topicId: "law",
        topicName: "Право",
        correct: 3,
        total: 4,
        percent: 80,
        earnedPoints: 8,
        possiblePoints: 10,
        passed: topicPassed,
        breakdown: [entry("pd", keyPassed), entry("kt", true)],
        breakdownFeedback: TEXTS,
      },
    ],
  };
}

const texts = (ctx: ReturnType<typeof buildResultContext>) =>
  ctx.result.recommendations?.texts ?? [];

describe("тексты подтем в блоке рекомендаций (FR-55)", () => {
  it("непройденная подтема говорит, пройденная молчит", () => {
    const ctx = buildResultContext(resultWith(true, true) as never, "Тест", {
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toEqual([TEXTS.pd.text]);
  });

  it("сданный тест и пройденная тема текст НЕ гасят: правило про подтему", () => {
    // Обратную связь ТЕМЫ пройденная тема гасит — это соседнее правило и оно осталось.
    // Текст подтемы обязан выйти именно в этом случае: человек сдал, но в одном срезе
    // провалился.
    const ctx = buildResultContext(resultWith(true, true) as never, "Тест", {
      hasPassThreshold: true,
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toContain(TEXTS.pd.text);
  });

  it("запись без исхода молчит: порога не было (FR-57)", () => {
    const ctx = buildResultContext(resultWith(false, null, null) as never, "Тест", {} as never);
    expect(texts(ctx)).toEqual([]);
  });

  it("тест без текстов подтем оставляет блок прежним", () => {
    const bare = resultWith(false, false);
    delete (bare.topicResults[0] as { breakdownFeedback?: unknown }).breakdownFeedback;
    const ctx = buildResultContext(bare as never, "Тест", {
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toEqual([]);
  });

  it("текст, повторяющий обратную связь теста, печатается один раз", () => {
    const ctx = buildResultContext(resultWith(false, false) as never, "Тест", {
      testFeedback: { text: TEXTS.pd.text },
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toEqual([TEXTS.pd.text]);
  });
});
