/**
 * @module shared/template/context
 *
 * The public render context contract (PRD-12; spec-template-platform §10). This is
 * the single typed surface that BOTH runtime hosts produce and feed to the unified
 * renderer ({@link module:shared/template/render-screen}); layouts read only from
 * it (spec §10.1: templates get no direct access to the internal `TEST_DATA`).
 *
 * The namespaces below — `course` / `result` / `state` / `retake` — are the ones
 * the real default-template layouts bind against (`data-path="course.title"`,
 * `{{ result.scorePercent }}`, `{{#if state.canResume}}`). Fields named
 * `*Class`/`statusLabel`/`ringDashoffset` are Core-prepared presentational values
 * (spec §10: the DSL computes no classes/labels via expressions — the builder does).
 *
 * Type-only module. The shared builders that produce conforming values live in
 * {@link module:shared/template/result-context} and
 * {@link module:shared/template/start-state}; each host adapts its own data shape
 * into the builders' normalized inputs.
 */

import type { CtxMeasureView } from "./measure-view";
import type { CtxScalesChart } from "./scales-chart";
import type { CtxScaleBars } from "./scale-bars";
import type { CtxRecommendations } from "./recommendations";
import type { CtxCoursePassCondition } from "./pass-condition";

/** Test-level info shown on the start screen and as the screen title (`course.*`). */
export interface CtxCourse {
  title: string;
  /**
   * Header subtitle under the title (wireframe: "Попытка N из M"). Core-prepared
   * by {@link module:shared/template/course-subtitle} on both hosts; empty string
   * or absent -> the layout's `{{#if course.subtitle}}` renders a title-only header.
   */
  subtitle?: string;
  description?: string;
  /**
   * PRD-59 FR-11: the description as MARKUP, built by the core from the text and its
   * format. Paired with `description` rather than replacing it — a template that
   * binds the plain string keeps working and simply shows the text unformatted.
   *
   * Printed through the controlled-HTML channel (`{{& course.descriptionHtml }}`);
   * the block is gated on the STRING, so an empty description prints nothing.
   */
  descriptionHtml?: string;
  questionCount?: number;
  passPercent?: number | null;
  timeLimitMinutes?: number | null;
  /**
   * The same limit as a learner-readable phrase, decomposed into days / hours /
   * minutes by {@link module:shared/template/duration} — «14 дней», «2 ч 30 мин»,
   * «45 мин». Paired with `timeLimitMinutes` rather than replacing it, so a
   * template that binds the number keeps working.
   *
   * The unit belongs HERE and not in the layout: the DSL has no helpers, so a
   * layout printing `{{ course.timeLimitMinutes }} мин` could only ever say
   * «20160 мин» for a two-week budget. Empty string when the test has no limit.
   */
  timeLimitLabel?: string;
  maxAttempts?: number | null;
  /** Legacy intro text; migrated to a content page, normally empty (PRD-7 S10). */
  startPageContent?: string;
  /**
   * PRD-67 «Закрывать раздел при выходе»: true when leaving a started section closes it
   * for good (in a test without sections — ends the attempt). Set on the start screen,
   * so a layout can warn BEFORE the learner begins: `{{#if course.closesOnLeave}}`.
   * The hosts already warn with their own notices; the shipped layouts do not print it.
   */
  closesOnLeave?: boolean;
  /**
   * The topic part of the pass condition when the «Тест пройден, если» policy makes the
   * topics decide: `{ count, total, kind, countLabel, label }` — the cover tile «8 из 8 /
   * обязательных тем для прохождения». Absent under «Только общий результат», for a
   * measurement method and when no topic carries a threshold. Contract 3.14.0.
   */
  passCondition?: CtxCoursePassCondition;
}

/** A recommended course/event link for failed-topic guidance (SCORM-extra). */
export interface CtxRecommendation {
  title: string;
  url?: string;
}

/**
 * The per-topic recommendation composition (spec §3.2 / plan 6.1): recommended courses +
 * recommended events, with a presence flag. The SAME shape in standard and adaptive
 * results, so the topic card is composed identically in both modes — recommendations are
 * a property of the test's settings, not the flow mode.
 *
 * It carries NO feedback text: the text of a topic reaches the learner through the ONE
 * consolidated «Рекомендации» block (`result.recommendations`), and a per-topic slot
 * beside it would print the same sentence twice on one screen. The exception is the
 * adaptive mode — see {@link CtxAdaptiveTopicView.feedback}, which is a different text
 * altogether.
 */
