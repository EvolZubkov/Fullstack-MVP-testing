// shared/template/__tests__/level-ramp.test.ts
import { describe, it, expect } from "vitest";
import { LEVEL_SCHEMES, parseHsl, rampColor, zoneColors } from "../level-ramp";

const TRAFFIC = LEVEL_SCHEMES.traffic;

describe("parseHsl", () => {
  it("разбирает тройку из параметров дизайна", () => {
    expect(parseHsl("142 76% 36%")).toEqual({ h: 142, s: 76, l: 36 });
  });

  it("возвращает null на мусоре", () => {
    expect(parseHsl("")).toBeNull();
    expect(parseHsl("#22c55e")).toBeNull();
  });
});

describe("rampColor", () => {
  it("на краях отдаёт опорные цвета без изменений", () => {
    expect(rampColor(TRAFFIC, 0)).toBe(TRAFFIC.unfavorable);
    expect(rampColor(TRAFFIC, 1)).toBe(TRAFFIC.favorable);
  });

  it("в середине отдаёт средний опорный цвет", () => {
    expect(rampColor(TRAFFIC, 0.5)).toBe(TRAFFIC.mid);
  });

  it("идёт по короткой дуге тона: между красным и жёлтым нет зелёного", () => {
    const parsed = parseHsl(rampColor(TRAFFIC, 0.25))!;
    expect(parsed.h).toBeGreaterThan(0);
    expect(parsed.h).toBeLessThan(38);
  });

  it("без середины интерполирует напрямую", () => {
    const ramp = { favorable: "0 0% 100%", mid: null, unfavorable: "0 0% 0%" };
    expect(parseHsl(rampColor(ramp, 0.5))!.l).toBe(50);
  });

  it("зажимает позицию в границах", () => {
    expect(rampColor(TRAFFIC, -1)).toBe(TRAFFIC.unfavorable);
    expect(rampColor(TRAFFIC, 2)).toBe(TRAFFIC.favorable);
  });
});

describe("zoneColors", () => {
  it("при higher_is_better благоприятный цвет у последней зоны", () => {
    const colors = zoneColors(TRAFFIC, 3, "higher_is_better");
    expect(colors[0]).toBe(TRAFFIC.unfavorable);
    expect(colors[2]).toBe(TRAFFIC.favorable);
  });

  it("при lower_is_better порядок обратный", () => {
    const colors = zoneColors(TRAFFIC, 3, "lower_is_better");
    expect(colors[0]).toBe(TRAFFIC.favorable);
    expect(colors[2]).toBe(TRAFFIC.unfavorable);
  });

  it("при none использует нейтральную рампу независимо от схемы", () => {
    const colors = zoneColors(TRAFFIC, 3, "none");
    expect(colors[0]).toBe(LEVEL_SCHEMES.neutral.unfavorable);
    expect(colors[2]).toBe(LEVEL_SCHEMES.neutral.favorable);
  });

  it("выдаёт ровно N цветов при любом N", () => {
    expect(zoneColors(TRAFFIC, 2, "higher_is_better")).toHaveLength(2);
    expect(zoneColors(TRAFFIC, 7, "higher_is_better")).toHaveLength(7);
  });

  it("единственную зону красит серединой рампы", () => {
    expect(zoneColors(TRAFFIC, 1, "higher_is_better")).toEqual([TRAFFIC.mid]);
  });

  it("на нуле зон отдаёт пустой список", () => {
    expect(zoneColors(TRAFFIC, 0, "higher_is_better")).toEqual([]);
  });
});
