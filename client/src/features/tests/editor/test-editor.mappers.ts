/**
 * @module features/tests/editor/test-editor.mappers
 * @description Maps API responses to the editor model and editor model back to
 * API payloads.
 *
 * All regions are now fully implemented (phase 2A + 2B):
 *   - `basic`, `runtime`, `passRules` — phase 2A.
 *   - `sections` (with `required`, `timeLimit`, per-section feedback),
 *     `adaptive` (topics/levels/links, skipped for standard mode),
 *     `flowSettings` (router, skipped when `flowPolicyJson` is null) — phase 2B.
 *
 * Key rules applied (docs/prd-7-decisions.md):
 *   - §4.1  legacy `published` → `status`
 *   - §4.3  legacy `feedback: string` → `FeedbackContent`
 *   - §4.4  all missing-field defaults
 *   - §6.1  `required` sourced from `sections[]`, never from `passRules.byTopic` (FR-45)
 *   - §6.5  `scormHref` stripped from feedback assets on write
 *   - §6.8  empty `description`/`webhookUrl` normalised to `null`
 *   - FR-25h adaptive payload excluded when `mode === "standard"`
 */
import type { DrawBlueprint, EligibilityPluginRef, FormSet, RetakePolicy } from "@shared/schema";
import { formSetSchema } from "@shared/schema";
import type {
  AdaptiveLevelConfig,
  AdaptiveLinkConfig,
  AdaptiveSettingsPayload,
  AdaptiveTopicConfig,
  EditorSection,
  FeedbackAsset,
  FeedbackContent,
  FeedbackEvent,
  FeedbackFormat,
  FeedbackLink,
  FeedbackPayload,
  FlowMode,
  FlowPolicyPayload,
  FlowRouterSettings,
  FlowSettings,
  OverallPassRule,
  OverallPassType,
  PassDecisionPolicy,
  PassRules,
  ResultVariableModel,
  ScaleBandModel,
  ScaleModel,
  QuestionMeasurementModel,
  MeasurementSourceType,
  RouterCompletionPolicy,
  SectionTimeLimit,
  TestEditorModel,
  TestMode,
  TestSectionPayload,
  TestSettingsPayload,
  TestStatus,
  TopicPassRule,
} from "./test-editor.types";
import { makeQuestionOverride, type QuestionScoringOverride } from "./scoring-api";

// ─── API response shape ───────────────────────────────────────────────────────

/**
 * Loose shape of an API test response consumed by `apiToEditorModel`. Only
 * fields read by the mapper are typed; unknown subtrees are validated lazily.
 */
export type ApiTestResponse = {
  id?: string | null;
  version?: number | null;
  title?: string | null;
  description?: string | null;
  mode?: string | null;
  status?: string | null;
  published?: boolean | null;
  showDifficultyLevel?: boolean | null;
  overallPassRuleJson?: unknown;
  passDecisionPolicy?: string | null;
  webhookUrl?: string | null;
  feedback?: string | null;
  feedbackJson?: unknown;
  flowPolicyJson?: unknown;
  telemetryEnabled?: boolean | null;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  showCorrectAnswers?: boolean | null;
  // PRD-19 (Блок A)
  allowReturnToUnanswered?: boolean | null;
  allowAnswerChange?: boolean | null;
  showSectionResults?: boolean | null;
  startPageContent?: string | null;
  folderId?: string | null;
  sections?: unknown[];
  adaptiveSettings?: unknown;
  retakePolicyJson?: unknown;
  /** PRD-15 block D (FR-31): test-wide default price; null = system (1). */
  defaultQuestionPoints?: number | null;
  /** PRD-15 block D (FR-30): per-(test, question) scoring overrides. */
  questionScoring?: unknown;
};

// ─── Type guards ──────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTestStatus(value: unknown): value is TestStatus {
  return value === "draft" || value === "published" || value === "archived";
}

function isTestMode(value: unknown): value is TestMode {
  return value === "standard" || value === "adaptive";
}

function isFlowMode(value: unknown): value is FlowMode {
  return (
    value === "linear_flat" ||
    value === "linear_by_topics" ||
    value === "router_by_topics"
  );
}

function isOverallPassType(value: unknown): value is OverallPassType {
  return value === "percent" || value === "absolute" || value === "none";
}

function isFeedbackFormat(value: unknown): value is FeedbackFormat {
  return value === "plain" || value === "richText" || value === "html";
}

function isPassDecisionPolicy(value: unknown): value is PassDecisionPolicy {
  return (
    value === "overall_only" ||
    value === "overall_and_required_topics" ||
    value === "required_topics_only" ||
    value === "all_topics_passed"
  );
}

function isRouterCompletionPolicy(value: unknown): value is RouterCompletionPolicy {
  return value === "all_required_completed" || value === "all_required_passed";
}

// ─── Shared feedback helpers ──────────────────────────────────────────────────

/**
 * Parse a `feedback_json`-shaped object into the three editor model fields.
 * Returns the §4.4 empty default when the input is not a plain object.
 */
function parseFeedbackObject(raw: unknown): {
  content: FeedbackContent;
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  events: FeedbackEvent[];
} {
  if (isPlainObject(raw)) {
    const format: FeedbackFormat = isFeedbackFormat(raw.format) ? raw.format : "plain";
    const text = typeof raw.text === "string" ? raw.text : "";
    const links = Array.isArray(raw.links) ? (raw.links as FeedbackLink[]) : [];
    const assets = Array.isArray(raw.assets) ? (raw.assets as FeedbackAsset[]) : [];
    const events = Array.isArray(raw.events) ? (raw.events as FeedbackEvent[]) : [];
    return { content: { format, text }, links, assets, events };
  }
  return { content: { format: "plain", text: "" }, links: [], assets: [], events: [] };
}

