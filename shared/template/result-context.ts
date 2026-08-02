/**
 * @module shared/template/result-context
 *
 * The single, browser-safe builder for the RESULTS screen render context
 * (PRD-12 §10): it turns a host's computed result into the `{ course, result }`
 * shape the `results.html` / `results.adaptive.html` layouts consume. Both hosts
 * call it on the SAME normalized input, so the presentational shaping (passClass /
 * statusLabel / ring offset / per-topic rows / adaptive level labels) cannot drift
 * between the web server and the SCORM package:
 *
 *   - web server adapts its `AttemptResult` (overallPercent / overallPassed / …);
 *   - SCORM adapts its runtime result (percent / passed / …) and reaches this via
 *     the `TBTemplate` bundle.
 *
 * Pure — no DOM, no Node — so it is unit-testable and safe to bundle for the browser.
 */

import type {
  CtxCourse,
  CtxResult,
  CtxSectionResult,
  CtxSectionIntro,
  CtxTopicResultView,
  CtxAdaptiveTopicView,
  CtxRecommendation,
} from "./context";
import { buildMeasureView, type RenderKind } from "./measure-view";
import { buildRadarChart } from "./radar-view";
import { collectRecommendations } from "./recommendations";
import { resolveResultsBlocks, type ResultsBlockSettings } from "./results-blocks";
import type {
  FeedbackBlock,
  IndicatorInterpretation,
  LearnerVisibility,
  RecommendationLink,
  ScaleInterpretation,
} from "../scales/interpretation";
import type { LevelRamp } from "./level-ramp";

/** Ring geometry from `layouts/results.html` (`<circle r="63">`). */
const RING_RADIUS = 63;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Round to one decimal (points show at most one fractional digit). */
function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/** Per-topic feedback composition — the SAME shape for standard and adaptive. */
export interface TopicFeedbackInput {
  /** Per-topic feedback text (`feedback_json.text`). */
  feedback?: string | null;
  /** Recommended courses/links (`feedback_json.links`). */
  recommendedCourses?: Array<{ title: string; url?: string }> | null;
  /** Recommended events (`feedback_json.events`). */
  recommendedEvents?: Array<{ title: string; url?: string }> | null;
  /**
   * PRD-32 attachments the learner is to receive for this topic — the topic's OWN
   * feedback (`topics.feedback_json`) and the feedback of this test's section over
   * that topic (`test_sections.feedback_json`), merged by the host in that order.
   *
   * They do NOT render inside the topic row: the results screen carries one
   * «Материалы» block structured by RESOURCE TYPE, not by cause (see
   * `./recommendations`), so an attachment reaches the learner through it whatever
   * level attached it. Addresses come pre-normalised — the host runs
   * {@link feedbackAssets}, so the `url`-over-`scormHref` rule lives in one place.
   *
   * The host hands them over for EVERY topic; whether the learner sees them is the
   * builder's call — it drops the whole topic once {@link TopicInput.passed} is `true`
   * (see `topicRecommendationSources`).
   */
  recommendedAssets?: Array<{ title: string; url?: string }> | null;
  /**
   * Feedback TEXTS the learner is to receive for this topic — the topic's own
   * (`topics.feedback_json.text`, or the legacy `topics.feedback` column) and that of
   * this test's section over it (`test_sections.feedback_json.text`), merged by the
   * host in that order.
   *
   * A LIST and not one string: the topic and the section are two INDEPENDENT authoring
   * points, and the boundary between them is what the consolidated block de-duplicates
   * on — an author who wrote the same sentence in both places must see it once.
   *
   * Like {@link recommendedAssets} these do NOT render inside the topic row: the
   * results screen carries ONE «Рекомендации» block gathering every level that spoke
   * (see `./recommendations`), so a text reaches the learner through it whatever level
   * wrote it. Blank entries are dropped by the builder — an empty paragraph is not a
   * recommendation — and so is the whole topic once {@link TopicInput.passed} is `true`:
   * what a topic carries is help with a topic the learner has not mastered.
   *
   * Both hosts fill it: the web adapter from the stored `TopicResult.feedbackTexts`,
   * the SCORM package from the same two blocks baked into `TEST_DATA`.
   */
  feedbackTexts?: string[] | null;
}

/** Normalized per-topic input (host adapts its own field names into this). */
export interface TopicInput extends TopicFeedbackInput {
  topicId?: string;
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  earnedPoints: number;
  possiblePoints: number;
  passed: boolean | null;
  /** SCORM-extra: per-topic pass threshold label, e.g. "Требуется: 70%". */
  requiredLabel?: string;
}

/**
 * The unified per-topic feedback view — `feedback` text + recommended courses/events
 * with presence flags. Shared by standard and adaptive results so the feedback block
 * is composed identically in both modes (spec §3.2 / plan 6.1). Feedback is a property
 * of the test's settings, not the flow mode.
 */
