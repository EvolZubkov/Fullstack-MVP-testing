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
import { richTextToHtml, type RichTextFormat } from "./rich-text";
import { buildScalesChart, type ChartKindSettings } from "./scales-chart";
import { parseScaleAppearance } from "./scale-appearance";
import { collectRecommendations } from "./recommendations";
import { resolveResultsBlocks, type ResultsBlocks, type ResultsBlockSettings } from "./results-blocks";
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
  /**
   * ADAPTIVE MODE ONLY: the wording of the level the learner confirmed
   * (`adaptive_levels.feedback`), or the topic's failure text when none was. Rendered in
   * the topic card of `results.adaptive.html` (see `adaptiveLevelFeedback`).
   *
   * The STANDARD mode leaves it empty on purpose. A topic's own feedback text is
   * {@link feedbackTexts}, and it reaches the learner through the consolidated
   * «Рекомендации» block rather than through the card.
   */
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
 * The unified per-topic recommendation view — courses/events with a presence flag.
 * Shared by standard and adaptive results so the topic card is composed identically in
 * both modes (spec §3.2 / plan 6.1). Recommendations are a property of the test's
 * settings, not the flow mode.
 *
 * It deliberately builds NO feedback text. It used to, and both results layouts carried
 * a per-topic slot for it; once the consolidation put every text into the ONE
 * «Рекомендации» block, that slot could only stand empty or print the same sentence a
 * second time on the same screen. The topic's text now travels as
 * {@link TopicFeedbackInput.feedbackTexts} into the block, and the slot is gone from the
 * standard layouts.
 *
 * The ADAPTIVE card is the exception and keeps its slot — see
 * {@link adaptiveLevelFeedback}: what `feedback` means there is a different text, with no
 * other route to the learner.
 */
