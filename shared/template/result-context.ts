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
  CtxResultBlock,
  CtxSectionResult,
  CtxSectionIntro,
  CtxTopicResultView,
  CtxTopicGroup,
  CtxAdaptiveTopicView,
  CtxRecommendation,
  CtxBreakdownRow,
} from "./context";
import type { BreakdownEntry } from "../breakdown/types";
import { resolveBlockOrder, DEFAULT_BLOCK_ORDER, type ResultsBlockKey } from "./results-order";
import { labelsTree } from "./labels";
import { buildMeasureView, type CtxMeasureView, type RenderKind } from "./measure-view";
import { richTextToHtml, type RichTextFormat } from "./rich-text";
import { barFillCss, type BarFillSetting } from "./bar-fill";
import { formatMinutesHuman } from "./duration";
import { buildScalesChart, type ChartKindSettings } from "./scales-chart";
import { buildScaleBars, type CtxScaleBars } from "./scale-bars";
import { parseScaleAppearance } from "./scale-appearance";
import { collectRecommendations } from "./recommendations";
import { collectBreakdownFeedback } from "../breakdown/feedback";
import {
  resolveTopicInterpretation,
  resolveBreakdownInterpretation,
  type InterpretationText,
} from "../interpretation/resolve";
import { resolveResultsBlocks, type ResultsBlocks, type ResultsBlockSettings } from "./results-blocks";
// PRD-29 §6.7 lives in the scoring layer, not here: the results screen was its first
// reader, not its owner (see the two gates in `buildResultContext`).
import { hasGradedScore as isGradedRun, hasPronouncedVerdict, type ResolvedRule } from "../scoring/pass-rule";
import { sectionIsRequiredForVerdict, sectionPassConditionText, sectionTimerWarningText } from "./pass-condition";
// PRD-61: КАКИЕ вводные тексты печатать — вопрос выдачи, и ответ на него один на оба хоста.
// Лежит он в `shared/report`, потому что тот же ответ нужен внутри SCORM-пакета.
import { introBlocksToPrint, type IntroBlockLike } from "../report/report-intro";
// PRD-50 FR-26: the counter rule lives with the verdict it counts, not with the layout —
// `aggregateStandardResult` stamps the same numbers onto the stored result through it.
import { groupSections } from "../scoring/section-groups";
import { findOutcome } from "../scales/interpretation";
import type {
  FeedbackBlock,
  IndicatorInterpretation,
  LearnerVisibility,
  RecommendationLink,
  ScaleInterpretation,
} from "../scales/interpretation";
import type { LevelRamp } from "./level-ramp";

/**
 * Layout-facing flag per sub-block: the DSL has no equality test, only truthiness.
 *
 * Typed against `CtxResultBlock` and not `string`: a misspelt flag («isScale») is a block
 * that silently disappears from the screen — the layout's `{{#if isScales}}` simply never
 * fires, no host throws, and no existing test looks at the flag of a block it does not
 * render. The compiler is the only thing that can catch it early.
 */
const BLOCK_FLAG: Record<ResultsBlockKey, keyof CtxResultBlock> = {
  summary: "isSummary",
  scales: "isScales",
  indicators: "isIndicators",
  topics: "isTopics",
  breakdown: "isBreakdown",
};

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
  /**
   * PRD-50 FR-50: тексты ПОДТЕМ этого раздела (`test_sections.breakdown_feedback_json`),
   * ключ подтемы -> её блок обратной связи в том же формате, что у темы.
   *
   * Отбор — не дело хоста: подтему выдаёт тот, чей результат ниже общего проходного
   * порога теста (решение владельца 2026-09-03), и правило живёт в одном месте,
   * {@link module:shared/breakdown/feedback}. Хост только привозит написанное.
   */
  breakdownFeedback?: Record<string, FeedbackBlock> | null;
}

/**
 * PRD-50 FR-13 display setting for the topic breakdown rows (`tests.breakdown_display_json`).
 * `hidden` (the default when the column is null) means the topic card prints no breakdown at
 * all, byte-identical to a test built before PRD-50. `basis` picks the NUMBER shown, not the
 * pass verdict's currency — the threshold is always evaluated in points.
 */
export interface BreakdownDisplaySetting {
  visibility: "hidden" | "bar" | "bar_and_value";
  basis: "units" | "points";
  /**
   * PRD-50 FR-44 (Э4): WHERE the visible breakdown is printed — inside the topic cards
   * (`topics`, the projection Э1 shipped), as the summary block of the whole test
   * (`block`, {@link CtxResult.breakdown}), or both.
   *
   * OPTIONAL, and absence means `topics`: every setting saved before Э4 says nothing here,
   * and such a test must keep printing exactly what it printed — nested bars and no block.
   * The two projections answer different questions (a key inside ONE section vs. the same
   * key across the whole test), so the author picks either, both, or neither — but
   * {@link visibility} still governs them jointly: `hidden` prints none of them (FR-31).
   */
  placement?: "topics" | "block" | "both";
  /**
   * Печатать ли ТОЛКОВАНИЯ подтем под их полосами.
   *
   * OPTIONAL, и отсутствие значит НЕ печатать: тексты подтем — новая возможность, и ни один
   * тест, сохранённый до неё, не должен получить их молча. Показ вложен в {@link visibility}:
   * при `hidden` строк подтем нет, и печатать толкование некуда.
   */
  showInterpretation?: boolean;
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
  /** PRD-50: breakdown records of this topic, as the host stored them. */
  breakdown?: BreakdownEntry[] | null;
  /**
   * PRD-50 FR-11: the group this section belongs to (`test_sections.group_key`, echoed by
   * the aggregate onto the stored topic result). Absent/null, or a key the test does not
   * declare, all mean the same: no group (FR-12).
   */
  groupKey?: string | null;
  /**
   * ТОЛКОВАНИЕ самой темы (`topics.interpretation_json`) и толкование, заданное ЭТИМ тестом
   * (`test_sections.interpretation_json`). Разрешает их ядро одной функцией — и для выдачи,
   * и для карточки редактора, чтобы автор видел ровно тот текст, который получит участник.
   */
  interpretation?: InterpretationText | null;
  sectionInterpretation?: InterpretationText | null;
  /**
   * ТОЛКОВАНИЯ ПОДТЕМ этого раздела: «ключ подтемы -> текст»
   * (`test_sections.breakdown_interpretation_json.keys`). Хост только привозит написанное.
   */
  breakdownInterpretation?: Record<string, InterpretationText> | null;
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
  /**
   * PRD-57 FR-36: оценка завершена. `false` — в попытке есть ответ, который ждёт
   * проверки, и экран итогов обязан уметь это сказать (FR-41). Отсутствие поля означает
   * «попытка собрана до этой работы», и экран ведёт себя как раньше.
   */
  gradingComplete?: boolean;
  percent: number;
  totalQuestions: number;
  correct: number;
  earnedPoints: number;
  possiblePoints: number;
  topicResults: TopicInput[];
  /**
   * PRD-50 FR-11: the test's declared groups (`tests.section_groups_json`), in any shape —
   * they are normalised by `shared/scoring/section-groups`, so a host may hand over the
   * jsonb column, a snapshot's copy or the value baked into `TEST_DATA` as it is. Absent /
   * empty = no groups, and the built context is byte-identical to what it was before this
   * stage (FR-27).
   *
   * Named `sectionGroups` on the INPUT and `topicGroups` on the OUTPUT on purpose: the
   * input speaks the words of the test's structure (a group of SECTIONS, which is what the
   * author edits), the output the words of the render contract, where FR-29 fixes the name
   * `result.topicGroups` because `result.blocks` is already taken by PRD-49.
   */
  sectionGroups?: unknown;
  /**
   * PRD-50 FR-28/FR-39: the breakdown records of the TEST scope, as the host STORED them
   * with the attempt (`attempts.result_json.breakdowns`, the package's saved attempt).
   *
   * Taken, never recomputed: the test scope is a separate pass over the delivered items
   * (FR-04), so it cannot be derived from the per-topic records this input also carries —
   * a question delivered in two sections counts twice there and once here. Absent/empty =
   * the attempt produced none (a test without keys, or one graded before PRD-50), and the
   * summary block simply does not appear.
   */
  breakdowns?: BreakdownEntry[] | null;
}

