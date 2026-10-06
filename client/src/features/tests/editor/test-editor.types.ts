/**
 * @module features/tests/editor/test-editor.types
 * @description Type definitions for the test editor: enums, the editor model
 * (frontend-normalized form state) and the API DTO payloads.
 *
 * Source of truth: docs/prd-7-decisions.md (sections 2, 3, 6) and PRD-7 sections
 * 6.2 and 6.3. Any change here must be reflected in decisions.md first.
 */

import type { DrawBlueprint, FormSet, RetakePolicy, SectionGroup } from "@shared/schema";
import type { DraftBlock } from "./use-report-document";
import type { ReportSettings, TestIntro, BreakdownDisplaySetting } from "@shared/schema";
import type { LearnerVisibility, LevelTone, Valence } from "@shared/scales/interpretation";
import type { TestQuestionOrder } from "@shared/draw/assemble-delivery";
import type { RichTextFormat } from "@shared/template/rich-text";
import type { TestTheme, ThemeId } from "@shared/template/themes";
import type { LabelValues } from "@shared/template/labels";
import type { ResultsBlockKey } from "@shared/template/results-order";
import type { QuestionScoringOverride } from "./scoring-api";
import type { FeedbackEditorValue } from "./sections/feedback-editor-modal";

// ─── Enums ────────────────────────────────────────────────────────────────────
// All enums are frozen by docs/prd-7-decisions.md section 2.

/** `scenario` — «Сценарий в ИС»: один пункт-сценарий вместо тем (docs/specs/sim-scenario/plan-tests.md). */
export type TestMode = "standard" | "adaptive" | "scenario";

/**
 * «Сценарий в ИС»: пункт-сценарий теста — тема-банк и способ выдачи. `questionId` пуст —
 * случайный сценарий темы с поправкой на экспозицию; задан — фиксированный.
 */
export type ScenarioItemDraft = {
  topicId: string;
  topicName: string;
  questionId: string | null;
};

export type TestStatus = "draft" | "published" | "archived";

export type FlowMode =
  | "linear_flat"
  | "linear_by_topics"
  | "router_by_topics";

export type PassDecisionPolicy =
  | "overall_only"
  | "overall_and_required_topics"
  | "required_topics_only"
  | "all_topics_passed";

export type OverallPassType = "percent" | "absolute" | "none";

export type TopicPassSource = "inherit_overall" | "custom" | "none";

export type SectionTimeLimitSource = "inherit_test" | "custom" | "none";

export type FeedbackFormat = "plain" | "richText" | "html";

export type RouterCompletionPolicy =
  | "all_required_completed"
  | "all_required_passed";

export type SectionUnlockMode =
  | "always_available"
  | "after_sections_completed"
  | "after_sections_passed";

// ─── Оформление ───────────────────────────────────────────────────────────────

/**
 * Настройки оформления теста: выбранный шаблон и всё, что автор задал поверх его
 * умолчаний. Форма совпадает с телом `PUT /api/tests/:id/design` и с колонкой
 * `tests.design_settings_json`.
 *
 * Объявлено ЗДЕСЬ, а не в хуке, потому что у черновика НОВОГО теста этот срез —
 * часть модели редактора ({@link TestEditorModel.design}); хук
 * (`useDesignSettings`) переиспользует тип под именем `DesignSettings`.
 */
export type TestDesignDraft = {
  templateId: string;
  /** Штампуются сервером при сохранении; в черновике нового теста их нет. */
  templateVersion?: string;
  templateApiVersion?: string;
  params?: Record<string, unknown>;
  /** PRD-23: палитра, закреплённая автором; отсутствие читается как «Авто». */
  theme?: TestTheme;
  /** PRD-23: цвета по палитрам. Только у шаблона, объявившего темы. */
  paramsByTheme?: Partial<Record<ThemeId, Record<string, unknown>>>;
  /**
   * PRD-49 §4.2: собственные формулировки надписей — только ОТСТУПЛЕНИЯ. Отсутствие
   * ключа означает «текст шаблона в силе», поэтому настройки теста, которому надписи
   * не переписывали, сохраняют ту же форму, что была до PRD.
   */
  labels?: LabelValues;
  /** PRD-49 §3: авторский порядок четырёх подблоков под итогами. */
  resultsBlockOrder?: ResultsBlockKey[];
};

// ─── Feedback ─────────────────────────────────────────────────────────────────

/**
 * Rich-format feedback content. Used at the test, topic and adaptive level.
 * Default `format` for legacy string feedback is `"plain"` (decisions §4.3).
 */
export type FeedbackContent = {
  format: FeedbackFormat;
  text: string;
};

