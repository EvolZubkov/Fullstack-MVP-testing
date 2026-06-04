/**
 * @module schema-prd11-blueprint
 * @description Tests for PRD-11 draw-quota Zod schemas (tag draw quotas):
 * drawStratumSchema and drawBlueprintSchema.
 *
 * Covers (PRD-11 §3a, §4, FR-01/03/03b; §6):
 *   - stratum: `tag` non-empty (after normalization), normalized (trim/collapse),
 *     `count` integer >= 1, optional per-tag `mode`.
 *   - blueprint: bare non-empty `strata` list (no topic-level mode/granularity);
 *     unknown enum values rejected.
 *   - nullish() accepts null/undefined (= uniform draw, FR-02).
 *
 * The Σcount <= drawCount cross-field rule (FR-05) lives on the section body
 * (routes/tests.ts) since it needs the sibling drawCount, not here.
 */
import { describe, it, expect } from "vitest";
import { drawStratumSchema, drawBlueprintSchema } from "../shared/schema";

// ─── drawStratumSchema ───────────────────────────────────────────────────────

describe("drawStratumSchema", () => {
  it("accepts a tag with a positive integer count", () => {
    expect(() => drawStratumSchema.parse({ tag: "Базовые понятия", count: 2 })).not.toThrow();
  });

  it("accepts an optional per-tag mode", () => {
    expect(() => drawStratumSchema.parse({ tag: "t", count: 1, mode: "min" })).not.toThrow();
  });

  it("normalizes the tag (trim + collapse internal whitespace)", () => {
    const s = drawStratumSchema.parse({ tag: "  Анализ   рисков ", count: 1 });
    expect(s.tag).toBe("Анализ рисков");
  });

  it("rejects an empty or whitespace-only tag", () => {
    expect(() => drawStratumSchema.parse({ tag: "", count: 1 })).toThrow();
    expect(() => drawStratumSchema.parse({ tag: "   ", count: 1 })).toThrow();
  });

  it("rejects a tag longer than 50 chars after normalization", () => {
    expect(() => drawStratumSchema.parse({ tag: "x".repeat(51), count: 1 })).toThrow();
  });

  it("rejects count < 1 and non-integer count", () => {
    expect(() => drawStratumSchema.parse({ tag: "t", count: 0 })).toThrow();
    expect(() => drawStratumSchema.parse({ tag: "t", count: 1.5 })).toThrow();
  });

  it("rejects an unknown mode", () => {
    expect(() => drawStratumSchema.parse({ tag: "t", count: 1, mode: "all" })).toThrow();
  });
});

// ─── drawBlueprintSchema ─────────────────────────────────────────────────────

describe("drawBlueprintSchema", () => {
  it("accepts a bare non-empty strata list", () => {
    const b = drawBlueprintSchema.parse({ strata: [{ tag: "a", count: 1 }] });
    expect(b.strata).toHaveLength(1);
  });

  it("accepts per-tag modes on the strata", () => {
    expect(() =>
      drawBlueprintSchema.parse({
        strata: [
          { tag: "a", count: 2, mode: "exact" },
          { tag: "b", count: 1, mode: "min" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects empty strata (FR-06 / §6: empty is invalid)", () => {
    expect(() => drawBlueprintSchema.parse({ strata: [] })).toThrow();
  });

  it("rejects an unknown per-tag mode", () => {
    expect(() => drawBlueprintSchema.parse({ strata: [{ tag: "a", count: 1, mode: "all" }] })).toThrow();
  });

  it("nullish() accepts null and undefined (= uniform draw, FR-02)", () => {
    const n = drawBlueprintSchema.nullish();
    expect(() => n.parse(null)).not.toThrow();
    expect(() => n.parse(undefined)).not.toThrow();
  });
});
