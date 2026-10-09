/**
 * @module shared/template/__tests__/bar-fill
 *
 * Окраска полос подтем: разрешение режима из параметров оформления и готовая заливка
 * «по доле».
 *
 * Главное свойство заливки — полоса шириной `p` показывает ЛЕВУЮ ЧАСТЬ градиента, растянутого
 * на всю дорожку: начинается неблагоприятным краем и кончается цветом в точке `p`. Переход —
 * прямой, в RGB, как у CSS-градиента прежнего отчёта (решение владельца 2026-09-24), а не по
 * дуге оттенка, как у зон уровней. Отсюда проверки концов и числа остановок.
 */
import { describe, expect, it } from "vitest";
import { barFillCss, barFillFromParams } from "../bar-fill";
import { LEVEL_SCHEMES, type LevelRamp } from "../level-ramp";

/** Брендовая пара «Сертификации» — схема «Своя» без середины. */
const BRAND: LevelRamp = { favorable: "163.9 79.2% 47.1%", mid: null, unfavorable: "15.4 100% 53.5%" };

/** Цветовые остановки заливки: `[цвет, позиция]`. */
function stops(css: string): Array<[string, number]> {
  const body = css.replace(/^linear-gradient\(90deg, /, "").replace(/\)$/, "");
  return body.split(/,\s*(?=rgb\()/).map((s) => {
    const m = /^(rgb\([^)]*\)) ([\d.]+)%$/.exec(s.trim());
    if (!m) throw new Error("неразборная остановка: " + s);
    return [m[1], Number(m[2])];
  });
}

describe("barFillFromParams", () => {
  it("режим «по вердикту» и отсутствие параметра дают null — контекст прежний", () => {
    expect(barFillFromParams({})).toBeNull();
    expect(barFillFromParams({ breakdownBarFill: "verdict" })).toBeNull();
    expect(barFillFromParams(null)).toBeNull();
  });

  it("неизвестное значение читается как «по вердикту», а не перекрашивает экран", () => {
    expect(barFillFromParams({ breakdownBarFill: "gradient" })).toBeNull();
  });

  it("«по доле» берёт рампу из схемы уровней теста", () => {
    expect(barFillFromParams({ breakdownBarFill: "share", levelScheme: "neutral" })).toEqual({
      mode: "share",
      ramp: LEVEL_SCHEMES.neutral,
    });
    expect(
      barFillFromParams({
        breakdownBarFill: "share",
        levelScheme: "custom",
        levelColorFavorable: BRAND.favorable,
        levelColorUnfavorable: BRAND.unfavorable,
      }),
    ).toEqual({ mode: "share", ramp: BRAND });
  });

  it("«нейтральная» тоже передаётся построителю: она снимает вердикт с полосы", () => {
    expect(barFillFromParams({ breakdownBarFill: "neutral" })?.mode).toBe("neutral");
  });
});

describe("barFillCss", () => {
  it("пустая полоса заливки не получает", () => {
    expect(barFillCss(BRAND, 0)).toBe("");
    expect(barFillCss(BRAND, -5)).toBe("");
    expect(barFillCss(BRAND, Number.NaN)).toBe("");
  });

  it("полная полоса — прямой переход между цветами референса отчёта, без промежуточных точек", () => {
    // #FF4F12 → #19D7A4: та же пара, что печатал report.css; ±1 на канал — округление тройки HSL.
    expect(stops(barFillCss(BRAND, 100))).toEqual([
      ["rgb(255, 79, 18)", 0],
      ["rgb(25, 215, 164)", 100],
    ]);
  });

  it("короткая полоса — левая часть того же градиента: конец — цвет прямой линии в точке доли", () => {
    // 25 % пути от (255, 79, 18) к (25, 215, 164) — ровно то, что браузер нарисовал бы на
    // четверти полного градиента. Жёлтого и зелёного, которые дала бы дуга оттенка, нет.
    expect(stops(barFillCss(BRAND, 25))).toEqual([
      ["rgb(255, 79, 18)", 0],
      ["rgb(197, 113, 54)", 100],
    ]);
  });

  it("середина схемы — единственный излом, и остановкой становится только за ней", () => {
    // Светофор: красный (0 84% 60%) → жёлтый (38 92% 50%) → зелёный (142 76% 36%).
    const full = stops(barFillCss(LEVEL_SCHEMES.traffic, 100));
    expect(full).toHaveLength(3);
    expect(full[1][1]).toBe(50);
    const beyond = stops(barFillCss(LEVEL_SCHEMES.traffic, 75));
    expect(beyond[1][1]).toBe(66.7);
    expect(stops(barFillCss(LEVEL_SCHEMES.traffic, 40))).toHaveLength(2);
  });

  it("испорченный цвет своей схемы не попадает в style: подставляется край светофора", () => {
    const css = barFillCss({ favorable: "red; background: url(x)", mid: "oops", unfavorable: BRAND.unfavorable }, 100);
    expect(css).not.toMatch(/url|red|oops/);
    expect(stops(css)).toEqual([
      ["rgb(255, 79, 18)", 0],
      ["rgb(22, 162, 73)", 100],
    ]);
  });
});