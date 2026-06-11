/**
 * @module tests/effective-scoring
 *
 * Unit tests of the pure effective-scoring resolver (PRD-15 block D, FR-31/
 * FR-32/FR-34): the price chain override -> legacy -> section -> test ->
 * system, the graded-config chain override -> legacy -> system `exact`, the
 * contentHash staleness pin and the difficulty override.
 */

import { describe, it, expect } from "vitest";
import {
  resolveEffectiveScoring,
  resolveEffectiveDifficulty,
  SYSTEM_DEFAULT_POINTS,
  SYSTEM_DEFAULT_SCORING,
} from "../shared/scoring/effective-scoring";
import type { QuestionScoring } from "../shared/schema";

const weighted: QuestionScoring = { kind: "weighted", weights: [0, 1, 2] };

describe("resolveEffectiveScoring — points chain", () => {
  it("falls back to the system default (1 point) on empty input", () => {
    const r = resolveEffectiveScoring({});
    expect(r.points).toBe(SYSTEM_DEFAULT_POINTS);
    expect(r.source.points).toBe("system");
  });

  it("prefers the per-question override over every other link", () => {
    const r = resolveEffectiveScoring({
      override: { points: 5 },
      legacy: { points: 4 },
      defaults: { sectionDefaultPoints: 3, testDefaultPoints: 2 },
    });
    expect(r.points).toBe(5);
    expect(r.source.points).toBe("override");
  });

  it("uses the legacy question value before test-side defaults (transition)", () => {
    const r = resolveEffectiveScoring({
      legacy: { points: 4 },
      defaults: { sectionDefaultPoints: 3, testDefaultPoints: 2 },
    });
    expect(r.points).toBe(4);
    expect(r.source.points).toBe("legacy");
  });

  it("uses the section default before the test default", () => {
    const r = resolveEffectiveScoring({
      defaults: { sectionDefaultPoints: 3, testDefaultPoints: 2 },
    });
    expect(r.points).toBe(3);
    expect(r.source.points).toBe("section");
  });

  it("uses the test default when the section has none", () => {
    const r = resolveEffectiveScoring({ defaults: { testDefaultPoints: 2 } });
    expect(r.points).toBe(2);
    expect(r.source.points).toBe("test");
  });

  it("accepts a zero-point override (an explicit unscored question)", () => {
    const r = resolveEffectiveScoring({
      override: { points: 0 },
      defaults: { testDefaultPoints: 2 },
    });
    expect(r.points).toBe(0);
    expect(r.source.points).toBe("override");
  });

  it("skips malformed links instead of failing", () => {
    const r = resolveEffectiveScoring({
      override: { points: Number.NaN },
      legacy: { points: -1 },
      defaults: { sectionDefaultPoints: null, testDefaultPoints: 2 },
    });
    expect(r.points).toBe(2);
    expect(r.source.points).toBe("test");
  });
});

describe("resolveEffectiveScoring — graded config chain", () => {
  it("defaults to exact match (no partial credit)", () => {
    const r = resolveEffectiveScoring({});
    expect(r.scoring).toEqual(SYSTEM_DEFAULT_SCORING);
    expect(r.source.scoring).toBe("system");
  });

  it("prefers the override config over the legacy question config", () => {
    const tiered: QuestionScoring = {
      kind: "tiered",
      tiers: [{ when: { all: [{ lhs: "c", op: "==", rhs: "T" }] }, score: 2 }],
    };
    const r = resolveEffectiveScoring({
      override: { scoring: tiered },
      legacy: { scoring: weighted },
    });
    expect(r.scoring).toEqual(tiered);
    expect(r.source.scoring).toBe("override");
  });

  it("uses the legacy question config during the transition", () => {
    const r = resolveEffectiveScoring({ legacy: { scoring: weighted } });
    expect(r.scoring).toEqual(weighted);
    expect(r.source.scoring).toBe("legacy");
  });
});

describe("resolveEffectiveScoring — staleness pin", () => {
  it("flags the override stale when the question contentHash diverged", () => {
    const r = resolveEffectiveScoring({
      override: { scoring: weighted, pinnedContentHash: "old" },
      questionContentHash: "new",
    });
    expect(r.stale).toBe(true);
  });

  it("stays fresh when hashes match, are absent or there is no override", () => {
    expect(
      resolveEffectiveScoring({
        override: { scoring: weighted, pinnedContentHash: "same" },
        questionContentHash: "same",
      }).stale,
    ).toBe(false);
    expect(
      resolveEffectiveScoring({ override: { scoring: weighted } , questionContentHash: "x" }).stale,
    ).toBe(false);
    expect(resolveEffectiveScoring({ questionContentHash: "x" }).stale).toBe(false);
  });
});

describe("resolveEffectiveDifficulty", () => {
  it("prefers the per-test override", () => {
    expect(resolveEffectiveDifficulty(80, 50)).toBe(80);
  });

  it("falls back to the question difficulty when no override", () => {
    expect(resolveEffectiveDifficulty(null, 50)).toBe(50);
    expect(resolveEffectiveDifficulty(undefined, 50)).toBe(50);
    expect(resolveEffectiveDifficulty(Number.NaN, 50)).toBe(50);
  });
});
