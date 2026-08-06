/**
 * @module shared/formula/types
 *
 * AST, evaluation context and validation result types for the result-variable
 * formula DSL (PRD-2 §4.2). The DSL is intentionally restricted and never uses
 * `eval` / `Function`: source text is tokenized, parsed into the {@link Ast}
 * below, then walked by the evaluator and validator. The same shapes are mirrored
 * by the plain-JS runtime port (`server/scorm/template/app/dsl/formula.js`); a
 * golden corpus keeps the two implementations in parity (PRD-2 §12).
 */

/** Binary operators, lowest-to-highest precedence handled by the parser. */
export type BinaryOp =
  | "OR"
  | "AND"
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "+"
  | "-"
  | "*"
  | "/";

/** Accessor sources of the form `fn("arg").prop` (PRD-2 §4.2). */
export type AccessorFn = "topicById" | "topicByName" | "tag" | "scaleById" | "sectionById";

/** Zero-argument aggregate sources. */
export type NullaryFn = "countPassed" | "countTopics" | "avgPercent";

/** `fn(["k1","k2"], "level")` counting sources. */
export type CountFn = "countVars" | "countScales";

/** `fn(["k1","k2"], place).prop` scale-ranking sources (PRD-44 §5). */
export type ScaleRankFn = "topScale" | "bottomScale";

/**
 * Allowed properties of a ranked scale. `key` and `label` are strings, the rest numbers;
 * `tiedCount` is at least 1, so a report can branch on «два равно выраженных стиля»
 * instead of silently crowning one of them (FR-22).
 */
export const SCALE_RANK_PROPS: readonly string[] = ["key", "label", "value", "margin", "tiedCount"];

/** Allowed properties per accessor source. */
export const ACCESSOR_PROPS: Record<AccessorFn, readonly string[]> = {
  topicById: ["percent", "passed", "score"],
  topicByName: ["percent", "passed", "score"],
  tag: ["percent", "score", "maxScore", "count"],
  scaleById: ["raw", "normalized", "percent", "level", "label", "hasValue"],
  sectionById: ["percent", "passed", "completed"],
};

/** Parsed formula node. */
export type Ast =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "percent" }
  | { type: "score" }
  | { type: "accessor"; fn: AccessorFn; arg: string; prop: string }
  | { type: "var"; name: string }
  | { type: "nullary"; fn: NullaryFn }
  | { type: "count"; fn: CountFn; keys: string[]; level: string }
  | { type: "scaleRank"; fn: ScaleRankFn; keys: string[]; place: number; prop: string }
  | { type: "if"; cond: Ast; then: Ast; otherwise: Ast }
  | { type: "unary"; op: "NOT" | "neg"; operand: Ast }
  | { type: "binary"; op: BinaryOp; left: Ast; right: Ast };

/** A formula evaluates to one of these primitives (or `null` when undefined). */
export type FormulaValue = number | string | boolean | null;

export interface TopicResult {
  percent: number;
  passed: boolean;
  score: number;
}
export interface TagResult {
  percent: number;
  score: number;
  maxScore: number;
  count: number;
}
export interface ScaleResult {
  raw: number;
  normalized: number;
  percent: number;
  level: string;
  label: string;
  hasValue: boolean;
}
export interface SectionResult {
  percent: number;
  passed: boolean;
  completed: boolean;
}

/**
 * Runtime context passed to the evaluator. Missing keys resolve to neutral
 * defaults so a formula never throws on absent data (PRD-2 §4.2; NFR — formula
 * errors must not break attempt completion).
 */
export interface EvalContext {
  percent: number;
  /** Overall earned points across the test (Σ of per-topic earned points). */
  score: number;
  /**
   * Per-topic results. Keyed by the topic's UUID AND its custom code (when set),
   * so `topicById(...)` accepts either form.
   */
  topics: Record<string, TopicResult>;
  /**
   * Per-topic results keyed by topic NAME (for `topicByName(...)`). Optional —
   * an absent map resolves `topicByName` to neutral defaults.
   */
  topicsByName?: Record<string, TopicResult>;
  tags: Record<string, TagResult>;
  scales: Record<string, ScaleResult>;
  /**
   * The test's scale keys in AUTHORED order (`scales.sort_order`) — the tie-break for
   * `topScale`/`bottomScale` (PRD-44 FR-21). Optional: absent, the ranking falls back to
   * the key order of {@link scales}, which `computeScales` fills by iterating the scales
   * in `sort_order` anyway. Passing it explicitly keeps the rule from depending on object
   * key order surviving every host's serialisation.
   */
  scaleOrder?: string[];
  sections: Record<string, SectionResult>;
  vars: Record<string, FormulaValue>;
}

export type ValueType = "number" | "string" | "boolean";

/**
 * Reference sets the validator checks formulas against. Any set left `undefined`
 * disables its check. `scaleKeys` empty/undefined downgrades `scaleById` misses to
 * warnings (Этап A: scales are not implemented yet — PRD-2 §4.2).
 */
export interface ValidationRefs {
  /** Valid `topicById` args: every topic's UUID plus its custom code (when set). */
  topicIds?: Set<string>;
  /** Valid `topicByName` args: every topic's name. */
  topicNames?: Set<string>;
  scaleKeys?: Set<string>;
  sectionKeys?: Set<string>;
  /** Variables with a SMALLER sort_order — the only ones `var()` may reference. */
  priorVarNames?: Set<string>;
  /** Per-scale band levels; used to warn on `countScales` level arguments. */
  scaleBandLevels?: Record<string, Set<string>>;
}

export interface ValidationMessage {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  returnType: ValueType | "unknown";
}

/** Thrown by the tokenizer/parser on malformed source. */
export class FormulaSyntaxError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}
