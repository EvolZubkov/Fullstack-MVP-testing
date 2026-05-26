/**
 * @module features/tests/editor/test-editor.validation
 * @description Validation rules for the test editor model. Returns a
 * structured result with errors and warnings; errors block save while
 * warnings do not (decisions §8.2).
 *
 * Covered: FR-11 (title required), FR-12 (min one section), FR-13 (drawCount
 * range), FR-14 (percent range), FR-15* (absolute pass rules), FR-15a (valid
 * policy), FR-15g (forbidden combination), FR-16 (adaptive difficulty range),
 * FR-17 (adaptive questions count), FR-18 (adaptive pass threshold), FR-19
 * (adaptive link completeness), FR-20 (webhook URL format).
 */
import type {
  AdaptiveLevelConfig,
  AdaptiveTopicConfig,
  EditorSection,
  PassDecisionPolicy,
  TestEditorModel,
  TopicPassRule,
  ValidationIssue,
  ValidationResult,
} from "./test-editor.types";

const VALID_PASS_DECISION_POLICIES: PassDecisionPolicy[] = [
  "overall_only",
  "overall_and_required_topics",
  "required_topics_only",
  "all_topics_passed",
];

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Calculate total questions across all sections (sum of drawCount). */
function getTotalQuestionsCount(sections: EditorSection[]): number {
  return sections.reduce((sum, section) => sum + section.drawCount, 0);
}

/** Get section by topic ID; returns undefined if not found. */
function getSectionByTopicId(sections: EditorSection[], topicId: string): EditorSection | undefined {
  return sections.find((s) => s.topicId === topicId);
}

/**
 * Validate the entire editor model. Each issue carries a stable `code` and
 * targets a `field` path that the UI uses to anchor inline errors.
 *
 * @param model - Normalized editor model to validate.
 * @returns Object with `errors` (block save) and `warnings` (non-blocking).
 */