export interface CtxTopicFeedback {
  recommendedCourses: CtxRecommendation[];
  recommendedEvents: CtxRecommendation[];
  hasRecommendations: boolean;
}

/** A per-topic result row for the standard results layout (`result.topicResults[]`). */
export interface CtxTopicResultView extends CtxTopicFeedback {
  topicId?: string;
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  /** Core-prepared class, e.g. `is-pass` / `is-fail` / `""`. */
  passClass: string;
  /** Core-prepared label, e.g. `Пройдено` / `Не пройдено` / `""`. */
  statusLabel: string;
  /** SCORM-extra (gated layout blocks; web omits): formatted points "x / y". */
  pointsLabel?: string;
  /** SCORM-extra: per-topic pass threshold, e.g. "Требуется: 70%". */
  requiredLabel?: string;
  /**
   * PRD-50: breakdown rows of this topic, Core-prepared. Absent when the author never
   * turned them on, or when the topic carries no key at all — an empty array is falsy in
   * the DSL, so the whole block (including its heading) disappears from the layout with it.
   */
  breakdown?: CtxBreakdownRow[];
  /**
   * ТОЛКОВАНИЕ темы — готовая разметка текста, объясняющего результат.
   *
   * Печатается ВСЕГДА, когда автор его написал: и у взятой темы, и у невзятой, и у темы без
   * вердикта. Этим оно и отличается от обратной связи, которая выдаётся по своему правилу и
   * уходит в сводный блок «Рекомендации» — здесь текста этого блока нет и быть не должно,
   * иначе одна и та же мысль напечатается на экране дважды.
   *
   * Отсутствует, когда толкования нет ни у темы, ни у теста: пустая строка заставила бы
   * макет печатать пустой блок.
   */
  interpretationHtml?: string;
  /**
   * Несёт ли хоть одна полоса разреза своё толкование.
   *
   * Признак РАСКЛАДКИ, а не данных: включённое толкование подтем разворачивает сетку
   * колонок в список во всю ширину, и модификатор стоит на всей сетке — построчно этого не
   * решить. Считает ядро, потому что макет (подмножество mustache) перебрать строки и
   * свести ответ не умеет.
   *
   * Отсутствует, когда текстов нет: раскладка тогда остаётся сеткой, как была.
   */
  hasBreakdownNotes?: boolean;
  /**
   * Есть ли у темы что показать СПРАВА — толкование либо полосы подтем.
   *
   * Признак РАСКЛАДКИ, как и {@link hasBreakdownNotes}: строка темы разворачивается в две
   * колонки только тогда, когда правой колонке есть что нести. Тема, у которой нет ни того,
   * ни другого, печатается ровно так, как печаталась, — одной колонкой со сводкой и полосой.
   *
   * Считает ядро: макет умеет спросить о каждом поле по отдельности, но не умеет сложить
   * два вопроса в один ответ, а модификатор стоит на всей карточке.
   */
  hasAside?: boolean;
}

/**
 * PRD-50 FR-24 - FR-27 (§8.1): ONE named group of topic cards, with the counter the core
 * has already counted and phrased.
 *
 * Named `topicGroups` on the result and not `blocks`: `result.blocks` is taken by the list
 * of the results umbrella's sub-blocks (PRD-49), a different thing at a different level —
 * FR-29 makes the choice explicit precisely because the two would be easy to confuse.
 *
 * The nesting is exactly ONE level deep (FR-24): a test holds groups, a group holds
 * sections, and there is no tree. A group that no section joined is not here at all
 * (FR-12), and a test that declares no groups gets no field at all — the layout then
 * prints `result.topicResults` exactly as it always has (FR-27).
 */
export interface CtxTopicGroup {
  /** Author key of the group (`tests.section_groups_json[].key`). */
  key: string;
  /** Heading of the group; may be empty if the author left it so. */
  label: string;
  /** The group's topic cards, in delivery order — the SAME objects as in `topicResults`. */
  topics: CtxTopicResultView[];
  /** Sections of the group with a PASSED verdict. */
  passedCount: number;
  /** Sections with ANY pronounced verdict — a section without one is not counted (FR-26). */
  totalCount: number;
  /** Ready-made counter, e.g. «1 / 2». Core-prepared: the layout computes nothing. */
  counterLabel: string;
}