/** One scale or indicator as the host hands it over, before presentational shaping. */
export interface MeasureInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  visibility: LearnerVisibility;
  interpretation: ScaleInterpretation | IndicatorInterpretation;
  /**
   * PRD-49 §6. Show the card's name / level slots — read by the host from
   * `config_json.showName` / `config_json.showLevel` of the scale or result-variable row.
   * Absent = show, so a measure whose row carries neither key (every measure saved before
   * this PRD) keeps its card exactly as it was. Spread straight through to
   * {@link module:shared/template/measure-view.MeasureViewInput} by {@link buildMeasureView}
   * callers below — this is the ONE place both hosts read the toggle from.
   */
  showName?: boolean;
  showLevel?: boolean;
  /**
   * PRD-53 §4.4. Собственное описание шкалы (`scales.description`). Читает только карточка
   * «вне профиля»: она собирает текст ИЗ ШКАЛ, а не из копий, разложенных по исходам показателя.
   */
  description?: string;
  /**
   * PRD-53 §4.4. Показатель-профиль печатает вторую карточку — шкалы группы, не вошедшие в набор.
   *
   * `keys` дублируют группу из формулы намеренно: контекст отрисовки формулы не несёт — он
   * получает уже посчитанные значения, — и разбирать её здесь значило бы тащить парсер в оба
   * хоста ради списка, который редактор и так знает.
   */
  restScales?: { show: boolean; label: string; keys: string[] };
}