/**
 * PRD-50 FR-50: обратная связь ОДНОЙ подтемы — целый блок, а не только текст.
 *
 * У теста и темы материалы лежат отдельными полями рядом с текстом (`feedbackLinks` и
 * прочие): так сложилось исторически. Подтем в разделе много, и четыре параллельные карты
 * пришлось бы держать в согласии между собой — поэтому здесь один блок на подтему, ровно
 * той формы, в какой его хранит база (`feedbackContentSchema`).
 */
export type BreakdownFeedbackEntry = FeedbackContent & {
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  events: FeedbackEvent[];
};

/**
 * Толкование — текст и его формат, и БОЛЬШЕ НИЧЕГО.
 *
 * Ни курсов, ни материалов, ни мероприятий: толкование объясняет результат, а не
 * советует, что с ним делать. Тип отдельный от {@link BreakdownFeedbackEntry} именно
 * поэтому — совпадение с {@link FeedbackContent} по форме здесь случайно, и заводить
 * одно имя на две разные сущности значило бы стереть различие, ради которого они и
 * разделены.
 */
export type InterpretationEntry = {
  format: FeedbackFormat;
  text: string;
};

/**
 * Material attached to feedback — title + external URL (PRD-42). `fileName`/`mimeType` are
 * legacy-only: descriptors saved through the retired upload flow (PRD-32) carry them, new
 * rows do not. `scormHref` is a legacy in-package address kept for reading old data only.
 */
export type FeedbackAsset = {
  id?: string;
  title: string;
  fileName?: string;
  mimeType?: "application/pdf";
  url?: string;
  scormHref?: string;
};

export type FeedbackLink = {
  title: string;
  url: string;
};

/** Recommended event (TD-02). URL optional — an event may have no page. */
export type FeedbackEvent = {
  title: string;
  url?: string;
};

// ─── Adaptive ─────────────────────────────────────────────────────────────────

export type AdaptiveLinkConfig = {
  id?: string;
  title: string;
  url: string;
};

export type AdaptiveLevelConfig = {
  id?: string;
  levelIndex: number;
  levelName: string;
  minDifficulty: number;
  maxDifficulty: number;
  questionsCount: number;
  passThreshold: number;
  passThresholdType: "percent" | "absolute";
  feedback?: string | null;
  links: AdaptiveLinkConfig[];
};

export type AdaptiveTopicConfig = {
  topicId: string;
  topicName: string;
  failureFeedback?: string | null;
  levels: AdaptiveLevelConfig[];
};

/**
 * Test-wide adaptive settings, separate from per-topic adaptive levels.
 */
export type AdaptiveTestSettings = {
  showDifficultyLevel: boolean;
  strategy?: string;
  globalDefaults?: unknown;
};

// ─── Flow policy ──────────────────────────────────────────────────────────────

export type RouterUnlockRule =
  | { mode: "always_available" }
  | { mode: "after_sections_completed"; sectionIds: string[] }
  | { mode: "after_sections_passed"; sectionIds: string[] };

export type FlowRouterSettings = {
  completionPolicy: RouterCompletionPolicy;
  sectionUnlockRules: Record<string, RouterUnlockRule>;
};

export type FlowSettings = {
  linear?: Record<string, never>;
  router?: FlowRouterSettings;
};

// ─── Pass rules ───────────────────────────────────────────────────────────────

export type OverallPassRule = {
  type: OverallPassType;
  value: number;
};

export type TopicPassRule =
  | { source: "inherit_overall" }
  | { source: "custom"; type: "percent" | "absolute"; value: number }
  | { source: "none" }
  /**
   * PRD-24: a threshold per PRD-17 variant, keyed by the stable `formId`. Only
   * available to a topic in variants mode; the delivered variant's entry is what
   * gates the topic at runtime.
   */
  | { source: "by_variant"; byForm: Record<string, { type: "percent" | "absolute"; value: number }> };

export type PassRules = {
  decisionPolicy: PassDecisionPolicy;
  overall: OverallPassRule;
  byTopic: Record<string, TopicPassRule>;
  /**
   * PRD-50 §16 (FR-53): учитывать ли подтемы (теги) в вердикте темы. Один флаг на весь
   * тест, а не на тему: порог подтемы производный от порога её темы (FR-52), отдельных
   * порогов у подтем нет.
   *
   * Необязательное, как и прочие поздние поля модели: черновик, собранный локально, и
   * ответ API старше колонки просто не несут значения, а каждое чтение вырождает его в
   * «выключено» — тема судится ровно как до §16.
   */
  breakdownGateEnabled?: boolean;
};

// ─── Sections ─────────────────────────────────────────────────────────────────

export type SectionTimeLimit =
  | { source: "inherit_test" }
  | { source: "custom"; minutes: number }
  | { source: "none" };