export function buildTopicFeedbackView(t: TopicFeedbackInput): {
  feedback?: string;
  hasFeedback: boolean;
  recommendedCourses: CtxRecommendation[];
  recommendedEvents: CtxRecommendation[];
  hasRecommendations: boolean;
} {
  const fb = String(t.feedback ?? "").trim();
  const courses = (t.recommendedCourses ?? []).map((l) => ({ title: l.title, ...(l.url ? { url: l.url } : {}) }));
  const events = (t.recommendedEvents ?? []).map((l) => ({ title: l.title, ...(l.url ? { url: l.url } : {}) }));
  return {
    ...(fb ? { feedback: fb } : {}),
    hasFeedback: fb.length > 0,
    recommendedCourses: courses,
    recommendedEvents: events,
    hasRecommendations: courses.length > 0 || events.length > 0,
  };
}

/** Normalized standard result input. */
export interface ResultInput {
  passed: boolean;
  percent: number;
  totalQuestions: number;
  correct: number;
  earnedPoints: number;
  possiblePoints: number;
  topicResults: TopicInput[];
}

/** One scale or indicator as the host hands it over, before presentational shaping. */
export interface MeasureInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  visibility: LearnerVisibility;
  interpretation: ScaleInterpretation | IndicatorInterpretation;
}

/** PRD-29 measurement input: the visible measures plus the design-param choices. */
export interface MeasuresInput {
  ramp: LevelRamp;
  scaleKind: RenderKind;
  indicatorKind: RenderKind;
  scales: MeasureInput[];
  indicators: MeasureInput[];
  /** Whether the test has a pass threshold — the `auto` answer for the score summary. */
  hasPassThreshold?: boolean;
  blockSettings?: ResultsBlockSettings;
  /**
   * PRD-35: the author's explicit switch on the `results` variant. There is no
   * `auto` mode — an absent flag means the radar is off, for existing tests and new
   * ones alike.
   */
  showRadar?: boolean;
}

/**
 * Feedback of the level that actually fired, NORMALISED for the recommendations
 * block.
 *
 * The author's editor stores the canonical `feedbackContentSchema` shape, where an
 * asset is a PDF descriptor — `{ title, fileName, mimeType, url?, scormHref? }` — whose
 * address belongs in `url` (PRD-32 contract: the field the editor writes on upload and
 * the SCORM packer resolves to an in-package path); the legacy `scormHref` is read only
 * for data built before that. `collectRecommendations` works on
 * `RecommendationLink { title, url? }`, so the host adapts before handing over; without
 * this the «Материалы» block renders links with an empty href.
 *
 * An asset with neither address is DROPPED rather than rendered dead: the file was
 * never uploaded, so there is nothing to open.
 *
 * Exported for the hosts: the TEST-level feedback block (`tests.feedback_json`) is
 * stored in the very same shape and reaches the builder from the host adapter, so it
 * must pass through THIS normaliser and not a second copy of the rule.
 */
export function normalizeFeedback(raw: unknown): FeedbackBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const links = (f.links as Array<{ title?: string; url?: string }> | undefined) ?? [];
  const events = (f.events as Array<{ title?: string; url?: string }> | undefined) ?? [];
  const assets = (f.assets as Array<{ title?: string; url?: string; scormHref?: string }> | undefined) ?? [];
  return {
    ...(f.text ? { text: String(f.text) } : {}),
    links: links.map((l) => ({ title: String(l.title ?? ""), ...(l.url ? { url: l.url } : {}) })),
    events: events.map((e) => ({ title: String(e.title ?? ""), ...(e.url ? { url: e.url } : {}) })),
    assets: assets
      // `url` wins: it is the address the packer resolves to a working in-package path,
      // while `scormHref` is left untouched — where both are set the legacy one points at a
      // path the package no longer has. `||` and not `??` on purpose — an empty string is an
      // absent address, not a value.
      .map((a) => ({ title: String(a.title ?? ""), url: String(a.url || a.scormHref || "") }))
      .filter((a) => !!a.url),
  };
}

/**
 * Attachments of one or more STORED feedback blocks, in the order given, ready for
 * {@link TopicFeedbackInput.recommendedAssets}.
 *
 * Both hosts call it — the web adapter on the topic + section blocks it grades an
 * attempt against, the SCORM bake on the same two blocks of a section — so the address
 * rule ({@link normalizeFeedback}: `url` wins, an addressless asset is dropped) is
 * applied once and identically. A `null`/absent block simply contributes nothing.
 */
export function feedbackAssets(...blocks: unknown[]): RecommendationLink[] {
  return blocks.flatMap((block) => normalizeFeedback(block)?.assets ?? []);
}

