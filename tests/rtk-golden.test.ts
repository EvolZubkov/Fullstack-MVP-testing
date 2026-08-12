/**
 * @module tests/rtk-golden
 * @description PRD-10 Stage 6 — end-to-end golden test against the RTK manager
 * certification reference. Proves the platform reproduces the external pandas
 * post-processor: the authoritative scoring engine (shared/scoring/engine.ts),
 * configured with the RTK-standard scoring rules, must yield the exact per-answer
 * score the external tool produced.
 *
 * Fixture `tests/fixtures/rtk-golden.json` was generated from the RTK reference:
 *   - key:    docs/references/.../Обработка серт теста/key_NEW_15-08-25.xlsx
 *   - report: docs/references/.../report_processed_pandas_2026-03-12_11-36-05.xlsx
 *   - rules:  docs/references/main/main.py (the pandas post-processor)
 * It holds 63 real answers (1 certified manager) across all 4 question types:
 * single weighted (option weights), single exact (0/1), multiple (non-additive
 * step table over c/x/T) and matching (step table over c/P). Each entry carries
 * the engine inputs plus the expected `score`/`sMax` from the pandas report.
 *
 * The fixture was self-validated at generation time (the RTK rules reproduce all
 * 63 report scores); this test confirms test-builder's own engine matches them —
 * i.e. the SCORM package computes the certification without the external Excel
 * step (scoring-model §11; PRD-10 §1.2, §9, FR-01..FR-07).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAnswer } from "../shared/scoring/engine";
import { questionScoringSchema, type QuestionScoring } from "../shared/schema";

interface GoldenEntry {
  code: string;
  type: "single" | "multiple" | "matching" | "ranking";
  correct: Record<string, unknown>;
  answer: unknown;
  scoring: QuestionScoring | null;
  expectedScore: number;
  expectedSMax: number;
}

const fixture: GoldenEntry[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/rtk-golden.json"), "utf8"),
);

describe("RTK certification golden", () => {
  it("covers 63 real answers across all RTK scoring kinds", () => {
    expect(fixture).toHaveLength(63);
    expect(fixture.some((e) => e.scoring?.kind === "weighted")).toBe(true);
    expect(fixture.some((e) => e.scoring?.kind === "tiered" && e.type === "multiple")).toBe(true);
    expect(fixture.some((e) => e.scoring?.kind === "tiered" && e.type === "matching")).toBe(true);
    expect(fixture.some((e) => e.scoring === null)).toBe(true);
  });

  it("every scoring config in the fixture is valid (FR-13)", () => {
    for (const e of fixture) {
      if (e.scoring !== null) {
        expect(() => questionScoringSchema.parse(e.scoring)).not.toThrow();
      }
    }
  });

  it.each(fixture)("$code reproduces pandas score $expectedScore / $expectedSMax", (e) => {
    const r = scoreAnswer({
      type: e.type,
      correct: e.correct,
      answer: e.answer as never,
      scoring: e.scoring,
    });
    expect(r.score).toBe(e.expectedScore);
    expect(r.sMax).toBe(e.expectedSMax);
  });
});
