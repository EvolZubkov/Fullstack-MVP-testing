/**
 * @module shared/template/__tests__/result-context-bar-fill
 *
 * Окраска полос подтем в контексте итогов и отчёта (параметр `breakdownBarFill`).
 *
 * Проверяется то, что видит МАКЕТ: у строки разреза есть готовая заливка `barFill` ровно в
 * режиме «по доле», вердикт-класс снят в режимах «по доле» и «нейтральная», а без настройки
 * строка байт в байт прежняя. Отчёт строится тем же построителем, поэтому проверяется и он:
 * документ обязан красить полосы так же, как экран, с которого его скачали.
 */
import { describe, expect, it } from "vitest";
import { buildAdaptiveResultContext, buildResultContext } from "../result-context";
import { buildReportContext } from "../../report/report-context";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { BarFillSetting } from "../bar-fill";

const entry = {
  scope: "section:law", axis: "tag", key: "ПДн", items: 4, answered: 4, earned: 3, possible: 4,
  unitEarned: 3, unitPossible: 4, percentPoints: 75, percentUnits: 75, passed: true,
};
const topic = {
  topicName: "Право", correct: 3, total: 4, percent: 75, earnedPoints: 3, possiblePoints: 4,
  passed: true, breakdown: [entry],
};
const result = {
  passed: true, percent: 75, totalQuestions: 4, correct: 3, earnedPoints: 3, possiblePoints: 4,
  topicResults: [topic], breakdowns: [entry],
};
const display = { visibility: "bar_and_value", basis: "units", placement: "both" } as const;
const SHARE: BarFillSetting = { mode: "share", ramp: LEVEL_SCHEMES.traffic };

/** Строка разреза в карточке темы. */
function nestedRow(ctx: ReturnType<typeof buildResultContext>): Record<string, unknown> {
  return (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown[0];
}

describe("окраска полос подтем", () => {
  it("без настройки строка прежняя: класс вердикта, заливки нет", () => {
    const row = nestedRow(buildResultContext(result as never, "Тест", { breakdownDisplay: display } as never));
    expect(row.passClass).toBe("is-pass");
    expect(row).not.toHaveProperty("barFill");
  });

  it("«по доле»: готовая заливка, вердикт снят с полосы, исход остался", () => {
    const row = nestedRow(
      buildResultContext(result as never, "Тест", { breakdownDisplay: display, barFill: SHARE } as never),
    );
    expect(row.passClass).toBe("");
    expect(row.passed).toBe(true);
    expect(String(row.barFill)).toMatch(/^linear-gradient\(90deg, rgb\(239, \d+, \d+\) 0%, .* 100%\)$/);
  });

  it("«нейтральная»: ни вердикта, ни заливки", () => {
    const row = nestedRow(
      buildResultContext(result as never, "Тест", {
        breakdownDisplay: display,
        barFill: { mode: "neutral", ramp: LEVEL_SCHEMES.traffic },
      } as never),
    );
    expect(row.passClass).toBe("");
    expect(row).not.toHaveProperty("barFill");
  });

  it("сводный блок теста красится тем же правилом, в обоих режимах выдачи", () => {
    const std = buildResultContext(result as never, "Тест", { breakdownDisplay: display, barFill: SHARE } as never);
    expect(std.result.breakdown![0].barFill).toBeTruthy();
    const adaptive = buildAdaptiveResultContext(
      { passed: true, topicResults: [], breakdowns: [entry] } as never,
      "Тест",
      { breakdownDisplay: display, barFill: SHARE } as never,
    );
    expect(adaptive.result.breakdown![0].barFill).toBe(std.result.breakdown![0].barFill);
  });

  it("отчёт повторяет заливку экрана", () => {
    const screen = nestedRow(
      buildResultContext(result as never, "Тест", { breakdownDisplay: display, barFill: SHARE } as never),
    );
    const report = buildReportContext({
      testName: "Тест",
      breakdownDisplay: display,
      barFill: SHARE,
      result,
    } as never);
    expect(nestedRow(report as never).barFill).toBe(screen.barFill);
  });
});