/** PRD-29 measurement input: the visible measures plus the design-param choices. */
export interface MeasuresInput {
  ramp: LevelRamp;
  scaleKind: RenderKind;
  indicatorKind: RenderKind;
  /**
   * Print «из N» beside a measure's value, or the value alone. A design param of the
   * test (`scaleShowMax`), read here by both hosts exactly like the two kinds above;
   * absent = print it, so a test saved before the param keeps its readout.
   */
  showMax?: boolean;
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
  /**
   * PRD-50 FR-11: блоки разделов теста, как их отдал хост вместе с остальным материалом
   * итогов.
   *
   * Поле объявлено ЗДЕСЬ, а не только у входа результата, потому что отчёт строится в
   * браузере: у него нет доступа к тесту, и блоки доезжают до него единственным путём —
   * этим же материалом. Пока поля в контракте не было, документ печатал плоский список
   * тем даже там, где экран печатал блоки со счётчиком, — и расхождение двух выдач
   * поймала только живая приёмка.
   */
  sectionGroupsJson?: unknown;
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
 * Обратная связь темы в этом тесте — РАЗРЕШЁННАЯ, одним значением (PRD-29 §7.1a).
 *
 * Задан текст раздела (`test_sections.feedback_json`) — печатается он; не задан —
 * печатается текст темы (`topics.feedback_json`). Сложение двух текстов не допускается:
 * до этой правки печатались ОБА подряд, и ученик получал склейку, которую автор нигде не
 * видел и не собирал (решение владельца 2026-09-02).
 *
 * ОДНО правило на оба хоста, как и {@link feedbackAssets}: веб-хост сохраняет результат
 * этого вызова вместе с попыткой, сборка SCORM пишет его в раздел `TEST_DATA`. Вторая
 * копия правила разошлась бы молча и всплыла бы как два плеера с разным текстом.
 *
 * ОТКУДА БЕРЁТСЯ ТЕКСТ ТЕМЫ. Нынешний источник — `topics.feedback_json.text`, запасной —
 * легаси-колонка `topics.feedback`. Запасной не украшение совместимости: редактор тем
 * шлёт ТОЛЬКО `feedback_json`, и у темы, которой редактор не касался, весь текст лежит в
 * колонке. Где есть оба, побеждает нынешний источник.
 *
 * Возвращается СПИСОК, хотя значений в нём теперь не больше одного: имя и форма поля
 * (`feedbackTexts`) — контракт с обоими хостами и с сохранёнными попытками, а попытки,
 * сданные до этой правки, везут в нём два текста и обязаны печатать их как прежде.
 * Пустой текст (пробелы) не даёт ничего: пустой абзац — не рекомендация.
 *
 * @param topic Строка темы: её блок `feedbackJson` и легаси-колонка `feedback`.
 * @param sectionFeedback `test_sections.feedback_json` раздела ЭТОГО теста над темой.
 */
export function topicFeedbackTexts(
  topic: { feedbackJson?: unknown; feedback?: string | null } | null | undefined,
  sectionFeedback?: unknown,
): string[] {
  const sectionText = blockText(sectionFeedback);
  if (sectionText) return [sectionText];
  const legacy = typeof topic?.feedback === "string" ? topic.feedback.trim() : "";
  const topicText = blockText(topic?.feedbackJson) || legacy;
  return topicText ? [topicText] : [];
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
  // Через `findOutcome`, а не собственным сравнением: набор ключей и запасной `count:<N>`
  // (PRD-53 §4.3) обязаны действовать и в карточке, и в блоке рекомендаций. Две копии правила
  // означали бы, что текст профиля нашёлся, а совет к нему — нет.
  const outcomes = (interpretation as IndicatorInterpretation).outcomes ?? [];
  return normalizeFeedback(findOutcome(outcomes, m.value as string | boolean)?.feedback);
}

/**
 * Вторая карточка показателя-профиля: шкалы группы, НЕ вошедшие в верхнюю зону (PRD-53 §4.4).
 *
 * Порядок — по убыванию значения, а не канонический: канонический порядок хранит КОД набора, а
 * методика перечисляет оставшиеся стили от более выраженного к менее. Текст берётся из самих шкал,
 * поэтому правка описания шкалы правит и этот блок, а не расходится с ним.
 *
 * `null` — печатать нечего: переключатель выключен, значение не код набора, или в набор вошла вся
 * группа.
 *
 * @public
 */
export function buildRestScalesView(
  indicator: MeasureInput,
  scales: readonly MeasureInput[],
): CtxMeasureView | null {
  const config = indicator.restScales;
  if (!config?.show) return null;
  const code = typeof indicator.value === "string" ? indicator.value : "";
  if (!code) return null;

  const inProfile = new Set(code.split("+").filter(Boolean));
  const group = new Set(config.keys);
  const rest = scales
    .filter((s) => group.has(s.key) && !inProfile.has(s.key))
    .filter((s) => typeof s.value === "number" && Number.isFinite(s.value))
    .sort((a, b) => (b.value as number) - (a.value as number));
  if (rest.length === 0) return null;

  const text = rest.map((s) => `${s.name}\n${s.description ?? ""}`.trimEnd()).join("\n\n");
  return {
    key: `${indicator.key}__rest`,
    name: config.label,
    renderKind: "label",
    showValue: false,
    // Заголовок уровня погашен: его роль у этой карточки играет её собственное имя.
    hideLevel: true,
    valueText: "",
    maxText: "",
    valueLabel: "",
    levelLabel: "",
    tone: "neutral",
    toneClass: "tb-tone--neutral",
    bannerVariant: "info",
    text,
    textHtml: richTextToHtml(text),
    zones: [],
    marks: [],
  };
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
  // Измерение без значения карточку не печатает (PRD-53 §7.2). Показатель, заведённый ПОСЛЕ
  // завершения попытки, значения в ней не имеет, и прежде это давало пустую карточку с одними
  // отступами. `null`/`undefined` — единственные признаки отсутствия: `false` и `0` это значения.
  const hasValue = (m: MeasureInput) => m.value !== null && m.value !== undefined;
  const visibleScales = measures.scales.filter((m) => m.visibility !== "hidden" && hasValue(m));
  const visibleIndicators = measures.indicators.filter((m) => m.visibility !== "hidden" && hasValue(m));
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
        showMax: measures.showMax,
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
    // ЛИНЕЙЧАТАЯ ДИАГРАММА печатается ВМЕСТО списка карточек и НЕ вместо розы: роза
    // отвечает на «как делится целое», диаграмма — на «сколько по каждой шкале», и обе
    // могут стоять на одном экране. Поэтому строится она здесь, рядом с карточками, а не
    // в `buildScalesChart`, который выбирает ОДНУ фигуру из взаимоисключающих.
    //
    // Карточки при этом остаются в контексте: макет старого шаблона о диаграмме не знает и
    // обязан продолжать печатать их (гейт стоит в разметке, а не тут). Диаграмма же берёт
    // из карточек готовые надписи, чтобы число под столбиком и число в карточке не
    // разошлись форматом.
    if (measures.scaleKind === "bars") {
      const bars = buildScaleBars({
        measures: visibleScales.map((m) => ({ ...m, color: appearance[m.key]?.color })),
        views: result.scales,
        ramp: measures.ramp,
      });
      if (bars) result.scaleBars = bars;
    }
  }
  if (blocks.indicators && visibleIndicators.length) {
    result.indicators = visibleIndicators.flatMap((m) => {
      const card = buildMeasureView({
        ...m,
        requestedKind: measures.indicatorKind,
        ramp: measures.ramp,
        showMax: measures.showMax,
      });
      // PRD-53 §4.4. Карточка «вне профиля» идёт СРАЗУ за своим профилем: она его продолжение, а
      // не отдельный показатель, и чужая карточка между ними была бы разрывом мысли.
      //
      // Читается ПОЛНЫЙ список шкал, а не `visibleScales`: шкала, скрытая от ученика на своей
      // карточке, всё равно может входить в группу профиля, и её описание блок печатает.
      const rest = buildRestScalesView(m, measures.scales);
      return rest ? [card, rest] : [card];
    });
  }
  return [
    ...(blocks.indicators ? visibleIndicators.map(firedFeedback) : []),
    ...(blocks.scales ? visibleScales.map(firedFeedback) : []),
  ];
}

/** Optional SCORM-richer additions to the standard results context. */
/**
 * Заголовки итога — три строки, которыми тест называет свой результат сам.
 *
 * Свойства узла «Итоги теста» в структуре сценария (`content_pages.settings_json`), а не
 * надписи словаря PRD-49: словарь переименовывает НАДПИСИ ИНТЕРФЕЙСА, общие для всех
 * тестов шаблона, а это — содержание конкретного теста, и живёт оно там же, где остальные
 * свойства его итоговой карточки.
 *
 * Пустая строка равна отсутствию: тест, ничего не заполнивший, печатает ровно то, что
 * печатал, — название теста в заголовке и «Тест пройден» / «Тест не пройден» в шапке.
 */
export interface ResultHeadings {
  /** Заголовок документа и экрана; пусто — название теста. */
  document?: string;
  /** Заголовок при успехе; пусто — умолчание поверхности. */
  passed?: string;
  /** Заголовок при неуспехе; пусто — умолчание поверхности. */
  failed?: string;
}

/** Непустая строка настройки либо `undefined`: пробелы не заголовок. */
export function headingText(value: string | undefined | null): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : undefined;
}