/**
 * Build test-level feedback from the API response. Handles the legacy
 * `feedback: string` form (decisions §4.3) and the new `feedbackJson` form
 * (decisions §3.4). Missing `format` defaults to `"plain"` (decisions §4.4).
 */
function readFeedbackFromApi(api: ApiTestResponse): {
  content: FeedbackContent;
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  events: FeedbackEvent[];
} {
  if (isPlainObject(api.feedbackJson)) {
    return parseFeedbackObject(api.feedbackJson);
  }
  const legacyText = typeof api.feedback === "string" ? api.feedback : "";
  return {
    content: { format: "plain", text: legacyText },
    links: [],
    assets: [],
    events: [],
  };
}

// ─── Status / mode / flow mode ────────────────────────────────────────────────

/**
 * Derive `TestStatus` from API. Priority (decisions §4.1):
 *   1. `api.status` if present and valid.
 *   2. `api.published === true` → `"published"`.
 *   3. Default `"draft"`.
 */
function readStatusFromApi(api: ApiTestResponse): TestStatus {
  if (isTestStatus(api.status)) return api.status;
  if (api.published === true) return "published";
  return "draft";
}

/**
 * Read `flowMode` from `flow_policy_json.mode`. `null` or missing maps to
 * `"linear_flat"` (decisions §3.1, §7.4).
 */
function readFlowModeFromApi(api: ApiTestResponse): FlowMode {
  if (isPlainObject(api.flowPolicyJson) && isFlowMode(api.flowPolicyJson.mode)) {
    return api.flowPolicyJson.mode;
  }
  return "linear_flat";
}

// ─── Pass rules ───────────────────────────────────────────────────────────────

/**
 * Build `OverallPassRule` from API. `type: "none"` forces value to 0 per §3.2.
 * Falls back to `{ type: "percent", value: 70 }` when the column is missing.
 */
function readOverallPassRuleFromApi(api: ApiTestResponse): OverallPassRule {
  if (isPlainObject(api.overallPassRuleJson)) {
    const json = api.overallPassRuleJson;
    if (isOverallPassType(json.type)) {
      if (json.type === "none") return { type: "none", value: 0 };
      const value = typeof json.value === "number" ? json.value : 0;
      return { type: json.type, value };
    }
  }
  return { type: "percent", value: 70 };
}

/**
 * Pick `passDecisionPolicy` — explicit API value wins; otherwise derived from
 * `byTopic` contents per decisions §2.4.
 */
function readPassDecisionPolicyFromApi(
  api: ApiTestResponse,
  byTopic: PassRules["byTopic"],
): PassDecisionPolicy {
  if (isPassDecisionPolicy(api.passDecisionPolicy)) {
    return api.passDecisionPolicy;
  }
  const rules = Object.values(byTopic);
  if (rules.length === 0) return "overall_only";
  const hasCustomOrNone = rules.some(
    (r) => r.source === "custom" || r.source === "none",
  );
  return hasCustomOrNone ? "overall_and_required_topics" : "overall_only";
}

// ─── Section mapping (phase 2B) ───────────────────────────────────────────────

/**
 * Parse a `topic_pass_rule_json` value. Defaults to `inherit_overall` when
 * absent or malformed (decisions §3.3).
 */
function readTopicPassRuleFromApi(raw: unknown): TopicPassRule {
  if (isPlainObject(raw)) {
    if (raw.source === "inherit_overall") return { source: "inherit_overall" };
    if (raw.source === "none") return { source: "none" };
    // PRD-24: per-variant thresholds keyed by the stable formId. Entries that are not
    // a well-formed {type, value} pair are dropped — a malformed threshold must not
    // silently become a gate the author never set.
    if (raw.source === "by_variant" && isPlainObject(raw.byForm)) {
      const byForm: Record<string, { type: "percent" | "absolute"; value: number }> = {};
      for (const [formId, entry] of Object.entries(raw.byForm)) {
        if (!isPlainObject(entry)) continue;
        const type = entry.type;
        if (type !== "percent" && type !== "absolute") continue;
        byForm[formId] = { type, value: typeof entry.value === "number" ? entry.value : 0 };
      }
      return { source: "by_variant", byForm };
    }
    if (raw.source === "custom") {
      const type = raw.type;
      if (type === "percent" || type === "absolute") {
        const value = typeof raw.value === "number" ? raw.value : 0;
        return { source: "custom", type, value };
      }
    }
  }
  return { source: "inherit_overall" };
}

/**
 * Map `time_limit_minutes` to the editor `SectionTimeLimit` union.
 * `null`/missing → `inherit_test` (decisions §4.4); positive integer → `custom`.
 */
function readSectionTimeLimitFromApi(minutes: number | null | undefined): SectionTimeLimit {
  if (typeof minutes === "number" && minutes > 0) {
    return { source: "custom", minutes };
  }
  return { source: "inherit_test" };
}

/**
 * Read a draw blueprint (PRD-11) from the API jsonb. Returns `null` for absence
 * or any malformed shape so the editor degrades to a uniform draw (FR-02).
 */