/**
 * One breakdown row, prepared by the core: the layout only prints it (PRD-50 §8.1).
 *
 * The counts and the points are here from the FIRST release, not from the release that
 * first prints them. A third-party template из реестра PRD-3 cannot show «верно 4 из 7»
 * out of a bar width, and adding a field later is a contract change that has to be
 * carried across both hosts and every shipped package.
 *
 * Строка снова несёт исход (PRD-50 §16, FR-54): `passed`, `passClass` и `requiredLabel`.
 * Словесной метки у неё нет и не будет — строка узкая, и слово рядом с процентом дублировало
 * бы цвет; вердикт СЛОВОМ говорит карточка темы вокруг. Шаблон, ничего о новых полях не
 * знающий, печатает ровно то, что печатал: класс подставляется в атрибут, надпись гейтится
 * своим `{{#if}}`.
 */
export interface CtxBreakdownRow {
  key: string;
  /** Delivered questions carrying this key (FR-01). */
  items: number;
  /** How many of those the learner answered. */
  answered: number;
  /** Points earned on them, one decimal (as `pointsLabel` rounds). */
  earned: number;
  /** Points they could bring, one decimal. */
  possible: number;
  /**
   * The value of the basis the AUTHOR chose (`units` / `points`), one decimal —
   * the unrounded twin of {@link barPercent}. A layout that wants a number prints
   * this one and does not have to know which basis is in force.
   */
  percent: number;
  /** Normalized share — every question weighs 1 (решение 4), one decimal. */
  percentUnits: number;
  /** Points share, one decimal. The verdict currency (FR-21), whatever is displayed. */
  percentPoints: number;
  /** Bar width in percent, rounded. */
  barPercent: number;
  /** Whether to print the number alongside the bar. */
  showValue: boolean;
  /** Ready-made value label, e.g. "50 %". Empty when showValue is false. */
  valueLabel: string;
  /** Исход подтемы: `true` / `false` / `null` — порога не было (FR-52). */
  passed?: boolean | null;
  /**
   * Готовый модификатор строки: `is-pass`, `is-fail` или пусто. Пуст и тогда, когда автор
   * выбрал окраску полос «по доле» или «нейтральную» (`breakdownBarFill`): полоса там
   * вердикт не несёт, а исход остаётся в {@link passed}.
   */
  passClass?: string;
  /**
   * Готовая заливка полосы — значение CSS `background` (`linear-gradient(...)`), когда автор
   * выбрал окраску «по доле»: цвет кодирует долю по рампе уровней теста
   * ({@link module:shared/template/bar-fill}). Макет печатает его в `style` заливки:
   * `{{#if barFill}} background: {{ barFill }};{{/if}}`. Отсутствует в остальных режимах и
   * у пустой полосы.
   */
  barFill?: string;
  /**
   * Надпись порога, например «Нужно 70 %». Печатается только там, где автор включил показ
   * значения: цвет без причины читается как приговор. Отсутствует, когда порога нет.
   */
  requiredLabel?: string;
  /**
   * ТОЛКОВАНИЕ подтемы — готовая разметка текста под её полосой.
   *
   * Приходит только когда автор включил показ (`breakdown_display_json.showInterpretation`):
   * референс сертификата толкований подтем не печатает, и ни один существующий тест не
   * должен получить их молча. Отсутствует, если текста нет или показ выключен.
   */
  interpretationHtml?: string;
}

/** A per-topic row for the adaptive results layout (level-based, no score). */
export interface CtxAdaptiveTopicView extends CtxTopicFeedback {
  topicName: string;
  /**
   * Confirmed level name, or «Минимально требуемый уровень не подтверждён» when the
   * learner did not reach the lowest level the test defines.
   */
  levelLabel: string;
  /**
   * Core-prepared DS tone modifiers for the level tag — two states only, because
   * that is all the model asserts: `ou-tag--solid ou-tag--accent` (a level was
   * confirmed; WHICH one the label says) / `ou-tag--solid ou-tag--error` (the test's
   * minimum was not confirmed). The rungs themselves carry no colour: the ladder is
   * the author's and differs from test to test.
   */
  levelClass: string;
  /**
   * Feedback of the CONFIRMED LEVEL (`adaptive_levels.feedback`), or the topic's
   * failure text when no level was confirmed — NOT the topic's feedback text, which the
   * standard mode prints and which travels to the consolidated block instead.
   *
   * This one has no other route to the learner: the consolidated block is fed from the
   * topic's and the section's `feedback_json`, and a level's own wording is not among
   * its sources. Dropping the slot from the adaptive card would therefore erase the
   * text from the product, not move it — which is why the adaptive layout keeps a slot
   * the standard one no longer has.
   */
  feedback?: string;
  /** Whether {@link feedback} carries anything — the adaptive card's slot gate. */
  hasFeedback: boolean;
}

