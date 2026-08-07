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
import {
  sectionDrawsAll,
  type AdaptiveLevelConfig,
  type AdaptiveTopicConfig,
  type EditorSection,
  type PassDecisionPolicy,
  type TestEditorModel,
  type TopicPassRule,
  type ValidationIssue,
  type ValidationResult,
} from "./test-editor.types";
import { resolveEffectiveScoring } from "@shared/scoring/effective-scoring";
import { normalizeTag, TAG_MAX_LENGTH } from "@shared/tags";

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

/**
 * A section's maximum attainable points (Σ question points). PRD-10: an absolute
 * pass threshold is compared against earned POINTS at runtime (graded scoring),
 * so it is bounded by this, not by the question count. Falls back to the question
 * count when the pool's points are unknown (points >= 1 per question, so the count
 * is a safe lower bound — see {@link EditorSection.maxPoints}).
 */
function getSectionMaxPoints(section: EditorSection): number {
  return section.maxPoints ?? section.maxQuestions;
}

/**
 * PRD-24: points attainable in ONE variant — Σ of the effective price of its
 * questions. Price is a property of the TEST (PRD-15 block D, T-40), so it resolves
 * through the same chain the «Оценка» tab renders: per-question override → section
 * default → test default → system default. Every link lives in the editor model, so
 * this is exact, not an estimate (the question count would be a lower bound only).
 */
function getVariantMaxPoints(
  model: TestEditorModel,
  section: EditorSection,
  form: { questionIds: string[] },
): number {
  const overrideByQuestion = new Map(
    model.scoring.questionOverrides.map((o) => [o.questionId, o]),
  );
  return form.questionIds.reduce((sum, questionId) => {
    const override = overrideByQuestion.get(questionId);
    const effective = resolveEffectiveScoring({
      override: override
        ? {
            points: override.points,
            scoring: override.scoringJson,
            difficulty: override.difficulty,
            pinnedContentHash: override.pinnedContentHash,
          }
        : null,
      defaults: {
        sectionDefaultPoints: section.defaultPoints,
        testDefaultPoints: model.scoring.defaultQuestionPoints,
      },
    });
    return sum + effective.points;
  }, 0);
}

