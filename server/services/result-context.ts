/**
 * @module server/services/result-context
 *
 * Web-host adapter for the results render context (PRD-12 §10). It maps the
 * server-computed {@link AttemptResult} (overallPercent / overallPassed / total* …)
 * into the renderer's normalized input and delegates the actual shaping to the
 * SHARED builder ({@link module:shared/template/result-context}) — the SAME builder
 * the SCORM package runs via `TBTemplate`. So passClass / statusLabel / ring offset
 * / per-topic rows / adaptive level labels are produced in ONE place and cannot
 * drift between hosts. Pure — no storage, no DOM.
 */

import type { AttemptResult, TopicResult } from "@shared/schema";
import {
  buildResultContext as buildSharedResultContext,
  buildAdaptiveResultContext as buildSharedAdaptiveResultContext,
  normalizeFeedback,
  type ResultRenderContext,
  type TopicInput,
  type AdaptiveTopicInput,
} from "@shared/template/result-context";
import type { MeasureInput, MeasuresInput } from "@shared/template/result-context";
import type { ReportInput, AdaptiveReportInput, ReportMeta } from "@shared/report/report-html";
import { LEVEL_SCHEMES, type LevelRamp } from "@shared/template/level-ramp";
import { withResolvedScaleIcons } from "./scale-icons";
import { parseIndicatorInterpretation, parseScaleInterpretation } from "@shared/scales/interpretation";
import type { RenderKind } from "@shared/template/measure-view";
import type { ResultsBlockSettings } from "@shared/template/results-blocks";
import {
  resolveLabels,
  type LabelDeclaration,
  type LabelScreen,
  type LabelValues,
  type ResolvedLabels,
} from "@shared/template/labels";
import {
  templateBlockOrder as templateOrderForScreen,
  type ResultsBlockKey,
  type TemplateBlockOrder,
} from "@shared/template/results-order";
import { resolveReportIntro } from "@shared/schema";
import type { DesignSettings, FeedbackContent, ResultVariable, Scale, TestIntro } from "@shared/schema";
import type { ScaleResult } from "@shared/formula/types";

export type { ResultRenderContext };

/** Rows and computed values the measures block needs, gathered by the caller. */
export interface MeasuresSource {
  scales: Scale[];
  variables: ResultVariable[];
  /**
   * Вводные блоки теста (`tests.intro_json`) — текст экрана и текст отчёта.
   *
   * Лежат здесь по той же причине, что `testFeedback` и `hasPassThreshold`: это
   * материал ЭКРАНА ИТОГОВ, который маршрут собирает один раз и раздаёт обоим
   * построителям — контекста экрана и входа отчёта.
   */
  intro?: TestIntro | null;
  /**
   * Scale values of the attempt. Omitted by the web route: they are read from the
   * SAVED `AttemptResult` by {@link module:server/services/template-render
   * readResultsRenderPayload}, never recomputed — a later edit of the scale
   * configuration must not change what a finished attempt scored.
   */
  scaleResults?: Record<string, ScaleResult>;
  /** Indicator values of the attempt; same source and same rule as {@link scaleResults}. */
  variableValues?: Record<string, unknown>;
  /**
   * Effective design params of the test (already resolved against the template
   * manifest). Omitted by the web route: `readResultsRenderPayload` fills them from
   * the ONE resolution `readScreenTemplate` performs for the layout, so the ramp and
   * the render kinds cannot drift from the CSS the same screen is painted with.
   */
  params?: Record<string, unknown>;
  /** Settings of the chosen `results` variant. */
  blockSettings: ResultsBlockSettings;
  hasPassThreshold: boolean;
  /**
   * PRD-46 §5: do the shown scales divide one whole? Answered by the CALLER
   * (`ipsativeScalesForDelivery`), which is the only side holding the contribution rows and
   * the allocation budgets; this adapter is pure and only carries the answer across. Absent =
   * not ipsative, so `auto` draws the radar — what the screen did before this PRD.
   */
  ipsativeScales?: boolean;
  /**
   * The test's own feedback block AS STORED (`tests.feedback_json`): text, course
   * links, events and PDF assets whose address lives in `url` — the media-library
   * address; the legacy `scormHref` is read only where `url` is absent. PRD-29 §7.1
   * counts the test as one of the equal sources of recommendations, so the WHOLE block
   * travels — not just its text — and goes through the same {@link normalizeFeedback}
   * the band and outcome blocks go through.
   *
   * Gathered alongside the measurement rows only because ONE route read assembles both;
   * it is handed to the shared builder as its own `testFeedback` option, NOT inside
   * `measures` — a test without scales or indicators owes the learner its feedback all
   * the same.
   */
  testFeedback?: Partial<FeedbackContent> | null;
  /**
   * PRD-49: `manifest.labels[]` of the ACTIVE design template — the declarations the
   * author's wording is resolved against. Absent/empty = a template that declares no
   * labels, whose layouts print their own hard-coded strings (spec §9); the builders then
   * pass NO `labels` option at all, so the context keeps the shape it had before this PRD.
   */
  labelDeclarations?: readonly LabelDeclaration[] | null;
  /**
   * PRD-49: `manifest.resultsBlockOrder` of the ACTIVE design template — the per-screen
   * composition and order of the results sub-blocks. Read as declared, because the SCREEN
   * is chosen here: the standard and the adaptive builder resolve different lists out of
   * the one declaration.
   */
  templateBlockOrder?: TemplateBlockOrder | ResultsBlockKey[] | null;
  /**
   * PRD-49: design settings of the DELIVERED test (`design_settings_json`) — the author's
   * own label wording and their saved sub-block order. From the delivered version, like
   * every other field here, so a finished attempt shows the content it was taken on.
   */
  design?: DesignSettings | null;
}

