/**
 * @module features/tests/editor/test-editor.types
 * @description Type definitions for the test editor: enums, the editor model
 * (frontend-normalized form state) and the API DTO payloads.
 *
 * Source of truth: docs/prd-7-decisions.md (sections 2, 3, 6) and PRD-7 sections
 * 6.2 and 6.3. Any change here must be reflected in decisions.md first.
 */

import type { DrawBlueprint, FormSet, RetakePolicy } from "@shared/schema";
import type { ReportSettings } from "@shared/schema";
import type { LearnerVisibility, LevelTone, Valence } from "@shared/scales/interpretation";
import type { TestQuestionOrder } from "@shared/draw/assemble-delivery";
import type { QuestionScoringOverride } from "./scoring-api";
import type { FeedbackEditorValue } from "./sections/feedback-editor-modal";

// ─── Enums ────────────────────────────────────────────────────────────────────
// All enums are frozen by docs/prd-7-decisions.md section 2.

export type TestMode = "standard" | "adaptive";

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
 * PDF asset attached to feedback. `url` is the canonical media-library address written by
 * the editor right after the upload; `scormHref` is the legacy in-package address kept for
 * reading old data only.
 */
export type FeedbackAsset = {
  id?: string;
  title: string;
  fileName: string;
  mimeType: "application/pdf";
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
   * PRD-29: which end of the scale is favourable. NOT the same as `direction`:
   * `direction` inverts the value during aggregation, `valence` says how the
   * value is to be JUDGED (it colours levels and orders the ruler's ramp).
   */
  valence: Valence;
  /** PRD-29: what the learner sees — nothing, the level only, or level + value. */
  learnerVisibility: LearnerVisibility;
  scormTarget: ScaleScormTarget;
  sortOrder: number;
};

/** The answer-unit kind a measurement is bound to (PRD-5 §9.2). */
export type MeasurementSourceType = "question" | "option" | "matching_pair" | "ranking_position";

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
  basic: {
    title: string;
    description: string;
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
    allowAnswerChange: boolean; // FR-04a (зависит от возврата; взаимоискл. с showCorrectAnswers)
    showSectionResults: boolean; // FR-05a (секционные)
    // PRD-34: защита текста задания. Три НЕЗАВИСИМЫХ переключателя (FR-02).
    copyProtection: boolean; // FR-01, умолчание ВКЛ
    protectionWatermark: boolean; // FR-16, умолчание ВЫКЛ
    protectionHideOnBlur: boolean; // FR-21, умолчание ВЫКЛ
  };
  passRules: PassRules;
  sections: EditorSection[];
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
  status: TestStatus;
  mode: TestMode;
  flowMode: FlowMode;
  /** PRD-30 FR-16: the test-wide delivery order. */
  questionOrder: TestQuestionOrder;
  flowPolicyJson?: FlowPolicyPayload;
  overallPassRuleJson: OverallPassRule;
  passDecisionPolicy: PassDecisionPolicy;
  timeLimitMinutes: number | null;
  maxAttempts: number | null;
  showCorrectAnswers: boolean;
  // PRD-19 (Блок A): правила навигации/завершения теста.
  allowReturnToUnanswered: boolean;
  allowAnswerChange: boolean;
  showSectionResults: boolean;
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
  /** PRD-15 block D (FR-31): test-wide default price; `null` = system (1). */
  defaultQuestionPoints: number | null;
  expectedVersion: number;
  /** Only sent on create (FAB folder-pick). PUT path leaves it undefined and
   *  uses the dedicated `/api/test-folders/move/:id` endpoint instead. */
  folderId?: string | null;
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
