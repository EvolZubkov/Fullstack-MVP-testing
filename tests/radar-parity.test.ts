/**
 * Паритет радара между хостами (PRD-35 §10).
 *
 * Геометрию считает ОДНО ядро, поэтому тест закрепляет не «два кода дают одно», а
 * то, что оба пути ведут в это ядро: контекст итогов (веб-хост и бандл `TBTemplate`
 * зовут его одинаково) и прямой вызов дают идентичный объект. Плюс проверяется, что
 * рантайм пакета читает переключатель из настроек варианта «Итоги» — там он живёт
 * рядом с блоками PRD-29.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildResultContext } from "@shared/template/result-context";
import { buildScalesChart } from "@shared/template/scales-chart";
import { LEVEL_SCHEMES } from "@shared/template/level-ramp";
import type { ScaleInterpretation } from "@shared/scales/interpretation";

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

const axes = [
  { key: "a", name: "Эмоциональное истощение", value: 27, visibility: "level_and_value" as const, interpretation: scale(45, [0, 15, 25]) },
  { key: "b", name: "Отстранённость", value: 6, visibility: "level_and_value" as const, interpretation: scale(25, [0, 5, 10]) },
  { key: "c", name: "Обесценивание достижений", value: 30, visibility: "level_and_value" as const, interpretation: scale(40, [0, 28, 33]) },
];

const BASE = {
  passed: false,
  percent: 0,
  totalQuestions: 22,
  correct: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  topicResults: [],
};

describe("паритет радара", () => {
  it("контекст итогов и прямой вызов ядра дают идентичную геометрию", () => {
    const direct = buildScalesChart({
      axes,
      ramp: LEVEL_SCHEMES.traffic,
      settings: { scalesChartKind: "radar" },
      ipsative: false,
    });
    const ctx = buildResultContext(BASE, "Тест", {
      measures: {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler",
        indicatorKind: "label",
        chartSettings: { scalesChartKind: "radar" as const },
        indicators: [],
        scales: axes,
      },
    });
    expect(ctx.result.scalesChart).toEqual(direct);
  });

  it("рантайм пакета читает переключатель из настроек варианта «Итоги»", () => {
    const runtime = readFileSync(
      resolve("server/scorm/template/app/render/viewResults.js"),
      "utf-8",
    );
    // Пакет отдаёт настройки как есть и НЕ решает сам: миграция булева ключа PRD-35 и
    // выбор вида живут в ядре, одним правилом на оба хоста. Пакет, собранный до PRD-35,
    // ключа не несёт вовсе, и ядро читает это как «диаграммы нет».
    expect(runtime).toContain("chartSettings: blockSettings");
  });
});