export type EditorSection = {
  topicId: string;
  topicName: string;
  /** PRD-2 §4.2: topic's author-defined readable id (slug), or null → use the UUID. */
  topicCode?: string | null;
  maxQuestions: number;
  /**
   * PRD-10: the topic pool's maximum attainable points (Σ question points).
   * Absolute pass thresholds are compared against earned POINTS at runtime
   * (graded scoring), so the editor caps them by this rather than by the
   * question count. Absent (e.g. a section built locally before the API
   * round-trip) — validation falls back to {@link maxQuestions}.
   */
  maxPoints?: number;
  drawCount: number;
  /**
   * When true the topic draws its ENTIRE current question pool (ignoring
   * drawCount). Holds the author's manual intent; adaptive mode overrides the
   * effective behaviour to "all" without mutating this flag (see
   * {@link sectionDrawsAll}). Default false = legacy fixed draw.
   */
  drawAll: boolean;
  required: boolean;
  timeLimit: SectionTimeLimit;
  feedback: FeedbackContent;
  feedbackLinks: FeedbackLink[];
  feedbackAssets: FeedbackAsset[];
  feedbackEvents: FeedbackEvent[];
  /**
   * PRD-11: optional per-tag draw quotas. Absent/`null` = uniform draw (FR-02).
   * When present, `strata` lists per-sub-topic quotas (tag + count + per-tag mode).
   */
  drawBlueprint?: DrawBlueprint | null;
  /**
   * PRD-17 (BR-12): optional fixed-variant set. Present = the section runs in
   * "variants mode" — one variant is delivered whole; the draw controls
   * (drawAll/drawCount/drawBlueprint) are then not applied. `null`/absent =
   * legacy draw.
   */
  formSet?: FormSet | null;
  /**
   * PRD-50 FR-50: обратная связь ПОДТЕМ этого раздела — ключ подтемы -> её текст с
   * рекомендациями в том же формате, что у темы.
   *
   * Своя колонка, отдельно от выдачи: квота — про доставку, текст — про содержание.
   */
  breakdownFeedback?: Record<string, BreakdownFeedbackEntry> | null;
  /**
   * Толкование темы, заданное ЭТИМ тестом (`test_sections.interpretation_json`).
   *
   * Заменяет текст самой темы целиком; `null`/отсутствие = тест не переопределял, и
   * участник читает текст темы. Отдельно от {@link feedback}: толкование объясняет
   * результат и печатается при любом вердикте, обратная связь советует и выдаётся по
   * правилу — свести их в одно поле значило бы потерять это различие.
   */
  interpretation?: InterpretationEntry | null;
  /**
   * Толкования ПОДТЕМ этого раздела (`test_sections.breakdown_interpretation_json`) —
   * ключ подтемы -> её текст. Печатаются под своей полосой, когда включён их показ.
   */
  breakdownInterpretation?: Record<string, InterpretationEntry> | null;
  /**
   * PRD-30 FR-02/FR-18: this topic's OVERRIDE of the test-wide delivery order.
   * `null`/absent = «как в тесте» (the default), `random` = today's shuffle,
   * `fixed` = by the author's «Индекс в теме», or by the variant's own list
   * when the section runs in variants mode (FR-07).
   */
  questionOrder?: "random" | "fixed" | null;
  /**
   * PRD-15 block D (FR-31): per-section default price of a question. `null` =
   * inherit the test default. Edited in the «Оценка» tab, persisted with the
   * section row.
   */
  defaultPoints: number | null;
  /**
   * PRD-50 FR-11/FR-12: `key` of the test's block (`TestEditorModel.sectionGroups`)
   * this section belongs to. `null`/absent = no block; the section prints after all
   * blocks, in its own order (FR-25). A key no block declares means the same thing —
   * deleting a block from the editor also clears it here so the UI never shows a
   * dangling reference.
   */
  groupKey?: string | null;
};

/**
 * Effective "draw all questions" for a section. Adaptive mode forces every
 * topic to contribute its full pool (the per-level `questionsCount` then drives
 * how many are shown), so it overrides the stored manual `drawAll` flag.
 */
export function sectionDrawsAll(drawAll: boolean, mode: TestMode): boolean {
  return mode === "adaptive" || drawAll;
}

// ─── Result variables (PRD-2) ─────────────────────────────────────────────────

export type ResultVariableType = "number" | "string" | "boolean";

/** How the value is published to the LMS (cmi). Mirrors the `scorm_target` enum. */
export type ResultVariableScormTarget =
  | "none"
  | "suspend_data"
  | "interaction"
  | "both";

/** Whether a boolean variable overrides cmi.success_status / completion_status. */
export type ResultVariableControlsStatus = "none" | "success" | "completion";

/**
 * One result variable as edited in the «Показатели» tab. `id` is absent for
 * rows added in the editor and not yet persisted; the save orchestrator creates
 * them via POST and the refetched snapshot fills in the real id.
 */
