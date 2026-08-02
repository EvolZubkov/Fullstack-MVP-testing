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
// The author-text pipeline: the package renders a prompt, an option and a page
// text field through the SAME functions as the web host, so the markdown subset
// and the typography cannot differ between a browser and an LMS.
export {
  renderInlineMarkdown,
  renderBlockMarkdown,
  stripMarkdown,
  renderPlainText,
  applyTypography,
  escapeHtml,
} from "../text";
export { renderResultField, CORE_RENDERER_IDS } from "./renderers";
export { renderScreenInto } from "./render-screen";
// PRD-34: защита текста задания. Периметр решает ОДИН построитель, применение — ядро,
// поэтому пакет получает ровно то же поведение, что и веб-хост (FR-30, FR-31).
export { buildProtectionSpec, formatWatermarkText, QUESTION_REGIONS } from "./protection/spec";
export { applyProtection, PROTECTED_ATTR } from "./protection/apply";
export { applyWatermark, MARK_SLOT } from "./protection/watermark";
export {
  normalizePool,
  dropOnRight,
  dropOnPoolSlot,
  returnToPool,
} from "./dnd/matching-model";
export { attachPointerDnd } from "./dnd/pointer-dnd";
export { buildResultContext, buildAdaptiveResultContext, buildSectionResultContext, buildSectionIntroContext } from "./result-context";
// PRD-29: the package assembles the measures input for the results screen ITSELF,
// to the very shape `server/services/result-context` assembles on the web host —
// so the two players draw the same scale/indicator cards. That needs the level
// ramp, the interpretation parsers and the feedback normaliser out here.
// `normalizeFeedback` is deliberately NOT idempotent (a normalised block has lost
// its `scormHref`), so it is the HOST's single pass over the test-level block; the
// band/outcome blocks are normalised inside the builder.
export { normalizeFeedback } from "./result-context";
export { LEVEL_SCHEMES } from "./level-ramp";
export { parseScaleInterpretation, parseIndicatorInterpretation } from "../scales/interpretation";
// PRD-18: the SINGLE standard result-aggregation + pass-rule engine shared by the
// SCORM runtime (resultsPage.js) and the web grader (attempts.ts).
export { aggregateStandardResult, aggregateAdaptiveResult } from "../scoring/aggregate";
export { resolveOverallRule, resolveTopicRule, checkPassRule } from "../scoring/pass-rule";
export { buildStartState } from "./start-state";
// PRD-22: the start illustration is a property of the START PAGE, with the branding
// param as the fallback. Exported so the package resolves it through the SAME rule
// the web host and the editor previews use.
export {
  resolveStartImageUrl,
  startImageForVariant,
  variantDeclaresStartImage,
  mediaUrlOf,
  START_IMAGE_KEY,
} from "./start-image";
export { buildCourseSubtitle } from "./course-subtitle";
export { buildTransitionContext } from "./transition-context";
export { buildTemplateCssVars, DEFAULT_PARAM_CSS_VARS } from "./params-css";
// Ревизия «Стандартный» на ui-kit: мост палитры теста в токены DS — оба хоста
// выводят DS-акцент из --primary теста, поэтому ученические экраны на .ou-разметке
// брендируются палитрой теста одинаково в вебе и в пакете.
export { buildPaletteBridge } from "./palette-bridge";
// Ревизия «Стандартный»: ЕДИНАЯ эмиссия интерактива вопросов (.ou-разметка эталона).
// Оба хоста зовут эти функции, поэтому DOM вариантов не расходится веб<->пакет.
export {
  renderSingleChoice,
  renderMultiple,
  renderRanking,
  renderMatching,
  renderScale,
  questionHint,
  answerTexts,
} from "./question-interaction";
// PRD-26: признаки типа вопроса и клавиатура шкалы. Рантайм пакета несёт ES5-зеркало
// признаков (app/utils/qtype.js), а клавиатуру берёт отсюда — считать индекс градации
// дважды нельзя, иначе хосты разойдутся в поведении стрелок.
export { nextScaleIndex } from "./scale-keyboard";
export {
  isSingleIndexChoice,
  hasOptionList,
  hasFixedOptionOrder,
  isMeasurementOnly,
} from "../questions/question-type";
// Ревизия «Стандартный»: состояние навигационной строки вопроса. Саму строку
// рисует МАКЕТ шаблона; хосты лишь кладут это состояние в контекст (state.nav).
export { buildQuestionNav, QUESTION_NAV_ACTIONS } from "./question-nav";
// Состояние подвала экрана результатов — строку рисует макет (results.html).
export { buildResultsNav, RESULTS_NAV_ACTIONS } from "./results-nav";
// Ревизия «Стандартный»: динамический размер шрифта вопроса/вариантов по длине —
// общая формула, оба хоста кладут результат в контекст, макет подставляет инлайном.
export { fitFont, questionFont, optionFont } from "./fit-font";
// Runtime HEIGHT-based fit: balance prompt (≤1/4 of the field) and option fonts so the
// question card fits without scrolling (both hosts call it after render).
export { fitQuestionScene } from "./fit-question";
// Ревизия «Стандартный»: единый DS-баннер проверки ответа (оба хоста, оба режима).
export { feedbackBanner, feedbackDesc } from "./feedback-banner";
// PRD-23: themed templates — the printer of per-theme colour overrides and the
// pinned-palette resolver, shared with the web host so both paint the same.
export { buildTemplateThemeCss, sceneThemeAttribute, baseParams, paramsOfTheme } from "./theme-css";
export { resolveThemeParams, paramsForTheme, colorParamKeys } from "./theme-params";
export {
  TEST_THEMES,
  THEME_IDS,
  declaredThemes,
  supportsThemes,
  resolveSceneTheme,
  isTestTheme,
  readTestTheme,
} from "./themes";
// Бюджет времени раздела: одна модель для веб-хоста и пакета (идёт только внутри
// раздела, выход замораживает остаток, возврат продолжает с него).
export * as sectionBudget from "../flow/section-budget";
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
// The attempt REPORT (PDF): one markup source and one export pipeline for both hosts.
// The package reaches them through this bundle; the web host imports them directly.
export { reportFileName, formatTimestamp as reportTimestamp } from "../report/report-html";
export { buildReportContext, buildAdaptiveReportContext } from "../report/report-context";
export { exportReportPdf, inlineReportImageValues } from "../report/export-pdf";
