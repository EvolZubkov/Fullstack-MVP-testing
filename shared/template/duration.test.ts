/**
 * @module shared/template/duration.test
 *
 * Unit tests for the single duration formatter both hosts print time limits and
 * countdowns with.
 */

import { describe, it, expect } from "vitest";
import { formatMinutesHuman, formatCountdown } from "./duration";

describe("formatMinutesHuman", () => {
  it("prints minutes alone below an hour", () => {
    expect(formatMinutesHuman(45)).toBe("45 мин");
    expect(formatMinutesHuman(1)).toBe("1 мин");
    expect(formatMinutesHuman(59)).toBe("59 мин");
  });

  it("drops the zero part of a whole hour", () => {
    expect(formatMinutesHuman(60)).toBe("1 ч");
    expect(formatMinutesHuman(120)).toBe("2 ч");
  });

  it("prints hours and minutes together", () => {
    expect(formatMinutesHuman(90)).toBe("1 ч 30 мин");
    expect(formatMinutesHuman(150)).toBe("2 ч 30 мин");
    expect(formatMinutesHuman(1439)).toBe("23 ч 59 мин");
  });

  it("prints whole days as days alone", () => {
    expect(formatMinutesHuman(1440)).toBe("1 день");
    expect(formatMinutesHuman(2880)).toBe("2 дня");
    expect(formatMinutesHuman(10080)).toBe("7 дней");
    expect(formatMinutesHuman(20160)).toBe("14 дней");
  });

  it("declines the day word by the Russian rules", () => {
    expect(formatMinutesHuman(1440 * 5)).toBe("5 дней");
    expect(formatMinutesHuman(1440 * 11)).toBe("11 дней");
    expect(formatMinutesHuman(1440 * 21)).toBe("21 день");
    expect(formatMinutesHuman(1440 * 22)).toBe("22 дня");
  });

  it("appends the remainder of a day, skipping the empty part", () => {
    expect(formatMinutesHuman(1500)).toBe("1 день 1 ч");
    expect(formatMinutesHuman(1560)).toBe("1 день 2 ч");
    expect(formatMinutesHuman(1445)).toBe("1 день 5 мин");
    expect(formatMinutesHuman(1501)).toBe("1 день 1 ч 1 мин");
  });

  it("prints nothing when there is no limit to speak of", () => {
    expect(formatMinutesHuman(0)).toBe("");
    expect(formatMinutesHuman(-5)).toBe("");
    expect(formatMinutesHuman(null)).toBe("");
    expect(formatMinutesHuman(undefined)).toBe("");
    expect(formatMinutesHuman(Number.NaN)).toBe("");
  });

  it("rounds a fractional input down to whole minutes", () => {
    expect(formatMinutesHuman(45.7)).toBe("45 мин");
  });
});

describe("formatCountdown", () => {
  it("prints M:SS below an hour", () => {
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(2700)).toBe("45:00");
    expect(formatCountdown(3599)).toBe("59:59");
  });

  it("adds the hour part from an hour up", () => {
    expect(formatCountdown(3600)).toBe("1:00:00");
    expect(formatCountdown(9000)).toBe("2:30:00");
    expect(formatCountdown(86399)).toBe("23:59:59");
  });

  it("adds the day part from a day up", () => {
    expect(formatCountdown(86400)).toBe("1 д 0:00:00");
    expect(formatCountdown(90061)).toBe("1 д 1:01:01");
    expect(formatCountdown(1209600)).toBe("14 д 0:00:00");
  });

  it("clamps a spent countdown to zero", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-10)).toBe("0:00");
  });
});
