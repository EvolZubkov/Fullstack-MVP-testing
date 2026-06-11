/**
 * @module tests/draw-feasibility
 *
 * Unit tests of the pure draw-feasibility core (PRD-15 block A, FR-04; audit
 * matrix E-1/E-3/E-4/E-5/E-9): pool shortfalls vs drawCount, blueprint quota
 * shortfalls via the simulated draw, adaptive level pools with per-test
 * difficulty overrides, scale-contribution loss and the advisory drawAll
 * shrink.
 */

import { describe, it, expect } from "vitest";
import { checkDrawFeasibility } from "../shared/draw/feasibility";
import type { FeasibilityQuestion, DependentTestRequirement } from "../shared/draw/feasibility";

function q(id: string, tags: string[] = [], difficulty = 50): FeasibilityQuestion {
  return { id, tags, difficulty };
}

function test(partial: Partial<DependentTestRequirement>): DependentTestRequirement {
  return { testId: "t1", title: "Test 1", status: "published", ...partial };
}

describe("checkDrawFeasibility — pool vs drawCount (E-1)", () => {
  it("reports a pool shortfall when fewer questions remain than drawCount", () => {
    const out = checkDrawFeasibility({
      pool: [q("a"), q("b")],
      tests: [test({ section: { drawCount: 3, drawAll: false } })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].issues).toContainEqual({ kind: "pool_shortfall", required: 3, available: 2 });
  });

  it("stays silent when the pool satisfies the drawCount", () => {
    const out = checkDrawFeasibility({
      pool: [q("a"), q("b"), q("c")],
      tests: [test({ section: { drawCount: 3, drawAll: false } })],
    });
    expect(out).toHaveLength(0);
  });
});

describe("checkDrawFeasibility — blueprint quotas (E-3)", () => {
  it("reports per-tag quota shortfalls via the simulated draw", () => {
    const out = checkDrawFeasibility({
      pool: [q("a", ["финансы"]), q("b", ["право"]), q("c")],
      tests: [
        test({
          section: {
            drawCount: 3,
            drawAll: false,
            blueprint: { strata: [{ tag: "Финансы", count: 2 }] },
          },
        }),
      ],
    });
    expect(out[0].issues).toContainEqual({
      kind: "quota_shortfall",
      tag: "Финансы",
      requested: 2,
      available: 1,
    });
  });

  it("accepts a satisfiable blueprint (tag matching is normalized)", () => {
    const out = checkDrawFeasibility({
      pool: [q("a", ["Финансы"]), q("b", ["финансы"]), q("c")],
      tests: [
        test({
          section: {
            drawCount: 3,
            drawAll: false,
            blueprint: { strata: [{ tag: "финансы", count: 2 }] },
          },
        }),
      ],
    });
    expect(out).toHaveLength(0);
  });
});

describe("checkDrawFeasibility — adaptive levels (E-4)", () => {
  const levels = [
    { levelIndex: 0, levelName: "База", minDifficulty: 0, maxDifficulty: 49, questionsCount: 1 },
    { levelIndex: 1, levelName: "Профи", minDifficulty: 50, maxDifficulty: 100, questionsCount: 2 },
  ];

  it("reports a level whose pool fell below questionsCount", () => {
    const out = checkDrawFeasibility({
      pool: [q("a", [], 30), q("b", [], 70)],
      tests: [test({ adaptiveLevels: levels })],
    });
    expect(out[0].issues).toContainEqual({
      kind: "adaptive_shortfall",
      levelIndex: 1,
      levelName: "Профи",
      required: 2,
      available: 1,
    });
  });

  it("applies per-test difficulty overrides before bucketing (block D)", () => {
    // Question "b" is base-70, but THIS test overrides it to 30 — level 1 empties.
    const out = checkDrawFeasibility({
      pool: [q("a", [], 30), q("b", [], 70), q("c", [], 60)],
      tests: [test({ adaptiveLevels: levels, difficultyOverrides: { b: 30 } })],
    });
    expect(out[0].issues).toContainEqual({
      kind: "adaptive_shortfall",
      levelIndex: 1,
      levelName: "Профи",
      required: 2,
      available: 1,
    });
  });
});

describe("checkDrawFeasibility — scale contributions (E-5)", () => {
  it("reports removed questions that carry measurements in the test", () => {
    const out = checkDrawFeasibility({
      pool: [q("a")],
      removedQuestionIds: ["x", "y"],
      tests: [
        test({
          section: { drawCount: 1, drawAll: false },
          measurementQuestionIds: ["y", "z"],
        }),
      ],
    });
    expect(out[0].issues).toContainEqual({ kind: "measurement_loss", questionIds: ["y"] });
  });
});

describe("checkDrawFeasibility — formula loss (E-6)", () => {
  it("emits formula_loss when the service flags emptied formula tags", () => {
    const out = checkDrawFeasibility({
      pool: [q("a")],
      tests: [
        test({
          section: { drawCount: 1, drawAll: false },
          formulaLossVariableNames: ["Финансовый баланс"],
        }),
      ],
    });
    expect(out[0].issues).toContainEqual({
      kind: "formula_loss",
      variableNames: ["Финансовый баланс"],
    });
  });

  it("omits formula_loss when no variables are flagged", () => {
    const out = checkDrawFeasibility({
      pool: [q("a")],
      tests: [test({ section: { drawCount: 1, drawAll: false }, formulaLossVariableNames: [] })],
    });
    expect(out).toHaveLength(0);
  });
});

describe("checkDrawFeasibility — drawAll shrink (E-9, advisory)", () => {
  it("flags a drawAll section as advisory when the pool shrinks", () => {
    const out = checkDrawFeasibility({
      pool: [q("a"), q("b")],
      removedQuestionIds: ["c"],
      tests: [test({ section: { drawCount: 0, drawAll: true } })],
    });
    expect(out[0].issues).toEqual([
      { kind: "draw_all_shrink", removed: 1, remaining: 2, advisory: true },
    ]);
  });

  it("never reports pool/quota shortfalls for drawAll sections", () => {
    const out = checkDrawFeasibility({
      pool: [],
      tests: [test({ section: { drawCount: 10, drawAll: true } })],
    });
    expect(out).toHaveLength(0);
  });
});

describe("checkDrawFeasibility — aggregation", () => {
  it("returns one entry per affected test and omits feasible tests", () => {
    const out = checkDrawFeasibility({
      pool: [q("a")],
      tests: [
        test({ testId: "ok", section: { drawCount: 1, drawAll: false } }),
        test({ testId: "broken", section: { drawCount: 2, drawAll: false } }),
      ],
    });
    expect(out.map((r) => r.testId)).toEqual(["broken"]);
    expect(out[0].title).toBe("Test 1");
    expect(out[0].status).toBe("published");
  });
});
