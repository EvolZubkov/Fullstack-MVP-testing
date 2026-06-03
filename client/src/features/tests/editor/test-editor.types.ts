/**
 * @module features/tests/editor/test-editor.types
 * @description Type definitions for the test editor: enums, the editor model
 * (frontend-normalized form state) and the API DTO payloads.
 *
 * Source of truth: docs/prd-7-decisions.md (sections 2, 3, 6) and PRD-7 sections
 * 6.2 and 6.3. Any change here must be reflected in decisions.md first.
 */

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
 * PDF asset attached to feedback. `scormHref` is filled by the backend when
 * the file is persisted, never by the frontend (decisions §6.5).
 */
export type FeedbackAsset = {
  id?: string;
  title: string;
  fileName: string;
  mimeType: "application/pdf";
  scormHref?: string;
};

export type FeedbackLink = {
  title: string;
  url: string;
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
  | { source: "none" };

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
  maxQuestions: number;
  drawCount: number;
  required: boolean;
  timeLimit: SectionTimeLimit;
  feedback: FeedbackContent;
  feedbackLinks: FeedbackLink[];
  feedbackAssets: FeedbackAsset[];
};

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
  showToLearner: boolean;
  scormTarget: ResultVariableScormTarget;
  controlsStatus: ResultVariableControlsStatus;
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
  showToLearner: boolean;
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
    webhookUrl: string;
    telemetryEnabled: boolean;
  };
  runtime: {
    timeLimitMinutes: number | null;
    maxAttempts: number | null;
    showCorrectAnswers: boolean;
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
  flowPolicyJson?: FlowPolicyPayload;
  overallPassRuleJson: OverallPassRule;
  passDecisionPolicy: PassDecisionPolicy;
  timeLimitMinutes: number | null;
  maxAttempts: number | null;
  showCorrectAnswers: boolean;
  /**
   * Test-level feedback. Sent under the `feedbackJson` key because the legacy
   * `feedback` server field is `string`-typed (zod-validated). The new structured
   * form lives in `feedbackJson` (decisions §4.3, §6.5).
   */
  feedbackJson: FeedbackPayload;
  webhookUrl: string | null;
  telemetryEnabled: boolean;
  expectedVersion: number;
  /** Only sent on create (FAB folder-pick). PUT path leaves it undefined and
   *  uses the dedicated `/api/test-folders/move/:id` endpoint instead. */
  folderId?: string | null;
};

export type TestSectionPayload = {
  topicId: string;
  drawCount: number;
  required: boolean;
  topicPassRuleJson: TopicPassRule;
  timeLimitMinutes: number | null;
  feedbackJson: FeedbackPayload;
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