export interface ResultContextOptions {
  /** Add the per-topic "Баллов" row (`pointsLabel`) — SCORM shows it, web omits. */
  withTopicPoints?: boolean;
  /**
   * Заголовки итога этого теста (см. {@link ResultHeadings}). Отсутствие оставляет
   * контекст прежним до поля.
   */
  headings?: ResultHeadings;
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
   * PRD-50 FR-13: the test's breakdown display setting (`tests.breakdown_display_json`).
   * Absent/`null` (no setting saved) leaves every topic's {@link CtxTopicResultView.breakdown}
   * unset — the byte-identical context a test built before PRD-50 produces. Lives OUTSIDE
   * {@link measures}, like {@link testFeedback}: it is a property of the test's results
   * screen, not of whether the test measures anything, and a control test must be able to
   * turn it on too.
   */
  breakdownDisplay?: BreakdownDisplaySetting | null;
  /**
   * How the breakdown bars are coloured (design param `breakdownBarFill`, resolved by
   * {@link module:shared/template/bar-fill barFillFromParams}). Absent/`null` is the
   * `verdict` mode — the byte-identical rows of a test built before the setting. Lives
   * OUTSIDE {@link measures} for the same reason as {@link breakdownDisplay}: a control test
   * has breakdown bars and no measurements.
   */
  barFill?: BarFillSetting | null;
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
   * Общее правило прохождения теста (`tests.overall_pass_rule_json`) — не признак, а
   * САМО правило: тексты подтем выдаются по сравнению с его порогом (PRD-50 FR-50).
   *
   * Отдельно от {@link ResultContextOptions.hasPassThreshold}, который отвечает на другой
   * вопрос («вердикт вообще выносился?») и читается ещё двумя потребителями. Отсутствие
   * значит «порога нет»: сравнивать не с чем, и тексты подтем выдаются везде, где автор
   * их написал.
   */
  overallPassRule?: { type?: string | null; value?: number | null } | null;
  /**
   * PRD-29 measurement blocks. Absent (a test with neither scales nor indicators)
   * leaves the context byte-identical to what a control test has always produced.
   */
  measures?: MeasuresInput;
  /**
   * Вводный блок этой выдачи: общее вступление и тексты по исходу (`tests.intro_json`).
   *
   * Разметку строит построитель, а не хост: правило одно и то же для экрана и для отчёта,
   * а два его применения разошлись бы ровно так же, как разошлись бы два расчёта вердикта.
   * Пустой текст блока не даёт (см. {@link CtxResult.introHtml}).
   *
   * PRD-61: ветвь выдачи приезжает ЦЕЛИКОМ — какой из текстов исхода печатать, решает
   * {@link module:shared/report/report-intro introBlocksToPrint} здесь же, где уже известен
   * вердикт. Хост вынимать текст не должен и не умеет.
   */
  intro?: IntroBlockLike | null;
  /**
   * PRD-49: resolved labels of THIS screen, flat map from `shared/template/labels`
   * (`{"results.scales": "По шкалам"}`). Absent = the caller has not been taught the
   * labels yet, and the context stays exactly as it was before this PRD.
   */
  labels?: Record<string, string>;
  /** PRD-49: the author's order of the sub-blocks; absent = the template's order. */
  blockOrder?: ResultsBlockKey[];
  /**
   * PRD-49: what THIS screen of THIS template prints, and in what order — the list the
   * author's order is cleaned against, and the composition it cannot exceed (the adaptive
   * results screen has no score summary at all).
   *
   * The builder takes a READY list rather than the manifest: resolving «manifest → this
   * screen» is the caller's job ({@link templateBlockOrder}), exactly as it is for the
   * labels. Absent = the shipped order, so a host not yet taught to pass it renders what
   * it always did.
   */
  templateBlockOrder?: readonly ResultsBlockKey[];
}