/**
 * The computed result namespace (`result.*`). Standard fields are always present;
 * adaptive results set `adaptive: true` and use the adaptive `topicResults` shape.
 * SCORM-richer fields (recommendations, back action, adaptive action flags) are
 * gated layout blocks the web context simply omits. The index signature carries
 * PRD-2 custom result variables and any other Core-prepared field.
 */
export interface CtxResult {
  passed: boolean;
  /** Core-prepared class `is-pass`/`is-fail`/`""` (empty when the test has no threshold). */
  passClass?: string;
  /** Verdict label «Пройден»/«Не пройден»/`""` — empty drops the header tag. */
  statusLabel?: string;
  scorePercent?: number;
  /** Core-prepared SVG ring dash offset (precomputed; layout binds it directly). */
  ringDashoffset?: number;
  totalQuestions?: number;
  correct?: number;
  earnedPoints?: number;
  possiblePoints?: number;
  /**
   * PRD-57 FR-41: часть ответов ждёт проверки, и результат на экране — ПРЕДВАРИТЕЛЬНЫЙ.
   *
   * Поле заводится сейчас, хотя проверки ещё нет: добавить его в контракт позже значит
   * поднять версию и обновить внешние шаблоны из реестра PRD-3. Контракт несёт ФАКТ;
   * текст и место — за шаблоном.
   */
  pendingReview?: boolean;
  topicResults?: Array<CtxTopicResultView | CtxAdaptiveTopicView>;
  /**
   * PRD-50 FR-24 - FR-27: the topic cards grouped into the author's named blocks, each with
   * its counter. Present ONLY when the test declares groups AND at least one section joined
   * one; absent otherwise, so a test without groups keeps today's screen (FR-27) and a
   * third-party template from the PRD-3 registry that knows nothing of groups keeps
   * printing the flat {@link topicResults} (FR-30, same principle).
   *
   * `topicResults` stays COMPLETE next to it — grouped and ungrouped cards alike. A layout
   * that prints groups therefore gates on this field and prints
   * `topicGroups` + {@link ungroupedTopics} INSTEAD of the flat list, never both.
   */
  topicGroups?: CtxTopicGroup[];
  /**
   * PRD-50 FR-28: the breakdown in the scope of the WHOLE TEST — one row per key, printed
   * as its own sub-block of the results umbrella above (or beside) the topic cards.
   *
   * These rows are the records the core stored WITH the attempt, printed as they are. A
   * key delivered in two sections has ALREADY been folded into a single test-scope record
   * by `computeBreakdowns` (FR-04, a separate pass over the delivered items), so summing
   * the per-topic rows here would produce a different — and wrong — number. That is the
   * whole reason the block exists: one honest row for a key that lives in two sections.
   *
   * Present only when the author turned the block on ({@link CtxResult} is built from
   * `tests.breakdown_display_json`) AND the attempt actually produced test-scope records;
   * absent otherwise, so a test that never touched the setting keeps today's screen.
   */
  breakdown?: CtxBreakdownRow[];
  /**
   * PRD-50 FR-25: the cards that belong to no group, in their own order — printed AFTER
   * all groups, as they are printed today. Travels beside {@link topicGroups} because the
   * DSL cannot filter a list: without it a group-aware layout has no way to tell which of
   * `topicResults` are already inside a group. Absent when every card found a group.
   */
  ungroupedTopics?: CtxTopicResultView[];
  // Adaptive variant:
  adaptive?: boolean;
  // SCORM-extras (web omits → gated layout blocks render nothing):
  recommendedCourses?: CtxRecommendation[];
  recommendedEvents?: CtxRecommendation[];
  backAction?: string;
  backLabel?: string;
  showPdf?: boolean;
  canRetry?: boolean;
  showFinish?: boolean;
  hasScormActions?: boolean;
  /**
   * Footer state of the results screen — the row is drawn by the LAYOUT, both
   * hosts only fill these in (see `buildResultsNav`). Before this, the package
   * overwrote the layout's footer with its own HTML and the web host rendered the
   * layout as written, so the same screen offered different actions.
   */
  nav?: CtxResultsNav;
  /**
   * PRD-29: measurement blocks. Present only when the test has visible scales /
   * indicators AND the block is on — absence keeps the control-test screen
   * byte-identical, so the layout gates on presence alone.
   */
  scales?: CtxMeasureView[];
  indicators?: CtxMeasureView[];
  /**
   * PRD-35/46: cross-scale profile — a radar or a rose, in ONE shape. Present only when the
   * author asked for a diagram and the chosen one is feasible: three or more visible scales,
   * each with a domain, and for the rose a whole to divide.
   */
  scalesChart?: CtxScalesChart;
  /**
   * Линейчатая диаграмма шкал (вид шкал «Линейчатая диаграмма»): столбики всех шкал на
   * ОДНОЙ оси. Печатается ВМЕСТО списка карточек и уживается с розой или радаром рядом —
   * в отличие от них, это не выбор фигуры, а способ показать сами шкалы.
   *
   * Присутствует, только когда автор выбрал этот вид и диаграмму есть из чего собрать
   * (хотя бы одна видимая шкала с доменом). Карточки при этом остаются в контексте:
   * шаблон, чей макет о диаграмме не знает, обязан продолжать печатать их, поэтому выбор
   * между списком и диаграммой стоит В РАЗМЕТКЕ, а не здесь.
   */
  scaleBars?: CtxScaleBars;
  /**
   * Class of the scales block: `tb-measures`, plus the `--chart` modifier when the
   * radar is drawn. Core-prepared because the DSL cannot append a class
   * conditionally, and a CSS `:has()` selector would depend on the engine the LMS
   * embeds — the very dependency core-side computation exists to avoid.
   */
  scalesBlockClass?: string;
  recommendations?: CtxRecommendations;
  /**
   * The score summary always HAS data, so it needs its own flag — and the flag is
   * NEGATIVE. A control test passes no measures at all, so any positive flag would
   * be absent and the layout would hide the summary everywhere. Absent = shown.
   */
  hideScoreSummary?: boolean;
  /**
   * PRD-49. The visible sub-blocks of the results umbrella, already ordered and already
   * carrying their heading. The layout walks this ONE array instead of printing four
   * fixed sections, so the author's order is expressed in DATA — the print pipeline of
   * the PDF report reads the real DOM order and a CSS-only reorder would lie to it.
   */
  blocks?: CtxResultBlock[];
  /**
   * ВВОДНЫЙ БЛОК — авторский текст, который идёт ПЕРВЫМ, до сводки, тем, измерений и
   * рекомендаций: он объясняет слушателю, что он сейчас читает.
   *
   * Приходит РАЗМЕТКОЙ, уже построенной ядром из текста и его формата
   * ({@link module:shared/template/rich-text}), поэтому макет печатает его через `{{& … }}`.
   * Пусто (или поля нет вовсе) = блока нет: гейт стоит на самом значении, второго признака
   * у него не заведено.
   *
   * У экрана итогов и у отчёта тексты РАЗНЫЕ — их адресаты не совпадают, — но имя поля
   * одно: макет печатает «свой вводный блок», не зная, чей контекст ему дали.
   */
  introHtml?: string;
  [key: string]: unknown;
}