/**
 * PRD-49. Effective labels of ONE screen for a delivered test: the manifest declarations
 * of the ACTIVE template, the test's own values on top. The report layer is applied by the
 * report builder, which knows its own overrides.
 *
 * An EMPTY map is returned for a template that declares nothing, and the callers treat it
 * as «this template has no labels»: it must not reach the context builder, or a screen
 * that had no `labels` key at all would gain an empty tree.
 */
export function resolveScreenLabels(
  declarations: readonly LabelDeclaration[] | undefined | null,
  design: DesignSettings | null | undefined,
  screen: LabelScreen,
  overrides: LabelValues = {},
): ResolvedLabels {
  if (!declarations?.length) return {};
  return resolveLabels({ declarations, values: design?.labels ?? {}, overrides, screen });
}

/**
 * PRD-49 options both results builders assemble the same way: the resolved labels of the
 * screen being built, the author's saved order and the template's own list for that
 * screen.
 *
 * ONE helper rather than two copies — the standard and the adaptive screen differ only in
 * WHICH screen they name, and a second copy of the resolution is exactly the drift this
 * PRD exists to remove. `labels` is spread in only when the template declares any (see
 * {@link resolveScreenLabels}); the other two are inert when nothing is declared, since
 * `templateBlockOrder` answers a silent manifest with the shipped order.
 */
function labelOptions(
  measures: MeasuresSource | undefined,
  screen: LabelScreen,
): {
  labels?: ResolvedLabels;
  blockOrder?: ResultsBlockKey[];
  templateBlockOrder?: readonly ResultsBlockKey[];
} {
  if (!measures) return {};
  const labels = resolveScreenLabels(measures.labelDeclarations, measures.design, screen);
  return {
    ...(Object.keys(labels).length ? { labels } : {}),
    ...(measures.design?.resultsBlockOrder ? { blockOrder: measures.design.resultsBlockOrder } : {}),
    templateBlockOrder: templateOrderForScreen(measures.templateBlockOrder, screen),
  };
}

/**
 * The ramp: a named scheme, or the author's three triples when `custom` is chosen.
 * A missing custom colour falls back to the traffic scheme's own end, so a
 * half-filled form still renders a sane ramp instead of a blank one.
 */
function resolveRamp(params: Record<string, unknown>): LevelRamp {
  const scheme = String(params.levelScheme ?? "traffic");
  if (scheme !== "custom") return LEVEL_SCHEMES[scheme === "neutral" ? "neutral" : "traffic"];
  return {
    favorable: String(params.levelColorFavorable ?? LEVEL_SCHEMES.traffic.favorable),
    mid: params.levelColorMid ? String(params.levelColorMid) : null,
    unfavorable: String(params.levelColorUnfavorable ?? LEVEL_SCHEMES.traffic.unfavorable),
  };
}

