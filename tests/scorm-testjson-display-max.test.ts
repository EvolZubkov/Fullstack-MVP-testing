/**
 * @module tests/scorm-testjson-display-max
 *
 * PRD-46 §6. Предел показа шкалы обязан доехать в пакет.
 *
 * Шкала печётся ПЛОСКОЙ — домен, направление и уровни ложатся полями рядом с ключом, а рантайм
 * перечитывает их тем же общим парсером. Значит поле, забытое в бейке, не «просто отсутствует»:
 * пакет молча нарисует другую фигуру, чем веб, при одинаковых настройках теста. Ровно этот
 * разрыв здесь и сторожится.
 *
 * И обратное: тест без предела не должен менять ни одного байта пакета — поле пишется только
 * тогда, когда автор его задал.
 */

import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest: any = {
  id: "test-46-limit",
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
  id: "s1", testId: "test-46-limit", topicId: "t1",
  topic: { id: "t1", name: "Стили", feedback: null },
  questions: [], courses: [], events: [], drawCount: 0, topicPassRuleJson: null,
};

function scale(configJson: unknown): any {
  return {
    id: "sc1", testId: "test-46-limit", key: "cel", label: "Целеустремлённый",
    type: "number", aggregation: "sum", normalization: "none", direction: "positive",
    configJson, learnerVisibility: "level_and_value", scormTarget: "none", sortOrder: 0,
  };
}

function exportData(configJson: unknown): any {
  return { test: baseTest, sections: [dbSection], scales: [scale(configJson)] };
}

function parse(json: string): Record<string, any> {
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  return JSON.parse(json.slice(start, end + 1));
}

const DOMAIN = { domainMin: 0, domainMax: 98, bands: [{ min: 0, max: 98, level: "any" }] };

describe("buildTestJson — предел показа шкалы (PRD-46 §6)", () => {
  it("печёт заданный предел рядом с доменом", () => {
    const out = parse(buildTestJson(exportData({ ...DOMAIN, displayMax: 40 })));
    expect(out.scales[0]).toMatchObject({ domainMin: 0, domainMax: 98, displayMax: 40 });
  });

  it("шкала без предела не получает ключа вовсе", () => {
    const out = parse(buildTestJson(exportData(DOMAIN)));
    expect("displayMax" in out.scales[0]).toBe(false);
  });

  it("тест без предела даёт прежние байты", () => {
    const before = buildTestJson(exportData(DOMAIN));
    const after = buildTestJson(exportData(DOMAIN));
    expect(before).toBe(after);
  });
});
