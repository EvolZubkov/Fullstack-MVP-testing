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

  // PRD-11 FR-05: when a draw blueprint is set, the quota sum must not exceed
  // drawCount (quotas are slices inside the topic's sample). Mirrors the server
  // section-body refine so the save is blocked client-side with a clear message.
  for (let i = 0; i < model.sections.length; i++) {
    const section = model.sections[i];
    const bp = section.drawBlueprint;
    if (bp && bp.strata.length > 0) {
      const sum = bp.strata.reduce((acc, s) => acc + (s.count || 0), 0);
      if (sum > section.drawCount) {
        errors.push({
          field: `sections[${i}].drawBlueprintJson`,
          code: "range",
          message: `Сумма квот (${sum}) для темы «${section.topicName}» превышает «Вопросов в тест» (${section.drawCount}).`,
          severity: "error",
        });
      }
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

  // PRD-4 v1.1 §3.1.2: (adaptive, linear_flat) is not supported in MVP —
  // deferred to a future «Flat adaptive» PRD that adds a global difficulty
  // scale without topic-binding. Block at validation level so neither save
  // nor publish succeeds with this combination.
  if (model.mode === "adaptive" && model.flowMode === "linear_flat") {
    errors.push({
      field: "flowMode",
      code: "adaptive_flat_unsupported",
      message:
        "Адаптивный режим в плоском сценарии (linear_flat) пока не поддерживается. " +
        "Выберите «Линейный по темам» или «Через страницу-маршрутизатор».",
      severity: "error",
    });
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

  // PRD-4 v1.1 §3.1.2 strict gating: in adaptive mode every section must have
  // a corresponding topic with at least one configured level. Mixed mode
  // («одни темы adaptive, другие standard») is explicitly forbidden by the
  // PRD-4 contract (clarified 2026-05-28). Stricter than FR-17b: not a
  // warning, blocks save.
  if (model.mode === "adaptive") {
    for (let i = 0; i < model.sections.length; i++) {
      const section = model.sections[i];
      const topicIdx = model.adaptive.topics.findIndex((t) => t.topicId === section.topicId);
      const topic = topicIdx >= 0 ? model.adaptive.topics[topicIdx] : undefined;
      if (!topic || topic.levels.length === 0) {
        errors.push({
          field:
            topicIdx >= 0
              ? `adaptive.topics[${topicIdx}].levels`
              : `sections[${i}]`,
          code: "adaptive_section_no_levels",
          message: `Тема «${section.topicName}» в адаптивном режиме обязана иметь хотя бы один уровень сложности.`,
          severity: "error",
        });
      } else if (topic.levels.length < 2) {
        // FR-17b retained as a warning: 1 level technically valid for strict
        // gating but the UX prompt encourages the author to add a second one
        // so the adaptive flow has somewhere to scale to/from.
        warnings.push({
          field: `adaptive.topics[${topicIdx}].levels`,
          code: "missing_levels",
          message: `Topic "${section.topicName}" has only one adaptive level; at least two are recommended.`,
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

  validateResultVariables(model, errors);
  validateScales(model, errors);

  return { errors, warnings };
}

/** Result-variable name grammar (PRD-2 §8.1): lower snake_case, ≤64 chars. */
const RESULT_VAR_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Synchronous structural checks for result variables (PRD-2). Deep formula
 * validity is enforced server-side by the create/update endpoints (422) and
 * surfaced live via the validate-formula call in the section; here we cover the
 * checks the editor can make from the draft alone: name grammar/uniqueness,
 * required label/formula, and the `controls_status` rules (boolean-only, at most
 * one success / one completion controller per test).
 */
function validateResultVariables(
  model: TestEditorModel,
  errors: ValidationIssue[],
): void {
  const vars = model.resultVariables ?? [];
  const seenNames = new Map<string, number>();
  let successCount = 0;
  let completionCount = 0;

  vars.forEach((v, i) => {
    if (!v.name.trim()) {
      errors.push({
        field: `resultVariables[${i}].name`,
        code: "required",
        message: "Укажите имя показателя.",
        severity: "error",
      });
    } else if (!RESULT_VAR_NAME_RE.test(v.name)) {
      errors.push({
        field: `resultVariables[${i}].name`,
        code: "format",
        message: "Имя: строчная буква в начале; буквы/цифры/подчёркивание; до 64 символов.",
        severity: "error",
      });
    } else {
      const prev = seenNames.get(v.name);
      if (prev !== undefined) {
        errors.push({
          field: `resultVariables[${i}].name`,
          code: "duplicate",
          message: `Имя «${v.name}» уже используется другим показателем.`,
          severity: "error",
        });
      } else {
        seenNames.set(v.name, i);
      }
    }

    if (!v.label.trim()) {
      errors.push({
        field: `resultVariables[${i}].label`,
        code: "required",
        message: "Укажите метку показателя.",
        severity: "error",
      });
    }

    if (!v.formula.trim()) {
      errors.push({
        field: `resultVariables[${i}].formula`,
        code: "required",
        message: "Формула не может быть пустой.",
        severity: "error",
      });
    }

    if (v.controlsStatus !== "none" && v.type !== "boolean") {
      errors.push({
        field: `resultVariables[${i}].controlsStatus`,
        code: "type_mismatch",
        message:
          "Управление статусом доступно только для показателей типа «булево». " +
          "Измените тип или сбросьте в «Нет».",
        severity: "error",
      });
    }

    if (v.controlsStatus === "success") successCount += 1;
    if (v.controlsStatus === "completion") completionCount += 1;
  });

  vars.forEach((v, i) => {
    if (v.controlsStatus === "success" && successCount > 1) {
      errors.push({
        field: `resultVariables[${i}].controlsStatus`,
        code: "duplicate_controller",
        message: "Только один показатель может управлять статусом «Успех».",
        severity: "error",
      });
    }
    if (v.controlsStatus === "completion" && completionCount > 1) {
      errors.push({
        field: `resultVariables[${i}].controlsStatus`,
        code: "duplicate_controller",
        message: "Только один показатель может управлять статусом «Завершение».",
        severity: "error",
      });
    }
  });
}

/** Scale key grammar (PRD-5 §9.1): lower snake_case, ≤64 chars. */
const SCALE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Synchronous structural checks for scales (PRD-5). The checks the editor can
 * make from the draft alone: key grammar/uniqueness, required label, and the
 * interpretation bands' numeric validity, ordering and non-overlap (§5.3 — bands
 * are entered ascending on raw and must not overlap). Coverage (a scale with no
 * contributions) is a soft warning surfaced in the section, not a save blocker.
 */
function validateScales(model: TestEditorModel, errors: ValidationIssue[]): void {
  const scales = model.scales ?? [];
  const seenKeys = new Map<string, number>();

  scales.forEach((s, i) => {
    if (!s.key.trim()) {
      errors.push({
        field: `scales[${i}].key`,
        code: "required",
        message: "Укажите ключ шкалы.",
        severity: "error",
      });
    } else if (!SCALE_KEY_RE.test(s.key)) {
      errors.push({
        field: `scales[${i}].key`,
        code: "format",
        message: "Ключ: строчная буква в начале; буквы/цифры/подчёркивание; до 64 символов.",
        severity: "error",
      });
    } else {
      const prev = seenKeys.get(s.key);
      if (prev !== undefined) {
        errors.push({
          field: `scales[${i}].key`,
          code: "duplicate",
          message: `Ключ «${s.key}» уже используется другой шкалой.`,
          severity: "error",
        });
      } else {
        seenKeys.set(s.key, i);
      }
    }

    if (!s.label.trim()) {
      errors.push({
        field: `scales[${i}].label`,
        code: "required",
        message: "Укажите метку шкалы.",
        severity: "error",
      });
    }

    // Bands: each row must be numeric with min ≤ max; rows must be ascending and
    // non-overlapping on raw. A trailing fully-empty row (the "new" row) is
    // ignored so the author can leave it blank.
    let prevMax: number | null = null;
    s.bands.forEach((band, j) => {
      const minRaw = band.min.trim();
      const maxRaw = band.max.trim();
      if (minRaw === "" && maxRaw === "" && band.label.trim() === "" && band.level.trim() === "") {
        return; // empty draft row
      }
      const min = Number(minRaw);
      const max = Number(maxRaw);
      if (minRaw === "" || maxRaw === "" || Number.isNaN(min) || Number.isNaN(max)) {
        errors.push({
          field: `scales[${i}].bands[${j}]`,
          code: "band_number",
          message: `Диапазон ${j + 1}: укажите числовые min и max.`,
          severity: "error",
        });
        return;
      }
      if (min > max) {
        errors.push({
          field: `scales[${i}].bands[${j}]`,
          code: "band_order",
          message: `Диапазон ${j + 1}: min не может быть больше max.`,
          severity: "error",
        });
      }
      if (prevMax !== null && min <= prevMax) {
        errors.push({
          field: `scales[${i}].bands[${j}]`,
          code: "band_overlap",
          message: `Диапазон ${j + 1}: пересекается с предыдущим. Вводите по возрастанию raw без пересечений.`,
          severity: "error",
        });
      }
      prevMax = max;
    });
  });
}