export function buildTopicRecommendationsView(t: TopicFeedbackInput): {
  recommendedCourses: CtxRecommendation[];
  recommendedEvents: CtxRecommendation[];
  hasRecommendations: boolean;
} {
  const courses = (t.recommendedCourses ?? []).map((l) => ({ title: l.title, ...(l.url ? { url: l.url } : {}) }));
  const events = (t.recommendedEvents ?? []).map((l) => ({ title: l.title, ...(l.url ? { url: l.url } : {}) }));
  return {
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
   * PRD-46: which diagram the author asked for, as the raw setting values.
   *
   * A separate field rather than a read of `blockSettings`, because the REPORT carries its own
   * switch: the document goes to a specialist, and a profile belongs there even when the
   * learner's screen does not show one (PRD-35 §9). The results host passes its block
   * settings, the report host passes the report variant's — the decision rule is one.
   */
  chartSettings?: ChartKindSettings;
  /**
   * PRD-46: do the scales divide one whole? Computed by the HOST
   * (`shared/scales/composition`), because the render context carries results, not the
   * contribution model they came from.
   */
  ipsativeScales?: boolean;
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
    // Формат едет ВМЕСТЕ с текстом: без него «Форматированный» и «HTML», которые автор
    // выбрал в редакторе, приходят слушателю сплошным абзацем (см. `FeedbackBlock.format`).
    ...(f.format === "richText" || f.format === "html" ? { format: f.format } : {}),
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

/**
 * What the measurement blocks resolve to for ONE attempt: the measures the learner may
 * see at all (`visibility !== "hidden"`) and the author's effective show/hide answer for
 * each block.
 *
 * Split out of the standard builder because the ADAPTIVE screen resolves the very same
 * two facts (issue #33). Two copies of this would be two answers to «does this test show
 * its scales», and the product has exactly one — it is a property of the TEST and its
 * «Итоги» settings, not of the flow mode.
 */
interface ResolvedMeasures {
  visibleScales: MeasureInput[];
  visibleIndicators: MeasureInput[];
  blocks: ResultsBlocks;
}

/**
 * Visible measures + effective block visibility.
 *
 * @param measures The test's measurement material for this attempt.
 * @param hasGradedScore Whether the test grades at all — the `auto` answer for the SCORE
 *   SUMMARY block only. The adaptive screen has no summary and passes `false`; the two
 *   measurement blocks answer `auto` from their own emptiness, in both modes alike.
 */
function resolveMeasures(measures: MeasuresInput, hasGradedScore: boolean): ResolvedMeasures {
  const visibleScales = measures.scales.filter((m) => m.visibility !== "hidden");
  const visibleIndicators = measures.indicators.filter((m) => m.visibility !== "hidden");
  return {
    visibleScales,
    visibleIndicators,
    blocks: resolveResultsBlocks(measures.blockSettings ?? {}, {
      hasPassThreshold: hasGradedScore,
      hasVisibleScales: visibleScales.length > 0,
      hasVisibleIndicators: visibleIndicators.length > 0,
    }),
  };
}

/**
 * Fill the measurement blocks of a results context and return what they contribute to the
 * consolidated «Рекомендации» block — the feedback of the band / outcome that actually
 * fired, indicators before scales, which is the order dedup should keep.
 *
 * ONE routine for both modes (issue #33): the standard screen and the adaptive one draw
 * the SAME cards from the SAME rows, and the only thing that ever differed between them
 * was that the adaptive screen was never handed the rows. A hidden block contributes
 * nothing to the recommendations either — the learner never saw what caused it.
 */
function fillMeasureBlocks(
  result: CtxResult,
  measures: MeasuresInput,
  resolved: ResolvedMeasures,
): Array<FeedbackBlock | null> {
  const { visibleScales, visibleIndicators, blocks } = resolved;
  if (blocks.scales && visibleScales.length) {
    // «Оформление шкал» читается ДО карточек, а не только диаграммой: цвет шкалы — свойство
    // самой шкалы, и карточка с полосой обязана совпасть с её сектором на розе. Диаграмму
    // могли и выключить — цвет от этого никуда не девается.
    const appearance = parseScaleAppearance(measures.chartSettings?.scaleAppearance);
    result.scales = visibleScales.map((m) =>
      buildMeasureView({
        ...m,
        requestedKind: measures.scaleKind,
        ramp: measures.ramp,
        color: appearance[m.key]?.color,
      }));
    // PRD-35/46. The chart is built INSIDE the scales branch: a hidden block must not
    // leave a dangling diagram on the screen. `buildScalesChart` returns null on every
    // refusal — the setting says «none», or the builder cannot draw the figure it was
    // asked for — and the refusal is silent for the learner; the author is told why in
    // the editor.
    result.scalesBlockClass = "tb-measures";
    const chart = buildScalesChart({
      axes: visibleScales,
      ramp: measures.ramp,
      settings: measures.chartSettings ?? {},
      ipsative: measures.ipsativeScales === true,
    });
    if (chart) {
      result.scalesChart = chart;
      result.scalesBlockClass = "tb-measures tb-measures--chart";
    }
  }
  if (blocks.indicators && visibleIndicators.length) {
    result.indicators = visibleIndicators.map((m) =>
      buildMeasureView({ ...m, requestedKind: measures.indicatorKind, ramp: measures.ramp }));
  }
  return [
    ...(blocks.indicators ? visibleIndicators.map(firedFeedback) : []),
    ...(blocks.scales ? visibleScales.map(firedFeedback) : []),
  ];
}

/** Optional SCORM-richer additions to the standard results context. */
export interface ResultContextOptions {
  /** Add the per-topic "Баллов" row (`pointsLabel`) — SCORM shows it, web omits. */
  withTopicPoints?: boolean;
  /**
   * Keep the per-topic "Баллов" row even when the test's score-summary block is
   * switched off (`blockSettings.scoreSummary: "hide"`). Set by the PDF report ONLY:
   * a downloaded document has no live toggle for the reader to flip, so it always
   * prints the number when {@link withTopicPoints} is on. Every other caller
   * (SCORM/web results screen) leaves this unset, so the toggle governs the
   * per-topic row exactly as it governs the summary itself (issue #30) — a hidden
   * summary is «the block with points is off», not «the test-level ring is off».
   */
  topicPointsIgnoreScoreSummary?: boolean;
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
   * TWO consumers read it, and both resolve ABSENT as «UNKNOWN» in favour of SHOWING:
   * the feedback gate (unknown keeps handing the learner everything the author wrote —
   * losing a leaflet is worse than showing it once too often) and the verdict tag
   * (unknown keeps the «Пройден»/«Не пройден» headline, so a host that has not been
   * taught to send the flag does not lose the verdict of every graded test it renders).
   * The flag therefore only ever silences; it never invents a verdict or a leaflet.
   *
   * `false` is NOT the same as absent: it is the author's own «this test has no
   * threshold», and it silences both — the screen must not headline a success nobody
   * pronounced (PRD-29 §6.7).
   */
  hasPassThreshold?: boolean;
  /**
   * PRD-29 measurement blocks. Absent (a test with neither scales nor indicators)
   * leaves the context byte-identical to what a control test has always produced.
   */
  measures?: MeasuresInput;
  /**
   * Вводный блок этой выдачи: авторский текст и его формат (`tests.intro_json`).
   *
   * Разметку строит построитель, а не хост: правило одно и то же для экрана и для отчёта,
   * а два его применения разошлись бы ровно так же, как разошлись бы два расчёта вердикта.
   * Пустой текст блока не даёт (см. {@link CtxResult.introHtml}).
   */
  intro?: { text?: string | null; format?: RichTextFormat | null } | null;
}

/** Built `{ course, result }` for the results layouts. */
export interface ResultRenderContext {
  course: CtxCourse;
  result: CtxResult;
}

/**
 * Does this topic have ANYTHING to tell the learner — i.e. is a card for it worth
 * rendering at all?
 *
 * Every slot of the topic card is gated on its own: «Правильно» on `total`, «Баллов»
 * on `pointsLabel`, the verdict tag on an empty label, the courses on
 * `hasRecommendations`. The CARD and the «Результаты по темам» heading above it were
 * not: they stood on the mere PRESENCE of the topic in `topicResults`. A purely
 * measurement topic (a burnout inventory: `aggregateStandardResult` counts no
 * measurement-only question toward `total`) on a test whose score summary is off
 * therefore rendered a heading, a separator and a card holding a topic name and a
 * forever-empty progress bar — a block without a single fact in it, the same nonsense
 * PRD-29 removed from the test-level summary, two levels down.
 *
 * Such a topic is dropped from `topicResults` entirely rather than hidden by a flag:
 * an empty array is falsy in the DSL, so `{{#if result.topicResults}}` takes the
 * heading, the separator and the grid with it — in the shipped templates AND in any
 * third-party one uploaded through the PRD-3 registry, which no layout edit here
 * could reach.
 *
 * THREE things count as something to say, and the last two are why this is not simply
 * `total > 0`:
 * - graded questions (`total > 0`) — the counts, the points and the bar mean something;
 * - a PRONOUNCED verdict (`passed !== null`) — a host that judged the topic has stated
 *   a fact about it, and we never erase a stated fact;
 * - the topic's own courses and events — the topic card is their ONLY route to the
 *   learner (the consolidated «Рекомендации» block is fed by feedback texts and
 *   attachments, not by these; see `topicRecommendationSources`), so dropping the card
 *   would drop what the author hung on the topic.
 */
export function topicHasContent(t: TopicInput): boolean {
  return (
    t.total > 0 ||
    t.passed != null ||
    (t.recommendedCourses?.length ?? 0) > 0 ||
    (t.recommendedEvents?.length ?? 0) > 0
  );
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
    // Courses and events only. The topic's feedback TEXT is deliberately absent: it
    // reaches the learner through the consolidated «Рекомендации» block (fed by
    // `feedbackTexts` above), and the standard layouts no longer carry a per-topic slot
    // for it. The adaptive row DOES carry one — that `feedback` is the confirmed LEVEL's
    // wording, not the topic's, and the block is not fed from it (see
    // `adaptiveLevelFeedback`). The asymmetry is intentional, not an unfinished edit.
    ...buildTopicRecommendationsView(t),
  };
  // `total` is the topic's COUNT OF GRADED questions (`aggregateStandardResult` never
  // counts a measurement-only one toward it), so zero means the topic has nothing with
  // a correct answer to speak of — a burnout-inventory topic, say. "Баллов 0.0 / 0.0"
  // there is the same nonsense PRD-29 removed from the test-level summary, one level
  // down; the layout drops the sibling «Правильно» row on the same `total` check.
  if (withPoints && t.total > 0) view.pointsLabel = round1(t.earnedPoints) + " / " + round1(t.possiblePoints);
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
  // ONE source of truth for «is there a graded score to speak about» — it answers the
  // score summary (`auto`) and the feedback gate below, and it is the strict half of the
  // verdict rule right after it. TWO conditions, not one: a threshold IS declared AND
  // there is something to grade. Every new test
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
  //
  // Computed BEFORE `result` so the block-visibility flags below can gate the per-topic
  // «Баллов» row the same way they gate the summary itself (issue #30).
  const thresholdDeclared = opts.hasPassThreshold ?? opts.measures?.hasPassThreshold;
  // «Nothing to grade» stands on its own because the verdict rule below needs it WITHOUT
  // the threshold flag: it is read off the run itself, so it holds for every host — taught
  // to send the flag or not — and for attempts finished before any of this existed.
  const nothingToGrade = round1(input.possiblePoints) <= 0;
  const hasGradedScore = thresholdDeclared === true && !nothingToGrade;
  // THE VERDICT TAG, for every test — measurement or control alike. Same question as
  // `hasGradedScore` («does this test grade at all»), with ONE deliberate difference: an
  // ABSENT threshold flag does not silence it. `hasGradedScore` may read unknown as «no»
  // because it only ever hides a summary; the tag is the screen's headline, and a host
  // that has not been taught to send the flag must not lose the verdict of every graded
  // test it renders. So the tag falls only on what is KNOWN: nothing was graded, or the
  // author declared no threshold at all (PRD-29 §6.7 — «порог задан И есть что оценивать»).
  //
  // Until 2026-08-06 this gate lived INSIDE the `measures` branch below, so it reached
  // only a test with scales or indicators. A control test — the commonest configuration
  // in the product — kept printing a green «Пройден» while the feedback block, gated by
  // the very same question a few lines down, printed underneath it: the header claimed a
  // success and the block below handed out work on the mistakes.
  const noVerdict = nothingToGrade || thresholdDeclared === false;
  // Visible scales/indicators and the resolved block visibility, gathered ONCE so the
  // scales/indicators sections further below reuse the SAME values instead of refiltering.
  // The SAME resolver the adaptive builder runs (issue #33).
  const resolvedMeasures = opts.measures ? resolveMeasures(opts.measures, hasGradedScore) : undefined;
  const blocks = resolvedMeasures?.blocks;
  // The score-summary toggle governs «the block with points» as a whole, not only the
  // test-level ring: a hidden summary must hide the SAME points at topic granularity too
  // (issue #30 — the SCORM package kept printing «Баллов» per topic while the summary
  // was switched off). No `measures` (a control test) leaves `withTopicPoints` exactly as
  // the caller set it — the toggle only exists for a measurement test. The report opts
  // out via {@link ResultContextOptions.topicPointsIgnoreScoreSummary}.
  const withTopicPoints =
    !!opts.withTopicPoints && (opts.topicPointsIgnoreScoreSummary || !blocks || blocks.scoreSummary);
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
    // A topic with nothing to report brings no card — see {@link topicHasContent}. The
    // filter runs BEFORE the mapping so the array can end up empty, which is what takes
    // the whole «Результаты по темам» section down with it.
    topicResults: (input.topicResults || []).filter(topicHasContent).map((t) => topicView(t, withTopicPoints)),
  };
  // Вводный блок — первым, до всего остального (см. `CtxResult.introHtml`). Разметку
  // строит ядро, поэтому правило одно и то же для экрана и для отчёта.
  const introHtml = richTextToHtml(opts.intro?.text, opts.intro?.format ?? undefined);
  if (introHtml) result.introHtml = introHtml;
  if (opts.recommendedCourses && opts.recommendedCourses.length) result.recommendedCourses = opts.recommendedCourses;
  if (opts.recommendedEvents && opts.recommendedEvents.length) result.recommendedEvents = opts.recommendedEvents;
  if (opts.backAction) {
    result.backAction = opts.backAction;
    result.backLabel = opts.backLabel;
  }
  // No judgement — no tag. A method that checks nothing makes both «Пройден» and «Не
  // пройден» false statements about the learner, not a cosmetic default. The third state
  // is the one the topic rows already use (`passed === true / false / ""`), and every
  // results layout drops the tag entirely on an empty label. It follows the
  // THRESHOLD-and-points pair and NOT the score-summary block: an author who force-shows
  // the summary of an ungraded test still gets no verdict, and hiding the summary of a
  // control test does not erase its verdict.
  if (noVerdict) {
    result.passClass = "";
    result.statusLabel = "";
  }
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
  if (opts.measures && resolvedMeasures && blocks) {
    // `hasGradedScore`, the visible measures and `blocks` are resolved ONCE, above — the
    // score summary, the verdict tag, the topic points row and the feedback gate must not
    // be able to disagree about whether this test grades.
    // (`scoredQuestions` in `shared/scoring/aggregate.ts` describes the very same
    // contract but is absent from the stored result schema, so it cannot answer for
    // attempts finished earlier.) The verdict tag is NOT gated here: it belongs to every
    // test, so it is resolved above `result` for the measurement and the control screen
    // alike — this branch only ever adds what measurements bring.
    // INVERTED on purpose. A control test never passes `measures`, so a positive
    // flag would be absent — and `{{#if result.showScoreSummary}}` would erase the
    // score ring from every control test in every package and in the preview. The
    // absent state has to mean «show», so only the suppression is recorded.
    if (!blocks.scoreSummary) result.hideScoreSummary = true;

    // Order matters: the test's own block (already first in the list) then the profile,
    // then the scales — dedup keeps the first occurrence, so a general recommendation
    // outranks its specific copy. The cards and that order come from the shared
    // `fillMeasureBlocks`, which the adaptive screen runs too.
    recommendationSources.push(...fillMeasureBlocks(result, opts.measures, resolvedMeasures));
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
  /**
   * PRD-29 measurement blocks — scales and indicators of THIS attempt, in the very shape
   * the standard screen takes them (issue #33).
   *
   * A scale is fed by the MEASUREMENTS an author hung on questions, and an adaptive test
   * asks questions like any other: the values were computed for an adaptive run all
   * along and even travelled to the LMS as `scale_*` / `var_*` interactions, while the
   * screen that run ends on showed none of it. Whether a block appears is decided by the
   * same two facts as in the standard mode — the measure's own `learnerVisibility` and
   * the show/hide/auto switch of the «Итоги» variant — because that is a property of the
   * TEST, not of its flow mode.
   *
   * The SCORE SUMMARY switch inside {@link MeasuresInput.blockSettings} is not read here:
   * the adaptive screen has no summary to hide. Absent (a test with neither scales nor
   * indicators, or a host that does not gather them) leaves the context byte-identical
   * to what the adaptive screen produced before.
   */
  measures?: MeasuresInput;
  /** Вводный блок этой выдачи — тот же, что у стандартного экрана (см. там же). */
  intro?: { text?: string | null; format?: RichTextFormat | null } | null;
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

/**
 * The adaptive card's own feedback slot — the ONLY per-topic feedback text either mode
 * still renders inside a topic card.
 *
 * WHY IT SURVIVED THE CONSOLIDATION. In the adaptive mode `feedback` is not the topic's
 * feedback text at all: `aggregateAdaptiveResult` fills it with the wording of the LEVEL
 * the learner confirmed (`adaptive_levels.feedback`), or with the topic's failure text
 * when no level was reached. Neither is a source of the consolidated «Рекомендации»
 * block — that one is fed from the topic's and the section's `feedback_json` — so
 * removing the slot here would not move the text into the block, it would delete it from
 * the product. The standard card's slot was removed precisely because its text DID move.
 *
 * So the two layouts differing on this point is the intended state, not an edit left
 * half-done: `results.html` has no slot, `results.adaptive.html` has one.
 */
function adaptiveLevelFeedback(t: AdaptiveTopicInput): { feedback?: string; hasFeedback: boolean } {
  const fb = String(t.feedback ?? "").trim();
  return { ...(fb ? { feedback: fb } : {}), hasFeedback: fb.length > 0 };
}

/** Map a normalized adaptive topic to its level-based view (unified feedback). */
function adaptiveTopicView(t: AdaptiveTopicInput): CtxAdaptiveTopicView {
  const achieved = hasAchievedLevel(t);
  return {
    topicName: t.topicName || "",
    levelLabel: achieved ? (t.achievedLevelName as string) : NO_LEVEL_CONFIRMED_LABEL,
    levelClass: achieved ? TONE_CONFIRMED : TONE_BELOW_MINIMUM,
    ...buildTopicRecommendationsView(t),
    ...adaptiveLevelFeedback(t),
  };
}

/**
 * Build the ADAPTIVE results context (level-based, no score ring). With no opts the
 * output matches the web adaptive results screen; the `opts` enable the SCORM
 * actions (Скачать PDF / Пройти заново / Завершить) and the PRD-29 measurement blocks
 * ({@link AdaptiveResultContextOptions.measures}).
 *
 * Block order on the screen is the LAYOUT's decision, not this builder's: it fills
 * `topicResults`, `indicators`, `scales` and `recommendations`, and
 * `results.adaptive.html` renders them as confirmed levels first (the headline of an
 * adaptive run), then the measurements, then the recommendations.
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
  // Вводный блок — первым, до уровней и измерений: правило общее для обоих режимов.
  const adaptiveIntroHtml = richTextToHtml(opts.intro?.text, opts.intro?.format ?? undefined);
  if (adaptiveIntroHtml) result.introHtml = adaptiveIntroHtml;
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
  // The measurement blocks and what their fired bands / outcomes say — the SAME routine
  // the standard screen runs, so the two screens cannot draw the same scale differently
  // (issue #33). `false` for the score summary: this screen has none, and only that
  // block's `auto` reads the flag.
  if (opts.measures) {
    recommendationSources.push(
      ...fillMeasureBlocks(result, opts.measures, resolveMeasures(opts.measures, false)),
    );
  }
  for (const topic of input.topicResults || []) {
    recommendationSources.push(...topicRecommendationSources(topic, !hasAchievedLevel(topic)));
  }
  const recommendations = collectRecommendations(recommendationSources);
  if (recommendations.hasAny) result.recommendations = recommendations;
  return { course: { title }, result };
}
