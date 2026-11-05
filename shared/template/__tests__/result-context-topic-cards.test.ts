/**
 * @module shared/template/__tests__/result-context-topic-cards
 * @description Переключатель «Показывать результаты по темам» (`tests.show_topic_results`):
 * гасит САМИ карточки тем на экране итогов обоих режимов и ничего больше — вердикт,
 * «Рекомендации» и сводный блок подытогов читают данные тем до переключателя.
 */
import { describe, it, expect } from "vitest";
import { buildAdaptiveResultContext, buildResultContext } from "../result-context";
import type { CtxResultBlock } from "../context";

const testRow = {
  scope: "test", axis: "tag", key: "ПДн", items: 4, answered: 3, earned: 3, possible: 4,
  unitEarned: 3, unitPossible: 4, percentPoints: 75, percentUnits: 75,
};

const result = {
  passed: false, percent: 50, totalQuestions: 4, correct: 2, earnedPoints: 2, possiblePoints: 4,
  topicResults: [
    { topicName: "Право", correct: 1, total: 2, percent: 50, earnedPoints: 1, possiblePoints: 2, passed: false },
    { topicName: "Кадры", correct: 1, total: 2, percent: 50, earnedPoints: 1, possiblePoints: 2, passed: true },
  ],
  breakdowns: [testRow],
};

const blockKeys = (blocks?: CtxResultBlock[]) => (blocks ?? []).map((b) => b.key);

describe("карточки тем: обычный экран итогов", () => {
  it("без переключателя и с `true` печатает карточки как всегда", () => {
    const absent = buildResultContext(result as never, "Тест");
    const on = buildResultContext(result as never, "Тест", { showTopicResults: true });
    expect(absent.result.topicResults).toHaveLength(2);
    expect(blockKeys(absent.result.blocks)).toContain("topics");
    expect(on).toEqual(absent);
  });

  it("`false` убирает карточки и подблок «topics», не трогая вердикт", () => {
    const ctx = buildResultContext(result as never, "Тест", { showTopicResults: false });
    expect(ctx.result.topicResults).toEqual([]);
    expect(blockKeys(ctx.result.blocks)).not.toContain("topics");
    expect(ctx.result.passed).toBe(false);
    expect(ctx.result.scorePercent).toBe(50);
  });

  it("`false` гасит и блоки разделов — иначе темы вышли бы мимо переключателя", () => {
    const grouped = { ...result, sectionGroups: [{ key: "g1", label: "Группа", sectionTopicIds: [] }] };
    const ctx = buildResultContext(grouped as never, "Тест", { showTopicResults: false });
    expect(ctx.result.topicGroups).toBeUndefined();
    expect(ctx.result.ungroupedTopics).toBeUndefined();
  });

  it("сводный блок подытогов остаётся, когда карточки выключены", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      showTopicResults: false,
      breakdownDisplay: { visibility: "bar", basis: "units", placement: "block" },
    });
    expect(ctx.result.topicResults).toEqual([]);
    expect(blockKeys(ctx.result.blocks)).toContain("breakdown");
    expect((ctx.result as { breakdown?: unknown[] }).breakdown).toHaveLength(1);
  });
});

describe("карточки тем: адаптивный экран итогов", () => {
  const adaptive = {
    passed: true,
    topicResults: [
      { topicName: "Право", achievedLevelIndex: 1, achievedLevelName: "Уверенный" },
      { topicName: "Кадры", achievedLevelIndex: null, achievedLevelName: null },
    ],
    breakdowns: [testRow],
  };

  it("по умолчанию печатает карточки уровней", () => {
    const ctx = buildAdaptiveResultContext(adaptive as never, "Тест");
    expect(ctx.result.topicResults).toHaveLength(2);
  });

  it("`false` убирает карточки, а сводный блок подытогов остаётся", () => {
    const ctx = buildAdaptiveResultContext(adaptive as never, "Тест", {
      showTopicResults: false,
      breakdownDisplay: { visibility: "bar", basis: "units", placement: "block" },
    });
    expect(ctx.result.topicResults).toEqual([]);
    expect(blockKeys(ctx.result.blocks)).not.toContain("topics");
    expect((ctx.result as { breakdown?: unknown[] }).breakdown).toHaveLength(1);
  });
});