/**
 * One sub-block of the results umbrella (PRD-49).
 *
 * The per-key boolean flags exist because the DSL has no equality test: a layout cannot
 * ask `{{#if key == "scales"}}`, only whether a path is truthy.
 */
export interface CtxResultBlock {
  key: "summary" | "scales" | "indicators" | "topics" | "breakdown";
  /** Effective heading; an empty string means the author switched the heading off. */
  heading: string;
  isSummary?: boolean;
  isScales?: boolean;
  isIndicators?: boolean;
  isTopics?: boolean;
  /** PRD-50 FR-28: the test-scope breakdown block (`result.breakdown`). */
  isBreakdown?: boolean;
}

/** What the results layout binds its footer against (`result.nav`). */
export interface CtxResultsNav {
  /** Render «Скачать отчёт». */
  showReport: boolean;
  /** Render «Пройти заново» (failed and attempts remain). */
  canRetry: boolean;
  /**
   * Attempts remain — the verdict does not matter. Weaker than {@link canRetry}:
   * a learner who PASSED may still run the test again while the cap allows it.
   */
  canRetake: boolean;
  /** `data-action` of the primary button. */
  primaryAction: string;
  /** Its caption. */
  primaryLabel: string;
}

/**
 * Per-screen UI state (`state.*`): the question counter label and the start-screen
 * action flags. The flags are a host superset — the web sets a subset (no saved-
 * results review / resume-position / restart-anew), so those gated buttons never
 * appear on the web.
 */