function readDrawBlueprintFromApi(raw: unknown): DrawBlueprint | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.strata)) return null;
  const strata: DrawBlueprint["strata"] = [];
  for (const s of raw.strata) {
    if (!isPlainObject(s)) continue;
    const tag = typeof s.tag === "string" ? s.tag : "";
    const count = typeof s.count === "number" ? s.count : 0;
    if (!tag || count < 1) continue;
    const mode = s.mode === "min" ? "min" : s.mode === "exact" ? "exact" : undefined;
    strata.push(mode ? { tag, count, mode } : { tag, count });
  }
  return strata.length > 0 ? { strata } : null;
}

/**
 * Read a fixed-variant set (PRD-17) from the API jsonb. Validated with
 * `formSetSchema`; absence or any malformed shape degrades to `null` (legacy
 * draw), so a bad blob never breaks the editor.
 */
function readFormSetFromApi(raw: unknown): FormSet | null {
  if (raw == null) return null;
  const parsed = formSetSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Map editor `SectionTimeLimit` back to the DB integer.
 * Both `inherit_test` and `none` are encoded as `null`.
 */
function timeLimitToMinutes(timeLimit: SectionTimeLimit): number | null {
  if (timeLimit.source === "custom") return timeLimit.minutes;
  return null;
}

/**
 * Map the `sections` array from the API response to `EditorSection[]` and
 * simultaneously build `byTopic` pass rules for `passRules.byTopic`.
 */
function buildSectionsFromApi(src: ApiTestResponse): {
  sections: EditorSection[];
  byTopic: PassRules["byTopic"];
} {
  if (!Array.isArray(src.sections) || src.sections.length === 0) {
    return { sections: [], byTopic: {} };
  }

  const sections: EditorSection[] = [];
  const byTopic: PassRules["byTopic"] = {};

  for (const raw of src.sections) {
    if (!isPlainObject(raw)) continue;

    const topicId = typeof raw.topicId === "string" ? raw.topicId : "";
    const topicName = typeof raw.topicName === "string" ? raw.topicName : "";
    const topicCode = typeof raw.topicCode === "string" ? raw.topicCode : null;
    const maxQuestions = typeof raw.maxQuestions === "number" ? raw.maxQuestions : 0;
    // PRD-10: Σ points of the topic pool (falls back to the question count for an
    // older API response without it — points >= 1 per question, so it stays a
    // valid lower bound until the next save round-trips the real value).
    const maxPoints = typeof raw.maxPoints === "number" ? raw.maxPoints : maxQuestions;
    const drawCount = typeof raw.drawCount === "number" ? raw.drawCount : 1;
    const drawAll = typeof raw.drawAll === "boolean" ? raw.drawAll : false;
    const required = typeof raw.required === "boolean" ? raw.required : true;
    const timeLimit = readSectionTimeLimitFromApi(
      raw.timeLimitMinutes as number | null | undefined,
    );

    const fb = parseFeedbackObject(raw.feedbackJson);

    const passRule = readTopicPassRuleFromApi(raw.topicPassRuleJson);
    if (topicId) byTopic[topicId] = passRule;

    sections.push({
      topicId,
      topicName,
      topicCode,
      maxQuestions,
      maxPoints,
      drawCount,
      drawAll,
      required,
      timeLimit,
      feedback: fb.content,
      feedbackLinks: fb.links,
      feedbackAssets: fb.assets,
      feedbackEvents: fb.events,
      drawBlueprint: readDrawBlueprintFromApi(raw.drawBlueprintJson),
      // PRD-17 (BR-12): fixed-variant set (validate; invalid/absent = null).
      formSet: readFormSetFromApi(raw.formSetJson),
      // PRD-15 block D (FR-31): per-section default price (null = inherit test).
      defaultPoints: typeof raw.defaultPoints === "number" ? raw.defaultPoints : null,
    });
  }

  return { sections, byTopic };
}

// ─── Adaptive mapping (phase 2B) ──────────────────────────────────────────────

/**
 * Map `adaptiveSettings` from the API to the editor adaptive topics array.
 * Called only when `mode === "adaptive"`; skipped entirely for standard tests.
 */
function buildAdaptiveFromApi(
  src: ApiTestResponse,
): Array<AdaptiveTopicConfig & { enabled: boolean }> {
  if (!Array.isArray(src.adaptiveSettings)) return [];

  return (src.adaptiveSettings as unknown[]).flatMap((rawTopic): Array<AdaptiveTopicConfig & { enabled: boolean }> => {
    if (!isPlainObject(rawTopic)) return [];

    const levels: AdaptiveLevelConfig[] = Array.isArray(rawTopic.levels)
      ? (rawTopic.levels as unknown[]).flatMap((rawLevel): AdaptiveLevelConfig[] => {
          if (!isPlainObject(rawLevel)) return [];
          const links: AdaptiveLinkConfig[] = Array.isArray(rawLevel.links)
            ? (rawLevel.links as unknown[]).flatMap((rawLink): AdaptiveLinkConfig[] => {
                if (!isPlainObject(rawLink)) return [];
                return [
                  {
                    id: typeof rawLink.id === "string" ? rawLink.id : undefined,
                    title: typeof rawLink.title === "string" ? rawLink.title : "",
                    url: typeof rawLink.url === "string" ? rawLink.url : "",
                  },
                ];
              })
            : [];
          return [
            {
              id: typeof rawLevel.id === "string" ? rawLevel.id : undefined,
              levelIndex: typeof rawLevel.levelIndex === "number" ? rawLevel.levelIndex : 0,
              levelName: typeof rawLevel.levelName === "string" ? rawLevel.levelName : "",
              minDifficulty: typeof rawLevel.minDifficulty === "number" ? rawLevel.minDifficulty : 0,
              maxDifficulty: typeof rawLevel.maxDifficulty === "number" ? rawLevel.maxDifficulty : 100,
              questionsCount: typeof rawLevel.questionsCount === "number" ? rawLevel.questionsCount : 1,
              passThreshold: typeof rawLevel.passThreshold === "number" ? rawLevel.passThreshold : 0,
              passThresholdType: rawLevel.passThresholdType === "absolute" ? "absolute" : "percent",
              feedback: typeof rawLevel.feedback === "string" ? rawLevel.feedback : null,
              links,
            },
          ];
        })
      : [];

    return [
      {
        topicId: typeof rawTopic.topicId === "string" ? rawTopic.topicId : "",
        topicName: typeof rawTopic.topicName === "string" ? rawTopic.topicName : "",
        failureFeedback:
          typeof rawTopic.failureFeedback === "string" ? rawTopic.failureFeedback : null,
        levels,
        enabled: true,
      },
    ];
  });
}

// ─── Router flow mapping (phase 2B) ───────────────────────────────────────────

/**
 * Read a single `sectionUnlockRule` entry from the API. Defaults to
 * `"always_available"` for unknown modes (decisions §2.10).
 */
function readSectionUnlockRuleFromApi(
  raw: Record<string, unknown>,
): FlowRouterSettings["sectionUnlockRules"][string] {
  const mode = raw.mode;
  if (mode === "always_available") return { mode: "always_available" };
  if (mode === "after_sections_completed" || mode === "after_sections_passed") {
    const sectionIds = Array.isArray(raw.sectionIds)
      ? (raw.sectionIds as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    return { mode, sectionIds };
  }
  return { mode: "always_available" };
}

/**
 * Build `FlowRouterSettings` from `flow_policy_json.router`. Applies the
 * §2.9 default `completionPolicy` and §2.10 default unlock mode.
 */
function buildRouterFlowFromApi(src: ApiTestResponse): FlowRouterSettings {
  const flowPolicy = isPlainObject(src.flowPolicyJson) ? src.flowPolicyJson : {};
  const router = isPlainObject(flowPolicy.router) ? flowPolicy.router : {};

  const completionPolicy: RouterCompletionPolicy = isRouterCompletionPolicy(
    router.completionPolicy,
  )
    ? router.completionPolicy
    : "all_required_completed";

  const sectionUnlockRules: FlowRouterSettings["sectionUnlockRules"] = {};
  if (isPlainObject(router.sectionUnlockRules)) {
    for (const [id, rawRule] of Object.entries(router.sectionUnlockRules)) {
      if (isPlainObject(rawRule)) {
        sectionUnlockRules[id] = readSectionUnlockRuleFromApi(rawRule);
      }
    }
  }

  return { completionPolicy, sectionUnlockRules };
}

// ─── Flow settings builder ────────────────────────────────────────────────────

function buildFlowSettingsFromApi(flowMode: FlowMode, api: ApiTestResponse): FlowSettings {
  switch (flowMode) {
    case "linear_flat":
    case "linear_by_topics":
      return { linear: {} };
    case "router_by_topics":
      return { router: buildRouterFlowFromApi(api) };
  }
}

// ─── Shared payload helpers ───────────────────────────────────────────────────

/** Strip `scormHref` from assets — decisions §6.5. */
function stripScormHref(assets: FeedbackAsset[]): FeedbackAsset[] {
  return assets.map(({ scormHref: _scormHref, ...rest }) => rest);
}

/** Normalise empty string to `null` for nullable payload fields (decisions §6.8). */
function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}

// ─── Public entry points (phase 2A reference) ─────────────────────────────────

/**
 * Build an empty editor model for the create flow (FAB → «Новый тест»).
 *
 * The model carries:
 *   - `id: undefined` and `version: 0` — distinguishes a fresh draft from one
 *     loaded via {@link apiToEditorModel}; the save mutation branches on this.
 *   - `folderId` from the FAB folder-pick modal.
 *   - All other fields use the same defaults as PRD-7 §4.4 (apiToEditorModel
 *     reuses these via `apiToEditorModel({ id: '<new>' })` semantics).
 *
 * The model is intentionally invalid for `save()` until the author fills in
 * `basic.title` and adds at least one section (FR-11, FR-12).
 */
// ─── Result variables (PRD-2) ─────────────────────────────────────────────────

const RESULT_VAR_TYPES = new Set(["number", "string", "boolean"]);
const RESULT_VAR_TARGETS = new Set(["none", "suspend_data", "interaction", "both"]);
const RESULT_VAR_STATUS = new Set(["none", "success", "completion"]);

/**
 * Map the `resultVariables` array from the API test response into editor models,
 * ordered by `sortOrder`. Unknown enum values fall back to safe defaults so a
 * malformed row never throws the whole editor open.
 */
function buildResultVariablesFromApi(src: ApiTestResponse): ResultVariableModel[] {
  const raw = (src as { resultVariables?: unknown }).resultVariables;
  if (!Array.isArray(raw)) return [];
  const out: ResultVariableModel[] = [];
  raw.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const r = item as Record<string, unknown>;
    out.push({
      id: typeof r.id === "string" ? r.id : undefined,
      name: typeof r.name === "string" ? r.name : "",
      label: typeof r.label === "string" ? r.label : "",
      type: RESULT_VAR_TYPES.has(r.type as string)
        ? (r.type as ResultVariableModel["type"])
        : "number",
      formula: typeof r.formula === "string" ? r.formula : "",
      showToLearner: r.showToLearner === true,
      scormTarget: RESULT_VAR_TARGETS.has(r.scormTarget as string)
        ? (r.scormTarget as ResultVariableModel["scormTarget"])
        : "both",
      controlsStatus: RESULT_VAR_STATUS.has(r.controlsStatus as string)
        ? (r.controlsStatus as ResultVariableModel["controlsStatus"])
        : "none",
      sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : index,
    });
  });
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * PRD-15 block D (FR-30): read the test's per-question scoring overrides from the
 * embedded `questionScoring` array of the test detail response into the draft.
 * Built via {@link makeQuestionOverride} so the objects compare stably against
 * the snapshot in `JSON.stringify`-based dirty detection.
 */