/** Trimmed `text` of a STORED feedback block; `""` when the block carries none. */
function blockText(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const text = (block as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

/**
 * Feedback TEXTS due to the learner for ONE topic of ONE test, ready for
 * {@link TopicFeedbackInput.feedbackTexts}: the topic's own text and that of this test's
 * section over it, in that order.
 *
 * ONE exported rule, like {@link feedbackAssets}, because both hosts must hand the
 * learner the SAME text: the web grader stores the result of this call with the attempt,
 * the SCORM bake writes it into the section of `TEST_DATA`. A second copy of the rule
 * would drift silently and surface as the two players showing different feedback — the
 * very defect this consolidation repairs.
 *
 * WHERE THE TOPIC'S TEXT COMES FROM. The current source is `topics.feedback_json.text`,
 * with the legacy `topics.feedback` column as the fallback. That fallback is not
 * back-compat decoration: the in-service topic editor sends ONLY `feedback_json`, so the
 * legacy column still holds the WHOLE text of every topic the editor has never touched,
 * and reading `feedback_json` alone would silently drop what the author did write. Where
 * both carry a text the CURRENT source wins — a topic already migrated to
 * `feedback_json` may still drag an outdated copy in the column.
 *
 * A LIST and not one glued string: the topic and the section are two INDEPENDENT
 * authoring points, and that boundary is what the consolidated recommendations block
 * de-duplicates on. The order is load-bearing — the topic, the more general source,
 * comes first, so its copy is the one dedup keeps. A blank text (empty, or whitespace
 * only) contributes nothing: an empty paragraph is not a recommendation. The same
 * sentence written in both places is returned once.
 *
 * @param topic The topic row: its `feedbackJson` block and legacy `feedback` column.
 * @param sectionFeedback `test_sections.feedback_json` of THIS test's section over it.
 */
export function topicFeedbackTexts(
  topic: { feedbackJson?: unknown; feedback?: string | null } | null | undefined,
  sectionFeedback?: unknown,
): string[] {
  const legacy = typeof topic?.feedback === "string" ? topic.feedback.trim() : "";
  const topicText = blockText(topic?.feedbackJson) || legacy;
  const out: string[] = [];
  for (const text of [topicText, blockText(sectionFeedback)]) {
    if (!text || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

/**
 * The sources ONE topic contributes to the consolidated recommendations block: its
 * feedback texts and its PRD-32 attachments, in that order.
 *
 * GATED BY THE TOPIC'S VERDICT, and the gate is «anything except an explicit pass» —
 * the owner's agreed rule for the consolidated block. It replaces the two rules that
 * used to coexist here: the recommended courses and events of a topic were failed-topic
 * guidance (`vrRecommended` in the package runtime skipped a topic on
 * `tr.passed !== false`), while its texts and its attachments were shown to everyone, on
 * the reading that a material hung on the topic's feedback is due for having TAKEN the
 * topic. Consolidation put all four into ONE block, where two rules read as the same
 * topic's resources behaving differently, and the owner settled them on one — now applied
 * to the courses and events as well, at both hosts' call sites.
 *
 * WE ARE SILENT ONLY WHERE WE ARE SURE OF SUCCESS. The rule is deliberately NOT «show on
 * failure»: per-topic thresholds are the exception in a standard test, so most topics
 * carry no verdict at all (`passed === null`) — treating «nothing was judged» as success
 * would swallow the author's material in every test that never set them. Any state other
 * than a pronounced pass is resolved in favour of showing: losing a leaflet the author
 * hung is worse than showing it once too often.
 *
 * WHAT «not passed» MEANS is the MODE's answer, and only that answer differs — hence
 * `notPassed` as a parameter rather than a second copy of this function per mode. The
 * standard mode reads the topic's pass verdict (`passed !== true`, so both an explicit
 * failure and an absent verdict speak). The adaptive mode has no third state: there the
 * non-success is «no level confirmed at all» ({@link hasAchievedLevel}), the branch
 * `aggregateAdaptiveResult` itself treats as the failure one — it is where the topic's
 * `failureFeedback` fires and where `overallPassed` is dropped.
 *
 * The gate lives HERE, in the one builder both hosts call, and not in either host's
 * adapter: a second copy of it would drift silently and surface as the web and the
 * package handing the learner different materials.
 */
function topicRecommendationSources(topic: TopicFeedbackInput, notPassed: boolean): FeedbackBlock[] {
  if (!notPassed) return [];
  const sources: FeedbackBlock[] = [];
  // ONE source per text, because `FeedbackBlock` carries a single `text` while a topic
  // brings up to two independent ones (its own and this test's section over it).
  // Widening the block to a list of texts would fork the shape every other source — the
  // test, the fired band, the fired outcome — already speaks; a source apiece keeps the
  // collector's contract untouched and lets dedup see the two texts for the separate
  // entries they are. Blank ones are dropped here so no host has to.
  for (const text of topic.feedbackTexts ?? []) {
    if (String(text ?? "").trim()) sources.push({ text, links: [], events: [], assets: [] });
  }
  const assets = topic.recommendedAssets ?? [];
  if (assets.length > 0) sources.push({ links: [], events: [], assets });
  return sources;
}

/** Feedback of the level that actually fired, for the recommendations block. */
function firedFeedback(m: MeasureInput): FeedbackBlock | null {
  const { interpretation } = m;
  if (typeof m.value === "number") {
    const band = interpretation.bands.find((b) => (m.value as number) >= b.min && (m.value as number) <= b.max);
    return normalizeFeedback(band?.feedback);
  }
  const outcomes = (interpretation as IndicatorInterpretation).outcomes ?? [];
  const outcome = outcomes.find((o) => o.code === String(m.value));
  return normalizeFeedback(outcome?.feedback);
}

/** Optional SCORM-richer additions to the standard results context. */
export interface ResultContextOptions {
  /** Add the per-topic "Баллов" row (`pointsLabel`) — SCORM shows it, web omits. */
  withTopicPoints?: boolean;
  recommendedCourses?: CtxRecommendation[];
  recommendedEvents?: CtxRecommendation[];
  backAction?: string;
  backLabel?: string;
  /**
   * The test's OWN feedback block (`tests.feedback_json`), normalised by the host —
   * the most general source of the «Рекомендации» block (PRD-29 §7.1), and the first
   * one, so a general recommendation outranks its per-measure or per-topic copy.
   *
   * Deliberately NOT part of {@link measures}. It lived there while PRD-29 assembled
   * the whole block inside its own branch, and that made the test's feedback vanish
   * from the commonest configuration of all — a test with neither scales nor
   * indicators, where the author's feedback exists precisely to be shown. A test's
   * feedback is a property of the test, not of its measurements.
   */
  testFeedback?: FeedbackBlock | null;
  /**
   * Whether the TEST declares a pass threshold at all (`tests.overall_pass_rule_json`
   * with a `type` other than `none`). It answers ONE question the builder cannot answer
   * from {@link ResultInput.passed}, which is a plain `boolean`: was a verdict actually
   * PRONOUNCED, or is `passed: false` merely the default of a test that judges nothing?
   *
   * It exists SEPARATELY from {@link MeasuresInput.hasPassThreshold}, which carries the
   * same fact, because that one only travels for a test with scales or indicators — a
   * control test never reaches the measures branch, and the commonest test in the product
   * is exactly that. Both hosts fill this one for EVERY test: the web from the
   * `MeasuresSource` its route already assembles, the package from the baked
   * `TEST_DATA.overallPassRule`. Where both are present they agree — they are read off
   * the same rule.
   *
   * ABSENT MEANS «UNKNOWN», and unknown is resolved in favour of SHOWING the feedback.
   * The flag only ever silences, so a host that has not been taught to send it keeps
   * handing the learner everything the author wrote — losing a leaflet is worse than
   * showing it once too often.
   */
  hasPassThreshold?: boolean;
  /**
   * PRD-29 measurement blocks. Absent (a test with neither scales nor indicators)
   * leaves the context byte-identical to what a control test has always produced.
   */
  measures?: MeasuresInput;
}

/** Built `{ course, result }` for the results layouts. */
export interface ResultRenderContext {
  course: CtxCourse;
  result: CtxResult;
}

/** Map a normalized topic to its presentational view (Core-prepared class + label). */
function topicView(t: TopicInput, withPoints: boolean): CtxTopicResultView {
  const passed = t.passed;
  const view: CtxTopicResultView = {
    topicId: t.topicId,
    topicName: t.topicName || "",
    correct: t.correct != null ? t.correct : 0,
    total: t.total,
    percent: Math.round(t.percent || 0),
    passClass: passed === true ? "is-pass" : passed === false ? "is-fail" : "",
    statusLabel: passed === true ? "Пройдено" : passed === false ? "Не пройдено" : "",
    // Unified feedback composition (feedback + courses + events) — same as adaptive.
    ...buildTopicFeedbackView(t),
  };
  if (withPoints) view.pointsLabel = round1(t.earnedPoints) + " / " + round1(t.possiblePoints);
  if (t.requiredLabel) view.requiredLabel = t.requiredLabel;
  return view;
}

/**
 * Build the STANDARD results context. `result.*` carries both raw numbers and
 * Core-prepared presentational fields (the layout/DSL computes no logic). The
 * `opts` enable the SCORM-richer (gated) extras; with no opts the output matches
 * the web results screen exactly.
 */
export function buildResultContext(
  input: ResultInput,
  title: string,
  opts: ResultContextOptions = {},
): ResultRenderContext {
  const passed = !!input.passed;
  const percent = Math.round(input.percent || 0);
  const result: CtxResult = {
    passed,
    passClass: passed ? "is-pass" : "is-fail",
    statusLabel: passed ? "Пройден" : "Не пройден",
    scorePercent: percent,
    ringDashoffset: Math.round(RING_CIRCUMFERENCE * (1 - percent / 100)),
    totalQuestions: input.totalQuestions,
    correct: input.correct,
    earnedPoints: round1(input.earnedPoints),
    possiblePoints: round1(input.possiblePoints),
    topicResults: (input.topicResults || []).map((t) => topicView(t, !!opts.withTopicPoints)),
  };
  if (opts.recommendedCourses && opts.recommendedCourses.length) result.recommendedCourses = opts.recommendedCourses;
  if (opts.recommendedEvents && opts.recommendedEvents.length) result.recommendedEvents = opts.recommendedEvents;
  if (opts.backAction) {
    result.backAction = opts.backAction;
    result.backLabel = opts.backLabel;
  }
  // ONE source of truth for «is there a graded score to speak about» — it answers the
  // score summary (`auto`), the verdict tag, and the feedback gate below. TWO conditions,
  // not one: a threshold IS declared AND there is something to grade. Every new test
  // carries the default 70% threshold, so the threshold alone would call a measurement
  // questionnaire graded and paint «0 %», «0 из 0 верно» and a green «Пройден» on its
  // results screen — the exact nonsense PRD-29 removes. The author of a burnout inventory
  // never opens that setting, and should not have to: such a method has no threshold by
  // nature, not by configuration.
  //
  // «Nothing to grade» is read off `possiblePoints`, which both hosts already pass in: a
  // measurement question has no correct grading, so it brings no points and never can.
  // Deriving it from the builder's own input also makes it true for attempts finished
  // before this rule existed — no migration, no new stored field.
  //
  // The threshold flag is read from the TOP-LEVEL option first and from `measures` only
  // as a fallback: the top-level one travels for every test, the measures copy only for a
  // test that measures something. `=== true` on purpose — an absent flag means «unknown»,
  // and unknown must not silence anything.
  const thresholdDeclared = opts.hasPassThreshold ?? opts.measures?.hasPassThreshold;
  const hasGradedScore = thresholdDeclared === true && round1(input.possiblePoints) > 0;
  // EXPLICIT SUCCESS — the only state in which the author's feedback is withheld. Both
  // halves are load-bearing: the test must actually grade (otherwise no verdict was
  // pronounced and `passed` is a default, not a judgement), and the verdict must be a
  // PASS. A measurement test without a threshold therefore keeps its feedback whatever
  // `passed` holds — that feedback IS its result, the whole point of PRD-29.
  const explicitPass = hasGradedScore && passed;
  // Sources of the ONE recommendations block, gathered in the order dedup should keep:
  // the general before the specific. Collected rather than merged on the spot because
  // the measurement sources are conditional while the other two are not — a test with
  // neither scales nor indicators still hands the learner its own feedback and what its
  // topics and sections attached (PRD-32). The test's own block leads: it is the widest.
  //
  // Unless the learner PASSED: a test the learner is through with owes no work on the
  // mistakes, so its own block is dropped at the source (owner's agreed rule). The
  // per-measure blocks below are NOT dropped with it — a scale's band or an indicator's
  // outcome is the interpretation of a measurement, not guidance on a failure, and a
  // learner who passed still gets to read what was measured.
  const recommendationSources: Array<FeedbackBlock | null | undefined> = explicitPass ? [] : [opts.testFeedback];
  if (opts.measures) {
    const visibleScales = opts.measures.scales.filter((m) => m.visibility !== "hidden");
    const visibleIndicators = opts.measures.indicators.filter((m) => m.visibility !== "hidden");
    // `hasGradedScore` is computed ONCE, above — the score summary, the verdict tag and
    // the feedback gate must not be able to disagree about whether this test grades.
    // (`scoredQuestions` in `shared/scoring/aggregate.ts` describes the very same
    // contract but is absent from the stored result schema, so it cannot answer for
    // attempts finished earlier.)
    const blocks = resolveResultsBlocks(opts.measures.blockSettings ?? {}, {
      hasPassThreshold: hasGradedScore,
      hasVisibleScales: visibleScales.length > 0,
      hasVisibleIndicators: visibleIndicators.length > 0,
    });
    // No graded score — no verdict. A measurement method checks nothing, so both
    // «Пройден» and «Не пройден» would be false statements about the learner, not a
    // cosmetic default. The third state is the one the topic rows already use
    // (passed === true / false / ""), and the layout drops the tag entirely on an
    // empty label. It follows the THRESHOLD-and-points pair, not the score-summary
    // block: an author who force-shows the summary of an ungraded test still gets no
    // verdict, and hiding the summary of a control test does not erase its verdict.
    if (!hasGradedScore) {
      result.passClass = "";
      result.statusLabel = "";
    }
    // INVERTED on purpose. A control test never passes `measures`, so a positive
    // flag would be absent — and `{{#if result.showScoreSummary}}` would erase the
    // score ring from every control test in every package and in the preview. The
    // absent state has to mean «show», so only the suppression is recorded.
    if (!blocks.scoreSummary) result.hideScoreSummary = true;

    if (blocks.scales && visibleScales.length) {
      result.scales = visibleScales.map((m) =>
        buildMeasureView({ ...m, requestedKind: opts.measures!.scaleKind, ramp: opts.measures!.ramp }));
      // PRD-35. The radar is built INSIDE the scales branch: a hidden block must not
      // leave a dangling chart on the screen. `buildRadarChart` returns null on its
      // own refusals (fewer than three axes, a scale without a domain), and that
      // refusal is silent for the learner — the author is told why in the editor.
      result.scalesBlockClass = "tb-measures";
      if (opts.measures.showRadar) {
        const chart = buildRadarChart({ axes: visibleScales, ramp: opts.measures.ramp });
        if (chart) {
          result.scalesChart = chart;
          result.scalesBlockClass = "tb-measures tb-measures--chart";
        }
      }
    }
    if (blocks.indicators && visibleIndicators.length) {
      result.indicators = visibleIndicators.map((m) =>
        buildMeasureView({ ...m, requestedKind: opts.measures!.indicatorKind, ramp: opts.measures!.ramp }));
    }
    // Order matters: the test's own block (already first in the list) then the profile,
    // then the scales — dedup keeps the first occurrence, so a general recommendation
    // outranks its specific copy. A hidden block contributes nothing: the learner never
    // saw what caused it.
    recommendationSources.push(
      ...(blocks.indicators ? visibleIndicators.map(firedFeedback) : []),
      ...(blocks.scales ? visibleScales.map(firedFeedback) : []),
    );
  }
  // What the topics of this attempt said and attached, LAST — they are the narrowest
  // source (one topic of the test), and the same text or file that the test as a whole
  // also carries should keep the test's copy under dedup. The verdict gate and the
  // shape of those sources live in `topicRecommendationSources`, shared with the
  // adaptive builder.
  for (const topic of input.topicResults || []) {
    recommendationSources.push(...topicRecommendationSources(topic, topic.passed !== true));
  }
  const recommendations = collectRecommendations(recommendationSources);
  if (recommendations.hasAny) result.recommendations = recommendations;
  return { course: { title }, result };
}

/** Normalized input for the staged section-results screen (PRD-19 FR-05a). */
export interface SectionResultInput {
  /** Section/topic name (heading). */
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  /** null = the section has no pass rule (no verdict tag). */
  passed: boolean | null;
  /** Override the «Продолжить» label (e.g. the last section before test-finish). */
  continueLabel?: string;
  /** Test title for the header (`course.title`); falls back to `topicName` when absent. */
  courseTitle?: string;
  /** Header subtitle "Попытка N из M". */
  subtitle?: string;
  /** 1-based position of this section among the test's sections (header tag + progress). */
  sectionIndex?: number;
  /** Total sections (header tag + progress); absent/0 drops the section tag + progress. */
  sectionsTotal?: number;
}

/**
 * Build the COMPUTED section-results context (`{ course, sectionResult }`, PRD-19
 * FR-05a). Reuses the same ring geometry as the test results screen; the verdict
 * tag is gated by `hasVerdict` so a section without a pass rule (passed === null)
 * shows the score without a pass/fail label. Pure — both hosts call it on their
 * own normalized section result so the numbers/markup cannot drift.
 */
export function buildSectionResultContext(input: SectionResultInput): {
  course: CtxCourse;
  sectionResult: CtxSectionResult;
} {
  const percent = Math.round(input.percent || 0);
  const hasVerdict = input.passed === true || input.passed === false;
  const sectionResult: CtxSectionResult = {
    topicName: input.topicName || "",
    scorePercent: percent,
    ringDashoffset: Math.round(RING_CIRCUMFERENCE * (1 - percent / 100)),
    passClass: input.passed === true ? "is-pass" : input.passed === false ? "is-fail" : "",
    statusLabel: input.passed === true ? "Раздел пройден" : input.passed === false ? "Раздел не пройден" : "",
    hasVerdict,
    correct: input.correct != null ? input.correct : 0,
    total: input.total,
    summaryLabel: (input.correct != null ? input.correct : 0) + " из " + input.total + " верно · " + percent + "%",
    continueLabel: input.continueLabel || "Продолжить",
  };
  // Header section-position tag + progress, when the host supplies the position.
  if (input.sectionsTotal && input.sectionsTotal > 0 && input.sectionIndex) {
    sectionResult.sectionLabel = "Раздел " + input.sectionIndex + " из " + input.sectionsTotal;
    sectionResult.progressPercent = Math.round((input.sectionIndex / input.sectionsTotal) * 100);
  }
  return {
    course: { title: input.courseTitle || input.topicName || "", subtitle: input.subtitle },
    sectionResult,
  };
}

/** Russian plural for «вопрос» (1 вопрос / 2 вопроса / 5 вопросов). */
function pluralQuestions(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return "вопросов";
  if (d === 1) return "вопрос";
  if (d > 1 && d < 5) return "вопроса";
  return "вопросов";
}

/** Russian plural for «минута» (1 минута / 2 минуты / 5 минут). */
function pluralMinutes(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return "минут";
  if (d === 1) return "минута";
  if (d > 1 && d < 5) return "минуты";
  return "минут";
}

/** Normalized input for the «Введение раздела» screen (PRD-1 §4.3). */
export interface SectionIntroInput {
  /** 1-based section index (for the «Раздел N из M» eyebrow + header tag). */
  sectionNumber: number;
  /** Total sections; enables «Раздел N из M» + the header progress. */
  sectionsTotal?: number;
  /** Test title for the header (`course.title`); falls back to `topicName`. */
  courseTitle?: string;
  /** Header subtitle «Попытка N из M». */
  subtitle?: string;
  topicName: string;
  /** Topic description from its properties. */
  description?: string | null;
  questionCount: number;
  timeLimitMinutes?: number | null;
  /** Author instruction (HTML/text); non-empty → the instruction block shows. */
  instruction?: string | null;
  /** Author section illustration URL; non-empty → the illustration column shows. */
  illustration?: string | null;
  continueLabel?: string;
}

/**
 * Build the «Введение раздела» context: `{ course, sectionIntro }`. The host injects
 * the author instruction HTML via the layout's `instruction` slot; this builder only
 * derives `hasInstruction` (gating the block) by stripping tags + whitespace.
 */
export function buildSectionIntroContext(input: SectionIntroInput): {
  course: CtxCourse;
  sectionIntro: CtxSectionIntro;
} {
  const count = Math.max(0, Math.round(input.questionCount || 0));
  const desc = (input.description ?? "").trim();
  const hasTime = !!(input.timeLimitMinutes && input.timeLimitMinutes > 0);
  const instrRaw = typeof input.instruction === "string" ? input.instruction : "";
  const instrText = instrRaw.replace(/<[^>]*>/g, "").trim();
  const illo = (input.illustration ?? "").trim();
  const secNum = input.sectionNumber || 1;
  const secTotal = input.sectionsTotal && input.sectionsTotal > 0 ? input.sectionsTotal : 0;
  const sectionIntro: CtxSectionIntro = {
    eyebrow: secTotal ? "Раздел " + secNum + " из " + secTotal : "Раздел " + secNum,
    topicName: input.topicName || "",
    description: desc,
    hasDescription: desc.length > 0,
    questionCount: count,
    questionCountLabel: count + " " + pluralQuestions(count),
    hasTimeLimit: hasTime,
    timeLimitLabel: hasTime ? String(input.timeLimitMinutes) + " " + pluralMinutes(input.timeLimitMinutes as number) : "",
    hasInstruction: instrText.length > 0,
    illustrationUrl: illo,
    hasIllustration: illo.length > 0,
    continueLabel: input.continueLabel || "Далее",
  };
  if (secTotal) sectionIntro.progressPercent = Math.round((secNum / secTotal) * 100);
  return {
    course: { title: input.courseTitle || input.topicName || "", subtitle: input.subtitle },
    sectionIntro,
  };
}

/** Normalized adaptive per-topic input. */
export interface AdaptiveTopicInput extends TopicFeedbackInput {
  topicName: string;
  achievedLevelIndex: number | null;
  achievedLevelName?: string | null;
}

/** Normalized adaptive result input. */
export interface AdaptiveResultInput {
  passed?: boolean;
  topicResults: AdaptiveTopicInput[];
}

/** Optional SCORM action flags for the adaptive results layout. */
export interface AdaptiveResultContextOptions {
  hasScormActions?: boolean;
  showPdf?: boolean;
  canRetry?: boolean;
  showFinish?: boolean;
  /**
   * The test's OWN feedback block (`tests.feedback_json`), normalised by the host —
   * the widest source of the «Рекомендации» block and therefore its first one, exactly
   * as in {@link ResultContextOptions.testFeedback}.
   *
   * It is a property of the TEST, not of the flow mode: an author who wrote a closing
   * word for an adaptive test owes it to the learner as much as in a standard one, so
   * the option exists on both builders and is read by the same collector.
   */
  testFeedback?: FeedbackBlock | null;
}

/**
 * Tone of the level tag, as DS modifiers. The tag answers only what the model can
 * answer — level CONFIRMED or the test's minimum NOT confirmed — and says nothing
 * about how good the level is: the ladder is the author's, it differs from test to
 * test, and the test defines no target rung. Colouring the rungs (top = success and
 * so on) would invent a verdict the author never set.
 *
 * Both states are SOLID, not the pastel default: the tag is the topic's headline on
 * the card, and a washed-out pill under the topic name reads as decoration.
 */
const TONE_CONFIRMED = "ou-tag--solid ou-tag--accent";
const TONE_BELOW_MINIMUM = "ou-tag--solid ou-tag--error";

/**
 * Verdict for an adaptive topic where NO level was confirmed — the learner did not
 * reach the LOWEST level the test defines. Said in full, because the tag is the verdict
 * of the assessment: a terse «Не достигнут» leaves «что именно» to the reader. Exported
 * so the PDF report prints the same words as the screen it is opened from.
 */
export const NO_LEVEL_CONFIRMED_LABEL = "Минимально требуемый уровень не подтверждён";

/**
 * Whether the learner confirmed ANY level of this adaptive topic — the mode's own
 * verdict, and the counterpart of `passed` in the standard mode.
 *
 * `false` is the FAILURE state and there is no third one: an adaptive topic is a ladder
 * of levels, each with its own threshold, so «nothing was judged» cannot happen the way
 * a standard topic without a pass rule leaves `passed === null`. The engine agrees —
 * `aggregateAdaptiveResult` fires the topic's `failureFeedback` and drops
 * `overallPassed` in exactly this branch — and so does the package, which maps the
 * adaptive topic onto the standard shape as `passed: achievedLevelIndex !== null`.
 *
 * Read in ONE place, so the level tag on the card and the visibility of the topic's
 * materials cannot come to disagree about what this topic's outcome was.
 */
function hasAchievedLevel(t: AdaptiveTopicInput): boolean {
  return t.achievedLevelIndex !== null && t.achievedLevelIndex !== undefined;
}

/** Map a normalized adaptive topic to its level-based view (unified feedback). */
function adaptiveTopicView(t: AdaptiveTopicInput): CtxAdaptiveTopicView {
  const achieved = hasAchievedLevel(t);
  return {
    topicName: t.topicName || "",
    levelLabel: achieved ? (t.achievedLevelName as string) : NO_LEVEL_CONFIRMED_LABEL,
    levelClass: achieved ? TONE_CONFIRMED : TONE_BELOW_MINIMUM,
    ...buildTopicFeedbackView(t),
  };
}

/**
 * Build the ADAPTIVE results context (level-based, no score ring). With no opts the
 * output matches the web adaptive results screen; the `opts` enable the SCORM
 * actions (Скачать PDF / Пройти заново / Завершить).
 */
export function buildAdaptiveResultContext(
  input: AdaptiveResultInput,
  title: string,
  opts: AdaptiveResultContextOptions = {},
): ResultRenderContext {
  const result: CtxResult = {
    passed: !!input.passed,
    adaptive: true,
    topicResults: (input.topicResults || []).map(adaptiveTopicView),
  };
  if (opts.hasScormActions) {
    result.hasScormActions = true;
    result.showPdf = !!opts.showPdf;
    result.canRetry = !!opts.canRetry;
    result.showFinish = !!opts.showFinish;
  }
  // The SAME consolidated block the standard results screen carries, from the SAME
  // collector and the same sources in the same order — the test's own feedback first,
  // then what the topics of this attempt wrote and attached. Feedback is a property of
  // the TEST, not of its flow mode, so a second assembly rule for the adaptive screen
  // would only mean two screens disagreeing about what the learner is owed; the adaptive
  // screen used to carry no block at all, which is that disagreement at its widest.
  //
  // What differs between the modes is ONE thing — how a topic's failure is spelled — and
  // it enters as the gate's argument (see `topicRecommendationSources`).
  //
  // The test's own block obeys the same rule as on the standard screen: withheld on an
  // EXPLICIT pass, because a learner who is through with the test owes no work on the
  // mistakes. Here the verdict needs no threshold check — the adaptive mode has no
  // pass-percentage setting to be absent, `overallPassed` is pronounced by
  // `aggregateAdaptiveResult` from the levels actually confirmed. An absent flag is
  // therefore not «unknown» but a plain non-success, and it shows.
  const recommendationSources: Array<FeedbackBlock | null | undefined> =
    input.passed === true ? [] : [opts.testFeedback];
  for (const topic of input.topicResults || []) {
    recommendationSources.push(...topicRecommendationSources(topic, !hasAchievedLevel(topic)));
  }
  const recommendations = collectRecommendations(recommendationSources);
  if (recommendations.hasAny) result.recommendations = recommendations;
  return { course: { title }, result };
}
