/**
 * @module shared/template/runtime-entry
 *
 * Bundle entry for the SCORM package runtime (PRD-12 task 2-7). esbuild bundles
 * this module to a browser IIFE exposing the shared renderer on a single global
 * (`TBTemplate`), so the SCORM package consumes the SAME engines as the web host
 * — no hand-written plain-JS port to drift out of parity.
 *
 * Only browser-safe, framework-free modules belong here (no Node, no React).
 */

export { compileTemplate, renderTemplate } from "./dsl";
export { renderResultField, CORE_RENDERER_IDS } from "./renderers";
export { renderScreenInto } from "./render-screen";
export {
  normalizePool,
  dropOnRight,
  dropOnPoolSlot,
  returnToPool,
} from "./dnd/matching-model";
export { attachPointerDnd } from "./dnd/pointer-dnd";
export { buildResultContext, buildAdaptiveResultContext } from "./result-context";
// PRD-18: the SINGLE standard result-aggregation + pass-rule engine shared by the
// SCORM runtime (resultsPage.js) and the web grader (attempts.ts).
export { aggregateStandardResult, aggregateAdaptiveResult } from "../scoring/aggregate";
export { resolveOverallRule, resolveTopicRule, checkPassRule } from "../scoring/pass-rule";
export { buildStartState } from "./start-state";
export { buildTransitionContext } from "./transition-context";
export { buildTemplateCssVars, DEFAULT_PARAM_CSS_VARS } from "./params-css";