/** Built `{ course, result }` for the results layouts. */
export interface ResultRenderContext {
  course: CtxCourse;
  result: CtxResult;
  /** PRD-49: resolved interface labels as a nested tree (`labels.results.scales`). */
  labels?: Record<string, unknown>;
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

/**
 * PRD-50 FR-34 fallback wording — the words this file has always printed for the topic
 * verdict tag. A caller that hands over no `labels` (or a template whose manifest has
 * not declared the `topic.verdict.*` keys) must keep seeing exactly these, so today's
 * test keeps today's screen the day this stage ships.
 */
const DEFAULT_TOPIC_VERDICT_LABEL: Record<"passed" | "failed" | "unknown", string> = {
  passed: "Пройдено",
  failed: "Не пройдено",
  unknown: "",
};

/**
 * The topic verdict's own wording, resolved against the PRD-49 dictionary (FR-34).
 *
 * ONE function for both places that speak a topic's verdict — the card's own tag
 * ({@link topicView}) and the breakdown row inside it (§8.1): the methodology names its
 * verdict once, and a row must not disagree with the card that holds it about what word
 * that verdict is. `labels` is the flat resolved map the caller already built
 * ({@link module:shared/template/labels.resolveLabels}); `??` (not `||`) so an author who
 * switched a label OFF (an explicit `""`) is honoured rather than papered over with the
 * fallback — only an ABSENT key (the caller passed no `labels`, or an older template
 * manifest never declared this one) falls back to the hard-coded word.
 */
function topicVerdictLabel(passed: boolean | null, labels?: Record<string, string>): string {
  const state = passed === true ? "passed" : passed === false ? "failed" : "unknown";
  return labels?.[`topic.verdict.${state}`] ?? DEFAULT_TOPIC_VERDICT_LABEL[state];
}

/**
 * One breakdown record as the LAYOUT receives it (§8.1) — the ONE mapping both projections
 * run: the bars nested in a topic card and the summary block of the test scope (FR-28).
 *
 * A second copy of this shaping is exactly the drift PRD-50 §8.1 exists to prevent: the two
 * projections show the same kind of fact, and a row that rounded or worded itself
 * differently depending on where it is printed would read as two different measurements.
 */
function breakdownRow(
  e: BreakdownEntry,
  display: BreakdownDisplaySetting,
  interpretations?: Record<string, InterpretationText> | null,
  barFill?: BarFillSetting | null,
): CtxBreakdownRow {
  const showValue = display.visibility === "bar_and_value";
  const value = display.basis === "points" ? e.percentPoints : e.percentUnits;
  const passed = e.passed ?? null;
  const threshold = typeof e.thresholdPercent === "number" ? e.thresholdPercent : null;
  // Окраска «по доле» и «нейтральная» снимают с полосы вердикт: класс исхода красит полосу
  // в шаблоне, и рядом с заливкой по доле он спорил бы с ней на любом значении между порогом
  // и серединой рампы. Сам исход (`passed`) остаётся — его читают не только полосы.
  const verdictClass = barFill ? "" : passed === true ? "is-pass" : passed === false ? "is-fail" : "";
  const fill = barFill?.mode === "share" ? barFillCss(barFill.ramp, Math.round(value)) : "";
  return {
    key: e.key,
    items: e.items,
    answered: e.answered,
    // One decimal everywhere a real number reaches the layout, exactly like
    // `pointsLabel` does: these fields are bound DIRECTLY by templates, and a raw
    // ratio prints as «73.33333333333333». The bar keeps its own integer.
    earned: round1(e.earned),
    possible: round1(e.possible),
    percent: round1(value),
    percentUnits: round1(e.percentUnits),
    percentPoints: round1(e.percentPoints),
    barPercent: Math.round(value),
    showValue,
    valueLabel: showValue ? Math.round(value) + " %" : "",
    // PRD-50 FR-54: исход ВЗЯТ у записи, а не вычислен здесь. Считать его в контексте значило
    // бы завести вторую правду о пороге и перекрашивать старые попытки при смене настроек.
    passed,
    passClass: verdictClass,
    ...(fill ? { barFill: fill } : {}),
    ...(showValue && threshold !== null ? { requiredLabel: "Нужно " + Math.round(threshold) + " %" } : {}),
    // ТОЛКОВАНИЕ подтемы печатается только при включённом показе: настройка решает, а не
    // наличие текста. Автор может написать тексты заранее и не показывать их участнику.
    ...(display.showInterpretation === true ? breakdownInterpretationHtml(e.key, interpretations) : {}),
  };
}

/**
 * Разметка толкования подтемы для строки разреза, или пустой объект.
 *
 * Пустой объект, а не пустая строка: поле должно ОТСУТСТВОВАТЬ, иначе `{{#if}}` макета
 * напечатает пустой блок под полосой.
 */
function breakdownInterpretationHtml(
  key: string,
  interpretations?: Record<string, InterpretationText> | null,
): { interpretationHtml?: string } {
  const resolved = resolveBreakdownInterpretation(interpretations, key);
  if (!resolved) return {};
  const html = richTextToHtml(resolved.text, resolved.format as RichTextFormat);
  return html ? { interpretationHtml: html } : {};
}

/**
 * PRD-50 FR-44: does the setting ask for the bars NESTED in the topic cards?
 *
 * `visibility` is the joint gate of both projections (FR-31), and `placement` splits them.
 * An ABSENT `placement` is `topics` — the projection Э1 shipped — so a setting saved before
 * Э4 keeps its screen unchanged.
 */
function showsNestedBreakdown(display?: BreakdownDisplaySetting | null): boolean {
  return !!display && display.visibility !== "hidden" && (display.placement ?? "topics") !== "block";
}

/** PRD-50 FR-28/FR-44: does the setting ask for the test-scope SUMMARY block? */
function showsBreakdownBlock(display?: BreakdownDisplaySetting | null): boolean {
  return !!display && display.visibility !== "hidden" && (display.placement ?? "topics") !== "topics";
}

/**
 * Fill the test-scope summary block, for EITHER results screen (FR-28).
 *
 * ONE function for the standard and the adaptive builder, not because the code is short
 * but because the block asks the same question in both modes — «как ты по подтемам по
 * всему тесту» — and a second copy is how one mode would start rounding, wording or
 * gating it differently. The adaptive screen speaks in confirmed LEVELS, so its topic
 * cards carry no bars; this block does not compete with the ladder and shows the very
 * records the engine already computed for an adaptive run (FR-17/FR-39).
 *
 * Both halves of the gate matter and neither is a proxy for the other: the author's own
 * switch (`placement`) and the presence of records. A test may carry keys and want only
 * the nested bars; a test with the block on may deliver an attempt without a single key.
 *
 * Nothing is summed here, and nothing may be: the records come from the attempt as
 * stored. Adding up the per-topic rows instead would silently double-count a question
 * delivered in two sections and would be a SECOND answer to a question the core already
 * answered (FR-04).
 */
function fillBreakdownBlock(
  result: CtxResult,
  breakdowns: readonly BreakdownEntry[] | null | undefined,
  display: BreakdownDisplaySetting | null | undefined,
  labels?: Record<string, string>,
  barFill?: BarFillSetting | null,
): void {
  if (!display || !showsBreakdownBlock(display) || !breakdowns?.length) return;
  result.breakdown = breakdowns.map((e) => breakdownRow(e, display, null, barFill));
}

/** Map a normalized topic to its presentational view (Core-prepared class + label). */
function topicView(
  t: TopicInput,
  withPoints: boolean,
  breakdownDisplay?: BreakdownDisplaySetting | null,
  labels?: Record<string, string>,
  barFill?: BarFillSetting | null,
): CtxTopicResultView {
  const passed = t.passed;
  const view: CtxTopicResultView = {
    topicId: t.topicId,
    topicName: t.topicName || "",
    correct: t.correct != null ? t.correct : 0,
    total: t.total,
    percent: Math.round(t.percent || 0),
    passClass: passed === true ? "is-pass" : passed === false ? "is-fail" : "",
    statusLabel: topicVerdictLabel(passed, labels),
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
  // ТОЛКОВАНИЕ темы: печатается ВСЕГДА, когда автор его написал, — вердикт здесь ни при чём.
  // Текст теста заменяет текст темы целиком; правило одно на выдачу и на редактор.
  const interpretation = resolveTopicInterpretation(t.interpretation, t.sectionInterpretation);
  if (interpretation) {
    const html = richTextToHtml(interpretation.text, interpretation.format as RichTextFormat);
    if (html) view.interpretationHtml = html;
  }
  // PRD-50: the breakdown rows print only when the author turned them on FOR THIS
  // PROJECTION (FR-44) AND the topic actually carries at least one key — a list of keys,
  // not a decomposition of the topic into parts, so keys are not required to partition its
  // questions.
  const display = breakdownDisplay;
  if (display && showsNestedBreakdown(display) && t.breakdown?.length) {
    view.breakdown = t.breakdown.map((e) => breakdownRow(e, display, t.breakdownInterpretation, barFill));
    // Несёт ли хоть одна полоса свой текст. Признак нужен РАСКЛАДКЕ: включённое толкование
    // разворачивает сетку колонок в список во всю ширину, и решить это построчно нельзя —
    // модификатор стоит на всей сетке. Считается здесь, потому что макет (подмножество
    // mustache) перебрать строки и свести ответ не умеет.
    if (view.breakdown.some((row) => row.interpretationHtml)) view.hasBreakdownNotes = true;
  }
  // Есть ли что нести правой колонке. Ставится ПОСЛЕ обоих слотов — толкования темы и
  // полос подтем: любого из них хватает, чтобы строка стала двухколоночной, а темы без
  // обоих остаются такими, какими были.
  if (view.interpretationHtml || view.breakdown?.length) view.hasAside = true;
  return view;
}

/**
 * Default format of {@link groupCounterLabel} — the spec's own `{passed} / {total}`
 * (§8.1), printed until the author writes their own via the `group.counter` label.
 */
const DEFAULT_GROUP_COUNTER_FORMAT = "{passed} / {total}";

/**
 * The group counter as the layout receives it (PRD-50 §8.1 `counterLabel`).
 *
 * The wording is the CORE's job, not the layout's — same reason `statusLabel` is. The
 * format is resolved from the `group.counter` label of the PRD-49 dictionary (FR-34):
 * `{passed}`/`{total}` are substituted wherever the author's own wording places them, so
 * "пройдено {passed} из {total}" is as valid a format as the default. `??`, not `||`: an
 * author who switched the label OFF (an explicit `""`) gets a silent counter rather than
 * the fallback text papering over the switch.
 */
function groupCounterLabel(passedCount: number, totalCount: number, labels?: Record<string, string>): string {
  const format = labels?.["group.counter"] ?? DEFAULT_GROUP_COUNTER_FORMAT;
  return format.replace(/\{passed\}/g, String(passedCount)).replace(/\{total\}/g, String(totalCount));
}

/** PRD-49 input {@link attachBlocksAndLabels} takes from either results builder's `opts`. */
interface BlockLabelOptions {
  labels?: Record<string, string>;
  blockOrder?: ResultsBlockKey[];
  templateBlockOrder?: readonly ResultsBlockKey[];
}

/**
 * PRD-49. Attach the umbrella's ordered, labelled sub-blocks (`result.blocks`) and resolve
 * the labels tree — ONE rule for BOTH the standard and the adaptive results screen.
 *
 * A second copy of «which sub-blocks are visible, and in what order» is exactly the drift
 * PRD-49 exists to prevent. Scales/indicators/topics are read off the SAME fields the two
 * layouts already gate their own rendering on (`{{#if result.scales}}` /
 * `{{#if result.indicators}}` / `{{#if result.topicResults}}` in `results.html` and
 * `results.adaptive.html`), so this function cannot disagree with what the screen actually
 * prints — it is reading the layout's own gate, not recomputing a second one.
 *
 * The score summary is the one exception: the adaptive screen has none, so its visibility
 * cannot be read off any `result` field (nothing there means «no summary block exists»,
 * same as «summary is hidden»). The caller states the fact directly via `hasSummary` — the
 * standard builder passes `!result.hideScoreSummary` (the flag the screen's own ring/strip
 * reads), the adaptive builder always passes `false`.
 *
 * Even with `hasSummary: true` by mistake, a `summary` sub-block could still only appear if
 * `summary` were present in the resolved order — and for the adaptive screen it never is:
 * `templateBlockOrder` there leaves it out, so `resolveBlockOrder` drops it from the merged
 * order however the author's saved `blockOrder` asks for it (`results-order.ts`'s own
 * mechanism, not a second check here). `hasSummary` is still explicit rather than derived,
 * so a reader of either call site sees the answer without following the order resolution.
 *
 * Mutates `result.blocks` in place, matching every other Core-prepared field this builder
 * sets, and returns the labels TREE for the caller's `{ ..., labels }` spread — `undefined`
 * when the caller passed no `labels` at all, so a host not yet taught PRD-49 gets a
 * byte-identical context (no `labels` key at all, not an empty one).
 */
function attachBlocksAndLabels(
  result: CtxResult,
  opts: BlockLabelOptions,
  hasSummary: boolean,
): Record<string, unknown> | undefined {
  // `topics` has no `auto/show/hide` setting of its own — it is visible exactly when there
  // is a topic card to show, which is what both layouts gated on before this PRD.
  const visible: Record<ResultsBlockKey, boolean> = {
    summary: hasSummary,
    scales: !!result.scales?.length,
    indicators: !!result.indicators?.length,
    topics: !!result.topicResults?.length,
    // PRD-50 FR-28: same principle as the three above — the sub-block is «visible» exactly
    // when the field the layout gates its own markup on carries something. The author's
    // switch and the attempt's records were both consulted where that field was built.
    breakdown: !!result.breakdown?.length,
  };
  const labels = opts.labels ?? {};
  const order = resolveBlockOrder(opts.blockOrder, opts.templateBlockOrder ?? DEFAULT_BLOCK_ORDER);
  // Named `subBlocks` and not `blocks`: in the standard builder's scope `blocks` already
  // holds the PRD-29 show/hide answers of the measurement blocks, a different thing entirely.
  const subBlocks = order
    .filter((key) => visible[key])
    .map((key) => ({
      key,
      heading: labels[`results.${key}`] ?? "",
      [BLOCK_FLAG[key]]: true,
    })) as CtxResultBlock[];
  if (subBlocks.length) result.blocks = subBlocks;
  return opts.labels ? labelsTree(labels) : undefined;
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
  // Both gates come from `@shared/scoring/pass-rule`, which owns the rule itself. They
  // live there and not here because the LEARNER's screen is no longer their only reader:
  // the author-facing analytics asks the very same question about the very same run, and
  // two implementations of «оценивает ли этот прогон» would drift exactly as the two
  // copies of the verdict gate drifted before 2026-08-06 (see below).
  const hasGradedScore = isGradedRun(thresholdDeclared, input.possiblePoints);
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
  const noVerdict = !hasPronouncedVerdict(thresholdDeclared, input.possiblePoints);
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
  // A topic with nothing to report brings no card — see {@link topicHasContent}. The
  // filter runs BEFORE the mapping so the array can end up empty, which is what takes
  // the whole «Результаты по темам» section down with it.
  //
  // The card is kept PAIRED with the input it came from: the groups below are resolved off
  // the input's `groupKey` and `passed`, which the presentational view no longer carries
  // (it holds a class and a label instead — deliberately, so the layout cannot judge).
  const topicCards = (input.topicResults || [])
    .filter(topicHasContent)
    .map((t) => ({
      groupKey: t.groupKey ?? null,
      passed: t.passed,
      view: topicView(t, withTopicPoints, opts.breakdownDisplay, opts.labels, opts.barFill),
    }));
  const result: CtxResult = {
    passed,
    passClass: passed ? "is-pass" : "is-fail",
    // Заголовок исхода: авторский, если задан, иначе прежняя подпись пилюли. Гейт стоит на
    // ТЕКСТЕ, а не на наличии поля: настройка, из которой текст стёрли, обязана вернуть
    // умолчание, а не напечатать пустую пилюлю.
    statusLabel: passed
      ? headingText(opts.headings?.passed) ?? "Пройден"
      : headingText(opts.headings?.failed) ?? "Не пройден",
    scorePercent: percent,
    ringDashoffset: Math.round(RING_CIRCUMFERENCE * (1 - percent / 100)),
    totalQuestions: input.totalQuestions,
    correct: input.correct,
    earnedPoints: round1(input.earnedPoints),
    possiblePoints: round1(input.possiblePoints),
    // PRD-57 FR-41: поле появляется, только когда есть что сказать, — контекст теста без
    // открытых ответов остаётся байт в байт прежним.
    ...(input.gradingComplete === false ? { pendingReview: true } : {}),
    topicResults: topicCards.map((c) => c.view),
  };
  // PRD-50 FR-24 - FR-27. Counting over the FILTERED cards gives the same numbers as
  // `aggregateStandardResult` does over all of them: `topicHasContent` only ever drops a
  // topic whose verdict is `null`, and such a topic counts in neither half of the counter
  // (FR-26). Both fields stay ABSENT unless a group actually holds a card, so a test
  // without groups produces the byte-identical context it always did.
  const grouped = groupSections(input.sectionGroups, topicCards);
  if (grouped.groups.length) {
    result.topicGroups = grouped.groups.map(
      (g): CtxTopicGroup => ({
        key: g.key,
        label: g.label,
        topics: g.sections.map((c) => c.view),
        passedCount: g.passedCount,
        totalCount: g.totalCount,
        counterLabel: groupCounterLabel(g.passedCount, g.totalCount, opts.labels),
      }),
    );
    if (grouped.ungrouped.length) result.ungroupedTopics = grouped.ungrouped.map((c) => c.view);
  }
  // PRD-50 FR-28: the summary block of the TEST scope — see {@link fillBreakdownBlock},
  // shared with the adaptive builder.
  fillBreakdownBlock(result, input.breakdowns, opts.breakdownDisplay, opts.labels, opts.barFill);
  // Вводный блок — первым, до всего остального (см. `CtxResult.introHtml`). Разметку
  // строит ядро, поэтому правило одно и то же для экрана и для отчёта.
  //
  // PRD-61: блоков может быть два — общее вступление и текст исхода. Исход берётся из
  // `noVerdict`, посчитанного выше ДЛЯ ВЕРДИКТНОЙ ШАПКИ: одна причина — один ответ, иначе
  // шапка и текст под ней снова начнут говорить разное, как в боевом отчёте 2026-09-22
  // («Сертификация пройдена» над абзацем о нехватке баллов).
  const introHtml = introBlocksToPrint(opts.intro, {
    verdictPronounced: !noVerdict,
    passed: !!input.passed,
  })
    .map((b) => richTextToHtml(b.text, b.format ?? undefined))
    .filter(Boolean)
    // Пустая строка между блоками, а не пустой шов: простой текст приходит без обёртки в
    // абзац, и склейка встык давала «…прохождение теста.Пока вам не хватает баллов…» одной
    // строкой. `join` на единственном блоке не добавляет ничего, поэтому старая форма — один
    // текст — печатается байт в байт как печаталась.
    .join("<br><br>");
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
  // Sources of the ONE recommendations block, gathered in the order dedup should keep:
  // the general before the specific.
  //
  // PRD-61 §10: обратная связь УРОВНЯ ТЕСТА снята — три вводных текста говорят то же самое
  // и там, где автор этого ждёт, в начале документа, а не в конце среди рекомендаций.
  // `opts.testFeedback` больше НЕ источник: поле убрано из ящика, не запекается в пакет и
  // не печатается ни одним хостом.
  //
  // Тексты ТЕМ, ПОДТЕМ, ШКАЛ и ПОКАЗАТЕЛЕЙ не тронуты, и их собственный гейт — тоже: тема
  // выдаёт написанное, пока не пройдена (`topic.passed !== true` ниже), по правилу «молчим
  // только там, где уверены в успехе». Прежний `explicitPass` гасил ИМЕННО блок теста и
  // вместе с ним ушёл.
  const recommendationSources: Array<FeedbackBlock | null | undefined> = [];
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
  // PRD-50 FR-55: тексты ПОДТЕМ — последними, они самые узкие (одна подтема одного раздела),
  // и дедуп оставит копию пошире, если автор написал то же самое теме. Вердикт теста и темы
  // здесь не спрашивается: исход подтемы уже вынесен ядром по порогу её темы.
  recommendationSources.push(...collectBreakdownFeedback(input.topicResults || []));
  const recommendations = collectRecommendations(recommendationSources);
  if (recommendations.hasAny) result.recommendations = recommendations;
  // PRD-49. The umbrella's sub-blocks + resolved labels, via the ONE rule shared with the
  // adaptive builder (see `attachBlocksAndLabels`). `summary` reads the INVERTED flag the
  // screen itself reads, so the list says «visible» exactly where the summary prints —
  // including a control test, which never reaches the toggle and has always shown it.
  const labelsTreeOut = attachBlocksAndLabels(result, opts, !result.hideScoreSummary);
  // Заголовок документа заменяет название теста — и на экране, и в отчёте: обе поверхности
  // печатают одно и то же поле `course.title`, и расхождение здесь было бы расхождением
  // между экраном и скачанным с него документом (PRD-51 §5.2).
  return {
    course: { title: headingText(opts.headings?.document) ?? title },
    result,
    ...(labelsTreeOut ? { labels: labelsTreeOut } : {}),
  };
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

/** PRD-49: optional resolved labels for the section-results screen. */
export interface SectionResultContextOptions {
  /**
   * Resolved labels of THIS screen (`section.eyebrow`, `facts.*`), same flat map the
   * results builders take. Absent = no `labels` key on the returned context — a caller
   * not yet taught PRD-49 gets a byte-identical result.
   *
   * The section-results screen has no sub-blocks of its own (it is one fixed card, not
   * an umbrella with children), so this builder attaches ONLY the labels tree — there is
   * no `attachBlocksAndLabels` call here, and none is needed.
   */
  labels?: Record<string, string>;
}

/**
 * Build the COMPUTED section-results context (`{ course, sectionResult }`, PRD-19
 * FR-05a). Reuses the same ring geometry as the test results screen; the verdict
 * tag is gated by `hasVerdict` so a section without a pass rule (passed === null)
 * shows the score without a pass/fail label. Pure — both hosts call it on their
 * own normalized section result so the numbers/markup cannot drift.
 */
export function buildSectionResultContext(
  input: SectionResultInput,
  opts: SectionResultContextOptions = {},
): {
  course: CtxCourse;
  sectionResult: CtxSectionResult;
  /** PRD-49: resolved interface labels as a nested tree (`labels.section.eyebrow`). */
  labels?: Record<string, unknown>;
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
    ...(opts.labels ? { labels: labelsTree(opts.labels) } : {}),
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
  /**
   * The topic rule resolved against the overall one and the DELIVERED variant
   * (`resolveTopicRule`); `null`/absent — the topic is not gated, no condition line.
   */
  passRule?: ResolvedRule | null;
  /** Σ prices of the delivered graded questions of the section; absent — unknown. */
  possiblePoints?: number | null;
  /** `test_sections.required`; absent — required. */
  required?: boolean | null;
  /** «Тест пройден, если» — decides whether the topic is marked «Обязательная тема». */
  passDecisionPolicy?: string | null;
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
    // Same formatter the start screen prints its limit with: one course must not
    // say «45 минут» on the section intro and «45 мин» on the cover.
    timeLimitLabel: formatMinutesHuman(input.timeLimitMinutes),
    hasInstruction: instrText.length > 0,
    illustrationUrl: illo,
    hasIllustration: illo.length > 0,
    continueLabel: input.continueLabel || "Далее",
    passCondition: sectionPassConditionText(input.passRule, input.possiblePoints),
    isRequired: sectionIsRequiredForVerdict(input.passDecisionPolicy, input.required, input.passRule),
    timerWarning: sectionTimerWarningText(input.timeLimitMinutes, input.continueLabel || "Далее"),
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
  /**
   * PRD-50 §16: подытоги подтем ЭТОГО раздела, с уже вынесенным исходом
   * (`adaptiveResultAsStandard` судит их общим порогом теста).
   *
   * В карточку темы они не попадают сознательно — она говорит подтверждённым УРОВНЕМ, — но
   * без них построителю не из чего отобрать тексты подтем ({@link TopicFeedbackInput.breakdownFeedback}).
   */
  breakdown?: BreakdownEntry[] | null;
}

/** Normalized adaptive result input. */
export interface AdaptiveResultInput {
  passed?: boolean;
  topicResults: AdaptiveTopicInput[];
  /**
   * PRD-50 FR-28/FR-39: records of the TEST scope, for the summary block.
   *
   * They exist for an adaptive attempt exactly as for a standard one — the axis is a
   * property of the DELIVERED questions, not of the ladder, so `adaptiveResultAsStandard`
   * computes them through the same engine (FR-17) and they are stored WITH the attempt
   * (`adaptiveAttemptResultSchema.breakdowns`). Until this stage no screen read them back.
   *
   * SECTION-scope records are deliberately not taken: the adaptive topic card shows a
   * confirmed LEVEL, and a percentage bar beside «Уровень 2» would invite a reading the
   * ladder cannot support. Absent leaves the context byte-identical to what the adaptive
   * screen produced before.
   */
  breakdowns?: BreakdownEntry[] | null;
}

/** Optional SCORM action flags for the adaptive results layout. */
export interface AdaptiveResultContextOptions {
  /**
   * Заголовки итога (см. {@link ResultHeadings}). Адаптивный итог читает из них только
   * заголовок документа: вердикта этот режим не выносит, и заголовков исхода у него нет.
   */
  headings?: ResultHeadings;
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
   * Общее правило прохождения теста (`tests.overall_pass_rule_json`) — не признак, а
   * САМО правило: тексты подтем выдаются по сравнению с его порогом (PRD-50 FR-50).
   *
   * Отдельно от {@link ResultContextOptions.hasPassThreshold}, который отвечает на другой
   * вопрос («вердикт вообще выносился?») и читается ещё двумя потребителями. Отсутствие
   * значит «порога нет»: сравнивать не с чем, и тексты подтем выдаются везде, где автор
   * их написал.
   */
  overallPassRule?: { type?: string | null; value?: number | null } | null;
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
  /**
   * Вводный блок этой выдачи — тот же, что у стандартного экрана (см. там же).
   *
   * Тексты исхода в нём допустимы, но не печатаются: этот режим вердикта не выносит
   * (PRD-61 FR-14b). Тип общий, чтобы хост не разбирал, какому построителю что отдавать.
   */
  intro?: IntroBlockLike | null;
  /**
   * PRD-50 FR-13/FR-44: the author's display setting, read here for ONE thing — the
   * summary block ({@link AdaptiveResultInput.breakdowns}).
   *
   * The `placement` half of the setting therefore behaves differently in this mode, and
   * knowingly so: «В карточках тем» prints nothing on an adaptive screen, because the
   * card there speaks in confirmed levels. The editor says so in the field's hint rather
   * than silently promoting the choice to «блоком» — substituting the author's answer
   * would be worse than telling them what the mode can do.
   */
  breakdownDisplay?: BreakdownDisplaySetting | null;
  /** Bar colouring of the summary block — see {@link ResultContextOptions.barFill}. */
  barFill?: BarFillSetting | null;
  /**
   * PRD-49: resolved labels of THIS screen, same flat map the standard builder takes
   * ({@link ResultContextOptions.labels}). Absent = no `labels` key on the returned
   * context, so a caller not yet taught PRD-49 gets a byte-identical result.
   */
  labels?: Record<string, string>;
  /** PRD-49: the author's order of the sub-blocks; absent = the template's order. */
  blockOrder?: ResultsBlockKey[];
  /**
   * PRD-49: what THIS screen of THIS template prints, and in what order
   * ({@link ResultContextOptions.templateBlockOrder}). The adaptive results screen has
   * never carried a score summary, so its declared list has no `summary` key — and that
   * is what keeps the sub-block list from ever growing one, whatever the author's saved
   * `blockOrder` asks for (see `attachBlocksAndLabels`).
   */
  templateBlockOrder?: readonly ResultsBlockKey[];
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
  // PRD-50 FR-28: сводный блок разреза — ТОТ ЖЕ заполнитель, что у стандартного экрана.
  // Записи для адаптивной попытки считаются и хранятся давно (FR-17/FR-39), но до этого
  // этапа их никто не читал обратно: посчитанное молча не показывалось.
  fillBreakdownBlock(result, input.breakdowns, opts.breakdownDisplay, opts.labels, opts.barFill);
  // Вводный блок — первым, до уровней и измерений: правило общее для обоих режимов.
  //
  // PRD-61 FR-14b: адаптивный режим вердикта НЕ выносит — заголовков исхода у него нет (см.
  // {@link AdaptiveResultContextOptions.headings}), — поэтому печатается только общее
  // вступление. Текст исхода ходит парой с заголовком исхода: там, где шапка не ветвится, не
  // ветвится и текст.
  const adaptiveIntroHtml = introBlocksToPrint(opts.intro, {
    verdictPronounced: false,
    passed: !!input.passed,
  })
    .map((b) => richTextToHtml(b.text, b.format ?? undefined))
    .filter(Boolean)
    .join("<br><br>");
  if (adaptiveIntroHtml) result.introHtml = adaptiveIntroHtml;
  if (opts.hasScormActions) {
    result.hasScormActions = true;
    result.showPdf = !!opts.showPdf;
    result.canRetry = !!opts.canRetry;
    result.showFinish = !!opts.showFinish;
  }
  // The SAME consolidated block the standard results screen carries, from the SAME
  // collector and the same sources in the same order. Feedback is a property of the TEST,
  // not of its flow mode, so a second assembly rule for the adaptive screen would only mean
  // two screens disagreeing about what the learner is owed; the adaptive screen used to
  // carry no block at all, which is that disagreement at its widest.
  //
  // What differs between the modes is ONE thing — how a topic's failure is spelled — and
  // it enters as the gate's argument (see `topicRecommendationSources`).
  //
  // PRD-61 §10: обратная связь УРОВНЯ ТЕСТА снята и здесь — по той же причине и тем же
  // заходом, что на стандартном экране. Блок собирается из тем, шкал и показателей.
  const recommendationSources: Array<FeedbackBlock | null | undefined> = [];
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
  // PRD-50 FR-55: тексты ПОДТЕМ — последними, они самые узкие (одна подтема одного раздела),
  // и дедуп оставит копию пошире, если автор написал то же самое теме. Вердикт теста и темы
  // здесь не спрашивается: исход подтемы уже вынесен ядром по порогу её темы.
  recommendationSources.push(...collectBreakdownFeedback(input.topicResults || []));
  const recommendations = collectRecommendations(recommendationSources);
  if (recommendations.hasAny) result.recommendations = recommendations;
  // PRD-49. Same rule as the standard screen (see `attachBlocksAndLabels`), with
  // `hasSummary: false` fixed — this screen has never carried a score summary, so no
  // caller-supplied order can ever bring one back onto it.
  const labelsTreeOut = attachBlocksAndLabels(result, opts, false);
  // Заголовок документа действует и здесь: как назван итог, от режима теста не зависит.
  // Заголовки ИСХОДА у адаптивного итога предмета не имеют — вердикта он не выносит.
  return {
    course: { title: headingText(opts.headings?.document) ?? title },
    result,
    ...(labelsTreeOut ? { labels: labelsTreeOut } : {}),
  };
}
