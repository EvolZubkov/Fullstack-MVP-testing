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
export { buildResultContext, buildAdaptiveResultContext, buildSectionResultContext, buildSectionIntroContext } from "./result-context";
// PRD-18: the SINGLE standard result-aggregation + pass-rule engine shared by the
// SCORM runtime (resultsPage.js) and the web grader (attempts.ts).
export { aggregateStandardResult, aggregateAdaptiveResult } from "../scoring/aggregate";
export { resolveOverallRule, resolveTopicRule, checkPassRule } from "../scoring/pass-rule";
export { buildStartState } from "./start-state";
export { buildTransitionContext } from "./transition-context";
export { buildTemplateCssVars, DEFAULT_PARAM_CSS_VARS } from "./params-css";
// PRD-23: themed templates — the printer of per-theme colour overrides and the
// pinned-palette resolver, shared with the web host so both paint the same.
export { buildTemplateThemeCss, sceneThemeAttribute, baseParams, paramsOfTheme } from "./theme-css";
export { resolveThemeParams, paramsForTheme, colorParamKeys } from "./theme-params";
export { TEST_THEMES, THEME_IDS, declaredThemes, supportsThemes, isTestTheme, readTestTheme } from "./themes";
// PRD-19 Block C: progress-pills builder, shared by both hosts.
export { buildQuestionProgress } from "./question-progress-context";
// PRD-19 Block D: review/finish (обзор) screen builder.
export { buildReviewContext } from "./review-context";
// PRD-19: the ONE rule for «is the обзор worth showing at the end of the scope»,
// shared with the web host so the two players cannot answer it differently.
export { shouldShowReview } from "../flow/review-gate";
// PRD-12 FR-6: the SINGLE content-page assembler (skeleton + values), so a content
// page is built identically on both hosts.
export {
  buildContentPageSkeleton,
  buildFallbackContentHtml,
  buildContentPageRender,
  findContentTemplate,
  findDefaultContentTemplate,
  resolveContentTemplate,
  getPageValues,
  getPagePlaceholderStyles,
} from "./content-page";
// PRD-22: sequences of content pages — which pages form one, and the `page.*`
// context (navigation dots) their layout binds against. Shared so the LMS package,
// the web host and «Предпросмотр» count the same dots.
export {
  buildSequencePlacements,
  buildPageContext,
  buildPageContextFor,
  collectSequenceIds,
  sequenceIdOf,
  SEQUENCE_SETTING_KEY,
} from "./page-sequences";
// PRD-22 FR-36: relative links in author content resolve against the template's
// files — the base differs per host, the stored value does not.
export { withTemplateAssetBase, withTemplateAssetBaseInValues } from "./asset-base";
// PRD-22: the closed registry of field types a template may declare.
export {
  PLACEHOLDER_TYPES,
  SETTING_TYPES,
  INPUT_MODES,
  inputModesFor,
  isPlaceholderType,
  isSettingType,
  validateVariantFields,
} from "./field-types";
// PRD-12 FR-6: the SINGLE router-hub rules + markup, so a section is open (or not)
// identically in the LMS and on the web.
export {
  buildRouterHubHtml,
  isSectionUnlocked,
  isRouterReadyToFinish,
  statusLabel,
  pluralQuestions,
} from "../flow/router-hub";
// PRD-12 FR-6: the SINGLE page-sequence builder — which screens the learner gets
// and in what order. Both hosts consume it so «Структура» and the run cannot drift.
export {
  buildPageSequence,
  buildBeforeZone,
  buildAfterZone,
  buildTopicChunk,
  contentPagesFor,
  questionIndicesByTopic,
  isFlowContentPage,
} from "../flow/page-sequence";
