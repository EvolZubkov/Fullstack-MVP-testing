/**
 * @module shared/template/__tests__/scale-appearance
 *
 * PRD-46 §7. The look the author gave each scale: how the stored map is read, and what the
 * rose does with it.
 *
 * Two properties matter more than the mechanics. The map is author-editable JSON that no
 * migration rewrites, so a malformed entry has to degrade to «nothing declared» — the palette
 * still answers and the sector is still drawn. And the colour is honoured only where it can
 * carry identity: one scale with a declared direction puts the WHOLE figure back on the level
 * ramp, because two colour languages on one figure would say two different things about the
 * same value.
 */
import { describe, expect, it } from "vitest";
import { applyScaleAppearance, parseScaleAppearance } from "../scale-appearance";
import { buildScalesChart } from "../scales-chart";
import { CATEGORICAL_HUES } from "../categorical-palette";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { RadarAxisInput } from "../radar-view";
import type { ScaleInterpretation } from "../../scales/interpretation";

describe("parseScaleAppearance", () => {
  it("читает цвет тройкой HSL — формат, в котором цвет доходит до макета", () => {
    expect(parseScaleAppearance({ s1: { color: "257.9 71.3% 65.9%" } })).toEqual({
      s1: { color: "257.9 71.3% 65.9%" },
    });
  });

  it("отбрасывает цвет в чужом формате: hsl(...) и #rrggbb макет обернёт второй раз", () => {
    expect(parseScaleAppearance({ s1: { color: "#8F6AE6" } })).toEqual({});
    expect(parseScaleAppearance({ s1: { color: "hsl(257 71% 66%)" } })).toEqual({});
  });

  it("не падает на мусоре вместо карты", () => {
    expect(parseScaleAppearance(undefined)).toEqual({});
    expect(parseScaleAppearance(null)).toEqual({});
    expect(parseScaleAppearance("оформление")).toEqual({});
    expect(parseScaleAppearance([{ color: "0 0% 0%" }])).toEqual({});
  });

  it("не падает на мусоре вместо записи шкалы", () => {
    expect(parseScaleAppearance({ s1: null, s2: "красный", s3: [], s4: {} })).toEqual({});
  });

  it("оставляет имя пиктограммы и контуры, посчитанные хостом", () => {
    expect(
      parseScaleAppearance({ s1: { icon: "  target  ", iconPaths: ["M 1 2", "", 7] } }),
    ).toEqual({ s1: { icon: "target", iconPaths: ["M 1 2"] } });
  });

  it("запись без цвета и без имени пиктограммы пропадает целиком", () => {
    // Контуры без имени — след прошлой сборки; сами по себе они ничего не значат.
    expect(parseScaleAppearance({ s1: { iconPaths: ["M 1 2"] } })).toEqual({});
  });
});

describe("applyScaleAppearance", () => {
  const axes = [
    { key: "s1", color: "0 0% 0%" },
    { key: "s2" },
  ];

  it("выбор автора старше того, что положил хост: хостовое значение — умолчание", () => {
    expect(applyScaleAppearance(axes, { s1: { color: "10 20% 30%" } })[0].color).toBe("10 20% 30%");
  });

  it("шкала вне карты проходит нетронутой — той же ссылкой", () => {
    const out = applyScaleAppearance(axes, { s1: { color: "10 20% 30%" } });
    expect(out[1]).toBe(axes[1]);
  });

  it("запись без цвета и контуров ничего не переписывает", () => {
    const out = applyScaleAppearance(axes, { s1: { icon: "target" } });
    expect(out[0]).toBe(axes[0]);
  });
});

describe("облик на розе", () => {
  const ramp = LEVEL_SCHEMES.traffic;

  function interpretation(valence: ScaleInterpretation["valence"]): ScaleInterpretation {
    return {
      domainMin: 0,
      domainMax: 98,
      valence,
      bands: [
        { min: 0, max: 40, level: "low", label: "Слабо" },
        { min: 40, max: 98, level: "high", label: "Сильно" },
      ],
    };
  }

  /** Four typology scales — the ЧИЛ shape: no direction anywhere, so colour is identity. */
  function axes(valences: ScaleInterpretation["valence"][] = ["none", "none", "none", "none"]): RadarAxisInput[] {
    return valences.map((valence, i) => ({
      key: `s${i}`,
      name: `Шкала ${i}`,
      value: 20 + i * 5,
      visibility: "level_and_value" as const,
      interpretation: interpretation(valence),
    }));
  }

  function rose(settings: Record<string, unknown>, valences?: ScaleInterpretation["valence"][]) {
    return buildScalesChart({
      axes: axes(valences),
      ramp,
      settings: { scalesChartKind: "rose", ...settings },
      ipsative: true,
    })!;
  }

  it("без карты картинка прежняя: цвета берутся из категориальной палитры", () => {
    expect(rose({}).sectors.map((s) => s.color)).toEqual(CATEGORICAL_HUES.slice(0, 4));
  });

  it("цвет автора перебивает слот палитры — и только у своей шкалы", () => {
    const sectors = rose({ scaleAppearance: { s1: { color: "10 20% 30%" } } }).sectors;
    expect(sectors[1].color).toBe("10 20% 30%");
    // Слот остаётся закреплён за позицией: покрасив одну шкалу, соседние не сдвигают оттенок.
    expect(sectors[0].color).toBe(CATEGORICAL_HUES[0]);
    expect(sectors[2].color).toBe(CATEGORICAL_HUES[2]);
  });

  it("всем или никому: одна шкала с направлением уводит ВСЮ розу на схему уровней", () => {
    const sectors = rose(
      { scaleAppearance: { s1: { color: "10 20% 30%" } } },
      ["none", "none", "none", "higher_is_better"],
    ).sectors;
    expect(sectors[1].color).not.toBe("10 20% 30%");
    expect(sectors.every((s) => !CATEGORICAL_HUES.includes(s.color))).toBe(true);
  });

  it("испорченная запись не ломает сектор — он падает обратно на палитру", () => {
    const sectors = rose({ scaleAppearance: { s1: { color: "#8F6AE6" } } }).sectors;
    expect(sectors[1].color).toBe(CATEGORICAL_HUES[1]);
  });

  it("контуры доезжают до подписи: пиктограмма приходит геометрией, не именем", () => {
    const chart = rose({
      scaleAppearance: { s1: { icon: "target", iconPaths: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0"] } },
    });
    expect(chart.icons).toHaveLength(1);
    expect(chart.icons[0].paths).toEqual(["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0"]);
    expect(chart.icons[0].transform).toMatch(/^translate\(/);
  });

  it("имя без контуров не рисует глиф и не ломает подпись", () => {
    // Хост не смог разрешить имя — например, набор пересобран после обновления библиотеки.
    // Подпись остаётся на месте: шкала без пиктограммы это штатное состояние.
    const chart = rose({ scaleAppearance: { s1: { icon: "нет-такого-глифа" } } });
    expect(chart.icons).toEqual([]);
    expect(chart.labels.some((l) => l.text.includes("Шкала 1"))).toBe(true);
  });

  it("шкала без пиктограммы не резервирует под неё строку подписи", () => {
    const withIcon = rose({ scaleAppearance: { s0: { icon: "target", iconPaths: ["M0 0"] } } });
    const without = rose({});
    expect(withIcon.icons).toHaveLength(1);
    expect(without.icons).toEqual([]);
    // Подписи шкал без пиктограммы стоят там же, где стояли бы без всякой карты.
    expect(without.labels).toEqual(rose({ scaleAppearance: {} }).labels);
  });
});