/** Build the PRD-29 measures input for the results context. */
export function buildMeasuresInput(source: MeasuresSource): MeasuresInput {
  const params = source.params ?? {};
  const scaleResults = source.scaleResults ?? {};
  const variableValues = source.variableValues ?? {};
  const scales: MeasureInput[] = source.scales
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      key: s.key,
      name: s.label || s.key,
      value: scaleResults[s.key]?.raw ?? null,
      visibility: s.learnerVisibility,
      interpretation: parseScaleInterpretation(s.configJson),
      // PRD-49 §6: per-slot toggles saved by the scale editor. `!== false` is load-bearing —
      // an absent key means "show" (legacy scales carry no key at all), so any other reading
      // would silently hide the name/level slot of every scale saved before this PRD.
      showName: (s.configJson as Record<string, unknown>)?.showName !== false,
      showLevel: (s.configJson as Record<string, unknown>)?.showLevel !== false,
    }));

  const indicators: MeasureInput[] = source.variables
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((v) => ({
      key: v.name,
      name: v.label || v.name,
      value: variableValues[v.name] as number | string | boolean | null,
      visibility: v.learnerVisibility,
      interpretation: parseIndicatorInterpretation(v.configJson),
      // PRD-49 §6: same toggle pair, saved by the result-variable editor.
      showName: (v.configJson as Record<string, unknown>)?.showName !== false,
      showLevel: (v.configJson as Record<string, unknown>)?.showLevel !== false,
    }));

  return {
    ramp: resolveRamp(params),
    scaleKind: String(params.scaleRenderKind ?? "band_ruler") as RenderKind,
    indicatorKind: String(params.indicatorRenderKind ?? "label") as RenderKind,
    scales,
    indicators,
    hasPassThreshold: source.hasPassThreshold,
    blockSettings: source.blockSettings,
    // PRD-35/46. Lives in the SAME `settings_json` of the results page as the block
    // settings, so nothing new travels from the route — only the reading of it.
    //
    // The pictogram is the one part that cannot travel as stored: the author picked a NAME and
    // the chart draws contours, so the glyph is resolved here, where the icon table exists. The
    // package resolves at bake for the same reason (`test-json`), and both go through the one
    // resolver — a name has to mean the same picture in both players.
    chartSettings: withResolvedScaleIcons(source.blockSettings),
    ipsativeScales: source.ipsativeScales === true,
  };
}

/** Map a server topic result to the normalized topic input. */
function toTopicInput(t: TopicResult): TopicInput {
  return {
    topicId: t.topicId,
    topicName: t.topicName,
    correct: t.correct,
    total: t.total,
    percent: t.percent,
    earnedPoints: t.earnedPoints,
    possiblePoints: t.possiblePoints,
    passed: t.passed,
    // No `feedback` here on purpose. The field used to be read off the stored result —
    // where `topicResultSchema` never declared it, so it was `undefined` for every
    // attempt ever graded — and fed a per-topic slot in the results and report layouts.
    // A topic's feedback text now travels as `feedbackTexts` below and is rendered ONCE,
    // in the consolidated «Рекомендации» block; the slot is gone from the standard
    // layouts. The ADAPTIVE adapter still fills `feedback` (see
    // `buildAdaptiveResultContext` / `buildAdaptiveReportInput`): there it is the
    // confirmed LEVEL's wording, which the block is not fed from.
    recommendedCourses: t.recommendedCourses ?? [],
    recommendedEvents: t.recommendedEvents ?? [],
    // PRD-32: attachments of the topic + of this test's section over it, merged and
    // address-normalised at grading time (`server/routes/attempts.ts`) and stored WITH
    // the attempt. The shared builder pours them into the ONE «Материалы» block.
    // Absent on attempts graded before PRD-32 — the block then simply lacks them.
    recommendedAssets: t.recommendedAssets ?? [],
    // Feedback texts of the topic and of this test's section over it, gathered at
    // grading time (`server/routes/attempts.ts`) and stored WITH the attempt, in that
    // order. The shared builder pours them into the ONE recommendations block, where
    // dedup keeps the widest copy — so a sentence the test also carries shows once.
    // Absent on attempts graded before this work — the block then simply lacks them.
    feedbackTexts: t.feedbackTexts ?? [],
  };
}