function buildQuestionOverridesFromApi(src: ApiTestResponse): QuestionScoringOverride[] {
  const raw = src.questionScoring;
  if (!Array.isArray(raw)) return [];
  const out: QuestionScoringOverride[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.questionId !== "string") continue;
    out.push(
      makeQuestionOverride({
        id: typeof r.id === "string" ? r.id : "",
        testId: typeof r.testId === "string" ? r.testId : "",
        questionId: r.questionId,
        points: typeof r.points === "number" ? r.points : null,
        scoringJson:
          isPlainObject(r.scoringJson) || r.scoringJson === null
            ? (r.scoringJson as QuestionScoringOverride["scoringJson"])
            : null,
        difficulty: typeof r.difficulty === "number" ? r.difficulty : null,
        pinnedContentHash: typeof r.pinnedContentHash === "string" ? r.pinnedContentHash : null,
      }),
    );
  }
  return out;
}

const SCALE_TYPES = new Set(["number", "boolean", "category", "level"]);
const SCALE_AGGREGATIONS = new Set(["sum", "avg", "weighted_avg", "max", "min"]);
const SCALE_NORMALIZATIONS = new Set(["none", "percent", "custom"]);
const SCALE_DIRECTIONS = new Set(["positive", "inverse"]);
const SCALE_TARGETS = new Set(["none", "suspend_data", "interaction", "both"]);

