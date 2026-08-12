/**
 * @module shared/template/__tests__/smoke-runner-measures
 *
 * PRD-47 §5.4: смоук шаблона и предпросмотр отчёта строили контекст БЕЗ измерений,
 * поэтому диаграмму не показывали никогда — ни до PRD-46, ни после. Проверка гоняет
 * ровно ту страницу, что уйдёт в PDF, значит она обязана гонять её с блоком измерений:
 * иначе поломка розы в отчёте вскроется у обучающегося, а не у автора.
 *
 * Тест смотрит на настоящую проводку: подставляет свой рендерер и ловит контекст,
 * который смоук отдаёт раскладке отчёта.
 */
import { describe, expect, it } from "vitest";

import { runSmokeChecks } from "../smoke-runner";
import type { PreviewDemoDataset } from "../preview-context";
import type { MeasuresInput } from "../result-context";

/** Одна ось профиля. Диаграмму строит только НАБОР осей — из одной фигуры не выйдет. */
function axis(key: string, name: string, value: number) {
  return {
    key,
    name,
    value,
    visibility: "level_and_value" as const,
    interpretation: {
      domainMin: 0,
      domainMax: 50,
      displayMax: null,
      valence: "higher_is_better" as const,
      bands: [{ min: 0, max: 50, level: "high", label: "Высокий" }],
    },
  };
}

const MEASURES: MeasuresInput = {
  ramp: { favorable: "142 76% 36%", mid: "38 92% 50%", unfavorable: "0 84% 60%" },
  scaleKind: "band_ruler",
  indicatorKind: "label",
  scales: [
    axis("demo_focus", "Ориентация на результат", 38),
    axis("demo_team", "Работа в команде", 21),
    axis("demo_care", "Внимание к деталям", 44),
  ],
  indicators: [],
  // Настройки ЭКРАНА: у отчёта свои, и подменять его вид этими нельзя.
  chartSettings: { scalesChartKind: "rose" },
};

const DATASET: PreviewDemoDataset = {
  course: { title: "Демо", topics: [{ id: "t1", title: "Тема" }] },
  runtime: { measures: MEASURES },
};

/**
 * Манифест с ОДНИМ видом отчёта. Виды отчёта живут в `contentTemplates` наравне с
 * вариантами экранов и отбираются по `kind` — смоук проверяет именно их (PRD-27 FR-26).
 */
const MANIFEST = {
  contentTemplates: [
    {
      kind: "report",
      key: "report.standard",
      label: "Стандартный",
      isDefault: true,
      // Без `layoutFile`: ключ раскладки тогда равен виду, и его же несёт `layouts` ниже.
      // С файлом ключом стал бы путь, раскладка не нашлась бы, и смоук не дошёл бы до
      // рендерера вовсе — тест зеленел бы на пустоте.
      //
      // Вид диаграммы объявлен СВОИМ полем варианта отчёта, с умолчанием «радар»: на
      // нём и проверяется, что отчёт рисует по своим настройкам, а не по экранным.
      settings: [{ key: "scalesChartKind", type: "select", default: "radar" }],
    },
  ],
} as never;

/** Ловит контексты, которые смоук отдаёт рендереру, по ключу раскладки. */
function capturingRun(): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  runSmokeChecks({
    dataset: DATASET,
    manifest: MANIFEST,
    layouts: { report: "<div class=\"tb-report\">x</div>" },
    createContainer: () => document.createElement("div"),
    render: (_root, input) => {
      seen.push(input.context as Record<string, unknown>);
    },
  });
  return seen;
}

/** Блок `result.*` контекста отчёта — туда построитель кладёт разобранные измерения. */
function reportResult(): Record<string, unknown> {
  const contexts = capturingRun();
  expect(contexts.length, "смоук не дошёл до рендерера — проверять нечего").toBeGreaterThan(0);
  return (contexts[0].result ?? {}) as Record<string, unknown>;
}

describe("смоук шаблона: отчёт", () => {
  it("отдаёт раскладке отчёта карточки шкал из демо-набора (PRD-47 §5.4)", () => {
    expect(reportResult().scales).toHaveLength(3);
  });

  it("рисует диаграмму видом из полей ВАРИАНТА ОТЧЁТА, а не из демо-набора", () => {
    // Демо-набор несёт настройки ЭКРАНА (там «роза»); у отчёта свой переключатель, и
    // подмена означала бы, что предпросмотр показывает не тот документ, что уйдёт в PDF.
    const chart = reportResult().scalesChart as { kind?: string } | undefined;

    expect(chart?.kind).toBe("radar");
  });
});
