/**
 * @module tests/scoring-pass-rule
 * @description PRD-10 Stage 5 (FR-10): the section/topic "count" pass rule is
 * compared against the section score Σs (earned points), not the number of
 * fully-correct questions. The `percent` rule already runs on the graded
 * percent. Extracts the runtime `checkPassRuleWithPartial` from resultsPage.js
 * and asserts the threshold semantics (chosen option A: count → Σs).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);
const match = src.match(/function checkPassRuleWithPartial\([^)]*\)\s*\{[\s\S]*?\n\}/);
if (!match) throw new Error("checkPassRuleWithPartial not found in resultsPage.js");
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const checkPassRuleWithPartial = new Function(
  `${match[0]}\n;return checkPassRuleWithPartial;`,
)() as (rule: unknown, percent: number, earnedScore: number) => boolean;

describe("checkPassRuleWithPartial — PRD-10 FR-10", () => {
  it("no rule => passes", () => {
    expect(checkPassRuleWithPartial(null, 0, 0)).toBe(true);
  });

  it("percent rule compares the graded percent", () => {
    expect(checkPassRuleWithPartial({ type: "percent", value: 60 }, 60, 0)).toBe(true);
    expect(checkPassRuleWithPartial({ type: "percent", value: 60 }, 59.9, 99)).toBe(false);
  });

  it("count rule compares Σs (earned points), not the question count", () => {
    // 3 points from a single heavy question clears "count >= 2".
    expect(checkPassRuleWithPartial({ type: "count", value: 2 }, 0, 3)).toBe(true);
    expect(checkPassRuleWithPartial({ type: "count", value: 2 }, 0, 1)).toBe(false);
  });

  it("partial credit counts toward the count threshold", () => {
    expect(checkPassRuleWithPartial({ type: "count", value: 2 }, 0, 2.5)).toBe(true);
    expect(checkPassRuleWithPartial({ type: "count", value: 2 }, 0, 1.5)).toBe(false);
  });

  it("legacy exact + 1pt/question (Σs == correct count) is unchanged", () => {
    expect(checkPassRuleWithPartial({ type: "count", value: 2 }, 0, 2)).toBe(true);
    expect(checkPassRuleWithPartial({ type: "count", value: 2 }, 0, 1)).toBe(false);
  });
});
