/**
 * Линейчатая диаграмма шкал: столбики и числа.
 *
 * Закрепляется главное правило фигуры — масштаб задаёт САМЫЙ БОЛЬШОЙ БАЛЛ попытки, а не
 * домен. Это не линейка прогресса: доля от максимума шкалы здесь не показывается, поэтому
 * домен для построения не нужен вовсе, а нужен он только для ЦВЕТА столбика.
 */
import { describe, expect, it } from "vitest";
import { buildScaleBars } from "../scale-bars";
import { buildMeasureView } from "../measure-view";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

function interp(domainMax: number | null, extra: Partial<ScaleInterpretation> = {}): ScaleInterpretation {
  return {
    domainMin: domainMax === null ? null : 0,
    domainMax,
    displayMax: null,
    valence: "none",
    bands: [],
    ...extra,
  };
}

function measure(key: string, name: string, value: number, interpretation: ScaleInterpretation) {
  return { key, name, value, visibility: "level_and_value" as const, interpretation };
}

/** Карточки строит то же ядро, что и в контексте итогов: диаграмма берёт их надписи. */
function bars(measures: ReturnType<typeof measure>[], showMax = true) {
  const views = measures.map((m) =>
    buildMeasureView({ ...m, requestedKind: "bars", ramp: LEVEL_SCHEMES.traffic, showMax }),
  );
  return buildScaleBars({ measures, views, ramp: LEVEL_SCHEMES.traffic });
}

describe("линейчатая диаграмма шкал", () => {
  it("меряет столбики НАИБОЛЬШИМ баллом попытки", () => {
    const out = bars([
      measure("a", "Целеустремленный", 21, interp(98)),
      measure("b", "Командный", 35, interp(98)),
    ]);
    // 35 — самый большой балл, он и занимает всю ширину; 21 короче ровно во столько же раз.
    expect(out?.rows[1].widthPercent).toBe(100);
    expect(out?.rows[0].widthPercent).toBeCloseTo(60, 1);
  });

  it("не смотрит на домен: доля от максимума шкалы тут не показывается", () => {
    // Обе шкалы с одним баллом, но разными диапазонами. Линейка прогресса нарисовала бы их
    // разной длины (60 % и 30.6 %), диаграмма — одинаковой: баллы равны.
    const out = bars([
      measure("a", "Короткая", 27, interp(45)),
      measure("b", "Длинная", 27, interp(98)),
    ]);
    expect(out?.rows[0].widthPercent).toBe(100);
    expect(out?.rows[1].widthPercent).toBe(100);
  });

  it("строится и для шкал БЕЗ домена", () => {
    const out = bars([
      measure("a", "Без границ", 30, interp(null)),
      measure("b", "Тоже без границ", 15, interp(null)),
    ]);
    expect(out?.rows).toHaveLength(2);
    expect(out?.rows[0].widthPercent).toBe(100);
    expect(out?.rows[1].widthPercent).toBe(50);
  });

  it("печатает число тем же текстом, что карточка", () => {
    const withMax = bars([measure("a", "Шкала", 21, interp(98))]);
    expect(withMax?.rows[0].valueLabel).toBe("21 из 98");
    const withoutMax = bars([measure("a", "Шкала", 21, interp(98))], false);
    expect(withoutMax?.rows[0].valueLabel).toBe("21");
    expect(withoutMax?.rows[0].valueText).toBe("21");
  });

  it("красит столбик по положению в СВОЁМ домене, а не по доле на фигуре", () => {
    // Иначе высокий балл короткой шкалы читался бы как низкий: цвет говорит об уровне.
    const ramp = LEVEL_SCHEMES.traffic;
    const short = interp(45, { valence: "higher_is_better" });
    const long = interp(98, { valence: "higher_is_better" });
    const ms = [measure("a", "Короткая", 45, short), measure("b", "Длинная", 45, long)];
    const out = buildScaleBars({
      measures: ms,
      views: ms.map((m) => buildMeasureView({ ...m, requestedKind: "bars", ramp })),
      ramp,
    });
    // Первая шкала на своём максимуме — благоприятный край рампы; вторая на 46 % — нет.
    expect(out?.rows[0].color).toBe(ramp.favorable);
    expect(out?.rows[1].color).not.toBe(ramp.favorable);
  });

  it("не строится, когда все баллы нулевые", () => {
    // Ни один столбик не имел бы длины, и фигура сказала бы неправду о равенстве шкал.
    expect(bars([measure("a", "Ноль", 0, interp(98)), measure("b", "Ноль", 0, interp(98))])).toBeNull();
  });

  it("пропускает нечисловую меру, оставляя остальные", () => {
    const numericOnly = bars([measure("a", "Число", 40, interp(98))]);
    expect(numericOnly?.rows).toHaveLength(1);
    expect(numericOnly?.rows[0].key).toBe("a");
  });
});
