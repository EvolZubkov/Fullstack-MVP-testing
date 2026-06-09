/**
 * @module shared/formula/result-variables
 *
 * Computes the `result.*` namespace from a test's result variables (PRD-2 §5.1).
 * This is the correctness-critical core of the SCORM runtime's result step (A7):
 * given the variables (ordered by `sort_order`) and the base evaluation context
 * built from standard scoring, it evaluates each formula in order — so a later
 * variable's `var("earlier")` resolves to the already-computed value — collects
 * per-variable formula errors without aborting the rest (NFR: a formula error
 * must not break attempt completion), and derives the `controls_status` override
 * for `cmi.success_status` / `cmi.completion_status` from the boolean controllers.
 *
 * The runtime calls the plain-JS twin `FormulaDSL.computeResultVariables`
 * (server/scorm/template/app/dsl/formula.js); a golden parity test keeps them
 * identical.
 */

import { parse } from "./parser";
import { evaluate } from "./evaluator";
import type { EvalContext, FormulaValue, ValueType } from "./types";

/** The subset of a result variable the computation needs. */
export interface ResultVariableSpec {
  name: string;
  type: ValueType;
  formula: string;
  controlsStatus?: "none" | "success" | "completion";
  sortOrder?: number;
}

export interface ResultComputation {
  /** `result.{name}` values, in evaluation (sort_order) order. */
  values: Record<string, FormulaValue>;
  /** Per-variable errors; the variable's value is `null` and others still run. */
  errors: Array<{ name: string; message: string }>;
  /** Status overrides from the boolean `controls_status` controllers, if any. */
  status: { success?: boolean; completion?: boolean };
}

/**
 * Evaluate all result variables against `base` (the context without `vars`).
 * Deterministic: the same inputs always yield the same output, so a recovered
 * attempt recomputes identically (NFR-04).
 */
export function computeResultVariables(
  vars: ResultVariableSpec[],
  base: Omit<EvalContext, "vars">,
): ResultComputation {
  const ordered = [...vars].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const computed: Record<string, FormulaValue> = {};
  const values: Record<string, FormulaValue> = {};
  const errors: Array<{ name: string; message: string }> = [];
  const status: { success?: boolean; completion?: boolean } = {};

  for (const v of ordered) {
    let value: FormulaValue = null;
    try {
      value = evaluate(parse(v.formula), { ...base, vars: computed });
    } catch (e) {
      errors.push({ name: v.name, message: e instanceof Error ? e.message : String(e) });
      value = null;
    }
    values[v.name] = value;
    computed[v.name] = value;

    if ((v.controlsStatus === "success" || v.controlsStatus === "completion") && typeof value === "boolean") {
      status[v.controlsStatus] = value;
    }
  }

  return { values, errors, status };
}