export type ResultVariableModel = {
  id?: string;
  /**
   * Stable client-side key for rows added in the editor before they have a
   * server `id`. Used only for React keys / drag identity; never sent to the API
   * and not part of the save diff.
   */
  clientKey?: string;
  name: string;
  label: string;
  type: ResultVariableType;
  formula: string;
  /** PRD-29: what the learner sees — nothing, the level only, or level + value. */
  learnerVisibility: LearnerVisibility;
  scormTarget: ResultVariableScormTarget;
  controlsStatus: ResultVariableControlsStatus;
  /**
   * PRD-29: interpretation of a NUMERIC indicator, persisted in the indicator's
   * own `config_json`. Empty for string/boolean indicators — those interpret
   * through {@link ResultVariableModel.outcomes}.
   */
  bands: ScaleBandModel[];
  /** PRD-29: interpretation of a string/boolean indicator, matched by exact code. */
  outcomes: OutcomeModel[];
  /**
   * The NUMERIC indicator's explicit domain, persisted alongside `bands` in the
   * indicator's own `config_json` — same meaning and round trip as
   * {@link ScaleModel.domainMin}/`domainMax`. BOTH `null` = not set; the domain
   * is then derived from the span of `bands` (mirrors `parseIndicatorInterpretation`).
   */
  domainMin: number | null;
  domainMax: number | null;
  /**
   * Which end of a NUMERIC indicator's range is favourable — same enum and
   * meaning as {@link ScaleModel.valence}. Unused by a string/boolean indicator
   * (its cards are toned per-outcome instead), but always round-tripped so a
   * type flip during editing does not lose it.
   */
  valence: Valence;
  /**
   * PRD-49 §6: show the card's NAME slot. Same convention as
   * {@link ScaleModel.showName} — absent = shown, stored only when switched off.
   */
  showName?: boolean;
  /** PRD-49 §6: show the card's LEVEL slot (the outcome label). */
  showLevel?: boolean;
  /**
   * PRD-53 §4.4: the «scales outside the profile» card. Absent = no card, which is
   * why it is optional rather than a filled default — an indicator nobody touched
   * must round-trip byte-identical. `keys` repeats the profile group instead of
   * being derived from the formula: the card is a PRESENTATION choice, and an
   * author may later want it over a subset without re-parsing the DSL to find out.
   */
  restScales?: { show: boolean; label: string; keys: string[] };
  sortOrder: number;
};

// ─── Scales (PRD-5) ────────────────────────────────────────────────────────────

export type ScaleType = "number" | "boolean" | "category" | "level";

/** Aggregation of the active per-question contributions into the scale's raw. */
export type ScaleAggregation = "sum" | "avg" | "weighted_avg" | "max" | "min";

export type ScaleNormalization = "none" | "percent" | "custom";

export type ScaleDirection = "positive" | "inverse";

/** How the scale is published to the LMS (cmi). Mirrors the `scorm_target` enum. */
export type ScaleScormTarget = "none" | "suspend_data" | "interaction" | "both";

/**
 * One interpretation band applied to the scale's raw value (PRD-5 §5.3). `min`/
 * `max` are edited as raw text and parsed to numbers on save; `level` is the
 * machine code published in `scale.{key}.level`, `label` the optional display
 * text (empty → the learner sees the code).
 */
export type ScaleBandModel = {
  clientKey?: string;
  min: string;
  max: string;
  label: string;
  level: string;
  /** PRD-29: what this level MEANS, shown to the learner under the ruler. */
  text: string;
  /**
   * PRD-29: author's override of the tone derived from the ramp position. Empty =
   * derive it. A closed list of METHODOLOGICAL states, never a colour — the template
   * decides how each state looks.
   */
  tone: LevelTone | "";
  /** PRD-29: recommendations that fire when the learner lands in this band. */
  feedback?: FeedbackEditorValue;
};

/**
 * PRD-29: one outcome of a non-numeric interpretation — the string/boolean twin of
 * {@link ScaleBandModel}. The match is an exact `code` (what the formula returns)
 * instead of a numeric interval; everything the learner sees is the same triple of
 * label, explanatory text and optional tone/recommendations.
 */
export type OutcomeModel = {
  clientKey?: string;
  code: string;
  label: string;
  text: string;
  tone: LevelTone | "";
  feedback?: FeedbackEditorValue;
};

/**
 * One scale as edited in the «Шкалы» tab. `id` is absent for rows added in the
 * editor and not yet persisted; the save orchestrator creates them via POST and
 * the refetched snapshot fills in the real id. The combined «Пересчёт итога»
 * control in the UI maps to the `(normalization, direction)` pair.
 */
