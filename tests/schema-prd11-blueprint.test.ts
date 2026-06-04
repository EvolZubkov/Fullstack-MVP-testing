/**
 * @module schema-prd11-blueprint
 * @description Tests for PRD-11 draw-quota Zod schemas (tag draw quotas):
 * drawStratumSchema and drawBlueprintSchema.
 *
 * Covers (PRD-11 §4, FR-01/03/03b; §6):
 *   - stratum: `tag` non-empty, `count` integer >= 1, optional `mode`.
 *   - blueprint: `modeGranularity` defaults to "uniform", `mode` to "exact";
 *     `strata` is non-empty; unknown enum values rejected.
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
    expect(() => drawStratumSchema.parse({ tag: "finance_base", count: 2 })).not.toThrow();
  });

  it("accepts an optional per-tag mode", () => {
    expect(() => drawStratumSchema.parse({ tag: "t", count: 1, mode: "min" })).not.toThrow();
  });

  it("rejects an empty tag", () => {
    expect(() => drawStratumSchema.parse({ tag: "", count: 1 })).toThrow();
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
  it("defaults modeGranularity to uniform and mode to exact", () => {
    const b = drawBlueprintSchema.parse({ strata: [{ tag: "a", count: 1 }] });
    expect(b.modeGranularity).toBe("uniform");
    expect(b.mode).toBe("exact");
  });

  it("accepts an explicit per_tag blueprint", () => {
    expect(() =>
      drawBlueprintSchema.parse({
        modeGranularity: "per_tag",
        mode: "min",
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

  it("rejects an unknown modeGranularity or mode", () => {
    expect(() => drawBlueprintSchema.parse({ modeGranularity: "topic", strata: [{ tag: "a", count: 1 }] })).toThrow();
    expect(() => drawBlueprintSchema.parse({ mode: "all", strata: [{ tag: "a", count: 1 }] })).toThrow();
  });

  it("nullish() accepts null and undefined (= uniform draw, FR-02)", () => {
    const n = drawBlueprintSchema.nullish();
    expect(() => n.parse(null)).not.toThrow();
    expect(() => n.parse(undefined)).not.toThrow();
  });
});