/** Dedup recommendations across failed topics by title + url (mirrors SCORM vrRecommended). */
function dedupRecommendations(items: { title: string; url?: string }[]): { title: string; url?: string }[] {
  const seen = new Set<string>();
  const out: { title: string; url?: string }[] = [];
  for (const it of items) {
    const key = `${it.title}|${it.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/**
 * Build the standard results-screen context from a computed attempt result.
 * Recommended courses (links) and events from FAILED topics are aggregated and
 * deduped, matching the SCORM runtime, so the web template results screen shows
 * them too (TD-02). The shared builder owns the actual shaping/rendering.
 *
 * PRD-29: `measures` is passed on to the shared builder ONLY when the test actually
 * defines scales or indicators — otherwise `opts.measures` stays undefined and the
 * control-test screen keeps exactly the context it has always had.
 */
export function buildResultContext(
  result: AttemptResult,
  testTitle: string,
  measures?: MeasuresSource,
): ResultRenderContext {
  // Everything a topic carries — courses, events, texts, attachments — is due unless the
  // topic was explicitly PASSED (the owner's one rule for all four; the shared builder
  // applies the same `!== true` to the texts and the attachments, and `vrRecommended` in
  // the package runtime to these two). `!== true` and not `=== false`: per-topic
  // thresholds are the exception, so most topics carry no verdict at all, and reading
  // «nothing was judged» as success would swallow the author's courses in every test that
  // never set them.
  const notPassed = (result.topicResults || []).filter((t) => t.passed !== true);
  const recommendedCourses = dedupRecommendations(notPassed.flatMap((t) => t.recommendedCourses ?? []));
  const recommendedEvents = dedupRecommendations(notPassed.flatMap((t) => t.recommendedEvents ?? []));
  const hasMeasures = !!measures && (measures.scales.length > 0 || measures.variables.length > 0);
  // The test's own feedback block travels OUTSIDE `measures` (see
  // `ResultContextOptions.testFeedback`): it is due to the learner whether or not the
  // test measures anything, and a control test — the commonest configuration there is —
  // never reaches the measures branch. The stored block carries PDF assets addressed by
  // `url` (legacy data may still carry `scormHref`), so it goes through the SAME
  // normaliser the fired band/outcome blocks pass through.
  const testFeedback = normalizeFeedback(measures?.testFeedback);
  return buildSharedResultContext(
    {
      passed: result.overallPassed,
      percent: result.overallPercent,
      totalQuestions: result.totalQuestions,
      correct: result.totalCorrect,
      earnedPoints: result.totalEarnedPoints,
      possiblePoints: result.totalPossiblePoints,
      topicResults: (result.topicResults || []).map(toTopicInput),
    },
    testTitle,
    {
      ...(recommendedCourses.length ? { recommendedCourses } : {}),
      ...(recommendedEvents.length ? { recommendedEvents } : {}),
      ...(testFeedback ? { testFeedback } : {}),
      // Whether the test declares a pass threshold at all — the ONE fact that tells an
      // explicit «Пройден» from a test that pronounces no verdict. The builder reads it
      // twice, and the two readings must agree: it withholds the test's own feedback only
      // on an explicit pass, and it drops the verdict tag when nothing was judged (PRD-29
      // §6.7 — a control test with a threshold but nothing to grade used to keep the tag
      // and print the feedback at the same time). It travels OUTSIDE
      // `measures` on purpose: the route reads it for every attempt, while `measures`
      // reaches the builder only for a test with scales or indicators, and a control
      // test — the commonest one — would otherwise never say whether it grades.
      // `undefined` when the material could not be read at all; the builder then treats
      // it as unknown and shows the feedback.
      ...(measures ? { hasPassThreshold: measures.hasPassThreshold } : {}),
      // Вводный блок ЭКРАНА: у отчёта свой текст, и путать их нельзя — адресаты разные.
      ...(measures?.intro?.results ? { intro: measures.intro.results } : {}),
      ...(hasMeasures ? { measures: buildMeasuresInput(measures as MeasuresSource) } : {}),
      // PRD-49. Headings and sub-block order travel OUTSIDE `measures`, like the test's
      // own feedback: they belong to the SCREEN, and a control test — which never reaches
      // the measures branch — has the same four headings to print.
      ...labelOptions(measures, "results"),
    },
  );
}

/**
 * The two facts of the consolidated feedback block that do NOT live in the attempt
 * result: the test's OWN feedback and whether the test declares a pass threshold.
 *
 * They travel with the report INPUT rather than as options of the context builder,
 * because the browser assembles the report context and knows neither — it only forwards
 * what the results endpoint sent it. Read off the very same {@link MeasuresSource} the
 * screen is built from, and normalised by the very same {@link normalizeFeedback}, so
 * the report cannot end up with a different block than the screen it was downloaded from.
 *
 * No material (it could not be read) leaves both absent: the block then holds only what
 * the topics of the attempt carry, exactly as before this work.
 */
function reportFeedbackMeta(measures?: MeasuresSource): Partial<ReportMeta> {
  const feedback = normalizeFeedback(measures?.testFeedback);
  return {
    ...(feedback ? { feedback } : {}),
    ...(measures ? { hasPassThreshold: measures.hasPassThreshold } : {}),
    // Переключатель «как на экране итогов» разрешается ОДНИМ правилом на все хосты.
    ...(resolveReportIntro(measures?.intro) ? { intro: resolveReportIntro(measures?.intro) } : {}),
  };
}

/**
 * Build the input for the shared PDF report (`shared/report/report-html`) from a
 * computed attempt result.
 *
 * The report is NOT built from the render context: that one is presentational
 * (`pointsLabel`, `passClass`), while the report needs the raw per-topic numbers and
 * verdicts. Both therefore start from the SAME normalized topic input, so the report
 * and the screen can never disagree about what the attempt was.
 *
 * @param result Computed attempt result.
 * @param testTitle Test title (the report headline + the file name).
 * @param meta Who took it and when, plus the attempt count for the «Лучший результат» line
 *   (dropped entirely for a test that grades nothing — see `buildReportContext`).
 * @param measures The material of the results screen. Only the two facts the consolidated
 *   feedback block needs are read off it — see {@link reportFeedbackMeta}.
 */
export function buildReportInput(
  result: AttemptResult,
  testTitle: string,
  meta: Omit<ReportMeta, "testName"> = {},
  measures?: MeasuresSource,
): ReportInput {
  return {
    ...meta,
    ...reportFeedbackMeta(measures),
    testName: testTitle,
    result: {
      passed: result.overallPassed,
      percent: result.overallPercent,
      totalQuestions: result.totalQuestions,
      correct: result.totalCorrect,
      earnedPoints: result.totalEarnedPoints,
      possiblePoints: result.totalPossiblePoints,
      topicResults: (result.topicResults || []).map(toTopicInput),
    },
  };
}

/** {@link buildReportInput} for an adaptive attempt (levels, no score). */
export function buildAdaptiveReportInput(
  result: any,
  testTitle: string,
  meta: Omit<ReportMeta, "testName"> = {},
  measures?: MeasuresSource,
): AdaptiveReportInput {
  const topics = Array.isArray(result?.topicResults) ? result.topicResults : [];
  return {
    ...meta,
    ...reportFeedbackMeta(measures),
    adaptive: true,
    testName: testTitle,
    result: {
      passed: !!result?.overallPassed,
      topicResults: topics.map((t: any) => ({
        topicName: t?.topicName ?? "",
        achievedLevelIndex: t?.achievedLevelIndex ?? null,
        achievedLevelName: t?.achievedLevelName ?? null,
        totalQuestionsAnswered: t?.totalQuestionsAnswered,
        totalCorrect: t?.totalCorrect,
        feedback: t?.feedback ?? "",
        recommendedCourses: Array.isArray(t?.recommendedCourses)
          ? t.recommendedCourses.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
          : Array.isArray(t?.recommendedLinks)
            ? t.recommendedLinks.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
            : [],
        recommendedEvents: Array.isArray(t?.recommendedEvents)
          ? t.recommendedEvents.map((l: any) => ({ title: l?.title ?? "" }))
          : [],
        // The sources of the consolidated block the topic carries, read by the same
        // names the adaptive SCREEN reads them by (`buildAdaptiveResultContext` below).
        // Without them the report of an adaptive attempt printed no feedback at all
        // while the screen it was downloaded from printed the whole block.
        feedbackTexts: Array.isArray(t?.feedbackTexts) ? t.feedbackTexts : [],
        recommendedAssets: Array.isArray(t?.recommendedAssets)
          ? t.recommendedAssets.map((a: any) => ({ title: a?.title ?? "", url: a?.url }))
          : [],
      })),
    },
  };
}

/**
 * Build the adaptive results-screen context (level-based). No SCORM action flags —
 * the web adaptive results screen shows the base "Пройти снова" action.
 *
 * @param measures The material of the results screen, as the route reads it for BOTH
 *   modes — the test's own feedback block AND its measurement rows. Both are properties
 *   of the TEST rather than of its flow mode, so both reach this screen (issue #33): the
 *   feedback as the widest source of the consolidated recommendations block, the rows as
 *   the «Ваш результат» / «По шкалам» blocks. The measured VALUES come from the SAVED
 *   adaptive result (`scaleResults` / `resultVariables`, filled in by
 *   `completeMeasuresSource`) and are never recomputed here. Absent (material unreadable)
 *   simply leaves both out, exactly as it does on the standard screen.
 */
export function buildAdaptiveResultContext(
  result: any,
  testTitle: string,
  measures?: MeasuresSource,
): ResultRenderContext {
  const topics = Array.isArray(result?.topicResults) ? result.topicResults : [];
  // The stored block goes through the SAME normaliser the standard screen uses, so the
  // `url`-over-`scormHref` rule for its PDF assets lives in one place.
  const testFeedback = normalizeFeedback(measures?.testFeedback);
  // …and the SAME rule decides whether the screen gets measurement blocks at all: the
  // test must actually declare scales or indicators. An adaptive test that declares
  // none keeps exactly the context it had before this work.
  const hasMeasures = !!measures && (measures.scales.length > 0 || measures.variables.length > 0);
  return buildSharedAdaptiveResultContext(
    {
      passed: !!result?.overallPassed,
      topicResults: topics.map(
        (t: any): AdaptiveTopicInput => ({
          topicName: t?.topicName ?? "",
          achievedLevelIndex: t?.achievedLevelIndex ?? null,
          achievedLevelName: t?.achievedLevelName ?? null,
          feedback: t?.feedback ?? "",
          // Unified per-topic recommendations (plan 6.1): courses (was recommendedLinks)
          // + events, so the adaptive feedback block matches the standard one.
          recommendedCourses: Array.isArray(t?.recommendedCourses)
            ? t.recommendedCourses.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
            : Array.isArray(t?.recommendedLinks)
              ? t.recommendedLinks.map((l: any) => ({ title: l?.title ?? "", url: l?.url }))
              : [],
          recommendedEvents: Array.isArray(t?.recommendedEvents)
            ? t.recommendedEvents.map((l: any) => ({ title: l?.title ?? "" }))
            : [],
          // Texts and attachments of the topic and of this test's section over it, stored
          // WITH the attempt at grading time (`server/routes/attempts.ts`) — the same two
          // fields the standard topic result carries, read here by the same names. Absent
          // on adaptive attempts finished before this work; the block then lacks them.
          feedbackTexts: Array.isArray(t?.feedbackTexts) ? t.feedbackTexts : [],
          recommendedAssets: Array.isArray(t?.recommendedAssets)
            ? t.recommendedAssets.map((a: any) => ({ title: a?.title ?? "", url: a?.url }))
            : [],
        }),
      ),
    },
    testTitle,
    {
      ...(testFeedback ? { testFeedback } : {}),
      ...(hasMeasures ? { measures: buildMeasuresInput(measures as MeasuresSource) } : {}),
      // PRD-49. Same wording, its OWN screen: the adaptive results screen may carry
      // per-screen defaults and, in the shipped manifest, a different sub-block list
      // (topics first, no score summary) — which is why the screen name is not shared.
      ...labelOptions(measures, "results.adaptive"),
    },
  );
}
