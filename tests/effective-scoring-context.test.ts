/**
 * @module tests/effective-scoring-context
 *
 * Unit tests of the server-side effective-scoring context (PRD-15 block D,
 * FR-31/FR-32/FR-34; server/services/effective-scoring). The pure resolver is
 * covered by tests/effective-scoring.test.ts; here the wiring is the unit:
 * assembling the chain from DB-shaped rows (test row, sections, override rows).
 * After T-40 the question carries no points/scoring_json, so the chain is
 * override -> section default -> test default -> system default.
 */

import { describe, it, expect } from "vitest";
import { buildTestScoringContext } from "../server/services/effective-scoring";

const question = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "q1",
    topicId: "tp1",
    type: "single",
    difficulty: 50,
    contentHash: "h1",
    ...overrides,
  }) as any;

const overrideRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "ov1",
    testId: "t1",
    questionId: "q1",
    points: null,
    scoringJson: null,
    difficulty: null,
    pinnedContentHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as any;

describe("buildTestScoringContext — points chain from rows", () => {
  it("resolves the system default when nothing is configured", () => {
    const ctx = buildTestScoringContext(undefined, [], []);
    const eff = ctx.resolve(question());
    expect(eff.points).toBe(1);
    expect(eff.source.points).toBe("system");
  });

  it("prefers the override row over the chain defaults", () => {
    const ctx = buildTestScoringContext(
      { defaultQuestionPoints: 9 } as any,
      [{ topicId: "tp1", defaultPoints: 4 }] as any,
      [overrideRow({ points: 7 })],
    );
    const eff = ctx.resolve(question());
    expect(eff.points).toBe(7);
    expect(eff.source.points).toBe("override");
  });

  it("honours a zero-point override (unscored in THIS test)", () => {
    const ctx = buildTestScoringContext(undefined, [], [overrideRow({ points: 0 })]);
    const eff = ctx.resolve(question());
    expect(eff.points).toBe(0);
    expect(eff.source.points).toBe("override");
  });

  it("matches the section default by the question's topic (now reachable post-T-40)", () => {
    const ctx = buildTestScoringContext(
      { defaultQuestionPoints: 9 } as any,
      [
        { topicId: "tp1", defaultPoints: 4 },
        { topicId: "tp2", defaultPoints: 6 },
      ] as any,
      [],
    );
    // Section default wins for a question on a topic that has one.
    expect(ctx.resolve(question()).points).toBe(4);
    expect(ctx.resolve(question()).source.points).toBe("section");
    expect(ctx.resolve(question({ id: "q2", topicId: "tp2" })).points).toBe(6);
  });

  it("falls through to the test default when the section has none", () => {
    const ctx = buildTestScoringContext(
      { defaultQuestionPoints: 9 } as any,
      [{ topicId: "tp9", defaultPoints: 3 }] as any, // a different topic
      [],
    );
    const eff = ctx.resolve(question()); // topic tp1 has no section default
    expect(eff.points).toBe(9);
    expect(eff.source.points).toBe("test");
  });
});

describe("buildTestScoringContext — graded config and difficulty", () => {
  it("applies the override graded config", () => {
    const ctx = buildTestScoringContext(undefined, [], [
      overrideRow({ scoringJson: { kind: "weighted", weights: [1, 0] } }),
    ]);
    const eff = ctx.resolve(question());
    expect(eff.scoring).toEqual({ kind: "weighted", weights: [1, 0] });
    expect(eff.source.scoring).toBe("override");
  });

  it("defaults graded config to system exact when no override is set", () => {
    const ctx = buildTestScoringContext(undefined, [], []);
    const eff = ctx.resolve(question());
    expect(eff.scoring).toEqual({ kind: "exact" });
    expect(eff.source.scoring).toBe("system");
  });

  it("difficultyOf prefers the per-test override (FR-34)", () => {
    const ctx = buildTestScoringContext(undefined, [], [overrideRow({ difficulty: 90 })]);
    expect(ctx.difficultyOf(question({ difficulty: 30 }))).toBe(90);
    expect(ctx.difficultyOf(question({ id: "q2", difficulty: 30 }))).toBe(30);
  });

  it("flags a stale override via the contentHash pin (FR-30)", () => {
    const ctx = buildTestScoringContext(undefined, [], [
      overrideRow({ points: 5, pinnedContentHash: "old-hash" }),
    ]);
    expect(ctx.resolve(question({ contentHash: "new-hash" })).stale).toBe(true);
    expect(ctx.resolve(question({ contentHash: "old-hash" })).stale).toBe(false);
  });

  it("overrideFor exposes the raw row for the editor", () => {
    const row = overrideRow({ points: 5 });
    const ctx = buildTestScoringContext(undefined, [], [row]);
    expect(ctx.overrideFor("q1")).toBe(row);
    expect(ctx.overrideFor("q-other")).toBeUndefined();
  });
});
