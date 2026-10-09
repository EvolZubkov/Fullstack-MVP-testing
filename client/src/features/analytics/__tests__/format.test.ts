/**
 * @module features/analytics/__tests__/format
 * @description Единый формат процентов аналитики (этап Э1 UX-аудита).
 */
import { describe, expect, it } from "vitest";

import { NBSP, percent, percentNumber, percentOfShare } from "../format";

describe("percent", () => {
  it("печатает целое с неразрывным пробелом", () => {
    expect(percent(61.6)).toBe(`62${NBSP}%`);
    expect(percent(0)).toBe(`0${NBSP}%`);
  });

  it("на отсутствующей величине — прочерк, а не «0 %»", () => {
    expect(percent(null)).toBe("—");
    expect(percent(undefined)).toBe("—");
    expect(percent(Number.NaN)).toBe("—");
  });

  it("десятую печатает только в точном формате и только когда она есть", () => {
    expect(percent(65.84, { precise: true })).toBe(`65,8${NBSP}%`);
    expect(percent(70, { precise: true })).toBe(`70${NBSP}%`);
    expect(percent(69.96, { precise: true })).toBe(`70${NBSP}%`);
  });
});

describe("percentOfShare", () => {
  it("переводит долю в проценты", () => {
    expect(percentOfShare(0.62)).toBe(`62${NBSP}%`);
    expect(percentOfShare(null)).toBe("—");
  });
});

describe("percentNumber", () => {
  it("отдаёт число без знака — для диапазонов", () => {
    expect(`${percentNumber(65.8, { precise: true })} — ${percentNumber(74.2, { precise: true })}`)
      .toBe("65,8 — 74,2");
  });
});
