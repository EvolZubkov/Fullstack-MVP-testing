/**
 * @module tests/sim-variant
 * @description The flat view of one device (`shared/sim/variant`): the common part merged with a
 * variant under the field names of version 1, built once per scenario and device.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { playable, isPlayable } from "@shared/sim/variant";
import { asScenario } from "@shared/sim/upgrade";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));

describe("playable", () => {
  it("сводит общую часть и вариант desktop", () => {
    const play = playable(v1);
    const scenario = asScenario(v1);
    expect(play.device).toBe("desktop");
    expect(play.kind).toBe("control");
    expect(play.start).toBe(scenario.variants[0].start);
    expect(play.scenes).toBe(scenario.variants[0].scenes);
    expect(play.media).toBe(scenario.media);
    expect(play.goal).toEqual(scenario.goal);
    expect(play.settings.stage).toEqual(v1.settings?.stage);
    expect(play.routes).toEqual([]);
    expect(play.stages).toEqual([]);
  });

  it("строится один раз на сценарий и устройство", () => {
    expect(playable(v1)).toBe(playable(v1));
  });

  it("готовый вид возвращается как есть", () => {
    const play = playable(v1);
    expect(isPlayable(play)).toBe(true);
    expect(playable(play)).toBe(play);
    expect(isPlayable(v1)).toBe(false);
  });

  it("нет варианта для устройства — ошибка", () => {
    expect(() => playable(v1, "phone")).toThrow(/нет варианта/);
  });
});
