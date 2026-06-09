/**
 * @module tests/result-compute
 *
 * Unit tests for the server-side graded-result orchestration (PRD-12 task 2-3,
 * server/services/result-compute.computeAttemptResult). Verifies the SCORM-mirrored
 * order (scales -> result variables), that formulas can read the topic/percent
 * context and the computed scales, the controls_status -> status derivation, and
 * the empty-config no-op. `loadScoringConfig` (DB I/O) is exercised by the route
 * tests; this suite keeps the compute path pure.
 */

import { describe, it, expect } from "vitest";
import { computeAttemptResult, type ScoringConfig } from "../server/services/result-compute";

const base = {
  percent: 80,
  topicResults: [{ topicId: "t1", percent: 90, passed: true, earnedPoints: 9 }],
};

describe("computeAttemptResult", () => {
  it("computes scales, then result variables that read percent/topic/scale context", () => {
    const config: ScoringConfig = {
      scales: [{ key: "EE", aggregation: "sum", normalization: "none", direction: "positive", bands: [] }],
      measurements: [
        { questionId: "q1", scaleKey: "EE", sourceType: "question", sourceKey: null, value: 5, weight: 1 },
      ],
      resultVariables: [
        { name: "pct", type: "number", formula: "percent", sortOrder: 0 },
        { name: "ee", type: "number", formula: 'topicById("t1").percent', sortOrder: 1 },
      ],
    };

    const out = computeAttemptResult(config, { q1: 0 }, { q1: "single" }, base);

    expect(out.scaleResults.EE.raw).toBe(5);
    expect(out.scaleResults.EE.hasValue).toBe(true);
    expect(out.resultVariables.pct).toBe(80);
    expect(out.resultVariables.ee).toBe(90);
  });

  it("derives a controls_status override from a boolean controller variable", () => {
    const config: ScoringConfig = {
      scales: [],
      measurements: [],
      resultVariables: [
        { name: "ok", type: "boolean", formula: "percent >= 50", controlsStatus: "success", sortOrder: 0 },
      ],
    };

    const out = computeAttemptResult(config, {}, {}, base);

    expect(out.resultVariables.ok).toBe(true);
    expect(out.status.success).toBe(true);
  });

  it("is a no-op (empty namespaces) when the test has no scales or variables", () => {
    const out = computeAttemptResult({ scales: [], measurements: [], resultVariables: [] }, {}, {}, base);
    expect(out.scaleResults).toEqual({});
    expect(out.resultVariables).toEqual({});
    expect(out.status).toEqual({});
  });
});
