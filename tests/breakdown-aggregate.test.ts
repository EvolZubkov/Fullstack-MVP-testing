/**
 * @module tests/breakdown-aggregate
 * @description PRD-50 FR-14 - FR-18: `aggregateStandardResult` splits breakdown records
 * between the topics and the test. A golden test: the SCORM runtime computes them with
 * this very code, through the `TBTemplate` bundle.
 */
import { describe, it, expect } from "vitest";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";
import { TEST_SCOPE, sectionScope } from "../shared/breakdown/compute";

const q = (correctIndex: number, answer: number | null, tags: string[] | null, points = 1) => ({
  type: "single" as const,
  correct: { correctIndex },
  scoring: null,
  points,
  answer,
  ...(tags ? { axisKeys: { tag: tags } } : {}),
});

const section = (topicId: string, qs: AggregateSection["questions"]): AggregateSection => ({
  topicId,
  topicName: topicId,
  topicPassRule: null,
  questions: qs,
});

describe("aggregateStandardResult + разрезы", () => {
  it("кладёт записи раздела в тему, записи теста — в результат", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0, ["ПДн"]), q(0, 1, ["ПДн"])])],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].breakdown).toEqual([
      expect.objectContaining({ scope: sectionScope("law"), key: "ПДн", items: 2, percentUnits: 50 }),
    ]);
    expect(agg.breakdowns).toEqual([
      expect.objectContaining({ scope: TEST_SCOPE, key: "ПДн", items: 2, percentUnits: 50 }),
    ]);
  });

  it("тест без axisKeys даёт пустые списки и прежний вердикт (FR-18)", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0, null)])],
      overallPassRule: { type: "percent", value: 70 },
    });
    expect(agg.breakdowns).toEqual([]);
    expect(agg.topicResults[0].breakdown).toEqual([]);
    expect(agg.passed).toBe(true);
  });

  it("один тег в двух разделах не смешивается в записях разделов", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0, ["ПДн"])]), section("sec", [q(0, 1, ["ПДн"])])],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].breakdown[0]).toMatchObject({ percentUnits: 100 });
    expect(agg.topicResults[1].breakdown[0]).toMatchObject({ percentUnits: 0 });
    expect(agg.breakdowns[0]).toMatchObject({ items: 2, percentUnits: 50 });
  });
});