export interface CtxState {
  questionCounterLabel?: string;
  /**
   * Section (topic) the current question belongs to. The question layout prints it
   * as a tag NEXT TO the counter, so the counter label itself must stay the bare
   * «Вопрос N из M» on both hosts — a host that folds the section into the counter
   * text renders a different meta row than the package does.
   */
  sectionName?: string;
  /** Learner guidance subtitle by question type (both hosts, see questionHint). */
  questionHint?: string;
  /** Length-fit font for the question prompt, e.g. "28px" (see fit-font). */
  questionFont?: string;
  /** Length-fit font for the answer options, e.g. "18px" (see fit-font). */
  optionFont?: string;
  exhausted?: boolean;
  canStart?: boolean;
  startLabel?: string;
  canResume?: boolean;
  resumeLabel?: string;
  resumeNote?: string;
  canRestart?: boolean;
  canViewResults?: boolean;
  /** Web-only: show the "back to list" action (the SCORM host omits it). */
  showBack?: boolean;
  /** PRD-19 Block C: clickable progress pills for the current scope (replaces the linear bar). */
  questionsProgress?: CtxQuestionsProgress;
  /**
   * PRD-19 Block F (FR-20): cooldown state ON the start screen. Present ONLY when a
   * retake is blocked by the cooldown period; its presence ⇒ the start button is
   * rendered DISABLED (not hidden) and the cooldown card is shown. Replaces the
   * separate `system.blocked` wall — cooldown is now a state of the normal start.
   */
  cooldown?: CtxStartCooldown;
  /**
   * PRD-19 Block F (FR-20): prior-attempt summary on the start screen (eligible
   * retake AND cooldown). Core-prepared (verdict label/class + attempts label).
   * Set only where the host can supply prior-attempt data — absent on the SCORM
   * cooldown path (rendered pre-Initialize, where suspend_data is unavailable).
   */
  priorResult?: CtxStartPriorResult;
  /** PRD-19 Block F (FR-20): show «Скачать отчёт» — report for the prior attempt is downloadable. */
  canDownloadReport?: boolean;
}

/**
 * PRD-19 Block F (FR-20): cooldown state for the start screen ({@link CtxState.cooldown}).
 * Passthrough — the host supplies the human date (ДД.ММ.ГГГГ, as the gate's
 * `fmtDateHuman`) and optionally the derived days-until.
 */
export interface CtxStartCooldown {
  /** Date the next attempt becomes available, formatted ДД.ММ.ГГГГ. */
  availableDateHuman: string;
  /** Days until the next attempt (availableDate − today), when computable. */
  daysUntil?: number | null;
}

/**
 * PRD-19 Block F (FR-20): prior-attempt summary ({@link CtxState.priorResult}).
 * Core-prepared so the layout only interpolates: the builder computes the verdict
 * label/class and the «попытка K из M» label from the raw facts.
 */
export interface CtxStartPriorResult {
  /** Rounded percent score of the prior attempt. */
  percent: number;
  /** «пройдено» / «не пройдено» / "" (no resolved verdict). */
  verdictLabel: string;
  /** "" | "prior-fail" (verdict colour class for a failed attempt). */
  verdictClass: string;
  /** «попытка 2 из 3» when attempt counts are known, else "". */
  attemptsLabel: string;
}

/**
 * One progress pill (PRD-19 Block C). Core-prepared so the DSL only interpolates:
 * the builder ({@link module:shared/template/question-progress-context}) computes
 * the status class, a11y label and frontier (`clickable`); the layout renders a
 * `<button class="tb-pill {{statusClass}}">` with `data-action="goto:{{index}}"`.
 */
export interface CtxQuestionPill {
  /** Absolute 0-based question index — the `goto:<index>` jump target. */
  index: number;
  /** Display number, 1-based within the current navigation scope. */
  number: number;
  /** Status class: `is-answered`/`is-current`/`is-skipped`/`""` (+ review: `is-correct`/`is-incorrect`/`is-unanswered`). */
  statusClass: string;
  /** A11y label, e.g. «Вопрос 3, текущий» (FR-12). */
  ariaLabel: string;
  /** Reachable jump target? Frontier (FR-11): future / committed-section pills are not clickable. */
  clickable: boolean;
}

