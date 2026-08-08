/**
 * @module server/__tests__/scale-icons
 *
 * PRD-46 §8. Имя пиктограммы превращается в контуры на ХОСТЕ: в пакете разрешать нечем — там
 * ни React, ни шрифта иконок, ни библиотеки. Веб делает это при отдаче контекста, упаковщик —
 * в бейке, но обе дороги идут через одну функцию, иначе одно имя означало бы два глифа.
 *
 * Отдельно сторожится ЗАМЕНА контуров: испечённая геометрия прошлой сборки не должна пережить
 * смену имени — старый глиф рядом с новым именем увидеть труднее всего.
 */
import { describe, expect, it } from "vitest";
import { iconContours, iconNames, withResolvedScaleIcons } from "../services/scale-icons";
import { SCALE_APPEARANCE_KEY } from "@shared/template/scale-appearance";

describe("iconContours", () => {
  it("отдаёт контуры известного глифа", () => {
    expect(iconContours("target")?.length).toBeGreaterThan(0);
  });

  it("незнакомое имя — null, а не пустой глиф", () => {
    expect(iconContours("нет-такого-глифа")).toBeNull();
  });

  it("набор непустой: без него ни один выбор автора не нарисуется", () => {
    expect(iconNames().length).toBeGreaterThan(1000);
  });
});

describe("withResolvedScaleIcons", () => {
  it("подставляет контуры к имени, оставляя имя на месте", () => {
    const out = withResolvedScaleIcons({
      scalesChartKind: "rose",
      [SCALE_APPEARANCE_KEY]: { s1: { icon: "target", color: "10 20% 30%" } },
    });
    const look = (out[SCALE_APPEARANCE_KEY] as Record<string, Record<string, unknown>>).s1;
    expect(look.icon).toBe("target");
    expect(look.color).toBe("10 20% 30%");
    expect((look.iconPaths as string[]).length).toBeGreaterThan(0);
  });

  it("незнакомое имя остаётся без контуров: выбор автора переживёт обновление набора", () => {
    const out = withResolvedScaleIcons({ [SCALE_APPEARANCE_KEY]: { s1: { icon: "нет-такого" } } });
    const look = (out[SCALE_APPEARANCE_KEY] as Record<string, Record<string, unknown>>).s1;
    expect(look.icon).toBe("нет-такого");
    expect(look.iconPaths).toBeUndefined();
  });

  it("контуры прошлой сборки не переживают смену имени", () => {
    const out = withResolvedScaleIcons({
      [SCALE_APPEARANCE_KEY]: { s1: { icon: "shield", iconPaths: ["M0 0"] } },
    });
    const look = (out[SCALE_APPEARANCE_KEY] as Record<string, Record<string, unknown>>).s1;
    expect(look.iconPaths).toEqual(iconContours("shield"));
  });

  it("настройки без пиктограмм возвращаются той же ссылкой: разрешать нечего", () => {
    const settings = { scalesChartKind: "rose", [SCALE_APPEARANCE_KEY]: { s1: { color: "10 20% 30%" } } };
    expect(withResolvedScaleIcons(settings)).toBe(settings);
    const plain = { scalesChartKind: "radar" };
    expect(withResolvedScaleIcons(plain)).toBe(plain);
  });
});
