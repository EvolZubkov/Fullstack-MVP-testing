/**
 * Рендер РЕАЛЬНОГО макета итогов «Стандартного» РОЗОЙ.
 *
 * Держит вместе то, что расходится молча: единый контракт ядра (`result.scalesChart`) и
 * биндинги разметки. Отдельно от радарного теста, потому что проверяет обратное свойство —
 * что ОДИН блок макета рисует другую диаграмму, не подмешивая чужих элементов: у розы не
 * должно появиться ни полигона, ни вершин радара.
 *
 * Данные — контрольная выкладка ЧИЛ (PRD-44 A-02): четыре стиля делят бюджет 98.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTemplate } from "@shared/template/dsl";
import { buildResultContext } from "@shared/template/result-context";
import { LEVEL_SCHEMES } from "@shared/template/level-ramp";
import type { ScaleInterpretation } from "@shared/scales/interpretation";

const layout = readFileSync(resolve("server/scorm/templates/default/layouts/results.html"), "utf-8");

const BASE = {
  passed: false,
  percent: 0,
  totalQuestions: 14,
  correct: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  topicResults: [],
};

/** Типология: направления нет, поэтому цвет свободен нести идентичность. */
function style(): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax: 98,
    valence: "none",
    bands: [
      { min: 0, max: 20, level: "low", label: "Слабо выражен" },
      { min: 20, max: 40, level: "mid", label: "Выражен" },
      { min: 40, max: 98, level: "high", label: "Доминирующий" },
    ],
  };
}

const CHIL = [
  ["Целеустремлённый", 34],
  ["Вдохновляющий", 16],
  ["Командный", 14],
  ["Процессный", 34],
] as const;

function render(kind: "rose" | "radar" | "none"): string {
  const ctx = buildResultContext(BASE, "Опросник ЧИЛ", {
    measures: {
      ramp: LEVEL_SCHEMES.traffic,
      scaleKind: "band_ruler" as const,
      indicatorKind: "label" as const,
      chartSettings: { scalesChartKind: kind },
      indicators: [],
      scales: CHIL.map(([name, value]) => ({
        key: name,
        name,
        value,
        visibility: "level_and_value" as const,
        interpretation: style(),
      })),
    },
  });
  return renderTemplate(layout, ctx);
}

describe("макет итогов: роза", () => {
  it("рисует секторы и сетку, переводя блок в две колонки", () => {
    const html = render("rose");
    expect(html).toContain('class="tb-measures tb-measures--chart"');
    expect(html).toContain('class="tb-chart"');
    // Четыре сектора: по одному на стиль.
    expect(html.match(/class="tb-rose__sector/g)).toHaveLength(4);
    expect(html).toContain('class="tb-chart__ring"');
    expect(html).toContain('class="tb-chart__axis"');
  });

  it("не подмешивает радарных элементов: ни полигона, ни вершин", () => {
    const html = render("rose");
    expect(html).not.toContain("tb-radar__shape");
    expect(html).not.toContain("tb-radar__dot");
  });

  it("не портит строку пути: d остаётся геометрией, а не экранированным текстом", () => {
    const html = render("rose");
    // Экранирование трогает кавычки и угловые скобки; путь состоит из букв команд,
    // цифр и запятых, и полагаться на это без проверки нельзя.
    expect(html).toMatch(/ d="M 180,150 L [\d.]+,[\d.]+ A [\d.]+,[\d.]+ 0 \d,1 [\d.]+,[\d.]+ Z"/);
  });

  it("красит секторы по идентичности: у типологии четыре разных оттенка", () => {
    const html = render("rose");
    const hues = [...html.matchAll(/--tb-hue:([^"]+)"/g)].map((m) => m[1]);
    expect(hues).toHaveLength(4);
    expect(new Set(hues).size).toBe(4);
  });

  it("тот же тест радаром даёт радарную разметку, а не розу", () => {
    const html = render("radar");
    expect(html).toContain("tb-radar__shape");
    expect(html).not.toContain("tb-rose__sector");
  });

  it("без диаграммы блок остаётся одноколоночным", () => {
    const html = render("none");
    expect(html).toContain('class="tb-measures"');
    expect(html).not.toContain("tb-chart");
  });
});