export function validateTestEditor(model: TestEditorModel): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // FR-11: title is required
  if (model.basic.title.trim() === "") {
    errors.push({
      field: "basic.title",
      code: "required",
      message: "Test title is required.",
      severity: "error",
    });
  }

  // FR-12: at least one section (topic) must be added
  if (model.sections.length === 0) {
    errors.push({
      field: "sections",
      code: "required",
      message: "At least one topic section is required.",
      severity: "error",
    });
  }

  // FR-14: overall percent pass value must be in [0, 100]
  if (
    model.passRules.overall.type === "percent" &&
    (model.passRules.overall.value < 0 || model.passRules.overall.value > 100)
  ) {
    errors.push({
      field: "passRules.overall.value",
      code: "range",
      message: "Overall pass threshold must be between 0 and 100 for percent type.",
      severity: "error",
    });
  }

  // FR-15a: passDecisionPolicy must be a known enum value
  if (!VALID_PASS_DECISION_POLICIES.includes(model.passRules.decisionPolicy)) {
    errors.push({
      field: "passRules.decisionPolicy",
      code: "required",
      message: "Pass decision policy is missing or invalid.",
      severity: "error",
    });
  }

  // FR-15g: all_topics_passed + inherit_overall + overall.type=none is forbidden
  if (
    model.passRules.decisionPolicy === "all_topics_passed" &&
    model.passRules.overall.type === "none" &&
    Object.values(model.passRules.byTopic).some((r) => r.source === "inherit_overall")
  ) {
    errors.push({
      field: "passRules.decisionPolicy",
      code: "forbidden_combination",
      message:
        'Cannot use "all_topics_passed" when overall pass type is "none" and any topic inherits the overall rule.',
      severity: "error",
    });
  }

  // FR-20: webhook URL must be a valid HTTP/HTTPS URL when provided
  if (model.basic.webhookUrl !== "" && !isValidHttpUrl(model.basic.webhookUrl)) {
    errors.push({
      field: "basic.webhookUrl",
      code: "invalid_url",
      message: "Webhook URL must be a valid HTTP or HTTPS URL.",
      severity: "error",
    });
  }

  // FR-13: drawCount must be between 1 and maxQuestions for each section
  for (let i = 0; i < model.sections.length; i++) {
    const section = model.sections[i];
    if (section.drawCount < 1 || section.drawCount > section.maxQuestions) {
      errors.push({
        field: `sections[${i}].drawCount`,
        code: "range",
        message: `Draw count for topic "${section.topicName}" must be between 1 and ${section.maxQuestions}.`,
        severity: "error",
      });
    }
  }

  // FR-15c-f: absolute pass rules must not exceed available questions
  const totalQuestions = getTotalQuestionsCount(model.sections);
  if (
    model.passRules.overall.type === "absolute" &&
    model.passRules.overall.value > totalQuestions
  ) {
    errors.push({
      field: "passRules.overall.value",
      code: "range",
      message: `Overall absolute pass threshold (${model.passRules.overall.value}) cannot exceed total questions (${totalQuestions}).`,
      severity: "error",
    });
  }

  for (const [topicId, rule] of Object.entries(model.passRules.byTopic)) {
    if (rule.source === "custom" && rule.type === "absolute") {
      const section = getSectionByTopicId(model.sections, topicId);
      if (section && rule.value > section.drawCount) {
        errors.push({
          field: `passRules.byTopic[${topicId}].value`,
          code: "range",
          message: `Topic absolute pass threshold (${rule.value}) cannot exceed draw count (${section.drawCount}).`,
          severity: "error",
        });
      }
    }
  }

  // FR-17a: adaptive mode requires at least one enabled topic — stop-factor.
  if (model.mode === "adaptive" && model.sections.length > 0) {
    const hasEnabledTopic = model.adaptive.topics.some((t) => t.enabled);
    if (!hasEnabledTopic) {
      errors.push({
        field: "adaptive.topics",
        code: "no_enabled_topics",
        message: "Adaptive mode requires at least one enabled topic.",
        severity: "error",
      });
    }
  }

  // FR-17b: in adaptive mode every ENABLED section-topic should have >= 2 levels.
  // Disabled topics are excluded from test logic so missing levels are not an issue.
  if (model.mode === "adaptive") {
    for (let i = 0; i < model.sections.length; i++) {
      const section = model.sections[i];
      const topicIdx = model.adaptive.topics.findIndex((t) => t.topicId === section.topicId);
      const topic = topicIdx >= 0 ? model.adaptive.topics[topicIdx] : undefined;
      if (!topic?.enabled) continue;
      if (topic.levels.length < 2) {
        warnings.push({
          field: `adaptive.topics[${topicIdx}].levels`,
          code: "missing_levels",
          message: topic.levels.length === 1
            ? `Topic "${section.topicName}" has only one adaptive level; at least two are recommended.`
            : `Topic "${section.topicName}" has no adaptive levels configured.`,
          severity: "warning",
        });
      }
    }
  }

  // FR-16: adaptive level difficulty range must be valid
  for (let i = 0; i < model.adaptive.topics.length; i++) {
    const topic = model.adaptive.topics[i];
    for (let j = 0; j < topic.levels.length; j++) {
      const level = topic.levels[j];
      if (level.minDifficulty >= level.maxDifficulty) {
        errors.push({
          field: `adaptive.topics[${i}].levels[${j}].minDifficulty`,
          code: "range",
          message: `Minimum difficulty must be less than maximum difficulty.`,
          severity: "error",
        });
      }
      if (level.minDifficulty < 0 || level.minDifficulty > 100) {
        errors.push({
          field: `adaptive.topics[${i}].levels[${j}].minDifficulty`,
          code: "range",
          message: `Minimum difficulty must be between 0 and 100.`,
          severity: "error",
        });
      }
      if (level.maxDifficulty < 0 || level.maxDifficulty > 100) {
        errors.push({
          field: `adaptive.topics[${i}].levels[${j}].maxDifficulty`,
          code: "range",
          message: `Maximum difficulty must be between 0 and 100.`,
          severity: "error",
        });
      }
    }
  }

  // FR-17: adaptive level questions count must be >= 1
  for (let i = 0; i < model.adaptive.topics.length; i++) {
    const topic = model.adaptive.topics[i];
    for (let j = 0; j < topic.levels.length; j++) {
      const level = topic.levels[j];
      if (level.questionsCount < 1) {
        errors.push({
          field: `adaptive.topics[${i}].levels[${j}].questionsCount`,
          code: "range",
          message: `Questions count must be at least 1.`,
          severity: "error",
        });
      }
    }
  }

  // FR-18: adaptive level pass threshold must be valid for its type
  for (let i = 0; i < model.adaptive.topics.length; i++) {
    const topic = model.adaptive.topics[i];
    for (let j = 0; j < topic.levels.length; j++) {
      const level = topic.levels[j];
      if (level.passThresholdType === "percent") {
        if (level.passThreshold < 0 || level.passThreshold > 100) {
          errors.push({
            field: `adaptive.topics[${i}].levels[${j}].passThreshold`,
            code: "range",
            message: `Pass threshold for percent type must be between 0 and 100.`,
            severity: "error",
          });
        }
      } else if (level.passThresholdType === "absolute") {
        if (level.passThreshold < 0 || level.passThreshold > level.questionsCount) {
          errors.push({
            field: `adaptive.topics[${i}].levels[${j}].passThreshold`,
            code: "range",
            message: `Pass threshold for absolute type must be between 0 and ${level.questionsCount}.`,
            severity: "error",
          });
        }
      }
    }
  }

  // FR-19: adaptive link must have both title and URL, or neither
  for (let i = 0; i < model.adaptive.topics.length; i++) {
    const topic = model.adaptive.topics[i];
    for (let j = 0; j < topic.levels.length; j++) {
      const level = topic.levels[j];
      for (let k = 0; k < level.links.length; k++) {
        const link = level.links[k];
        const hasTitle = link.title && link.title.trim() !== "";
        const hasUrl = link.url && link.url.trim() !== "";
        if (hasTitle !== hasUrl) {
          errors.push({
            field: `adaptive.topics[${i}].levels[${j}].links[${k}]`,
            code: "required",
            message: "Link must have both title and URL, or neither.",
            severity: "error",
          });
        }
      }
    }
  }

  return { errors, warnings };
}