/** Map the bands stored in a scale's `config_json` into editor band models. */
function buildScaleBands(configJson: unknown): ScaleBandModel[] {
  const bands = isPlainObject(configJson) ? (configJson as { bands?: unknown }).bands : undefined;
  if (!Array.isArray(bands)) return [];
  const out: ScaleBandModel[] = [];
  bands.forEach((b) => {
    if (!isPlainObject(b)) return;
    const band = b as Record<string, unknown>;
    out.push({
      min: typeof band.min === "number" ? String(band.min) : typeof band.min === "string" ? band.min : "",
      max: typeof band.max === "number" ? String(band.max) : typeof band.max === "string" ? band.max : "",
      label: typeof band.label === "string" ? band.label : "",
      level: typeof band.level === "string" ? band.level : "",
    });
  });
  return out;
}

/**
 * Map the `scales` array from the API test response into editor models, ordered
 * by `sortOrder`. Unknown enum values fall back to safe defaults so a malformed
 * row never throws the whole editor open. Bands live in `config_json`.
 */
function buildScalesFromApi(src: ApiTestResponse): ScaleModel[] {
  const raw = (src as { scales?: unknown }).scales;
  if (!Array.isArray(raw)) return [];
  const out: ScaleModel[] = [];
  raw.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const r = item as Record<string, unknown>;
    out.push({
      id: typeof r.id === "string" ? r.id : undefined,
      key: typeof r.key === "string" ? r.key : "",
      label: typeof r.label === "string" ? r.label : "",
      type: SCALE_TYPES.has(r.type as string) ? (r.type as ScaleModel["type"]) : "number",
      aggregation: SCALE_AGGREGATIONS.has(r.aggregation as string)
        ? (r.aggregation as ScaleModel["aggregation"])
        : "sum",
      normalization: SCALE_NORMALIZATIONS.has(r.normalization as string)
        ? (r.normalization as ScaleModel["normalization"])
        : "none",
      direction: SCALE_DIRECTIONS.has(r.direction as string)
        ? (r.direction as ScaleModel["direction"])
        : "positive",
      bands: buildScaleBands(r.configJson),
      showToLearner: r.showToLearner === true,
      scormTarget: SCALE_TARGETS.has(r.scormTarget as string)
        ? (r.scormTarget as ScaleModel["scormTarget"])
        : "none",
      sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : index,
    });
  });
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

const MEASUREMENT_SOURCE_TYPES = new Set(["question", "option", "matching_pair", "ranking_position"]);

/**
 * Map the raw `measurements` rows from the API into editor models, resolving each
 * row's `scaleId` to the stable scale `key` (the editor references scales by key,
 * never the uuid). Rows whose scale is missing are dropped. `value` comes from
 * `valueJson`. Requires the already-mapped scales for the id→key lookup.
 */
function buildMeasurementsFromApi(src: ApiTestResponse, scales: ScaleModel[]): QuestionMeasurementModel[] {
  const raw = (src as { measurements?: unknown }).measurements;
  if (!Array.isArray(raw)) return [];
  const keyById = new Map(scales.filter((s) => s.id).map((s) => [s.id as string, s.key]));
  const out: QuestionMeasurementModel[] = [];
  raw.forEach((item) => {
    if (!isPlainObject(item)) return;
    const r = item as Record<string, unknown>;
    const scaleKey = typeof r.scaleId === "string" ? keyById.get(r.scaleId) : undefined;
    if (!scaleKey) return;
    if (typeof r.questionId !== "string") return;
    if (typeof r.valueJson !== "number") return;
    out.push({
      questionId: r.questionId,
      scaleKey,
      sourceType: MEASUREMENT_SOURCE_TYPES.has(r.sourceType as string)
        ? (r.sourceType as MeasurementSourceType)
        : "question",
      sourceKey: typeof r.sourceKey === "string" ? r.sourceKey : null,
      value: r.valueJson,
      weight: typeof r.weight === "number" ? r.weight : 1,
    });
  });
  return out;
}

