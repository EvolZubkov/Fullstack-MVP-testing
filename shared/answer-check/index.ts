/**
 * @module shared/answer-check
 *
 * Public face of the open-answer comparison engine (PRD-57 §6.1). Hosts import from
 * here; the SCORM package receives the same functions through
 * `shared/template/runtime-entry`, so there is no per-host copy (FR-28s).
 */
export { normalizeForCompare } from "./normalize";
export { matchWildcard } from "./wildcard";
export { compileExpression, matchExpression } from "./regex";
export { DEFAULT_BUDGET_MS, DEFAULT_WARN_MS, measure, provocations } from "./budget";
export { simplifyExpression } from "./simplify";
export { parseNumericAnswer, matchNumber, type NumericOp, type NumericRule } from "./number";
export {
  checkRuleSet,
  hasRules,
  type AnswerRule,
  type AnswerRuleSet,
  type RuleSetOutcome,
  type RuleVerdict,
  type RuleVerdicts,
  type TextRule,
} from "./rules";
