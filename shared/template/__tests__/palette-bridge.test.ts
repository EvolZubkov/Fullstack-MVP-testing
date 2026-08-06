/**
 * @module shared/template/__tests__/palette-bridge
 * @description Мост выводит акцентную рампу DS из одного --primary теста (теми же
 * долями color-mix, что и ui-kit) и поверхности из --background/--card. Проверяем
 * СТРУКТУРУ вывода: какие переменные объявлены и что источник — токены/color-mix,
 * без цветовых литералов-значений.
 */
import { describe, it, expect } from "vitest";
import { buildPaletteBridge } from "../palette-bridge";

describe("buildPaletteBridge", () => {
  it("declares the full DS purple ramp anchored on the test primary", () => {
    const css = buildPaletteBridge({ primary: "217 91% 42%" });
    // Якорь 500 = primary теста.
    expect(css).toContain("--ou-purple-500:hsl(var(--primary))");
    // Крайние шаги выведены color-mix от того же якоря.
    expect(css).toContain("--ou-purple-50:color-mix(in oklch, #fff 92%, hsl(var(--primary)))");
    expect(css).toContain("--ou-purple-900:color-mix(in oklch, #000 68%, hsl(var(--primary)))");
    // Ровно десять шагов рампы.
    expect(css.match(/--ou-purple-\d+:/g)).toHaveLength(10);
    // Объявляется на .ou, не на :root.
    expect(css.startsWith(".ou{")).toBe(true);
  });

  it("maps surfaces and border when the test overrides them", () => {
    const css = buildPaletteBridge({ background: "225 7% 7%", card: "225 14% 14%", border: "0 0% 22%" });
    expect(css).toContain("--ou-bg-page:hsl(var(--background))");
    expect(css).toContain("--ou-bg-elevated:hsl(var(--card))");
    expect(css).toContain("--ou-border-soft:hsl(var(--border))");
  });

  it("is empty when the test declares no palette", () => {
    expect(buildPaletteBridge({})).toBe("");
  });

  it("emits no colour VALUE literals (#hex / rgb / numeric hsl) — only tokens and mix anchors", () => {
    const css = buildPaletteBridge({ primary: "217 91% 42%", background: "225 7% 7%" });
    // #fff/#000 внутри color-mix — опоры микса, не цвет-значения; их отсеиваем,
    // затем убеждаемся, что не осталось #rrggbb / rgb() / hsl( с числом.
    const withoutMixAnchors = css.replace(/#fff|#000/g, "");
    expect(withoutMixAnchors).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]|hsla?\(\s*[\d.]/);
  });
});
