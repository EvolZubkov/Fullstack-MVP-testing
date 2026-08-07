import { describe, expect, it } from "vitest";
import { CATEGORICAL_HUES, categoricalColor } from "../categorical-palette";
import { parseHsl } from "../level-ramp";

describe("categoricalColor", () => {
  it("отдаёт оттенки в объявленном порядке, а не по значению", () => {
    expect(categoricalColor(0)).toBe(CATEGORICAL_HUES[0]);
    expect(categoricalColor(2)).toBe(CATEGORICAL_HUES[2]);
  });

  it("не зацикливает ряд: за последним оттенком цвета нет", () => {
    expect(categoricalColor(CATEGORICAL_HUES.length)).toBeNull();
    expect(categoricalColor(-1)).toBeNull();
  });

  it("хранит цвета тройками HSL, как того требует контракт дизайн-параметров", () => {
    for (const triple of CATEGORICAL_HUES) {
      expect(parseHsl(triple)).not.toBeNull();
      expect(triple).not.toMatch(/hsl|#/);
    }
  });

  it("покрывает предел числа секторов розы", () => {
    expect(CATEGORICAL_HUES).toHaveLength(6);
  });
});
