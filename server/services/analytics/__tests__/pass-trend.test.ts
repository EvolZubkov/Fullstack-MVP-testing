/**
 * @module server/services/analytics/__tests__/pass-trend
 * @description PRD-56 FR-13: динамика сдаваемости по месяцам.
 *
 * По дням тренд теста не читается: в большинстве инсталляций прохождения идут волнами по
 * назначениям, и дневная линия — это частокол из единиц и нулей, по которому нельзя сказать
 * ничего. Месяц — та единица, в которой об обучении и говорят («после мартовской правки стали
 * сдавать хуже»).
 *
 * Месяц без прохождений в линии не рисуется вовсе: ноль сдавших там, где никто не проходил,
 * читается как провал, которого не было.
 */

import { describe, expect, it } from "vitest";

import { passTrendByMonth, type TrendObservation } from "../pass-trend";

function observation(over: Partial<TrendObservation> = {}): TrendObservation {
  return {
    startedAt: new Date("2026-09-11T14:00:00Z"),
    passed: true,
    outcome: "passed",
    ...over,
  };
}

describe("passTrendByMonth", () => {
  it("собирает месяцы в порядке времени и называет их по-человечески", () => {
    const trend = passTrendByMonth([
      observation({ startedAt: new Date("2026-08-03T10:00:00Z") }),
      observation({ startedAt: new Date("2026-09-11T10:00:00Z") }),
    ]);

    expect(trend.map(point => point.key)).toEqual(["2026-08", "2026-09"]);
    expect(trend[0].label).toBe("август 2026");
  });

  it("считает долю сдавших внутри месяца", () => {
    const trend = passTrendByMonth([
      observation({ passed: true, outcome: "passed" }),
      observation({ passed: true, outcome: "passed" }),
      observation({ passed: false, outcome: "failed" }),
      observation({ passed: false, outcome: "failed" }),
    ]);

    expect(trend[0]).toMatchObject({ attempts: 4, passRate: 50 });
  });

  it("не берёт в знаменатель прохождения без вердикта", () => {
    // Опросник ничего не оценивает, брошенная попытка не дошла до оценки: считать их
    // «не сдавшими» значит занижать сдаваемость теста ровно на их число.
    const trend = passTrendByMonth([
      observation({ passed: true, outcome: "passed" }),
      observation({ passed: null, outcome: "completed" }),
      observation({ passed: null, outcome: "incomplete" }),
    ]);

    expect(trend[0]).toMatchObject({ attempts: 3, judged: 1, passRate: 100 });
  });

  it("говорит «неприменимо», когда в месяце судить было нечего", () => {
    // Ноль процентов здесь означал бы «все провалились», а вердикта не выносили никому.
    const trend = passTrendByMonth([observation({ passed: null, outcome: "completed" })]);

    expect(trend[0].passRate).toBeNull();
  });

  it("не выдумывает месяцев, в которых ничего не было", () => {
    const trend = passTrendByMonth([
      observation({ startedAt: new Date("2026-07-03T10:00:00Z") }),
      observation({ startedAt: new Date("2026-09-03T10:00:00Z") }),
    ]);

    expect(trend.map(point => point.key)).toEqual(["2026-07", "2026-09"]);
  });

  it("ничего не выдумывает на пустой выборке", () => {
    expect(passTrendByMonth([])).toEqual([]);
  });
});