/** Clamp a cooldown value into the schema-valid `[1, 3650]` integer range. */
function clampCooldown(value: number): number {
  return Math.min(3650, Math.max(1, Math.round(value)));
}

/** Default (disabled) retake policy — legacy behaviour, no cooldown (PRD-6 FR-02). */
export function defaultRetakePolicy(): RetakePolicy {
  return {
    enabled: false,
    cooldownPeriodDays: 30,
    gateMode: "before_internal_start",
    eligibilityPlugin: null,
  };
}

/**
 * Normalize `tests.retake_policy_json` into the editor's {@link RetakePolicy}.
 * Tolerates the legacy `cooldownDays` alias and missing/partial fields; an
 * absent/!object value yields the disabled default (PRD-6 FR-02).
 */
function readRetakePolicyFromApi(api: ApiTestResponse): RetakePolicy {
  const raw = api.retakePolicyJson;
  if (!isPlainObject(raw)) return defaultRetakePolicy();
  const r = raw as Record<string, unknown>;

  const cooldownRaw =
    typeof r.cooldownPeriodDays === "number"
      ? r.cooldownPeriodDays
      : typeof r.cooldownDays === "number"
        ? r.cooldownDays
        : 30;

  let eligibilityPlugin: EligibilityPluginRef | null = null;
  if (isPlainObject(r.eligibilityPlugin)) {
    const p = r.eligibilityPlugin as Record<string, unknown>;
    if (typeof p.key === "string" && p.key) {
      eligibilityPlugin = {
        key: p.key,
        ...(typeof p.configId === "string" ? { configId: p.configId } : {}),
        failPolicy: p.failPolicy === "failClosed" ? "failClosed" : "failOpen",
      };
    }
  }

  return {
    enabled: r.enabled === true,
    cooldownPeriodDays: clampCooldown(cooldownRaw),
    gateMode: "before_internal_start",
    eligibilityPlugin,
    ...(typeof r.blockedPageId === "string" ? { blockedPageId: r.blockedPageId } : {}),
  };
}

export function emptyEditorModel(args: { folderId: string | null }): TestEditorModel {
  return {
    version: 0,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: args.folderId,
    basic: {
      title: "",
      description: "",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: false,
      // PRD-19 (Блок A): новый тест — возврат ВКЛ по умолчанию (FR-01).
      allowReturnToUnanswered: true,
      allowAnswerChange: false,
      showSectionResults: true,
    },
    passRules: {
      decisionPolicy: "overall_only",
      overall: { type: "percent", value: 70 },
      byTopic: {},
    },
    sections: [],
    adaptive: {
      showDifficultyLevel: true,
      testSettings: { showDifficultyLevel: true },
      topics: [],
    },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
  };
}

/**
 * Convert an API test response (legacy or new shape) into the normalized
 * editor model. Applies all defaults from decisions §4.4 and legacy mappings
 * from §4.1, §4.3. Now fully populates `sections`, `adaptive` and
 * `flowSettings` (phase 2B).
 */
export function apiToEditorModel(api: unknown): TestEditorModel {
  if (!isPlainObject(api)) {
    throw new TypeError("apiToEditorModel: expected an object response");
  }
  const src = api as ApiTestResponse;

  const status = readStatusFromApi(src);
  const mode: TestMode = isTestMode(src.mode) ? src.mode : "standard";
  let flowMode = readFlowModeFromApi(src);
  // PRD-4 v1.1 L4 legacy auto-fix: tests saved before the v1.1 contract
  // validator may carry the now-invalid `(adaptive, linear_flat)` pair.
  // Coerce them to the closest valid alternative (linear_by_topics) so the
  // editor can open such tests without immediately blocking on save-error.
  // The mapper is silent — the editor renders the corrected combo and any
  // resulting dirty state surfaces normally. If the author wants a different
  // flowMode, they can change it.
  if (mode === "adaptive" && flowMode === "linear_flat") {
    flowMode = "linear_by_topics";
  }
  const flowSettings = buildFlowSettingsFromApi(flowMode, src);
  const feedback = readFeedbackFromApi(src);
  const overall = readOverallPassRuleFromApi(src);

  const { sections, byTopic } = buildSectionsFromApi(src);
  const decisionPolicy = readPassDecisionPolicyFromApi(src, byTopic);

  const showDifficultyLevel =
    typeof src.showDifficultyLevel === "boolean" ? src.showDifficultyLevel : true;

  const adaptiveTopics = mode === "adaptive" ? buildAdaptiveFromApi(src) : [];

  // Scales must be mapped before measurements: the latter resolve scaleId→key.
  const scalesModel = buildScalesFromApi(src);

  return {
    id: typeof src.id === "string" ? src.id : undefined,
    version: typeof src.version === "number" ? src.version : 1,
    mode,
    flowMode,
    flowSettings,
    folderId: typeof src.folderId === "string" ? src.folderId : null,
    basic: {
      title: typeof src.title === "string" ? src.title : "",
      description: typeof src.description === "string" ? src.description : "",
      status,
      feedback: feedback.content,
      feedbackLinks: feedback.links,
      feedbackAssets: feedback.assets,
      feedbackEvents: feedback.events,
      webhookUrl: typeof src.webhookUrl === "string" ? src.webhookUrl : "",
      telemetryEnabled:
        typeof src.telemetryEnabled === "boolean" ? src.telemetryEnabled : false,
    },
    runtime: {
      timeLimitMinutes:
        typeof src.timeLimitMinutes === "number" ? src.timeLimitMinutes : null,
      maxAttempts: typeof src.maxAttempts === "number" ? src.maxAttempts : null,
      showCorrectAnswers:
        typeof src.showCorrectAnswers === "boolean" ? src.showCorrectAnswers : false,
      // PRD-19 (Блок A): загрузка существующего теста. Отсутствие поля (до A3) → консервативно:
      // возврат ВЫКЛ (как у существующих после миграции), итоги раздела ВКЛ.
      allowReturnToUnanswered:
        typeof src.allowReturnToUnanswered === "boolean" ? src.allowReturnToUnanswered : false,
      allowAnswerChange:
        typeof src.allowAnswerChange === "boolean" ? src.allowAnswerChange : false,
      showSectionResults:
        typeof src.showSectionResults === "boolean" ? src.showSectionResults : true,
    },
    passRules: {
      decisionPolicy,
      overall,
      byTopic,
    },
    sections,
    adaptive: {
      showDifficultyLevel,
      testSettings: { showDifficultyLevel },
      topics: adaptiveTopics,
    },
    resultVariables: buildResultVariablesFromApi(src),
    scales: scalesModel,
    measurements: buildMeasurementsFromApi(src, scalesModel),
    retakePolicy: readRetakePolicyFromApi(src),
    scoring: {
      defaultQuestionPoints:
        typeof src.defaultQuestionPoints === "number" ? src.defaultQuestionPoints : null,
      questionOverrides: buildQuestionOverridesFromApi(src),
    },
  };
}