/**
 * Progress-pills map for the CURRENT navigation scope (`state.questionsProgress`,
 * PRD-19 Block C). Sectional flows scope it to the current section; the flat flow
 * spans the whole test. Absent on screens without a question map (e.g. content pages).
 */
export interface CtxQuestionsProgress {
  /** Scope heading, e.g. «Вопросы раздела «Сеть»» / «Вопросы теста». */
  scopeLabel: string;
  /** Questions in scope. */
  total: number;
  answeredCount: number;
  skippedCount: number;
  /** One entry per in-scope question, in display order. */
  states: CtxQuestionPill[];
}

/** One unanswered question in the review screen's explicit list (PRD-19 FR-08). */
export interface CtxReviewUnanswered {
  /** Absolute 0-based question index — the `goto:<index>` jump target. */
  index: number;
  /** Display number, 1-based within the review scope. */
  number: number;
  /** Question prompt (escaped by the renderer). */
  prompt: string;
}

/**
 * Review/finish screen namespace (`review.*`, PRD-19 Block D, FR-08). The system
 * обзор screen (section-finish / test-finish) shows the pills
 * ({@link CtxState.questionsProgress}, built with all pills issued) PLUS this
 * explicit unanswered list and the «Завершить …» action. Runtime-rendered on both
 * hosts from the shared `review` layout (no content_pages row — incremental model).
 */
export interface CtxReview {
  /** Heading, e.g. «Раздел «Сеть» · обзор» / «Обзор теста». */
  scopeLabel: string;
  /** True for the test-finish обзор, false for a section-finish обзор. */
  isTest: boolean;
  /** Finish-button label: «Завершить раздел» / «Завершить тест». */
  finishLabel: string;
  /** Explicit list of still-unanswered (or skipped) questions in scope. */
  unanswered: CtxReviewUnanswered[];
  unansweredCount: number;
  answeredCount: number;
  total: number;
  /** Pre-answer hint shown above the list. */
  hint: string;
  /**
   * True when the обзор was opened via the «К обзору» button MID-flow (not reached
   * at the section/test end). Then the footer shows an accented «Назад» (returns to
   * the origin question) and DEMOTES «Завершить …», to cut the risk of an accidental
   * finish. False for the end-of-flow обзор (finish is the primary action).
   */
  canReturn: boolean;
  /** «Назад» button label (only meaningful when {@link canReturn}). */
  backLabel: string;
}

/**
 * Computed section-results namespace (`sectionResult.*`, PRD-19 Block D / FR-05a).
 * The optional staged screen shown after «Завершить раздел» when `showSectionResults`
 * is on: the section's score ring + a one-line summary + an optional pass/fail verdict
 * tag + «Продолжить». A COMPUTED screen (from the results engine), NOT an author
 * `summary` content page. Both hosts build it from {@link
 * module:shared/template/result-context}.buildSectionResultContext so the numbers
 * never drift (SCORM computes the section offline; the web grades it on the server).
 */
export interface CtxSectionResult {
  /** Section/topic name for the heading. */
  topicName: string;
  scorePercent: number;
  /** Core-prepared SVG ring dash offset (precomputed; layout binds it directly). */
  ringDashoffset: number;
  /** Core-prepared class: `is-pass`/`is-fail`/`""` (empty when the section has no pass rule). */
  passClass: string;
  /** Verdict label: «Раздел пройден»/«Раздел не пройден»/`""`. */
  statusLabel: string;
  /** True when a pass/fail verdict applies — gates the verdict tag. */
  hasVerdict: boolean;
  correct: number;
  total: number;
  /** One-line summary, e.g. «6 из 8 верно · 75%». */
  summaryLabel: string;
  /** «Продолжить» action label. */
  continueLabel: string;
  /** Header caption "Раздел N из M" (position among sections); absent when unknown. */
  sectionLabel?: string;
  /** Header progress-bar fill percent (section position / total); absent when unknown. */
  progressPercent?: number;
}

/**
 * PRD-1 §4.3: «Введение раздела» (section-intro) screen data (`sectionIntro.*`).
 * Shown at the START of a section: topic name, description (from topic properties),
 * question count, time limit (when set), and an author instruction. Both hosts build
 * it from {@link module:shared/template/result-context}.buildSectionIntroContext.
 */
