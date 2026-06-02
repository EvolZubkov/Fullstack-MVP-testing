/**
 * @module shared/formula/formula.test
 *
 * Unit tests for the result-variable formula DSL: tokenizer, parser precedence,
 * evaluator and validator (PRD-2 §4.2–4.3). The golden parity corpus against the
 * runtime JS port is added in A3.
 */

import { describe, it, expect } from "vitest";
import { parse } from "./parser";
import { evaluate } from "./evaluator";
import { validate } from "./validate";
import { tokenize } from "./tokens";
import type { EvalContext } from "./types";

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    percent: 80,
    topics: {
      t1: { percent: 80, passed: true, score: 8 },
      t2: { percent: 40, passed: false, score: 4 },
    },
    tags: { "scale:EE": { percent: 50, score: 5, maxScore: 10, count: 2 } },
    scales: { leadership: { raw: 7, normalized: 0.7, percent: 70, level: "high", label: "Высокий", hasValue: true } },
    sections: { sec1: { percent: 90, passed: true, completed: true } },
    vars: { ee_score: 12, category: "high" },
    ...overrides,
  };
}

const ev = (src: string, c: EvalContext = ctx()) => evaluate(parse(src), c);

describe("tokenizer", () => {
  it("splits numbers, strings, idents, ops and punct", () => {
    const kinds = tokenize('IF(percent >= 90, "Expert", x)').map((t) => `${t.type}:${t.value}`);
    expect(kinds).toContain("ident:IF");
    expect(kinds).toContain("op:>=");
    expect(kinds).toContain("string:Expert");
    expect(kinds[kinds.length - 1]).toBe("eof:");
  });

  it("throws on an unterminated string", () => {
    expect(() => tokenize('"oops')).toThrow();
  });
});

describe("parser precedence", () => {
  it("multiplication binds tighter than addition", () => {
    expect(ev("2 + 3 * 4")).toBe(14);
  });
  it("arithmetic binds tighter than comparison", () => {
    expect(ev("1 + 1 = 2")).toBe(true);
  });
  it("AND binds tighter than OR", () => {
    expect(ev("true OR false AND false")).toBe(true);
  });
  it("NOT binds tighter than AND", () => {
    expect(ev("NOT true AND true")).toBe(false);
  });
  it("parentheses override precedence", () => {
    expect(ev("(2 + 3) * 4")).toBe(20);
  });
  it("rejects a trailing operator", () => {
    expect(() => parse("percent >")).toThrow();
  });
});

describe("evaluator — sources", () => {
  it("percent and topic accessors", () => {
    expect(ev("percent")).toBe(80);
    expect(ev('topicById("t1").percent')).toBe(80);
    expect(ev('topicById("t1").passed')).toBe(true);
    expect(ev('topicById("t2").passed')).toBe(false);
  });
  it("missing accessor keys fall back to neutral defaults", () => {
    expect(ev('topicById("nope").percent')).toBe(0);
    expect(ev('scaleById("nope").level')).toBe("");
    expect(ev('scaleById("nope").hasValue')).toBe(false);
    expect(ev('sectionById("nope").completed')).toBe(false);
  });
  it("tag, scale and section accessors", () => {
    expect(ev('tag("scale:EE").count')).toBe(2);
    expect(ev('scaleById("leadership").level')).toBe("high");
    expect(ev('sectionById("sec1").percent')).toBe(90);
  });
  it("var resolves known and unknown names", () => {
    expect(ev('var("ee_score")')).toBe(12);
    expect(ev('var("missing")')).toBe(null);
  });
  it("nullary aggregates over topics", () => {
    expect(ev("countTopics()")).toBe(2);
    expect(ev("countPassed()")).toBe(1);
    expect(ev("avgPercent()")).toBe(60);
  });
  it("count functions", () => {
    expect(ev('countVars(["category"], "high")')).toBe(1);
    expect(ev('countScales(["leadership"], "high")')).toBe(1);
    expect(ev('countScales(["leadership"], "low")')).toBe(0);
  });
});

describe("evaluator — operations & safety", () => {
  it("IF selects a branch by truthiness", () => {
    expect(ev('IF(percent >= 90, "Expert", "Beginner")')).toBe("Beginner");
    expect(ev('IF(percent >= 70, "Advanced", "Beginner")')).toBe("Advanced");
  });
  it("comparisons over strings and numbers", () => {
    expect(ev('scaleById("leadership").level = "high"')).toBe(true);
    expect(ev("percent != 80")).toBe(false);
  });
  it("division by zero is a safe 0", () => {
    expect(ev("10 / 0")).toBe(0);
  });
  it("unary negation and NOT", () => {
    expect(ev("-5 + 2")).toBe(-3);
    expect(ev("NOT (1 = 1)")).toBe(false);
  });
  it("weighted-sum example (PRD-2 §4.1)", () => {
    expect(ev('topicById("t1").percent * 0.5 + topicById("t2").percent * 0.5')).toBe(60);
  });
});

describe("validator", () => {
  it("accepts a well-typed boolean formula", () => {
    const r = validate("percent >= 75", "boolean", {});
    expect(r.valid).toBe(true);
    expect(r.returnType).toBe("boolean");
  });
  it("flags a return-type mismatch", () => {
    const r = validate("percent", "boolean", {});
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "type-mismatch")).toBe(true);
  });
  it("infers IF string result", () => {
    expect(validate('IF(1 = 1, "a", "b")', "string", {}).returnType).toBe("string");
  });
  it("reports a syntax error as invalid", () => {
    const r = validate("percent >", "number", {});
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe("syntax");
  });
  it("errors on an unknown topic but accepts a known one", () => {
    expect(validate('topicById("x").percent', "number", { topicIds: new Set(["x"]) }).valid).toBe(true);
    const bad = validate('topicById("x").percent', "number", { topicIds: new Set(["y"]) });
    expect(bad.errors.some((e) => e.code === "unknown-topic")).toBe(true);
  });
  it("warns (not errors) on scaleById while scales are unavailable", () => {
    const r = validate('scaleById("s").level', "string", { scaleKeys: new Set() });
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.code === "scale-unresolved")).toBe(true);
  });
  it("enforces var() forward-reference order (DAG)", () => {
    expect(validate('var("v")', "number", { priorVarNames: new Set() }).errors.some((e) => e.code === "var-order")).toBe(true);
    expect(validate('var("v")', "number", { priorVarNames: new Set(["v"]) }).valid).toBe(true);
  });
  it("warns on a countScales level outside the scale bands", () => {
    const r = validate('countScales(["s"], "bad") = 1', "boolean", {
      scaleBandLevels: { s: new Set(["high", "low"]) },
    });
    expect(r.warnings.some((w) => w.code === "count-scales-level")).toBe(true);
  });
});
