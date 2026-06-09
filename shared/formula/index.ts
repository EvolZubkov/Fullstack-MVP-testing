/**
 * @module shared/formula
 *
 * Public entry point for the result-variable formula DSL (PRD-2 §4.2). Authoring
 * (server validation, editor) imports from here. The runtime SCORM package uses a
 * separate plain-JS port (`server/scorm/template/app/dsl/formula.js`) kept in
 * parity by a golden corpus.
 *
 * @example
 * import { parse, evaluate, validate } from "@shared/formula";
 * const v = validate('IF(percent >= 90, "Expert", "Beginner")', "string", { topicIds: new Set() });
 * if (v.valid) {
 *   const ast = parse('percent >= 75');
 *   const passed = evaluate(ast, ctx);
 * }
 */

export { parse } from "./parser";
export { evaluate } from "./evaluator";
export { validate } from "./validate";
export { tokenize } from "./tokens";
export {
  computeResultVariables,
  type ResultVariableSpec,
  type ResultComputation,
} from "./result-variables";
export {
  type Ast,
  type EvalContext,
  type FormulaValue,
  type ValidationRefs,
  type ValidationResult,
  type ValidationMessage,
  type ValueType,
  type TopicResult,
  type TagResult,
  type ScaleResult,
  type SectionResult,
  ACCESSOR_PROPS,
  FormulaSyntaxError,
} from "./types";
