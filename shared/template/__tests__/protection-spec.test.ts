import { describe, it, expect } from "vitest";
import {
  buildProtectionSpec,
  formatWatermarkText,
  QUESTION_REGIONS,
} from "../protection/spec";

const ON = { copyProtection: true, watermark: false, hideOnBlur: false };
const STAMP = { id: "7f3ac2", at: new Date(2026, 7, 2, 14, 35) };

describe("buildProtectionSpec", () => {
  it("экран вопроса защищает поимённо перечисленные регионы", () => {
    const spec = buildProtectionSpec({ screen: "question", settings: ON, stamp: null });
    expect(spec.copy).toEqual({ selectors: [...QUESTION_REGIONS], wholeScene: false });
  });

  it("экран обзора защищает сцену целиком", () => {
    const spec = buildProtectionSpec({ screen: "review", settings: ON, stamp: null });
    expect(spec.copy).toEqual({ selectors: [], wholeScene: true });
  });

  it("экран итогов и итоги раздела от копирования не защищаются", () => {
    for (const screen of ["results", "section-results"] as const) {
      expect(buildProtectionSpec({ screen, settings: ON, stamp: null }).copy).toBeNull();
    }
  });

  it("незнакомый экран не защищается ничем", () => {
    const spec = buildProtectionSpec({ screen: "start", settings: ON, stamp: null });
    expect(spec.copy).toBeNull();
    expect(spec.hide).toBeNull();
    expect(spec.watermarkText).toBeNull();
  });

  it("выключенная настройка снимает защиту", () => {
    const settings = { ...ON, copyProtection: false };
    expect(buildProtectionSpec({ screen: "question", settings, stamp: null }).copy).toBeNull();
  });

  it("отладочный прогон снимает защиту и скрытие, но не знак", () => {
    const settings = { copyProtection: true, watermark: true, hideOnBlur: true };
    const spec = buildProtectionSpec({ screen: "question", settings, stamp: STAMP, active: false });
    expect(spec.copy).toBeNull();
    expect(spec.hide).toBeNull();
    expect(spec.watermarkText).toBe("ID 7f3ac2 · 02.08.2026 14:35");
  });

  it("скрытие при потере фокуса не зависит от защиты от копирования", () => {
    const settings = { copyProtection: false, watermark: false, hideOnBlur: true };
    const spec = buildProtectionSpec({ screen: "question", settings, stamp: null });
    expect(spec.copy).toBeNull();
    expect(spec.hide).toEqual({ selectors: [...QUESTION_REGIONS], wholeScene: false });
  });

  it("знак показывается на четырёх экранах, включая итоги теста", () => {
    const settings = { copyProtection: false, watermark: true, hideOnBlur: false };
    for (const screen of ["question", "review", "section-results", "results"] as const) {
      expect(buildProtectionSpec({ screen, settings, stamp: STAMP }).watermarkText).not.toBeNull();
    }
  });

  it("знак без идентификатора печатает только дату и время", () => {
    expect(formatWatermarkText({ id: "  ", at: new Date(2026, 7, 2, 9, 5) })).toBe("02.08.2026 09:05");
  });
});