export type ScaleModel = {
  id?: string;
  /** Stable client-side key for unsaved rows; never sent to the API. */
  clientKey?: string;
  key: string;
  label: string;
  /**
   * PRD-53 §4.4: what the scale measures, in the author's words. Печатается
   * обучающемуся в блоке «шкалы вне профиля» на экране итогов и возится книгой
   * Excel (лист «Шкалы», колонка «Описание»). Всегда строка: пустая означает
   * «не задано» и сохраняется как `null`.
   */
  description: string;
  type: ScaleType;
  aggregation: ScaleAggregation;
  normalization: ScaleNormalization;
  direction: ScaleDirection;
  bands: ScaleBandModel[];
  /**
   * PRD-29: the scale's explicit numeric domain, persisted in `config_json`.
   * BOTH `null` = not set; the domain is then derived from the span the
   * interpretation bands cover (mirrors `parseScaleInterpretation`). A zero is a
   * legitimate bound — every domain of the reference methodology starts at zero —
   * so absence can never be signalled by the value itself, only by `null`.
   */
  domainMin: number | null;
  domainMax: number | null;
  /**
   * PRD-46 §6: how far a full ray of the radar stretches, when the domain is not the
   * right answer. Read ONLY by the chart, and only when the test sets the axis limit to
   * «заданный автором»; `null` = not set, the chart falls back to the domain.
   *
   * Deliberately separate from the domain: the domain says what the scale MEASURES and
   * drives the ruler and the band boundaries in the card, while this one says nothing
   * about the measurement and only rescales a drawing.
   */
  displayMax: number | null;
  /**
   * PRD-29: which end of the scale is favourable. NOT the same as `direction`:
   * `direction` inverts the value during aggregation, `valence` says how the
   * value is to be JUDGED (it colours levels and orders the ruler's ramp).
   */
  valence: Valence;
  /** PRD-29: what the learner sees — nothing, the level only, or level + value. */
  learnerVisibility: LearnerVisibility;
  scormTarget: ScaleScormTarget;
  /**
   * PRD-49 §6: show the card's NAME slot. Absent (or `true`) = shown, which is why
   * every read goes through `!== false`: the flag is written to `config_json` only
   * when the author switches the slot OFF, so a scale nobody touched keeps the exact
   * config it had. Switching it off hides the slot only — the label itself stays in
   * the data, because the report, the analytics and the export all read it.
   */
  showName?: boolean;
  /** PRD-49 §6: show the card's LEVEL slot (the banner's verdict line). */
  showLevel?: boolean;
  sortOrder: number;
};

/** The answer-unit kind a measurement is bound to (PRD-5 §9.2). */
export type MeasurementSourceType =
  | "question"
  | "option"
  | "matching_pair"
  | "ranking_position"
  // PRD-44: вклад распределения — величину задаёт учащийся, ключ это индекс утверждения.
  | "option_allocation";

/**
 * One contribution cell of the «Вклады вопросов» matrix: an explicit numeric
 * contribution of a question's answer unit into one scale. Identified by
 * (questionId, sourceType, sourceKey, scaleKey) — the scale is referenced by its
 * stable `key` (not the uuid), resolved to `scaleId` on save once scales are
 * persisted. `value` is the explicit number (0 and negatives valid); `weight`
 * defaults to 1 (no UI yet). Rows are replaced per question on save.
 */
export type QuestionMeasurementModel = {
  questionId: string;
  scaleKey: string;
  sourceType: MeasurementSourceType;
  sourceKey: string | null;
  value: number;
  weight: number;
};

// ─── Breakdown display (PRD-50 FR-13) ──────────────────────────────────────────

export type { BreakdownDisplaySetting };

/** Default when the test carries no `breakdownDisplayJson` yet — same as an
 *  absent DB column: subtotal rows stay hidden, «Доля вопросов» pre-selected. */
export const DEFAULT_BREAKDOWN_DISPLAY: BreakdownDisplaySetting = {
  visibility: "hidden",
  basis: "units",
};

// ─── Editor model ─────────────────────────────────────────────────────────────

/**
 * Normalized frontend state of the test editor. Built by `apiToEditorModel`
 * from the API response and consumed by all editor sections. Persisted via
 * `editorModelToPayload` -> API on save.
 *
 * `version` is the snapshot value used for optimistic conflict detection
 * (decisions §5.3).
 */
