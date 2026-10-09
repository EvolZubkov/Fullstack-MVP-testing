/**
 * @module server/services/analytics/__tests__/scale-profile
 * @description PRD-56 FR-21, FR-21a, FR-21b: профиль по шкалам измерительного теста.
 */
import { describe, it, expect } from "vitest";

import { LEVEL_SCHEMES, zoneColors } from "@shared/template/level-ramp";
import { summariseScales } from "../scale-profile";

/** Шкала с тремя полосами толкования: «выше — хуже», как у выгорания. */
const BURNOUT = {
  key: "burnout",
  label: "Эмоциональное истощение",
  configJson: {
    domainMin: 0,
    domainMax: 54,
    valence: "lower_is_better",
    bands: [
      { min: 0, max: 17, level: "low", label: "Низкий" },
      { min: 18, max: 29, level: "mid", label: "Средний" },
      { min: 30, max: 54, level: "high", label: "Высокий" },
    ],
  },
};

/** Шкала без полос: уровня у неё нет вовсе (FR-21b). */
const RAW = { key: "raw", label: "Редукция достижений", configJson: { domainMin: 0, domainMax: 40 } };

const values = (...list: Array<Record<string, number>>) =>
  list.map((values, i) => ({ attemptId: `a${i}`, source: "web" as const, values }));

describe("summariseScales — средние (FR-21)", () => {
  it("считает среднее и объём выборки по каждой шкале", () => {
    const [profile] = summariseScales(
      values({ burnout: 10 }, { burnout: 20 }, { burnout: 30 }),
      [BURNOUT],
      { ramp: LEVEL_SCHEMES.traffic },
    );

    expect(profile).toMatchObject({ key: "burnout", average: 20, sampleSize: 3, domainMax: 54 });
  });

  it("прохождение без значения шкалы в знаменатель не идёт", () => {
    // Иначе среднее занижается ровно на число тех, кто до этих вопросов не дошёл.
    const [profile] = summariseScales(
      values({ burnout: 20 }, { other: 5 }),
      [BURNOUT],
      { ramp: LEVEL_SCHEMES.traffic },
    );

    expect(profile).toMatchObject({ average: 20, sampleSize: 1 });
  });

  it("шкала, которую никто не заполнил, среднего не выдумывает", () => {
    const [profile] = summariseScales([], [BURNOUT], { ramp: LEVEL_SCHEMES.traffic });

    expect(profile).toMatchObject({ average: null, sampleSize: 0, bands: [] });
  });
});

describe("summariseScales — распределение уровней (FR-21a)", () => {
  it("уровень считается по полосам самой шкалы, а не берётся из записи", () => {
    // Импорт выгрузки подписи уровня не хранит вовсе: считать его по-разному для двух
    // источников значило бы получить два распределения на одних данных.
    const [profile] = summariseScales(
      values({ burnout: 5 }, { burnout: 25 }, { burnout: 40 }, { burnout: 45 }),
      [BURNOUT],
      { ramp: LEVEL_SCHEMES.traffic },
    );

    expect(profile.bands.map(b => [b.label, b.count, Math.round(b.share)])).toEqual([
      ["Низкий", 1, 25],
      ["Средний", 1, 25],
      ["Высокий", 2, 50],
    ]);
  });

  it("цвет полосы берётся из рампы теста с учётом валентности", () => {
    // У шкалы «выше — хуже» верхняя полоса обязана быть тревожной, а не благополучной:
    // иначе «высокий» покрасится одинаково у шкалы, где выше лучше, и у той, где хуже.
    const [profile] = summariseScales(
      values({ burnout: 5 }),
      [BURNOUT],
      { ramp: LEVEL_SCHEMES.traffic },
    );

    // Цвет отдаётся ГОТОВЫМ CSS-значением: экран его только печатает.
    expect(profile.bands.map(b => b.color))
      .toEqual(zoneColors(LEVEL_SCHEMES.traffic, 3, "lower_is_better").map(t => `hsl(${t})`));
  });

  it("levels of a scale without direction take the categorical palette of the approved wireframe", () => {
    // approved/slice-compare-answers.html: «Низкий / Средний / Высокий» of a ЧИЛ scale are
    // digital, bti, business — not a grey ramp, which made the levels indistinguishable.
    const typology = { ...BURNOUT, configJson: { ...BURNOUT.configJson, valence: undefined } };

    const [profile] = summariseScales(values({ burnout: 5 }), [typology], { ramp: LEVEL_SCHEMES.traffic });

    expect(profile.bands.map(b => b.color)).toEqual([
      "var(--ou-cat-digital)", "var(--ou-cat-bti)", "var(--ou-cat-business)",
    ]);
  });

  it("авторский тон уровня перебивает рампу", () => {
    // Тон задан автором в самой шкале: он и печатается участнику в итогах.
    const authored = {
      ...BURNOUT,
      configJson: {
        ...BURNOUT.configJson,
        bands: BURNOUT.configJson.bands.map((band, i) => ({
          ...band,
          tone: i === 2 ? "critical" : undefined,
        })),
      },
    };

    const [profile] = summariseScales(
      values({ burnout: 40 }),
      [authored],
      { ramp: LEVEL_SCHEMES.traffic },
    );

    expect(profile.bands[2].tone).toBe("critical");
    expect(profile.bands[0].tone).toBeNull();
  });
});

describe("summariseScales — шкала без полос (FR-21b)", () => {
  it("даёт среднее, но распределения не строит", () => {
    const [profile] = summariseScales(
      values({ raw: 10 }, { raw: 20 }),
      [RAW],
      { ramp: LEVEL_SCHEMES.traffic },
    );

    expect(profile).toMatchObject({ key: "raw", average: 15, sampleSize: 2, bands: [] });
    expect(profile.hasBands).toBe(false);
  });
});
