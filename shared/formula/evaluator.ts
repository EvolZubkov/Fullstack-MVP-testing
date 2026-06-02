/**
 * @module shared/formula/evaluator
 *
 * Tree-walking evaluator for the result-variable formula DSL (PRD-2 §4.2).
 * Walks an {@link Ast} against an {@link EvalContext} and returns a
 * {@link FormulaValue}. Never throws on absent data — missing accessor keys
 * resolve to neutral defaults, division by zero yields `0`, and unknown `var()`
 * resolves to `null` — so a malformed runtime context cannot break attempt
 * completion (NFR).
 */

import {
  type Ast,
  type EvalContext,
  type FormulaValue,
  type ScaleResult,
  type SectionResult,
  type TagResult,
  type TopicResult,
} from "./types";

const DEFAULT_TOPIC: TopicResult = { percent: 0, passed: false, score: 0 };
const DEFAULT_TAG: TagResult = { percent: 0, score: 0, maxScore: 0, count: 0 };
const DEFAULT_SCALE: ScaleResult = {
  raw: 0,
  normalized: 0,
  percent: 0,
  level: "",
  label: "",
  hasValue: false,
};
const DEFAULT_SECTION: SectionResult = { percent: 0, passed: false, completed: false };

function toNum(v: FormulaValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function toBool(v: FormulaValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return false;
}

function looseEquals(a: FormulaValue, b: FormulaValue): boolean {
  if (typeof a === typeof b) return a === b;
  // Mixed types compare numerically (e.g. score = 3).
  return toNum(a) === toNum(b);
}

/** Evaluate an AST node against a runtime context. */
export function evaluate(node: Ast, ctx: EvalContext): FormulaValue {
  switch (node.type) {
    case "number":
    case "string":
    case "boolean":
      return node.value;

    case "percent":
      return ctx.percent;

    case "accessor": {
      switch (node.fn) {
        case "topicById": {
          const t = ctx.topics[node.arg] ?? DEFAULT_TOPIC;
          return (t as unknown as Record<string, FormulaValue>)[node.prop];
        }
        case "tag": {
          const t = ctx.tags[node.arg] ?? DEFAULT_TAG;
          return (t as unknown as Record<string, FormulaValue>)[node.prop];
        }
        case "scaleById": {
          const s = ctx.scales[node.arg] ?? DEFAULT_SCALE;
          return (s as unknown as Record<string, FormulaValue>)[node.prop];
        }
        case "sectionById": {
          const s = ctx.sections[node.arg] ?? DEFAULT_SECTION;
          return (s as unknown as Record<string, FormulaValue>)[node.prop];
        }
      }
      return null;
    }

    case "var":
      return node.name in ctx.vars ? ctx.vars[node.name] : null;

    case "nullary": {
      const topics = Object.values(ctx.topics);
      switch (node.fn) {
        case "countPassed":
          return topics.filter((t) => t.passed).length;
        case "countTopics":
          return topics.length;
        case "avgPercent":
          return topics.length ? topics.reduce((sum, t) => sum + t.percent, 0) / topics.length : 0;
      }
      return 0;
    }

    case "count": {
      if (node.fn === "countVars") {
        return node.keys.filter((k) => k in ctx.vars && String(ctx.vars[k]) === node.level).length;
      }
      // countScales
      return node.keys.filter((k) => (ctx.scales[k]?.level ?? "") === node.level).length;
    }

    case "if":
      return toBool(evaluate(node.cond, ctx))
        ? evaluate(node.then, ctx)
        : evaluate(node.otherwise, ctx);

    case "unary":
      return node.op === "NOT" ? !toBool(evaluate(node.operand, ctx)) : -toNum(evaluate(node.operand, ctx));

    case "binary": {
      const { op } = node;
      if (op === "AND") return toBool(evaluate(node.left, ctx)) && toBool(evaluate(node.right, ctx));
      if (op === "OR") return toBool(evaluate(node.left, ctx)) || toBool(evaluate(node.right, ctx));

      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);

      switch (op) {
        case "=":
          return looseEquals(l, r);
        case "!=":
          return !looseEquals(l, r);
        case ">":
          return toNum(l) > toNum(r);
        case ">=":
          return toNum(l) >= toNum(r);
        case "<":
          return toNum(l) < toNum(r);
        case "<=":
          return toNum(l) <= toNum(r);
        case "+":
          return toNum(l) + toNum(r);
        case "-":
          return toNum(l) - toNum(r);
        case "*":
          return toNum(l) * toNum(r);
        case "/": {
          const d = toNum(r);
          return d === 0 ? 0 : toNum(l) / d; // division by zero is a safe runtime case
        }
      }
      return null;
    }
  }
}
