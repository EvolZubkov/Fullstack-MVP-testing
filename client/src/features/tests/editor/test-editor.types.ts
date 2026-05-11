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
  | "mixed"
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
  mixed?: Record<string, never>;
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
  feedback: FeedbackPayload;
  webhookUrl: string | null;
  telemetryEnabled: boolean;
  expectedVersion: number;
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
