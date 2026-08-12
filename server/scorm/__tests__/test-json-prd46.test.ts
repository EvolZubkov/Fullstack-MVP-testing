// @vitest-environment node
/**
 * @module server/scorm/__tests__/test-json-prd46
 *
 * PRD-46 §5: the ipsativity verdict is resolved by the ASSEMBLER — only it sees the
 * contribution rows and the allocation budgets — and travels to the runtime baked into
 * TEST_DATA. Here: that the bake carries it, and that it costs nothing to a test that is
 * not ipsative, so packages built before this PRD stay byte-identical (FR-02).
 */

import { describe, it, expect } from "vitest";
import { buildTestJson } from "../builders/test-json";

const SCALE = {
  id: "s1",
  testId: "t1",
  key: "cel",
  label: "Целеустремлённый",
  type: "number",
  aggregation: "sum",
  normalization: "none",
  direction: "positive",
  learnerVisibility: "level_and_value",
  scormTarget: "none",
  sortOrder: 0,
  configJson: { domainMin: 0, domainMax: 98 },
} as never;

const baseTest = {
  id: "t1",
  title: "ЧИЛ",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

const withScales = { test: baseTest, sections: [], scales: [SCALE] };

/** Parse the baked TEST_DATA (buildTestJson returns the serialized JSON). */
function bake(data: unknown): any {
  return JSON.parse(buildTestJson(data as never));
}

describe("buildTestJson (PRD-46)", () => {
  it("запекает признак ипсативности рядом со шкалами", () => {
    expect(bake({ ...withScales, ipsativeScales: true }).ipsativeScales).toBe(true);
  });

  it("не пишет ключ неипсативному тесту — его пакет остаётся прежним (FR-02)", () => {
    // Отсутствие ключа рантайм читает как «не ипсативна», поэтому писать `false` было бы
    // изменением байтов пакета без изменения поведения.
    expect(bake(withScales)).not.toHaveProperty("ipsativeScales");
    expect(buildTestJson({ ...withScales, ipsativeScales: false } as never))
      .toBe(buildTestJson(withScales as never));
  });

  it("тесту без шкал ключа не достаётся даже при истинном признаке", () => {
    // Рисовать нечего: признак живёт в блоке шкал и без них смысла не имеет.
    const plain = { test: baseTest, sections: [], ipsativeScales: true };
    expect(bake(plain)).not.toHaveProperty("ipsativeScales");
    expect(buildTestJson(plain as never)).toBe(buildTestJson({ test: baseTest, sections: [] } as never));
  });
});
