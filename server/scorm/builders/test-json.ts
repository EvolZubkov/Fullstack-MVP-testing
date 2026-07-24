import type { Test, TestSection, Topic, Question, TopicCourse, TopicEvent, PassRule, AdaptiveTopicSettings, AdaptiveLevel, AdaptiveLevelLink, ContentPage, ResultVariable, Scale, QuestionMeasurement, RetakePolicy, TestQuestionScoring } from "@shared/schema";
import { sanitizeHtml, placeholderScope } from "../../utils/html-sanitizer";
import { findEligibilityPlugin, findEligibilityConfig } from "@shared/eligibility/registry";
import { resolveAnswerCommitScope } from "@shared/flow/answer-commit-scope";
import { buildTestScoringContext, type TestScoringContext } from "../../services/effective-scoring";

interface AdaptiveLevelWithLinks extends AdaptiveLevel {
  links: AdaptiveLevelLink[];
}

interface AdaptiveSettingsExport {
  topicSettings: AdaptiveTopicSettings[];
  levels: AdaptiveLevelWithLinks[];
}

interface DesignSettingsExport {
  templateId: string;
  templateVersion?: string;
  templateApiVersion?: string;
  params: Record<string, unknown>;
  /** PRD-23: palette the author pinned (`light`/`dark`/`auto`). */
  theme?: string;
  /** PRD-23: colour overrides per declared palette. */
  paramsByTheme?: Record<string, Record<string, unknown>>;
  /**
   * System variant kinds (`start`/`results`) the active template does NOT declare
   * in its `contentTemplates`, so the runtime must render them from the bundled
   * `default` template (PRD-7 G21). Set by the exporter when it bundles the
   * `template-default/` files; absent/empty means no fallback.
   */
  /**
   * LAYOUT KEYS of the system screens the active template does not declare; the
   * runtime renders these from the bundled `default` template (PRD-1 §4.3.2,
   * PRD-3 NFR-05/NFR-06). Layout keys, not variant kinds — that is what
   * `systemLayout()` looks up.
   */
  fallbackLayoutKeys?: string[];
}

interface ExportData {
  test: Test;
  sections: (TestSection & { topic: Topic; questions: Question[]; courses: TopicCourse[]; events: TopicEvent[] })[];
  /**
   * PRD-15 block D (FR-32): per-(test, question) scoring overrides. The bake
   * resolves the EFFECTIVE price / graded config / difficulty per question and
   * writes the resolved values into TEST_DATA, so the in-package runtime keeps
   * reading plain `q.points`/`q.scoring`/`q.difficulty` from the baked JSON
   * (not a DB column — unaffected by the T-40 column drop). Absent/empty = the
   * chain falls through to the section/test defaults and the system default.
   */
  questionScoring?: TestQuestionScoring[];
  adaptiveSettings?: AdaptiveSettingsExport | null;
  contentPages?: ContentPage[];
  resultVariables?: ResultVariable[];
  scales?: Scale[];
  measurements?: QuestionMeasurement[];
  designSettings?: DesignSettingsExport;
  /**
   * Already-resolved on-disk directory of the selected template (built-in or
   * uploaded PRD-3), provided by the route via `resolveTemplateDir`. When absent
   * the exporter falls back to the built-in convention `server/scorm/templates/<id>`.
   */
  templateDir?: string;
  // Telemetry config
  telemetry?: {
    enabled: boolean;
    packageId: string;
    secretKey: string;
    apiBaseUrl: string;
  } | null;
}

