/**
 * @module tests/draw-blueprint-port
 *
 * Golden parity test for the PRD-11 stratified draw. The SCORM runtime uses a
 * hand-maintained plain-JS port (server/scorm/assets/app.js `drawSection`) of the
 * authoritative TypeScript engine (shared/draw/blueprint.ts). Both run over a
 * shared set of scenarios (and two deterministic shuffles) so they can never
 * silently diverge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drawSection as tsDraw, type DrawableQuestion } from "../shared/draw/blueprint";
import type { DrawBlueprint } from "../shared/schema";

const src = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
const match = src.match(/function drawSection\([^)]*\)\s*\{[\s\S]*?\n\}/);
if (!match) throw new Error("drawSection not found in assets/app.js");
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const portDraw = new Function(`${match[0]}\n;return drawSection;`)() as typeof tsDraw;

const identity = <T,>(a: T[]): T[] => a;
const reverse = <T,>(a: T[]): T[] => a.slice().reverse();

function q(id: string, ...tags: string[]): DrawableQuestion {
  return { id, tags };
}
const QS = [q("1", "A"), q("2", "A"), q("3", "B"), q("4", "B"), q("5"), q("6", "A", "B")];

const scenarios: Array<{ name: string; qs: DrawableQuestion[]; drawCount: number; bp: DrawBlueprint | null }> = [
  { name: "uniform / no blueprint", qs: QS, drawCount: 3, bp: null },
  { name: "empty strata -> uniform", qs: QS, drawCount: 2, bp: { strata: [] } },
  { name: "exact single stratum", qs: QS, drawCount: 3, bp: { strata: [{ tag: "A", count: 2 }] } },
  { name: "exact two strata + dedup", qs: QS, drawCount: 4, bp: { strata: [{ tag: "A", count: 2 }, { tag: "B", count: 2 }] } },
  { name: "min stratum grows in remainder", qs: QS, drawCount: 4, bp: { strata: [{ tag: "A", count: 2, mode: "min" }] } },
  { name: "per-tag mixed modes", qs: QS, drawCount: 4, bp: { strata: [{ tag: "A", count: 1, mode: "exact" }, { tag: "B", count: 1, mode: "min" }] } },
  { name: "shortfall warning", qs: QS, drawCount: 6, bp: { strata: [{ tag: "A", count: 5 }] } },
  { name: "case-insensitive tag match", qs: [q("1", "Финансы"), q("2", " финансы "), q("3", "Прочее")], drawCount: 3, bp: { strata: [{ tag: "финансы", count: 2 }] } },
];

describe("stratified draw — TS ↔ JS port parity", () => {
  for (const sh of [{ n: "identity", f: identity }, { n: "reverse", f: reverse }]) {
    it.each(scenarios)(`[${sh.n}] $name`, ({ qs, drawCount, bp }) => {
      const a = tsDraw(qs, drawCount, bp, sh.f);
      const b = portDraw(qs, drawCount, bp, sh.f);
      expect(b.selected.map((x) => x.id)).toEqual(a.selected.map((x) => x.id));
      expect(b.warnings).toEqual(a.warnings);
    });
  }
});