export type TestEditorModel = {
  id?: string;
  version: number;
  mode: TestMode;
  /**
   * «Сценарий в ИС»: пункт теста режима `scenario`. Хранится и в других режимах — смена режима
   * его не стирает, как и темы (FR-40), — а сохраняется только в своём. Необязательное: черновик,
   * сохранённый до этой работы, его не несёт.
   */
  scenario?: ScenarioItemDraft | null;
  flowMode: FlowMode;
  /**
   * PRD-30 FR-16: the test-wide delivery order and the default every topic
   * inherits. `shuffle_all` («полное перемешивание») is only offered in the flat
   * flow — a sectional flow rewrites it to `random` on save (FR-17).
   *
   * Optional like the other delivery extras: a draft assembled locally, or one
   * loaded from an API response older than the column, simply has no value, and
   * every read defaults it to `random` — today's behaviour.
   */
  questionOrder?: TestQuestionOrder;
  flowSettings: FlowSettings;
  /** Parent folder; `null` means root (no folder). */
  folderId: string | null;
  /**
   * Оформление, набранное ДО первого сохранения. Живёт в модели ТОЛЬКО в режиме
   * создания: у существующего теста оформление правится своим ресурсом
   * (`PUT /api/tests/:id/design`) со своим черновиком, и второе место хранения
   * означало бы два источника истины.
   *
   * Поэтому {@link apiToEditorModel} срез НЕ заполняет: у открытого на правку теста
   * поля нет, и `editorModelToPayload` ничего об оформлении в PUT не кладёт.
   *
   * Сохраняется в ДВА приёма (см. правило 9 в
   * `docs/architecture/test-editor-contracts.md`): `templateId` уезжает телом
   * создания, потому что системные страницы связывает с шаблоном та же транзакция,
   * а остальное дописывается сразу после INSERT тем же `PUT /:id/design` — по образцу
   * показателей, шкал и измерений, которые редактор буферизует так же.
   */
  design?: TestDesignDraft;
  basic: {
    title: string;
    description: string;
    /** PRD-59 FR-06: режим ввода описания; сохраняется вместе с тестом. */
    descriptionFormat: RichTextFormat;
    status: TestStatus;
    feedback: FeedbackContent;
    feedbackLinks: FeedbackLink[];
    feedbackAssets: FeedbackAsset[];
    feedbackEvents: FeedbackEvent[];
    webhookUrl: string;
    telemetryEnabled: boolean;
  };
  runtime: {
    timeLimitMinutes: number | null;
    maxAttempts: number | null;
    showCorrectAnswers: boolean;
    // PRD-19 (Блок A): правила навигации/завершения.
    allowReturnToUnanswered: boolean; // FR-01
    allowFreeSectionNavigation: boolean; // FR-11a (зависит от возврата, FR-11c)
    allowAnswerChange: boolean; // FR-04a (зависит от возврата; взаимоискл. с showCorrectAnswers)
    // PRD-43: НЕЗАВИСИМ от allowReturnToUnanswered; взаимоискл. с showCorrectAnswers (гасится в UI).
    quickAdvance: boolean;
    showSectionResults: boolean; // FR-05a (секционные)
    // Обзор при полностью отвеченном объёме — авторское решение (см. `review-gate`).
    skipReviewWhenComplete: boolean;
    /**
     * PRD-67: leaving a started section with a time limit (its own or the test's) closes
     * it; in a test without sections leaving ends the attempt. Default off.
     */
    closeSectionOnLeave: boolean;
    /**
     * Что SCORM-пакет отдаёт в LMS при нескольких попытках: лучшую по проценту или только
     * что завершённую. В вебе не применяется — внешней системы там нет. Умолчание `best`:
     * так ведут себя уже выданные пакеты.
     */
    lmsAttemptResult: "best" | "last";
    /**
     * PRD-50 FR-13: subtotal-by-key display on the topic card (section results, test
     * results, report). Absent = a draft built before this PRD — every reader falls
     * back to {@link DEFAULT_BREAKDOWN_DISPLAY} («Не показывать»).
     */
    breakdownDisplay?: BreakdownDisplaySetting;
    // PRD-34: защита текста задания. Три НЕЗАВИСИМЫХ переключателя (FR-02).
    copyProtection: boolean; // FR-01, умолчание ВКЛ
    protectionWatermark: boolean; // FR-16, умолчание ВЫКЛ
    protectionHideOnBlur: boolean; // FR-21, умолчание ВЫКЛ
  };
  passRules: PassRules;
  sections: EditorSection[];
  /**
   * PRD-50 FR-11: named blocks of sections (`tests.section_groups_json`), in author
   * order — a section joins one via `EditorSection.groupKey`. Absent/empty = no
   * blocks, i.e. exactly today's flat list of topic cards every test has printed so
   * far (FR-27). Edited next to the section list itself (`topics-structure-section`),
   * since a block is a property of the test's STRUCTURE, not its scoring or display.
   */
  sectionGroups?: SectionGroup[];
  adaptive: {
    showDifficultyLevel: boolean;
    testSettings: AdaptiveTestSettings;
    topics: Array<AdaptiveTopicConfig & { enabled: boolean }>;
  };
  /** PRD-2 result variables, ordered by evaluation (`sortOrder`). */
  resultVariables: ResultVariableModel[];
  /** PRD-5 scales, ordered by `sortOrder`. */
  scales: ScaleModel[];
  /** PRD-5 per-question measurement contributions (the «Вклады вопросов» matrix). */
  measurements: QuestionMeasurementModel[];
  /** PRD-6 retake gate. `enabled: false` = legacy behaviour (no cooldown). */
  retakePolicy: RetakePolicy;
  /**
   * PRD-27: выбранный вид ОТЧЁТА и значения его полей, по режиму теста. Часть черновика
   * вкладки «Настройки»: сохраняется одной кнопкой «Сохранить», «Закрыть» отменяет.
   * Пустая ветка = автор ничего не выбирал, берётся вариант с `isDefault`.
   *
   * Необязателен: черновики, сохранённые до PRD-27, среза не несут — как и `scoring`
   * до блока D. Потребители обязаны читать через `?? {}`.
   */
  report?: ReportSettings;
  /**
   * PRD-51: ДОКУМЕНТ ОТЧЁТА — состав и порядок блоков, по ветви режима. Ветви две и
   * живут одновременно, как и у {@link report}: смена режима не должна стирать
   * собранный документ другого.
   *
   * ОТСУТСТВУЕТ у теста, который документа не собирал, и это не то же самое, что пустой
   * список: без строк печатается документ по умолчанию шаблона, а пустой список —
   * осознанное «печатать нечего». Потребители обязаны различать эти два случая.
   */
  reportDocument?: {
    /**
     * Строки, ПРИШЕДШИЕ ИЗ БАЗЫ. Правкой не меняются: из них один раз разрешается
     * начальный вид документа (правила §5.1 — дописать новое, пропустить неизвестное), и
     * применять эти правила к каждому нажатию значило бы спорить с автором.
     */
    saved?: { standard?: DraftBlock[]; adaptive?: DraftBlock[] };
    /** Черновик автора; появляется с ПЕРВОЙ правкой и только тогда уходит на сервер. */
    draft?: { standard?: DraftBlock[]; adaptive?: DraftBlock[] };
  };
  /** Вводные блоки экрана итогов и отчёта (`tests.intro_json`, PRD-27 §7.1). */
  intro?: TestIntro;
  /**
   * PRD-15 block D (FR-31): test-side scoring edited in the «Оценка» tab.
   * `defaultQuestionPoints = null` = system default (1 point). `questionOverrides`
   * are the per-(test, question) overrides; they are part of the draft and persist
   * with the single drawer «Сохранить» (reconciled against the snapshot in the
   * editor's save mutation, see scoring-api `saveQuestionOverrides`). «Закрыть»
   * discards them.
   */
  scoring: {
    defaultQuestionPoints: number | null;
    questionOverrides: QuestionScoringOverride[];
  };
  /**
   * PRD-56: вопросы, исключённые из выдачи в этом тесте. Только для чтения: признак
   * ставит аналитика, редактор его лишь показывает («Вопросы теста») и в сохранение не
   * отдаёт. Необязателен: черновик, собранный локально, среза не несёт.
   */
  deliveryExcludedQuestionIds?: string[];
};