/** Total attainable points across all sections (Σ of {@link getSectionMaxPoints}). */
function getTotalMaxPoints(sections: EditorSection[]): number {
  return sections.reduce((sum, section) => sum + getSectionMaxPoints(section), 0);
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

  // FR-13: drawCount must be between 1 and maxQuestions for each section.
  // Skipped when the topic draws its whole pool (manual "all" or adaptive mode),
  // where drawCount is unused — the count is the full pool / per-level questionsCount.
  for (let i = 0; i < model.sections.length; i++) {
    const section = model.sections[i];
    if (sectionDrawsAll(section.drawAll, model.mode)) continue;
    // PRD-17: variants mode hides the draw-count control (the variant is delivered
    // whole), so drawCount is not validated for it.
    if (model.mode !== "adaptive" && section.formSet != null) continue;
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
    if (sectionDrawsAll(section.drawAll, model.mode)) continue; // quotas moot when drawing all
    if (model.mode !== "adaptive" && section.formSet != null) continue; // variants mode hides quotas
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
      // PRD-11: mirror the server drawStratumSchema byte-for-byte so an empty /
      // over-long tag (or a bad count) is BLOCKED here with a clear message instead
      // of surfacing as a raw HTTP 400 only after the author hits «Сохранить».
      for (let j = 0; j < bp.strata.length; j++) {
        const stratum = bp.strata[j];
        const tag = normalizeTag(stratum.tag ?? "");
        if (tag.length < 1 || tag.length > TAG_MAX_LENGTH) {
          errors.push({
            field: `sections[${i}].drawBlueprintJson`,
            code: "range",
            message: `Квота №${j + 1} темы «${section.topicName}»: укажите тег (1–${TAG_MAX_LENGTH} символов).`,
            severity: "error",
          });
        }
        if (!Number.isInteger(stratum.count) || stratum.count < 1) {
          errors.push({
            field: `sections[${i}].drawBlueprintJson`,
            code: "range",
            message: `Квота №${j + 1} темы «${section.topicName}»: количество должно быть целым ≥ 1.`,
            severity: "error",
          });
        }
      }
    }
  }

  // PRD-17 (BR-12): a section in variants mode needs >= 2 variants, each with at
  // least one question (the variant is delivered whole). Adaptive ignores variants
  // (the editor hides them), so they are not validated there.
  for (let i = 0; i < model.sections.length; i++) {
    const section = model.sections[i];
    if (model.mode === "adaptive" || section.formSet == null) continue;
    const forms = section.formSet.forms;
    if (forms.length < 2) {
      errors.push({
        field: `sections[${i}].formSetJson`,
        code: "range",
        message: `Тема «${section.topicName}»: нужно не менее 2 вариантов теста.`,
        severity: "error",
      });
    } else {
      const empty = forms.filter((f) => f.questionIds.length === 0).length;
      if (empty > 0) {
        errors.push({
          field: `sections[${i}].formSetJson`,
          code: "range",
          message: `Тема «${section.topicName}»: ${empty} вариант(а/ов) без вопросов — добавьте вопросы или удалите вариант.`,
          severity: "error",
        });
      }
    }
  }

  // FR-15c-f: absolute pass thresholds must not exceed the attainable POINTS.
  // PRD-10: graded scoring makes earned points (not the question count) the basis
  // of an absolute pass, so a points threshold may legitimately exceed the number
  // of questions (e.g. matching = 3 points). It is bounded by Σ question points.
  const totalMaxPoints = getTotalMaxPoints(model.sections);
  if (
    model.passRules.overall.type === "absolute" &&
    model.passRules.overall.value > totalMaxPoints
  ) {
    errors.push({
      field: "passRules.overall.value",
      code: "range",
      message: `Overall absolute pass threshold (${model.passRules.overall.value}) cannot exceed total points (${totalMaxPoints}).`,
      severity: "error",
    });
  }

  // PRD-24: a per-variant rule is only meaningful for a topic in variants mode, must
  // cover every variant (an uncovered one would silently fall back to the overall rule
  // at runtime), and its absolute thresholds are capped by the points attainable in
  // THAT variant — resolved through the same effective-price chain the «Оценка» tab uses.
  for (const [topicId, rule] of Object.entries(model.passRules.byTopic)) {
    if (rule.source !== "by_variant") continue;
    const section = getSectionByTopicId(model.sections, topicId);
    const forms = section?.formSet?.forms ?? [];
    if (!section || forms.length < 2) {
      errors.push({
        field: `passRules.byTopic[${topicId}]`,
        code: "forbidden_combination",
        message: `Правило «По вариантам» доступно только теме в режиме вариантов (не менее 2 вариантов).`,
        severity: "error",
      });
      continue;
    }
    const formIds = new Set(forms.map((f) => f.id));
    for (const form of forms) {
      if (!rule.byForm[form.id]) {
        errors.push({
          field: `passRules.byTopic[${topicId}].byForm[${form.id}].value`,
          code: "required",
          message: `Задайте порог для варианта «${form.label}».`,
          severity: "error",
        });
      }
    }
    for (const [formId, entry] of Object.entries(rule.byForm)) {
      const form = forms.find((f) => f.id === formId);
      if (!form) {
        errors.push({
          field: `passRules.byTopic[${topicId}].byForm[${formId}].value`,
          code: "forbidden_combination",
          message: `Порог ссылается на вариант, которого нет в теме.`,
          severity: "error",
        });
        continue;
      }
      if (entry.type === "percent" && (entry.value < 0 || entry.value > 100)) {
        errors.push({
          field: `passRules.byTopic[${topicId}].byForm[${formId}].value`,
          code: "range",
          message: `Порог варианта «${form.label}» в процентах должен быть от 0 до 100.`,
          severity: "error",
        });
      }
      if (entry.type === "absolute") {
        const maxPoints = getVariantMaxPoints(model, section, form);
        if (entry.value > maxPoints) {
          errors.push({
            field: `passRules.byTopic[${topicId}].byForm[${formId}].value`,
            code: "range",
            message: `Порог варианта «${form.label}» (${entry.value}) не может превышать максимум баллов варианта (${maxPoints}).`,
            severity: "error",
          });
        }
      }
    }
  }

  for (const [topicId, rule] of Object.entries(model.passRules.byTopic)) {
    if (rule.source === "custom" && rule.type === "absolute") {
      const section = getSectionByTopicId(model.sections, topicId);
      if (section) {
        // A draw is a subset of the pool, so the pool's max points is a safe
        // upper bound on any attempt's earned points for this section.
        const maxPoints = getSectionMaxPoints(section);
        if (rule.value > maxPoints) {
          errors.push({
            field: `passRules.byTopic[${topicId}].value`,
            code: "range",
            message: `Topic absolute pass threshold (${rule.value}) cannot exceed topic max points (${maxPoints}).`,
            severity: "error",
          });
        }
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

    // Label is OPTIONAL (parity with scales): an empty label is not an error;
    // consumers fall back to the name for display (see scorm test-json bake).

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
 * make from the draft alone: key grammar/uniqueness and the interpretation bands'
 * numeric validity, ordering and non-overlap (§5.3 — bands are entered ascending
 * on raw and must not overlap). The label is OPTIONAL (per the approved wireframe —
 * no required marker): an empty label is not an error; consumers fall back to the
 * key for display (see scorm test-json bake). Coverage (a scale with no
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

    // Label is optional (empty -> key shown). Не валидируем.

    // Bands: each row must be numeric with min ≤ max, and rows must ascend on raw.
    // Touching neighbours are legal (see the overlap check below). A trailing
    // fully-empty row (the "new" row) is ignored so the author can leave it blank.
    // A band IS a level to the author — PRD-45 retired «диапазон», `min` and `max`
    // from the UI — so these messages speak the levels editor's vocabulary and
    // repeat the ordering sentence `draftErrors` shows inside the card verbatim.
    // The save gate and the card must not describe one fault two ways.
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
          message: `Уровень ${j + 1}: границы заданы не полностью — укажите числа во всех полях.`,
          severity: "error",
        });
        return;
      }
      if (min > max) {
        errors.push({
          field: `scales[${i}].bands[${j}]`,
          code: "band_order",
          message: `Уровень ${j + 1}: нижняя граница больше верхней. Числа в ряду «Начало — пороги — Конец» должны идти по возрастанию.`,
          severity: "error",
        });
      }
      // PRD-45: the levels editor writes touching boundaries by construction
      // (`bands[i].max === bands[i + 1].min`), and `findBand` resolves the shared
      // point to the LOWER band. Only a real overlap is an error now.
      if (prevMax !== null && min < prevMax) {
        errors.push({
          field: `scales[${i}].bands[${j}]`,
          code: "band_overlap",
          message: `Уровень ${j + 1}: перекрывает предыдущий. Числа в ряду «Начало — пороги — Конец» должны идти по возрастанию.`,
          severity: "error",
        });
      }
      prevMax = max;
    });
  });
}
