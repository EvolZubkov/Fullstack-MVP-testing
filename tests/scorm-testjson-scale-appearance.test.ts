/**
 * @module tests/scorm-testjson-scale-appearance
 *
 * PRD-46 §8. Пиктограмма шкалы едет в пакет КОНТУРАМИ.
 *
 * Внутри пакета разрешать имя нечем: ни React, ни шрифта иконок, ни библиотеки. Поэтому
 * геометрия печётся рядом с настройками, которым принадлежит, и печётся БЕЗУСЛОВНО — цена
 * один раз на сборку, а ответ обязан лежать в пакете до того, как станет известно, под какой
 * настройкой его прочтут.
 *
 * Тест без карты оформления обязан дать прежние байты: карта необязательна, и её отсутствие не
 * должно менять ни одного пакета с измерениями.
 */

import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest: any = {
  id: "test-46",
  title: "Опросник",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: false,
};

const dbSection: any = {
  id: "s1", testId: "test-46", topicId: "t1",
  topic: { id: "t1", name: "Стили", feedback: null },
  questions: [],
  courses: [], events: [],
  drawCount: 0,
  topicPassRuleJson: null,
};

function exportData(settingsJson: unknown): any {
  return {
    test: baseTest,
    sections: [dbSection],
    contentPages: [
      {
        id: "p1", topicId: null, position: "after_test", mode: "template", type: null,
        kind: "results", templateKey: "results.standard", sortOrder: 0,
        valuesJson: { values: {} },
        settingsJson,
        autoAdvance: false, autoAdvanceDelayMs: null,
      },
    ],
  };
}

/** `buildTestJson` returns `var TEST_DATA = { … };` — the object is what matters here. */
function parse(json: string): Record<string, any> {
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  return JSON.parse(json.slice(start, end + 1));
}

describe("buildTestJson — облик шкал (PRD-46)", () => {
  it("подставляет контуры к выбранному имени", () => {
    const out = parse(
      buildTestJson(exportData({ scalesChartKind: "rose", scaleAppearance: { s1: { icon: "target" } } })),
    );
    const look = out.contentPages[0].settings.scaleAppearance.s1;
    expect(look.icon).toBe("target");
    expect(look.iconPaths[0]).toBe("M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0");
  });

  it("цвет автора едет как есть — тройкой HSL", () => {
    const out = parse(
      buildTestJson(exportData({ scaleAppearance: { s1: { color: "257.9 71.3% 65.9%" } } })),
    );
    expect(out.contentPages[0].settings.scaleAppearance.s1).toEqual({ color: "257.9 71.3% 65.9%" });
  });

  it("настройка предела оси едет в пакет как есть", () => {
    const out = parse(buildTestJson(exportData({ scalesChartKind: "radar", radarAxisLimit: "attempt" })));
    expect(out.contentPages[0].settings.radarAxisLimit).toBe("attempt");
  });

  it("тест без карты даёт прежние байты", () => {
    const before = buildTestJson(exportData({ scalesChartKind: "rose" }));
    const after = buildTestJson(exportData({ scalesChartKind: "rose" }));
    expect(before).toBe(after);
    expect(parse(before).contentPages[0].settings).toEqual({ scalesChartKind: "rose" });
  });
});