export interface CtxSectionIntro {
  /** «Раздел N из M» (or «Раздел N» without a total) eyebrow + header-tag label. */
  eyebrow: string;
  /** Header progress-bar fill percent (section position / total); absent when unknown. */
  progressPercent?: number;
  /** Section/topic name (heading). */
  topicName: string;
  /** Topic description from its properties; empty string when absent. */
  description: string;
  /** Gates the description block. */
  hasDescription: boolean;
  /** Number of questions delivered in the section. */
  questionCount: number;
  /** Localized count label, e.g. «16 вопросов». */
  questionCountLabel: string;
  /** Gates the time-limit meta item. */
  hasTimeLimit: boolean;
  /** Localized time-limit label, e.g. «20 мин». */
  timeLimitLabel: string;
  /** Gates the author instruction block (set when the instruction is non-empty). */
  hasInstruction: boolean;
  /** Author section illustration URL; empty string when absent. */
  illustrationUrl: string;
  /** Gates the illustration column. */
  hasIllustration: boolean;
  /** «Далее» action label. */
  continueLabel: string;
  /**
   * The threshold of this topic, ready to print: «Для прохождения: 70 %» /
   * «Для прохождения: 7 баллов из 10» (by the DELIVERED variant). Empty string when the
   * topic is not gated — the layout gates the line on the string. Contract 3.14.0.
   */
  passCondition?: string;
  /**
   * The topic is one the test verdict depends on («Обязательная тема»): set only under the
   * «…обязательные темы» policies and only for a gated topic. Contract 3.14.0.
   */
  isRequired?: boolean;
  /**
   * System warning when the section has its own time limit: the countdown starts on the
   * continue button and cannot be paused. Empty string without a limit. Contract 3.14.0.
   */
  timerWarning?: string;
}

/** Adaptive inter-level/topic transition interstitial (`transition.*`). */
export interface CtxTransition {
  /**
   * The topic the level is DETERMINED FOR (eyebrow). This screen is a level change
   * WITHIN a topic (adaptive_by_section / adaptive+router) — NOT a topic move (flat
   * adaptive is a deferred future PRD) and NOT a per-answer verdict.
   */
  topicName: string;
  /** Level-change title, e.g. «Сложность повышена» — never an answer verdict. */
  title: string;
  /** The level change (always present — the screen exists because the level changed). */
  level: {
    /** Core-prepared class: `is-up` / `is-down` / `is-complete`. */
    class: string;
    isUp: boolean;
    isDown: boolean;
    isComplete: boolean;
    /** Supporting line, e.g. «Следующие вопросы будут сложнее». */
    message: string;
  };
  /** Whether to render an explicit "Продолжить" action (SCORM) vs auto-advance (web). */
  showContinue?: boolean;
}

/** Retake gate data for the block screen (`retake.*`, PRD-6). */
export interface CtxRetake {
  cooldownPeriodDays?: number;
  availableDate?: string;
  availableDateHuman?: string;
  reason?: string;
}

/**
 * Per-test branding shown across learner screens (`design.*`, PRD-7). Carried in
 * the render context so the SAME layout binding works on both hosts. Built from
 * the test's design params — the value is already RESOLVED to a plain URL string
 * (the author stores a `{ url, name, … }` media envelope; each host extracts
 * `.url` before it reaches the context, never the envelope).
 */
export interface CtxDesign {
  /** Logo URL; absent → the `{{#if design.logoUrl}}` layout block renders nothing. */
  logoUrl?: string;
  /**
   * Start-screen illustration URL (PRD-7 branding). Present → the start layout shows
   * the «with image» variant (illustration on the right); absent → the plain variant.
   * Resolved to a plain URL string on both hosts (like {@link CtxDesign.logoUrl}).
   */
  startImageUrl?: string;
}

/**
 * The public render context handed to the unified renderer for any screen. Every
 * namespace is optional — present only on the screens that use it (`course` on
 * start/question/results; `result` on results; `state` on start/question; `retake`
 * on the block screen).
 */
export interface PublicRenderContext {
  course?: CtxCourse;
  result?: CtxResult;
  state?: CtxState;
  retake?: CtxRetake;
  transition?: CtxTransition;
  /** Per-test branding (logo); present on every learner screen that shows it. */
  design?: CtxDesign;
  /** PRD-19 Block D: review/finish (обзор) screen data. */
  review?: CtxReview;
  /** PRD-19 Block D / FR-05a: computed section-results (итоги раздела) screen data. */
  sectionResult?: CtxSectionResult;
  /** PRD-1 §4.3: «Введение раздела» (section-intro) screen data. */
  sectionIntro?: CtxSectionIntro;
}
