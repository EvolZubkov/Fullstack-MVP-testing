/**
 * @module tests/breakdown-web-host
 * @description PRD-50 FR-15: the stored attempt result carries breakdown records, and a
 * result saved before PRD-50 stays valid (the field defaults to an empty list).
 */
import { describe, it, expect } from "vitest";
import { topicResultSchema } from "../shared/schema";

describe("topicResultSchema.breakdown", () => {
  it("принимает записи разреза", () => {
    const parsed = topicResultSchema.parse({
      topicId: "law", topicName: "Право", correct: 1, total: 2, percent: 50,
      earnedPoints: 1, possiblePoints: 2, passed: false, passRule: null,
      recommendedCourses: [],
      breakdown: [{ scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2,
        earned: 1, possible: 2, unitEarned: 1, unitPossible: 2,
        percentPoints: 50, percentUnits: 50 }],
    });
    expect(parsed.breakdown).toHaveLength(1);
  });

  it("результат, сохранённый до PRD-50, остаётся валидным", () => {
    const parsed = topicResultSchema.parse({
      topicId: "law", topicName: "Право", correct: 1, total: 2, percent: 50,
      earnedPoints: 1, possiblePoints: 2, passed: false, passRule: null,
      recommendedCourses: [],
    });
    expect(parsed.breakdown).toEqual([]);
  });
});