/**
 * Build the `TestSettingsPayload` from the editor model (test-level fields
 * only). Per-section and adaptive payloads are produced by the separate
 * exported helpers `mapEditorSectionsToPayload` and `mapEditorAdaptiveToPayload`.
 *
 * Rules applied (decisions §6):
 *   - writes `status`, never `published` (§6.2);
 *   - omits `flowPolicyJson` for `linear_flat` (§3.1, §6.3);
 *   - normalises empty `description`/`webhookUrl` to `null` (§6.8);
 *   - strips `scormHref` from feedback assets (§6.5);
 *   - copies `expectedVersion` from model snapshot (§6.6).
 */
export function editorModelToPayload(model: TestEditorModel): TestSettingsPayload {
  const flowPolicyJson = buildFlowPolicyForPayload(model);

  const feedbackJson: FeedbackPayload = {
    format: model.basic.feedback.format,
    text: model.basic.feedback.text,
    links: model.basic.feedbackLinks,
    assets: stripScormHref(model.basic.feedbackAssets),
    events: model.basic.feedbackEvents,
  };

  const payload: TestSettingsPayload = {
    title: model.basic.title,
    description: emptyToNull(model.basic.description),
    status: model.basic.status,
    mode: model.mode,
    flowMode: model.flowMode,
    overallPassRuleJson: model.passRules.overall,
    passDecisionPolicy: model.passRules.decisionPolicy,
    timeLimitMinutes: model.runtime.timeLimitMinutes,
    maxAttempts: model.runtime.maxAttempts,
    showCorrectAnswers: model.runtime.showCorrectAnswers,
    allowReturnToUnanswered: model.runtime.allowReturnToUnanswered,
    allowAnswerChange: model.runtime.allowAnswerChange,
    showSectionResults: model.runtime.showSectionResults,
    feedbackJson,
    webhookUrl: emptyToNull(model.basic.webhookUrl),
    telemetryEnabled: model.basic.telemetryEnabled,
    // PRD-6 FR-02: a disabled policy persists as `null` so the export stays
    // byte-identical to legacy tests (the gate is omitted from the package).
    retakePolicyJson: model.retakePolicy.enabled ? model.retakePolicy : null,
    // PRD-15 block D (FR-31): test-wide default price (null = system default).
    // Defensive `?.` — drafts persisted before block D have no scoring slice.
    defaultQuestionPoints: model.scoring?.defaultQuestionPoints ?? null,
    expectedVersion: model.version,
    folderId: model.folderId,
  };

  if (flowPolicyJson !== undefined) {
    payload.flowPolicyJson = flowPolicyJson;
  }
  return payload;
}

// ─── Exported phase-2B helpers ────────────────────────────────────────────────

/**
 * PRD-24: change a topic's variant set and keep its per-variant pass rule in step,
 * in ONE model update so the two can never be observed out of sync.
 *
 * - variant added → seed a threshold for it (from an existing entry, else from the
 *   test's overall rule) — an uncovered variant is a blocking validation error;
 * - variant removed → drop its entry, so no orphan threshold blocks the save;
 * - variants mode switched off → the rule falls back to «Как у теста», since
 *   `by_variant` is meaningless without a variant set.
 *
 * Rules with any other source are left untouched.
 */