// ─── API DTO payloads ─────────────────────────────────────────────────────────
// Source of truth: PRD-7 §6.3 and decisions.md §6.

export type FlowPolicyPayload = {
  mode: FlowMode;
  router: FlowRouterSettings | null;
};

export type FeedbackPayload = {
  format: FeedbackFormat;
  text: string;
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  events: FeedbackEvent[];
};

/**
 * `description` is `string | null` (not `string`) because decisions.md §6.8
 * normalizes empty strings to `null` for nullable fields. The editor model
 * keeps a non-null `string`; the mapper produces `null` here when empty.
 */
export type TestSettingsPayload = {
  title: string;
  description: string | null;
  /** PRD-59 FR-02: формат, в котором написано описание. */
  descriptionFormat: RichTextFormat;
  status: TestStatus;
  mode: TestMode;
  flowMode: FlowMode;
  /** PRD-30 FR-16: the test-wide delivery order. */
  questionOrder: TestQuestionOrder;
  flowPolicyJson?: FlowPolicyPayload;
  overallPassRuleJson: OverallPassRule;
  passDecisionPolicy: PassDecisionPolicy;
  /** PRD-50 §16 (FR-53): `tests.breakdown_gate_enabled` — учитывать подтемы в вердикте темы. */
  breakdownGateEnabled: boolean;
  timeLimitMinutes: number | null;
  maxAttempts: number | null;
  showCorrectAnswers: boolean;
  // PRD-19 (Блок A): правила навигации/завершения теста.
  allowReturnToUnanswered: boolean;
  allowFreeSectionNavigation: boolean;
  allowAnswerChange: boolean;
  // PRD-43: независим от allowReturnToUnanswered.
  quickAdvance: boolean;
  showSectionResults: boolean;
  skipReviewWhenComplete: boolean;
  // PRD-67: leaving a started section with a time limit closes it.
  closeSectionOnLeave: boolean;
  lmsAttemptResult: "best" | "last";
  // PRD-34: настройки защиты текста задания.
  copyProtection: boolean;
  protectionWatermark: boolean;
  protectionHideOnBlur: boolean;
  /**
   * Test-level feedback. Sent under the `feedbackJson` key because the legacy
   * `feedback` server field is `string`-typed (zod-validated). The new structured
   * form lives in `feedbackJson` (decisions §4.3, §6.5).
   */
  feedbackJson: FeedbackPayload;
  webhookUrl: string | null;
  telemetryEnabled: boolean;
  /** PRD-6 retake gate; `null` when disabled (= legacy behaviour, FR-02). */
  retakePolicyJson?: RetakePolicy | null;
  /** PRD-27: выбор варианта отчёта и значения его полей. */
  reportSettingsJson?: ReportSettings | null;
  /** Вводные блоки экрана итогов и отчёта; `null` — ни одного не задано. */
  introJson?: TestIntro | null;
  /** PRD-50 FR-13: subtotal-by-key display setting. Always sent — the editor resolves
   *  the missing-model case to {@link DEFAULT_BREAKDOWN_DISPLAY} before building the payload. */
  breakdownDisplayJson: BreakdownDisplaySetting;
  /**
   * PRD-50 FR-11: named blocks of sections, in author order. `null`/absent = no
   * blocks (FR-27).
   */
  sectionGroupsJson?: SectionGroup[] | null;
  /** PRD-15 block D (FR-31): test-wide default price; `null` = system (1). */
  defaultQuestionPoints: number | null;
  /**
   * PRD-51: документ отчёта ветви ТЕКУЩЕГО режима, в порядке печати. ОТСУТСТВИЕ поля =
   * «не трогать»: сохранение с другой вкладки не должно стирать документ. Пустой массив —
   * осознанное «печатать нечего», и он документ действительно стирает.
   *
   * Имена полей — КОНТРАКТ МАРШРУТА (`values`/`settings`), а не имена колонок базы:
   * `sortOrder` тело запроса не несёт вовсе, его выводит сервер из позиции. Тип описан
   * здесь целиком, а не переиспользован от разрешения документа, именно поэтому: у
   * запроса и у строки таблицы разные наборы полей, и подмена одного другим уже стоила
   * молча потерянного текста страниц — zod выбрасывает незаявленные ключи без единого слова.
   */
  reportBlocks?: Array<{
    block: string;
    templateKey: string | null;
    enabled: boolean;
    values: Record<string, unknown>;
    settings: Record<string, unknown>;
  }>;
  expectedVersion: number;
  /** Only sent on create (FAB folder-pick). PUT path leaves it undefined and
   *  uses the dedicated `/api/test-folders/move/:id` endpoint instead. */
  folderId?: string | null;
  /**
   * Выбранный шаблон оформления. Уходит ТОЛЬКО при создании — маршрут создания
   * принимает один идентификатор и сам штампует версии. На пути PUT поле остаётся
   * пустым: там оформление сохраняет `PUT /api/tests/:id/design`.
   */
  designSettingsJson?: { templateId: string };
};

