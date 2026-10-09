import { describe, expect, it } from "vitest";
import { buildResultContext, type ResultInput } from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";

const INPUT: ResultInput = {
  passed: true,
  percent: 80,
  totalQuestions: 10,
  correct: 8,
  earnedPoints: 8,
  possiblePoints: 10,
  topicResults: [],
};

/** Показатель-профиль: единственное, что различает случаи, — его значение. */
function indicator(key: string, value: string | null) {
  return {
    key,
    name: key,
    value,
    visibility: "level" as const,
    interpretation: {
      domainMin: null,
      domainMax: null,
      valence: "none" as const,
      bands: [],
      outcomes: [
        {
          code: "cel+pro",
          label: "Двухвекторный",
          text: "Текст профиля",
          feedback: { text: "Совет профиля" },
        },
      ],
    },
  };
}

const measures = (indicators: ReturnType<typeof indicator>[]) => ({
  ramp: LEVEL_SCHEMES.neutral,
  scaleKind: "label" as const,
  indicatorKind: "label" as const,
  scales: [],
  indicators,
  blockSettings: { scoreSummary: "hide" as const },
});

describe("измерение без значения (PRD-53 FR-21)", () => {
  it("не печатает карточку", () => {
    const ctx = buildResultContext(INPUT, "Тест", {
      measures: measures([indicator("profile", "cel+pro"), indicator("added_later", null)]),
    });
    expect(ctx.result.indicators?.map((card) => card.key)).toEqual(["profile"]);
  });

  it("рекомендации ищутся тем же сопоставлением, что и карточка", () => {
    // Порядок ключей в наборе ОБРАТНЫЙ коду исхода: собственное сравнение в `firedFeedback`
    // такой набор не находило, и совет к найденному профилю пропадал.
    const ctx = buildResultContext(INPUT, "Тест", {
      measures: measures([indicator("profile", "pro+cel")]),
    });
    expect(ctx.result.indicators?.[0].levelLabel).toBe("Двухвекторный");
    expect(JSON.stringify(ctx.result.recommendations ?? {})).toContain("Совет профиля");
  });
});
