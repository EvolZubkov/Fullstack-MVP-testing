/**
 * Рендер РЕАЛЬНОГО макета итогов «Стандартного» с радаром и без него.
 *
 * Тест держит вместе две вещи, которые расходятся молча: контракт ядра
 * (`result.scalesChart`) и биндинги разметки. Плюс закрепляет, что DSL не портит
 * строку координат `points` — экранирование трогает кавычки и угловые скобки, а
 * не цифры с запятыми, и полагаться на это без проверки нельзя.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTemplate } from "@shared/template/dsl";
import { buildResultContext } from "@shared/template/result-context";
import { LEVEL_SCHEMES } from "@shared/template/level-ramp";
import type { ScaleInterpretation } from "@shared/scales/interpretation";

const layout = readFileSync(
  resolve("server/scorm/templates/default/layouts/results.html"),
  "utf-8",
);

const BASE = {
  passed: false,
  percent: 0,
  totalQuestions: 22,
  correct: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  topicResults: [],
};

function scale(domainMax: number, bandsAt: number[]): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax,
    valence: "higher_is_better",
    bands: bandsAt.map((min, i) => ({
      min,
      max: i + 1 < bandsAt.length ? bandsAt[i + 1] : domainMax,
      level: `l${i}`,
      label: `Уровень ${i}`,
    })),
  };
}

function measures(showRadar: boolean) {
  return {
    ramp: LEVEL_SCHEMES.traffic,
    scaleKind: "band_ruler" as const,
    indicatorKind: "label" as const,
    showRadar,
    indicators: [],
    scales: [
      { key: "a", name: "Эмоциональное истощение", value: 27, visibility: "level_and_value" as const, interpretation: scale(45, [0, 15, 25]) },
      { key: "b", name: "Отстранённость", value: 6, visibility: "level_and_value" as const, interpretation: scale(25, [0, 5, 10]) },
      { key: "c", name: "Обесценивание достижений", value: 30, visibility: "level_and_value" as const, interpretation: scale(40, [0, 28, 33]) },
    ],
  };
}

function render(showRadar: boolean): string {
  const ctx = buildResultContext(BASE, "Тест", { measures: measures(showRadar) });
  return renderTemplate(layout, ctx);
}

describe("макет итогов: радар", () => {
  it("рисует диаграмму и переводит блок в две колонки", () => {
    const html = render(true);
    expect(html).toContain('class="tb-measures tb-measures--chart"');
    expect(html).toContain('class="tb-radar"');
    expect(html).toContain("tb-radar__shape");
    // Три вершины, три подписи, три метки уровня.
    expect(html.match(/tb-radar__dot/g)).toHaveLength(3);
    expect(html).toContain("Обесценивание достижений");
  });

  it("не портит строку координат: points остаётся числами", () => {
    const html = render(true);
    const points = /points="([^"]+)"/.exec(html);
    expect(points).not.toBeNull();
    expect(points![1]).toMatch(/^[\d.,\s-]+$/);
    expect(points![1].split(" ")).toHaveLength(3);
    expect(html).not.toContain("&quot;");
  });

  it("без переключателя оставляет блок таким же, как до PRD-35", () => {
    const html = render(false);
    expect(html).toContain('class="tb-measures"');
    expect(html).not.toContain("tb-measures--chart");
    expect(html).not.toContain("tb-radar");
    // Карточки шкал на месте — радар ничего не забрал.
    expect(html).toContain("Эмоциональное истощение");
    expect(html.match(/ou-formsection tb-measure"/g)).toHaveLength(3);
  });
});
