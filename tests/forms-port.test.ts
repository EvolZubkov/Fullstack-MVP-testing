/**
 * @module tests/forms-port
 *
 * Golden parity test for the PRD-17 (BR-12) variant selection. The SCORM runtime
 * uses a hand-maintained plain-JS port (server/scorm/assets/app.js `selectForm`) of
 * the authoritative TypeScript engine (shared/draw/forms.ts). Both run over a shared
 * set of scenarios (rotation, cycle-on-exhaustion, soft shortfall) and two
 * deterministic shuffles so they can never silently diverge.
 *
 * Bridging note: the TS engine takes `availableIds` as a `Set`; the JS twin takes an
 * object map (the app.js convention, matching `usedIds`). The test builds both from
 * the same id list so the two implementations see identical inputs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectForm as tsSelect } from "../shared/draw/forms";
import type { Form } from "../shared/schema";
import type { ShuffleFn } from "../shared/draw/blueprint";

const src = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
const match = src.match(/function selectForm\([^)]*\)\s*\{[\s\S]*?\n\}/);
if (!match) throw new Error("selectForm not found in assets/app.js");
type PortSelect = (
  forms: Form[],
  previousFormIds: string[],
  availableIds: Record<string, boolean> | null,
  shuffle: ShuffleFn,
) => { formId: string; questionIds: string[] };
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const portSelect = new Function(`${match[0]}\n;return selectForm;`)() as PortSelect;

const identity = <T,>(a: T[]): T[] => a;
const reverse = <T,>(a: T[]): T[] => a.slice().reverse();

function f(id: string, ...questionIds: string[]): Form {
  return { id, label: id, questionIds };
}
const FORMS: Form[] = [f("v1", "q1", "q2", "q3"), f("v2", "q3", "q4"), f("v3", "q5", "q6", "q7")];

const scenarios: Array<{ name: string; prev: string[]; avail: string[] | null }> = [
  { name: "no rotation, no bank filter", prev: [], avail: null },
  { name: "no rotation, full bank present", prev: [], avail: ["q1", "q2", "q3", "q4", "q5", "q6", "q7"] },
  { name: "rotation excludes v1", prev: ["v1"], avail: null },
  { name: "rotation excludes v1+v2", prev: ["v1", "v2"], avail: null },
  { name: "all used -> cycle resets candidates", prev: ["v1", "v2", "v3"], avail: null },
  { name: "soft shortfall: q3 removed from bank", prev: [], avail: ["q1", "q2", "q4", "q5", "q6", "q7"] },
  { name: "rotation + shortfall combined", prev: ["v1"], avail: ["q4", "q5", "q6"] },
];

describe("variant selection — TS ↔ JS port parity", () => {
  for (const sh of [{ n: "identity", f: identity as ShuffleFn }, { n: "reverse", f: reverse as ShuffleFn }]) {
    it.each(scenarios)(`[${sh.n}] $name`, ({ prev, avail }) => {
      const a = tsSelect(FORMS, {
        previousFormIds: prev,
        availableIds: avail ? new Set(avail) : null,
        shuffle: sh.f,
      });
      const map = avail ? Object.fromEntries(avail.map((id) => [id, true])) : null;
      const b = portSelect(FORMS, prev, map, sh.f);
      expect(b.formId).toEqual(a.formId);
      expect(b.questionIds).toEqual(a.questionIds);
    });
  }
});
