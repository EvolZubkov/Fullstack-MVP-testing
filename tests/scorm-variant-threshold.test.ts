/**
 * @module tests/scorm-variant-threshold
 *
 * PRD-24 in the SCORM package. The verdict itself is not re-implemented here — both
 * hosts call the SAME shared engine (`aggregateStandardResult` via `TBTemplate`), so
 * parity holds by construction as long as the package FEEDS the engine the variant it
 * delivered. That wiring is what this file pins:
 *
 *  1. `generateVariant` (assets/app.js) records the chosen `formId` in the attempt state;
 *  2. `deliveredFormId` (render/resultsPage.js) reads that pin back, degrading to null
 *     for non-variant topics and for sessions saved before the pin existed (FR-09);
 *  3. both grading paths pass it into the resolver.
 *
 * Without the pin the runtime silently falls back to the overall rule, and a
 * `by_variant` topic would be graded by the wrong threshold — a regression no
 * shared-engine test could catch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";

const appSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
const resultsSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);

/** Extract the plain-JS `deliveredFormId` and bind it to an injected `state`. */
function makeDeliveredFormId(state: unknown): (topicId: string) => string | null {
  const match = resultsSrc.match(/function deliveredFormId\([\s\S]*?\n\}/);
  if (!match) throw new Error("deliveredFormId not found in resultsPage.js");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("state", `${match[0]}\n;return deliveredFormId;`)(state) as (
    topicId: string,
  ) => string | null;
}

describe("SCORM runtime pins the delivered variant (PRD-24 FR-08)", () => {
  it("generateVariant stores the chosen formId in the attempt state", () => {
    // the pushed section must carry the id picked by selectForm / the debug pin
    expect(appSrc).toMatch(/deliveredFormId = picked\.formId/);
    expect(appSrc).toMatch(/state\.variant\.sections\.push\(\{[\s\S]*?formId: deliveredFormId/);
  });

  it("оба расчёта переносят применённое правило наружу (иначе подпись «Требуется» пустеет)", () => {
    // calculateResults maps the shared result back into the runtime shape by hand —
    // a field left out there is silently lost, which is exactly how the label broke.
    expect(resultsSrc).toMatch(/resolvedPassRule: t.resolvedPassRule/);
    expect(resultsSrc).toMatch(/resolvedPassRule: resolvedRule/);
  });

  it("both grading paths feed the pin into the shared resolver", () => {
    // per-topic result screen + final aggregation
    expect(resultsSrc).toMatch(/resolveTopicRule\([\s\S]*?formId: deliveredFormId\(topicId\)/);
    expect(resultsSrc).toMatch(/formId: deliveredFormId\(fq\.topicId\)/);
  });
});

describe("deliveredFormId — reading the pin back", () => {
  it("returns the variant pinned for the topic", () => {
    const read = makeDeliveredFormId({
      variant: { sections: [{ topicId: "a", formId: "f1" }, { topicId: "b", formId: "f2" }] },
    });
    expect(read("a")).toBe("f1");
    expect(read("b")).toBe("f2");
  });

  it("degrades to null for a non-variant topic and for state saved before the pin", () => {
    const read = makeDeliveredFormId({
      variant: { sections: [{ topicId: "a" }] }, // legacy session: no formId
    });
    expect(read("a")).toBeNull();
    expect(read("missing")).toBeNull();
    expect(makeDeliveredFormId({})("a")).toBeNull(); // no variant at all
  });
});

describe("web ↔ SCORM parity on a by_variant verdict", () => {
  const rule = {
    source: "by_variant",
    byForm: { fA: { type: "percent", value: 50 }, fB: { type: "percent", value: 100 } },
  };
  const questions: AggregateSection["questions"] = [
    { type: "single", correct: { correctIndex: 0 }, scoring: null, points: 1, answer: 0 },
    { type: "single", correct: { correctIndex: 0 }, scoring: null, points: 1, answer: 1 },
  ];

  it("gives the same verdict for the same delivered variant on both hosts", () => {
    // The package hands the engine exactly this shape (topicPassRule from TEST_DATA +
    // the pinned formId); the web grader builds the identical input from variant_json.
    const run = (formId: string) =>
      aggregateStandardResult({
        overallPassRule: { type: "percent", value: 40 },
        sections: [{ topicId: "t", topicName: "T", topicPassRule: rule, formId, questions }],
      }).topicResults[0];

    expect(run("fA").passed).toBe(true); // 50% >= 50
    expect(run("fB").passed).toBe(false); // 50% < 100
    // the label source is the rule that actually gated the topic
    expect(run("fB").resolvedPassRule).toEqual({ type: "percent", value: 100 });
  });
});
