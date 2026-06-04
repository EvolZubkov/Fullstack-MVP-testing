/**
 * @module tests/draw-blueprint
 * @description Unit tests for the PRD-11 stratified-draw engine
 * (shared/draw/blueprint.ts). A deterministic identity "shuffle" keeps the
 * selection order = input order so every scenario is exactly asserted
 * (PRD-11 §3a, §5; FR-02/03/03a/03b/04/06). The blueprint is a bare list of
 * per-tag strata (mode per-tag, default "exact").
 */
import { describe, it, expect } from "vitest";
import { drawSection, type DrawableQuestion } from "../shared/draw/blueprint";
import type { DrawBlueprint } from "../shared/schema";

const identity = <T,>(a: T[]): T[] => a;
const ids = (qs: DrawableQuestion[]) => qs.map((q) => q.id);

function q(id: string, ...tags: string[]): DrawableQuestion {
  return { id, tags };
}

// A=finance_base, B=finance_metrics; q6 carries both (multi-tag).
const QS = [q("1", "A"), q("2", "A"), q("3", "B"), q("4", "B"), q("5"), q("6", "A", "B")];

describe("drawSection — uniform (no blueprint, FR-02)", () => {
  it("draws the first drawCount questions with an identity shuffle", () => {
    const r = drawSection(QS, 3, null, identity);
    expect(ids(r.selected)).toEqual(["1", "2", "3"]);
    expect(r.warnings).toEqual([]);
  });

  it("an empty-strata blueprint also falls back to uniform", () => {
    const r = drawSection(QS, 2, { strata: [] }, identity);
    expect(ids(r.selected)).toEqual(["1", "2"]);
  });
});

describe("drawSection — exact strata", () => {
  const bp: DrawBlueprint = { strata: [{ tag: "A", count: 2 }] };

  it("takes exactly count of the tag; remainder excludes the exact tag", () => {
    const r = drawSection(QS, 3, bp, identity);
    // A: [1,2]; remainder from non-A questions: 3 (B). q6 (A,B) is excluded.
    expect(ids(r.selected)).toEqual(["1", "2", "3"]);
    expect(r.warnings).toEqual([]);
  });

  it("a multi-tag question counts once (FR-04)", () => {
    const ordered = [q("6", "A", "B"), q("1", "A"), q("3", "B")];
    const two: DrawBlueprint = { strata: [{ tag: "A", count: 1 }, { tag: "B", count: 1 }] };
    const r = drawSection(ordered, 2, two, identity);
    // A picks q6; B then sees q6 as used and picks q3.
    expect(ids(r.selected)).toEqual(["6", "3"]);
  });

  it("a shortfall is a non-blocking warning (FR-06)", () => {
    const big: DrawBlueprint = { strata: [{ tag: "A", count: 5 }] };
    const r = drawSection(QS, 6, big, identity);
    // Only 3 A-tagged (1,2,6); takes all, warns about the shortfall.
    expect(r.warnings).toEqual([{ tag: "A", requested: 5, available: 3 }]);
    expect(ids(r.selected)).toEqual(["1", "2", "6", "3", "4", "5"]);
  });
});

describe("drawSection — min strata (FR-03a)", () => {
  it("takes count as a floor; remainder may include the same tag", () => {
    // min A=2, drawCount 4: A is not an exact tag, so step 2 can pull more A.
    const ordered = [q("1", "A"), q("2", "A"), q("6", "A", "B"), q("3", "B"), q("5")];
    const bp: DrawBlueprint = { strata: [{ tag: "A", count: 2, mode: "min" }] };
    const r = drawSection(ordered, 4, bp, identity);
    // step1 A: [1,2]; remainder 2 from non-exact (all remaining): [6,3].
    expect(ids(r.selected)).toEqual(["1", "2", "6", "3"]);
  });
});

describe("drawSection — per-tag mixed modes (FR-03b)", () => {
  it("uses each stratum's own mode", () => {
    const ordered = [q("1", "A"), q("2", "A"), q("3", "B"), q("4", "B"), q("5")];
    const bp: DrawBlueprint = {
      strata: [{ tag: "A", count: 1, mode: "exact" }, { tag: "B", count: 1, mode: "min" }],
    };
    const r = drawSection(ordered, 4, bp, identity);
    // step1: A exact -> [1]; B -> [3]. exactTags={A}. remainder 2 from non-A:
    // [4 (B), 5]. (q2 is A -> excluded; B is min so eligible.)
    expect(ids(r.selected)).toEqual(["1", "3", "4", "5"]);
  });
});

describe("drawSection — case-insensitive tag match (PRD-11 §3a)", () => {
  it("matches questions tagged with a different case/spacing than the quota", () => {
    const ordered = [q("1", "Финансы"), q("2", " финансы "), q("3", "Прочее")];
    const bp: DrawBlueprint = { strata: [{ tag: "финансы", count: 2 }] };
    const r = drawSection(ordered, 3, bp, identity);
    // Both "Финансы" and " финансы " normalize to the same key as the quota.
    expect(ids(r.selected)).toEqual(["1", "2", "3"]);
    expect(r.warnings).toEqual([]);
  });
});

describe("drawSection — never exceeds drawCount", () => {
  it("caps the selection at drawCount", () => {
    const bp: DrawBlueprint = { strata: [{ tag: "A", count: 2 }] };
    const r = drawSection(QS, 2, bp, identity);
    expect(r.selected).toHaveLength(2);
    expect(ids(r.selected)).toEqual(["1", "2"]);
  });
});
