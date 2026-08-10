/**
 * @module shared/template/__tests__/radar-axis-limit
 *
 * PRD-46 §6. Чем считается ПОЛНЫЙ луч радара.
 *
 * Три режима отвечают на один вопрос по-разному, и цена у них разная. `домен` — прежнее
 * поведение: сетка совпадает с границами интервалов в карточке рядом. `заданный` меняет
 * только масштаб рисунка, не трогая того, что шкала измеряет. `по попытке` растягивает фигуру
 * на весь круг ценой сравнимости: масштаб начинает зависеть от ответов.
 *
 * Отдельно сторожатся две вещи, которые легко потерять: балл выше предела не обрезается
 * молча, и умолчание не меняет ни одной существующей картинки.
 */
import { describe, expect, it } from "vitest";
import { buildRadarChart, type RadarAxisInput } from "../radar-view";
import { axisLimitSetting, buildScalesChart } from "../scales-chart";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { LearnerVisibility } from "../../scales/interpretation";

const ramp = LEVEL_SCHEMES.traffic;

function axis(
  key: string,
  value: number,
  over: { displayMax?: number | null; visibility?: LearnerVisibility } = {},
): RadarAxisInput {
  return {
    key,
    name: `Шкала ${key}`,
    value,
    visibility: over.visibility ?? "level_and_value",
    interpretation: {
      domainMin: 0,
      domainMax: 100,
      displayMax: over.displayMax ?? null,
      valence: "none",
      bands: [
        { min: 0, max: 50, level: "low", label: "Слабо" },
        { min: 51, max: 100, level: "high", label: "Сильно" },
      ],
    },
  };
}

/** Доля луча в процентах, по ключу шкалы. */
function percents(chart: ReturnType<typeof buildRadarChart>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of chart!.axes) out[a.key] = a.radiusPercent;
  return out;
}

describe("предел оси радара", () => {
  const axes = [axis("a", 10), axis("b", 20), axis("c", 40)];

  it("умолчание — домен: доли считаются от domainMax, как до PRD-46", () => {
    const chart = buildRadarChart({ axes, ramp })!;
    expect(percents(chart)).toEqual({ a: 10, b: 20, c: 40 });
    // Явный «домен» обязан совпасть с умолчанием до последнего числа.
    expect(buildRadarChart({ axes, ramp, limit: "domain" })!.axes).toEqual(chart.axes);
  });

  it("подпись предела пуста при «домене»: рассказывать не о чем", () => {
    expect(buildRadarChart({ axes, ramp })!.limitCaption).toBe("");
  });

  it("«заданный» берёт предел ИЗ ШКАЛЫ, поэтому у каждой оси он свой", () => {
    const chart = buildRadarChart({
      axes: [axis("a", 10, { displayMax: 20 }), axis("b", 20, { displayMax: 40 }), axis("c", 40)],
      ramp,
      limit: "declared",
    })!;
    // a: 10 из 20, b: 20 из 40, c: предела нет — падает обратно на домен.
    expect(percents(chart)).toEqual({ a: 50, b: 50, c: 40 });
    expect(chart.limitCaption).toContain("заданного автором");
  });

  it("«заданный» без значения не меняет картинку", () => {
    expect(buildRadarChart({ axes, ramp, limit: "declared" })!.axes).toEqual(
      buildRadarChart({ axes, ramp })!.axes,
    );
  });

  it("«по попытке» берёт ОДИН предел на фигуру — наибольшее значение попытки", () => {
    const chart = buildRadarChart({ axes, ramp, limit: "attempt" })!;
    // Наибольшая шкала упирается в кольцо, остальные меряются от неё.
    expect(percents(chart)).toEqual({ a: 25, b: 50, c: 100 });
  });

  it("«по попытке» предупреждает о несравнимости: без подписи это ловушка", () => {
    expect(buildRadarChart({ axes, ramp, limit: "attempt" })!.limitCaption).toContain(
      "несравнимы",
    );
  });

  it("«по попытке» не берёт предел со шкалы со скрытым баллом", () => {
    // Иначе спрятанное число вернулось бы к читателю через геометрию всей фигуры.
    const chart = buildRadarChart({
      axes: [axis("a", 10), axis("b", 20), axis("c", 90, { visibility: "level" })],
      ramp,
      limit: "attempt",
    })!;
    expect(percents(chart).b).toBe(100);
  });

  it("значение выше предела упирается в кольцо и помечается, а не режется молча", () => {
    const chart = buildRadarChart({
      axes: [axis("a", 80, { displayMax: 40 }), axis("b", 20), axis("c", 40)],
      ramp,
      limit: "declared",
    })!;
    const a = chart.axes.find((x) => x.key === "a")!;
    expect(a.radiusPercent).toBe(100);
    expect(a.overflowClass).toBe("tb-radar__dot--over");
    expect(chart.axes.find((x) => x.key === "b")!.overflowClass).toBe("");
  });

  it("предел ниже минимума шкалы игнорируется: рисовать было бы нечего", () => {
    const chart = buildRadarChart({
      axes: [axis("a", 10, { displayMax: -5 }), axis("b", 20), axis("c", 40)],
      ramp,
      limit: "declared",
    })!;
    expect(percents(chart).a).toBe(10);
  });
});

describe("настройка предела в варианте «Итоги»", () => {
  const axes = [axis("a", 10), axis("b", 20), axis("c", 40)];

  it("читает объявленные значения", () => {
    expect(axisLimitSetting({ radarAxisLimit: "attempt" })).toBe("attempt");
    expect(axisLimitSetting({ radarAxisLimit: "declared" })).toBe("declared");
  });

  it("отсутствие и мусор сводятся к «домену», а не к случайному масштабу", () => {
    // Незнакомое значение выглядело бы на экране правдоподобно, и никто бы не заметил,
    // что фигура нарисована в другом масштабе.
    expect(axisLimitSetting({})).toBe("domain");
    expect(axisLimitSetting({ radarAxisLimit: "по попытке" })).toBe("domain");
    expect(axisLimitSetting({ radarAxisLimit: 3 })).toBe("domain");
  });

  it("настройка доезжает от варианта до фигуры одной дорогой с видом диаграммы", () => {
    const chart = buildScalesChart({
      axes,
      ramp,
      settings: { scalesChartKind: "radar", radarAxisLimit: "attempt" },
      ipsative: false,
    })!;
    expect(chart.axes.find((a) => a.key === "c")!.radiusPercent).toBe(100);
    expect(chart.limitCaption).toContain("несравнимы");
  });

  it("у розы подпись предела пуста: её опора — кольцо ровного расклада, и оно нарисовано", () => {
    const chart = buildScalesChart({
      axes,
      ramp,
      settings: { scalesChartKind: "rose", radarAxisLimit: "attempt" },
      ipsative: true,
    })!;
    expect(chart.isRose).toBe(true);
    expect(chart.limitCaption).toBe("");
  });
});