export function applyFormSetChange(
  model: TestEditorModel,
  topicId: string,
  formSet: FormSet | null,
): TestEditorModel {
  const sections = model.sections.map((s) => (s.topicId === topicId ? { ...s, formSet } : s));
  const rule = model.passRules.byTopic[topicId];
  if (rule?.source !== "by_variant") {
    return { ...model, sections };
  }

  const forms = formSet?.forms ?? [];
  let nextRule: TopicPassRule;
  if (!formSet) {
    // Variants mode switched off — the rule has nothing left to key on.
    // NB: a set that merely dropped below two variants is an intermediate editing
    // state (validation already flags it), so the authored thresholds are KEPT
    // rather than silently discarded.
    nextRule = { source: "inherit_overall" };
  } else {
    const seed =
      Object.values(rule.byForm)[0] ??
      (model.passRules.overall.type === "percent"
        ? { type: "percent" as const, value: model.passRules.overall.value }
        : { type: "percent" as const, value: 70 });
    const byForm: Record<string, { type: "percent" | "absolute"; value: number }> = {};
    for (const form of forms) byForm[form.id] = rule.byForm[form.id] ?? seed;
    nextRule = { source: "by_variant", byForm };
  }

  return {
    ...model,
    sections,
    passRules: {
      ...model.passRules,
      byTopic: { ...model.passRules.byTopic, [topicId]: nextRule },
    },
  };
}

/**
 * Build `TestSectionPayload[]` from the editor model.
 *
 * FR-45 / decisions §6.1: `required` is taken from `sections[].required`, not
 * from `passRules.byTopic`. `topicPassRuleJson` comes from `passRules.byTopic`
 * and defaults to `inherit_overall` when the topic has no explicit rule.
 */
export function mapEditorSectionsToPayload(model: TestEditorModel): TestSectionPayload[] {
  return model.sections.map((section): TestSectionPayload => {
    const topicPassRuleJson: TopicPassRule =
      model.passRules.byTopic[section.topicId] ?? { source: "inherit_overall" };

    const feedbackJson: FeedbackPayload = {
      format: section.feedback.format,
      text: section.feedback.text,
      links: section.feedbackLinks,
      assets: stripScormHref(section.feedbackAssets),
      events: section.feedbackEvents,
    };

    // PRD-11: send the blueprint only when it has at least one stratum; an empty
    // list collapses to null = uniform draw (FR-02) and avoids the empty-strata
    // schema rejection.
    const drawBlueprintJson =
      section.drawBlueprint && section.drawBlueprint.strata.length > 0
        ? section.drawBlueprint
        : null;

    return {
      topicId: section.topicId,
      drawCount: section.drawCount,
      drawAll: section.drawAll,
      required: section.required,
      topicPassRuleJson,
      timeLimitMinutes: timeLimitToMinutes(section.timeLimit),
      feedbackJson,
      drawBlueprintJson,
      // PRD-17 (BR-12): fixed-variant set (null = legacy draw).
      formSetJson: section.formSet ?? null,
      // PRD-15 block D (FR-31): per-section default price.
      defaultPoints: section.defaultPoints ?? null,
    };
  });
}

/**
 * Build `AdaptiveSettingsPayload` from the editor model.
 *
 * FR-25h / decisions §6.4: returns `null` for `mode === "standard"` so that
 * hidden draft adaptive settings are never written to the API when they are
 * incompatible with the active mode.
 */
export function mapEditorAdaptiveToPayload(
  model: TestEditorModel,
): AdaptiveSettingsPayload | null {
  if (model.mode !== "adaptive") return null;

  const topics = model.adaptive.topics
    .filter((t) => t.enabled)
    .map(({ enabled: _enabled, ...rest }): AdaptiveTopicConfig => rest);

  return {
    showDifficultyLevel: model.adaptive.showDifficultyLevel,
    testSettings: model.adaptive.testSettings,
    topics,
  };
}

/**
 * Build `FlowRouterSettings` from `model.flowSettings.router` for inclusion in
 * `flowPolicyJson` on the write path. Applies the §2.9 default when the model
 * has no router sub-object (e.g. a freshly initialised router_by_topics draft).
 */
export function mapEditorRouterFlowToPayload(model: TestEditorModel): FlowRouterSettings {
  const router = model.flowSettings.router;
  if (!router) {
    return { completionPolicy: "all_required_completed", sectionUnlockRules: {} };
  }
  return {
    completionPolicy: router.completionPolicy,
    sectionUnlockRules: router.sectionUnlockRules,
  };
}

/**
 * Convenience re-export: map API response to `EditorSection[]` only (no
 * `byTopic`). Use `apiToEditorModel` when the full model is needed.
 */
export function mapApiSectionsToEditor(api: ApiTestResponse): EditorSection[] {
  return buildSectionsFromApi(api).sections;
}

/**
 * Convenience re-export: map API response to adaptive topics array only.
 * Use `apiToEditorModel` when the full model is needed.
 */
export function mapApiAdaptiveTopicsToEditor(
  api: ApiTestResponse,
): Array<AdaptiveTopicConfig & { enabled: boolean }> {
  return buildAdaptiveFromApi(api);
}

/**
 * Convenience re-export: map API response to `FlowRouterSettings` only.
 * Use `apiToEditorModel` when the full model is needed.
 */
export function mapApiRouterFlowToEditor(api: ApiTestResponse): FlowRouterSettings {
  return buildRouterFlowFromApi(api);
}

// ─── Internal: flow policy payload builder ────────────────────────────────────

function buildFlowPolicyForPayload(model: TestEditorModel): FlowPolicyPayload | undefined {
  if (model.flowMode === "linear_flat") return undefined;
  if (model.flowMode === "router_by_topics") {
    return {
      mode: "router_by_topics",
      router: mapEditorRouterFlowToPayload(model),
    };
  }
  return { mode: model.flowMode, router: null };
}