export type TestSectionPayload = {
  topicId: string;
  drawCount: number;
  /** Author's manual "draw the whole topic" flag (adaptive overrides effect). */
  drawAll: boolean;
  required: boolean;
  topicPassRuleJson: TopicPassRule;
  timeLimitMinutes: number | null;
  feedbackJson: FeedbackPayload;
  /** PRD-11: per-tag draw quotas; `null` = uniform draw (FR-02). */
  drawBlueprintJson: DrawBlueprint | null;
  /** PRD-17 (BR-12): fixed-variant set; `null` = legacy draw. */
  formSetJson: FormSet | null;
  /** PRD-50 FR-50: тексты подтем; `null` = автор их не писал. */
  breakdownFeedbackJson: { axis: "tag"; keys: Record<string, BreakdownFeedbackEntry> } | null;
  /** Толкование темы, заданное этим тестом; `null` = тест не переопределял. */
  interpretationJson: InterpretationEntry | null;
  /** Толкования подтем; `null` = автор их не писал. */
  breakdownInterpretationJson: { axis: "tag"; keys: Record<string, InterpretationEntry> } | null;
  /** PRD-50 FR-11/FR-12: the test's block this section belongs to; `null` = no block. */
  groupKey: string | null;
  /** PRD-15 block D (FR-31): per-section default price; `null` = inherit test. */
  defaultPoints: number | null;
  /** PRD-30 FR-02/FR-18: the topic's override; `null` = «как в тесте». */
  questionOrder: "random" | "fixed" | null;
};

export type AdaptiveSettingsPayload = {
  showDifficultyLevel: boolean;
  testSettings: AdaptiveTestSettings;
  topics: AdaptiveTopicConfig[];
};

// ─── Validation result ────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  field: string;
  code: string;
  message: string;
  severity: ValidationSeverity;
};

export type ValidationResult = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};