export function buildTestJson(data: ExportData): string {
  const testMode = data.test.mode || "standard";
  // PRD-15 block D (FR-32): one resolution context for the whole bake. With no
  // overrides and no defaults the chain returns the legacy question values, so
  // packages of untouched tests stay byte-identical.
  const scoringCtx: TestScoringContext = buildTestScoringContext(
    data.test,
    data.sections,
    data.questionScoring ?? [],
  );
  /** Bake one question's effective scoring into the TEST_DATA shape. */
  const bakeScoring = (q: Question): { points: number; difficulty: number; scoring?: unknown } => {
    const eff = scoringCtx.resolve(q);
    return {
      points: eff.points,
      // `|| 50` keeps the historical coercion of the SCORM bake (FR-02).
      difficulty: scoringCtx.difficultyOf(q) || 50,
      // PRD-10: included only when authored (override or legacy) so packages
      // for unscored questions stay byte-identical (FR-02).
      ...(eff.source.scoring !== "system" ? { scoring: eff.scoring } : {}),
    };
  };
  // Effective per-topic draw count. `drawAll` (or adaptive mode, which always
  // feeds the whole pool to the level engine) means "draw every question the
  // topic currently has" — resolved dynamically here, not from the stored
  // drawCount, so adding questions after save still draws all of them.
  const effectiveDraw = (
    s: ExportData["sections"][number],
  ): number => (testMode === "adaptive" || s.drawAll ? s.questions.length : s.drawCount);

  const totalQuestions = data.sections.reduce((sum, s) => sum + effectiveDraw(s), 0);
  const overallPassRule = data.test.overallPassRuleJson as PassRule;

  const passPercent =
    overallPassRule.type === "percent"
      ? overallPassRule.value
      : totalQuestions > 0
        ? Math.round((overallPassRule.value / totalQuestions) * 100)
        : 80;

  // PRD-4 v1.1: export `flowPolicy` so the runtime can switch traversal
  // strategy (legacy_flat / linear_by_topics / router_by_topics) and apply
  // router-specific gating (routerCompletionPolicy, sectionUnlockRules).
  // Missing flowPolicyJson defaults to `{ mode: "linear_flat" }` per FR-40
  // to keep legacy SCORMs identical to pre-v1.1 behaviour.
  const flowPolicyJson = data.test.flowPolicyJson as {
    mode?: string;
    routerCompletionPolicy?: string;
    sectionUnlockRules?: Record<string, unknown>;
  } | null;
  const exportedFlowPolicy: {
    mode: "linear_flat" | "linear_by_topics" | "router_by_topics";
    routerCompletionPolicy?: "all_required_completed" | "all_required_passed";
    sectionUnlockRules?: Record<string, unknown>;
  } = {
    mode:
      flowPolicyJson?.mode === "linear_by_topics" ||
      flowPolicyJson?.mode === "router_by_topics"
        ? flowPolicyJson.mode
        : "linear_flat",
  };
  // PRD-4 v1.1 §4.7: router-specific fields are only meaningful in router
  // mode. Default routerCompletionPolicy to all_required_completed (the
  // softer rule — counts any achievedLevel as «pass» for navigation).
  if (exportedFlowPolicy.mode === "router_by_topics") {
    exportedFlowPolicy.routerCompletionPolicy =
      flowPolicyJson?.routerCompletionPolicy === "all_required_passed"
        ? "all_required_passed"
        : "all_required_completed";
    if (flowPolicyJson?.sectionUnlockRules) {
      exportedFlowPolicy.sectionUnlockRules = flowPolicyJson.sectionUnlockRules;
    }
  }

  const test: any = {
    id: data.test.id,
    title: data.test.title,
    description: data.test.description,
    mode: data.test.mode || "standard",
    flowPolicy: exportedFlowPolicy,
    showDifficultyLevel: data.test.showDifficultyLevel ?? true,
    overallPassRule: overallPassRule,
    webhookUrl: data.test.webhookUrl,
    testFeedback: data.test.feedback || null,
    timeLimitMinutes: data.test.timeLimitMinutes || null,
    maxAttempts: data.test.maxAttempts || null,
    showCorrectAnswers: data.test.showCorrectAnswers || false,
    // PRD-19 (Блок A): правила навигации/завершения для рантайма (применение — Блок B/C/D).
    allowReturnToUnanswered: data.test.allowReturnToUnanswered ?? true,
    allowAnswerChange: data.test.allowAnswerChange ?? false,
    showSectionResults: data.test.showSectionResults ?? true,
    // PRD-19 (Блок B): единый резолв гранулярности фиксации ответа — оба хоста
    // читают готовое значение (без повторного вывода из flowMode), что
    // исключает дрейф skip/return/freeze между SCORM и вебом.
    answerCommitScope: resolveAnswerCommitScope({
      mode: data.test.mode,
      flowMode: exportedFlowPolicy.mode,
    }),
    // PRD-7 S10: legacy `start_page_content` is no longer exported into TEST_DATA.
    // Its content is migrated to a `content_pages` 'intro' row (migration 003 §4.2)
    // and rendered by the content-flow runtime; the DB column is kept write-only
    // for legacy clients (decisions §1, S10 §3.3).
    passPercent: passPercent,
    totalQuestions: totalQuestions,
    sections: data.sections.map((s) => ({
      topicId: s.topic.id,
      topicName: s.topic.name,
      // PRD-1 §4.3: topic description (from topic properties) — rendered on the
      // «Введение раздела» (section-intro) screen. null/empty → no description block.
      topicDescription: s.topic.description ?? null,
      // Author-defined readable id (slug) for `topicById("<code>")`; null → UUID.
      topicCode: s.topic.code ?? null,
      drawCount: effectiveDraw(s),
      // PRD-4 v1.1 §4.7: `required` drives routerCompletionPolicy's
      // «all_required_*» calculation; `false` means optional (the test can
      // finish even if this section is skipped/incomplete).
      required: s.required ?? true,
      // PRD-4 v1.1 §3.2 / §4.6 per-section time limit (Phase 4e).
      // null = inherit_test (section uses the test-wide timer, no extra timer);
      // number = custom limit in minutes (section timer starts on entry).
      timeLimitMinutes: s.timeLimitMinutes ?? null,
      // PRD-24: the rule may now be `{source:'by_variant', byForm}` as well, so it is
      // baked as authored — the runtime resolves it through the shared engine.
      topicPassRule: (s.topicPassRuleJson as unknown) ?? null,
      // PRD-11: stratified-draw blueprint. Included only when set so packages
      // without quotas stay byte-identical (FR-02); runtime reads section.drawBlueprint.
      ...(s.drawBlueprintJson ? { drawBlueprint: s.drawBlueprintJson } : {}),
      // PRD-17 (BR-12): fixed-variant set. Included only when present so packages
      // without variants stay byte-identical (FR-02); the runtime (selectForm in
      // app.js) picks one variant and delivers it whole, overriding the uniform/
      // stratified draw. SCORM has no cross-attempt store (NFR-17) so rotation
      // degrades to a random pick (R-6). The whole bank ships (every variant's
      // questions+keys, R-7) — selection happens client-side.
      ...(s.formSetJson ? { formSet: s.formSetJson } : {}),
      topicFeedback: s.topic.feedback || null,
      recommendedCourses: s.courses.map((c) => ({ title: c.title, url: c.url })),
      recommendedEvents: s.events.map((e) => ({ title: e.title })),
      questions: s.questions.map((q) => {
        // PRD-15 block D: effective price / graded config / difficulty are
        // resolved here, at bake time; the runtime keeps its plain reads.
        const baked = bakeScoring(q);
        return {
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          data: q.dataJson,
          correct: q.correctJson,
          points: baked.points,
          difficulty: baked.difficulty,
          mediaUrl: q.mediaUrl || null,
          mediaType: q.mediaType || null,
          feedback: q.feedback || null,
          feedbackMode: q.feedbackMode || "general",
          feedbackCorrect: q.feedbackCorrect || null,
          feedbackIncorrect: q.feedbackIncorrect || null,
          // PRD-10: graded answer scoring. Included only when authored so packages
          // for unscored questions stay byte-identical (FR-02); runtime reads q.scoring.
          ...(baked.scoring ? { scoring: baked.scoring } : {}),
          // PRD-11: sub-topic tags drive the stratified draw (drawSection matches a
          // stratum tag against q.tags). Included only when non-empty so packages
          // for untagged questions stay byte-identical (FR-02); the draw blueprint
          // is useless without them.
          ...(Array.isArray(q.tags) && q.tags.length ? { tags: q.tags } : {}),
        };
      }),
    })),
  };

  // PRD-6: retake gate policy + resolved plugin runtime/config. Included only
  // when enabled with a plugin so unpolicied packages stay byte-identical (FR-02);
  // the runtime gate (RetakeGate) reads test.retakePolicy + test.retakePlugin.
  const rp = data.test.retakePolicyJson as RetakePolicy | null | undefined;
  if (rp && rp.enabled && rp.eligibilityPlugin?.key) {
    const plugin = findEligibilityPlugin(rp.eligibilityPlugin.key);
    if (plugin) {
      const cfg = findEligibilityConfig(rp.eligibilityPlugin.key, rp.eligibilityPlugin.configId);
      test.retakePolicy = {
        enabled: true,
        cooldownPeriodDays: rp.cooldownPeriodDays,
        gateMode: rp.gateMode,
        eligibilityPlugin: rp.eligibilityPlugin,
        blockedPageId: rp.blockedPageId ?? null,
      };
      test.retakePlugin = {
        key: plugin.key,
        runtimeEntry: plugin.runtimeEntry,
        bestEffort: plugin.bestEffort,
        config: cfg?.config ?? {},
      };
    }
  }

  // Add adaptive settings if present
  if (data.test.mode === "adaptive" && data.adaptiveSettings) {
    const { topicSettings, levels } = data.adaptiveSettings;

    // Group levels by topicId
    const levelsByTopic: Record<string, any[]> = {};
    for (const level of levels) {
      if (!levelsByTopic[level.topicId]) {
        levelsByTopic[level.topicId] = [];
      }
      levelsByTopic[level.topicId].push({
        levelIndex: level.levelIndex,
        levelName: level.levelName,
        minDifficulty: level.minDifficulty,
        maxDifficulty: level.maxDifficulty,
        questionsCount: level.questionsCount,
        passThreshold: level.passThreshold,
        passThresholdType: level.passThresholdType,
        feedback: level.feedback || null,
        links: level.links.map((l) => ({ title: l.title, url: l.url })),
      });
    }

    // Sort levels by levelIndex within each topic
    for (const topicId of Object.keys(levelsByTopic)) {
      levelsByTopic[topicId].sort((a, b) => a.levelIndex - b.levelIndex);
    }

    // Create adaptive topics array
    test.adaptiveTopics = data.sections.map((s) => {
      const topicSetting = topicSettings.find((ts) => ts.topicId === s.topic.id);
      return {
        topicId: s.topic.id,
        topicName: s.topic.name,
        failureFeedback: topicSetting?.failureFeedback || null,
        levels: levelsByTopic[s.topic.id] || [],
        // Include all questions for this topic (they will be filtered by difficulty
        // in runtime — against the baked EFFECTIVE difficulty, FR-34).
        questions: s.questions.map((q) => {
          const baked = bakeScoring(q);
          return {
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            data: q.dataJson,
            correct: q.correctJson,
            points: baked.points,
            difficulty: baked.difficulty,
            mediaUrl: q.mediaUrl || null,
            mediaType: q.mediaType || null,
            feedback: q.feedback || null,
            feedbackMode: q.feedbackMode || "general",
            feedbackCorrect: q.feedbackCorrect || null,
            feedbackIncorrect: q.feedbackIncorrect || null,
            // PRD-10: graded answer scoring (see standard-section map above).
            ...(baked.scoring ? { scoring: baked.scoring } : {}),
          };
        }),
      };
    });
  }
  // Add design settings (template selection + params)
  if (data.designSettings) {
    test.designSettings = {
      templateId: data.designSettings.templateId,
      templateVersion: data.designSettings.templateVersion,
      templateApiVersion: data.designSettings.templateApiVersion,
      params: data.designSettings.params,
      // PRD-23: omitted for a template without themes, so a themeless package keeps
      // exactly the TEST_DATA shape it had before.
      ...(data.designSettings.theme ? { theme: data.designSettings.theme } : {}),
      ...(data.designSettings.paramsByTheme
        ? { paramsByTheme: data.designSettings.paramsByTheme }
        : {}),
      ...(data.designSettings.fallbackLayoutKeys && data.designSettings.fallbackLayoutKeys.length > 0
        ? { fallbackLayoutKeys: data.designSettings.fallbackLayoutKeys }
        : {}),
    };
  }

  // Add content pages (re-sanitize richText/html values before packaging)
  if (data.contentPages && data.contentPages.length > 0) {
    test.contentPages = data.contentPages.map((page) => {
      const rawValues = (page.valuesJson as { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> }) ?? {};
      const values = rawValues.values ?? {};
      // Re-sanitize all string values that may contain HTML. Author CSS is also
      // confined to the placeholder region it renders into: inside the package the
      // markup lands in the REAL document, where a pasted `body { … }` rule would
      // restyle the whole player (a fixed-stage template collapses to a blank
      // screen). Re-scoping on every build also repairs pages saved before the fix;
      // it is idempotent, so already-scoped values pass through unchanged.
      const sanitizedValues: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        sanitizedValues[k] = typeof v === "string" ? sanitizeHtml(v, { scope: placeholderScope(k) }) : v;
      }
      // PRD-22 FR-30: page SETTINGS travel with the page. Without this the LMS
      // package loses the sequence identifier (no navigation dots) and the media
      // packer never sees the background image, leaving a dead link to /uploads.
      const rawSettings = (page.settingsJson ?? {}) as Record<string, unknown>;
      const sanitizedSettings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawSettings)) {
        sanitizedSettings[k] = typeof v === "string" ? sanitizeHtml(v) : v;
      }

      return {
        id: page.id,
        topicId: page.topicId,
        position: page.position,
        mode: page.mode,
        type: page.type,
        // PRD-4 v1.1 / PRD-1 §4.3: `kind` is the new variant-kind dimension
        // (intro/info/summary/router/questions). Runtime distinguishes router
        // pages from regular content pages by `kind === "router"` (Phase 4c).
        // Legacy `type` is kept for backward compat.
        kind: page.kind,
        templateKey: page.templateKey,
        sortOrder: page.sortOrder,
        values: sanitizedValues,
        placeholderStyles: rawValues.placeholderStyles ?? {},
        settings: sanitizedSettings,
        autoAdvance: page.autoAdvance,
        autoAdvanceDelayMs: page.autoAdvanceDelayMs,
      };
    });
  }

  // PRD-2: user-defined result variables, ordered by sort_order. The runtime
  // (resultsPage.js) evaluates `formula` via FormulaDSL after standard scoring
  // and publishes result.*; `controlsStatus` may override pass/completion.
  if (data.resultVariables && data.resultVariables.length > 0) {
    test.resultVariables = data.resultVariables.map((rv) => ({
      id: rv.id,
      name: rv.name,
      // Label is optional; fall back to the name so the package never shows blank.
      label: rv.label.trim() ? rv.label : rv.name,
      type: rv.type,
      formula: rv.formula,
      showToLearner: rv.showToLearner,
      scormTarget: rv.scormTarget,
      controlsStatus: rv.controlsStatus,
      sortOrder: rv.sortOrder,
    }));
  }

  // PRD-5 (B5): measurement scales + per-question contributions. The runtime
  // (scales/engine.js) computes scale.* before result.* at completion; the
  // interpretation `bands` live in config_json. Measurements are flattened to the
  // engine's MeasurementSpec shape with scaleId resolved to the stable scale key
  // — the runtime never sees uuids. Gate on scales: rows without a scale are
  // meaningless, and a scale with no rows is still valid (empty aggregate).
  if (data.scales && data.scales.length > 0) {
    test.scales = data.scales.map((s) => {
      const config = (s.configJson as { bands?: unknown }) ?? {};
      return {
        key: s.key,
        // Label is optional; fall back to the key so the package never shows blank.
        label: s.label.trim() ? s.label : s.key,
        type: s.type,
        aggregation: s.aggregation,
        normalization: s.normalization,
        direction: s.direction,
        bands: Array.isArray(config.bands) ? config.bands : [],
        showToLearner: s.showToLearner,
        scormTarget: s.scormTarget,
        sortOrder: s.sortOrder,
      };
    });

    const scaleKeyById = new Map(data.scales.map((s) => [s.id, s.key]));
    test.measurements = (data.measurements ?? [])
      .map((m) => {
        const scaleKey = scaleKeyById.get(m.scaleId);
        // Orphan row (scale was deleted but cascade missed it): skip silently.
        if (!scaleKey) return null;
        return {
          questionId: m.questionId,
          scaleKey,
          sourceType: m.sourceType,
          sourceKey: m.sourceKey ?? null,
          value: m.valueJson,
          weight: m.weight ?? 1,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }

  // Add telemetry config if present
  if (data.telemetry && data.telemetry.enabled) {
    test.telemetry = {
      enabled: true,
      packageId: data.telemetry.packageId,
      secretKey: data.telemetry.secretKey,
      apiBaseUrl: data.telemetry.apiBaseUrl,
    };
  }

  return JSON.stringify(test, null, 2);
}

export type { ExportData };
