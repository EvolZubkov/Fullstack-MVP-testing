/**
 * @module shared/formula/result-variables.test
 *
 * Test suite for the A7 runtime result step (computeResultVariables). Verifies
 * the correctness-critical behaviours the SCORM runtime depends on (PRD-2 §5.1):
 * sort_order evaluation, var() chaining, error isolation, controls_status
 * derivation, type handling and recovery determinism. The same scenarios are run
 * against the runtime JS port in tests/formula-port.test.ts.
 */

import { describe, it, expect } from "vitest";
import { computeResultVariables, type ResultVariableSpec } from "./result-variables";
import type { EvalContext } from "./types";

function base(overrides: Partial<Omit<EvalContext, "vars">> = {}): Omit<EvalContext, "vars"> {
  return {
    percent: 80,
    topics: {
      t1: { percent: 90, passed: true, score: 9 },
      t2: { percent: 40, passed: false, score: 4 },
    },
    tags: { "scale:EE": { percent: 60, score: 6, maxScore: 10, count: 3 } },
    scales: { leadership: { raw: 12, normalized: 0.8, percent: 80, level: "high", label: "Высокий", hasValue: true } },
    sections: { sec1: { percent: 70, passed: true, completed: true } },
    ...overrides,
  };
}

const rv = (
  name: string,
  formula: string,
  extra: Partial<ResultVariableSpec> = {},
): ResultVariableSpec => ({ name, type: "number", formula, ...extra });

describe("computeResultVariables — ordering & var() chaining", () => {
  it("evaluates in sort_order regardless of array order", () => {
    const out = computeResultVariables(
      [rv("b", 'var("a") + 1', { sortOrder: 1 }), rv("a", "percent", { sortOrder: 0 })],
      base(),
    );
    expect(out.values).toEqual({ a: 80, b: 81 });
    expect(out.errors).toEqual([]);
  });

  it("a var() to a not-yet-computed variable resolves to null at runtime", () => {
    const out = computeResultVariables(
      [rv("a", 'var("b")', { sortOrder: 0 }), rv("b", "percent", { sortOrder: 1 })],
      base(),
    );
    expect(out.values.a).toBe(null);
    expect(out.values.b).toBe(80);
  });

  it("publishes each value into result.* under its name", () => {
    const out = computeResultVariables(
      [
        rv("ee", "topicById(\"t1\").percent", { sortOrder: 0 }),
        rv("level", 'IF(var("ee") >= 90, "Expert", "Beginner")', { type: "string", sortOrder: 1 }),
      ],
      base(),
    );
    expect(out.values).toEqual({ ee: 90, level: "Expert" });
  });
});

describe("computeResultVariables — error isolation (NFR)", () => {
  it("captures a formula error without aborting the rest", () => {
    const out = computeResultVariables(
      [
        rv("good", "percent", { sortOrder: 0 }),
        rv("bad", "percent >", { sortOrder: 1 }), // syntax error
        rv("after", "1 + 1", { sortOrder: 2 }),
      ],
      base(),
    );
    expect(out.values.good).toBe(80);
    expect(out.values.bad).toBe(null);
    expect(out.values.after).toBe(2);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].name).toBe("bad");
  });

  it("division by zero is a safe value, not an error", () => {
    const out = computeResultVariables([rv("x", "10 / 0")], base());
    expect(out.values.x).toBe(0);
    expect(out.errors).toEqual([]);
  });
});

describe("computeResultVariables — controls_status override", () => {
  it("a true boolean success controller sets status.success = true", () => {
    const out = computeResultVariables(
      [rv("passed", "percent >= 75", { type: "boolean", controlsStatus: "success" })],
      base(),
    );
    expect(out.status).toEqual({ success: true });
  });

  it("a false boolean controller sets the status to false", () => {
    const out = computeResultVariables(
      [rv("passed", "percent >= 90", { type: "boolean", controlsStatus: "success" })],
      base(),
    );
    expect(out.status).toEqual({ success: false });
  });

  it("controls_status = completion is independent of success", () => {
    const out = computeResultVariables(
      [
        rv("done", "countPassed() >= 1", { type: "boolean", controlsStatus: "completion" }),
        rv("won", "percent >= 75", { type: "boolean", controlsStatus: "success" }),
      ],
      base(),
    );
    expect(out.status).toEqual({ completion: true, success: true });
  });

  it("controls_status = none does not affect status", () => {
    const out = computeResultVariables(
      [rv("flag", "percent >= 75", { type: "boolean", controlsStatus: "none" })],
      base(),
    );
    expect(out.status).toEqual({});
  });

  it("a non-boolean (errored) controller does not override status", () => {
    const out = computeResultVariables(
      [rv("broken", "percent >", { type: "boolean", controlsStatus: "success" })],
      base(),
    );
    expect(out.status).toEqual({});
    expect(out.errors).toHaveLength(1);
  });
});

describe("computeResultVariables — recovery determinism (NFR-04)", () => {
  it("recomputes identically from the same inputs", () => {
    const vars: ResultVariableSpec[] = [
      rv("ee", "topicById(\"t1\").percent", { sortOrder: 0 }),
      rv("cat", 'IF(percent >= 90, "Expert", IF(percent >= 70, "Advanced", "Beginner"))', { type: "string", sortOrder: 1 }),
      rv("ok", 'var("ee") >= 50', { type: "boolean", controlsStatus: "success", sortOrder: 2 }),
    ];
    const first = computeResultVariables(vars, base());
    const second = computeResultVariables(vars, base());
    expect(second).toEqual(first);
    expect(first.values).toEqual({ ee: 90, cat: "Advanced", ok: true });
    expect(first.status).toEqual({ success: true });
  });

  it("does not mutate the input array order", () => {
    const vars = [rv("b", "1", { sortOrder: 1 }), rv("a", "2", { sortOrder: 0 })];
    computeResultVariables(vars, base());
    expect(vars.map((v) => v.name)).toEqual(["b", "a"]);
  });
});
