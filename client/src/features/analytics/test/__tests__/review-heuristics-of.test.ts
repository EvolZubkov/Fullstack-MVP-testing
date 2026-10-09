/**
 * @module features/analytics/test/__tests__/review-heuristics-of.test
 * @description `reviewHeuristicsOf`: the PRD-56 review heuristics map shared by the test
 * analytics page and «Вопросы теста» in the editor.
 */
import { describe, expect, it } from "vitest";
import { reviewHeuristicsOf } from "../item-quality";

describe("reviewHeuristicsOf", () => {
  it("is empty without statistics", () => {
    expect(reviewHeuristicsOf(undefined)).toEqual({});
  });

  it("keeps only questions where a heuristic fired, with the numbers behind it", () => {
    expect(
      reviewHeuristicsOf([
        { questionId: "q1", reviewFlags: [] },
        {
          questionId: "q2",
          reviewFlags: [{ kind: "hard-and-frequent" }, { kind: "fast-and-wrong" }],
          exposurePercent: 90,
          correctPercent: 20,
          latencyMedianMs: 4000,
        },
        { questionId: "q3", reviewFlags: [{ kind: "fast-and-wrong" }] },
      ]),
    ).toEqual({
      q2: {
        kinds: ["hard-and-frequent", "fast-and-wrong"],
        exposurePercent: 90,
        correctPercent: 20,
        latencyMedianMs: 4000,
      },
      q3: { kinds: ["fast-and-wrong"], exposurePercent: null, correctPercent: null, latencyMedianMs: null },
    });
  });
});
