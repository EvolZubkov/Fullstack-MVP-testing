import type { Test, TestSection, Topic, Question, TopicCourse, TopicEvent, PassRule, AdaptiveTopicSettings, AdaptiveLevel, AdaptiveLevelLink, ContentPage, ResultVariable, Scale, QuestionMeasurement } from "@shared/schema";
import { sanitizeHtml } from "../../utils/html-sanitizer";

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
}

interface ExportData {
  test: Test;
  sections: (TestSection & { topic: Topic; questions: Question[]; courses: TopicCourse[]; events: TopicEvent[] })[];
  adaptiveSettings?: AdaptiveSettingsExport | null;
  contentPages?: ContentPage[];
  resultVariables?: ResultVariable[];
  scales?: Scale[];
  measurements?: QuestionMeasurement[];
  designSettings?: DesignSettingsExport;
  // Telemetry config
  telemetry?: {
    enabled: boolean;
    packageId: string;
    secretKey: string;
    apiBaseUrl: string;
  } | null;
}

export function buildTestJson(data: ExportData): string {
  const totalQuestions = data.sections.reduce((sum, s) => sum + s.drawCount, 0);
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
    // PRD-7 S10: legacy `start_page_content` is no longer exported into TEST_DATA.
    // Its content is migrated to a `content_pages` 'intro' row (migration 003 §4.2)
    // and rendered by the content-flow runtime; the DB column is kept write-only
    // for legacy clients (decisions §1, S10 §3.3).
    passPercent: passPercent,
    totalQuestions: totalQuestions,
    sections: data.sections.map((s) => ({
      topicId: s.topic.id,
      topicName: s.topic.name,
      drawCount: s.drawCount,
      // PRD-4 v1.1 §4.7: `required` drives routerCompletionPolicy's
      // «all_required_*» calculation; `false` means optional (the test can
      // finish even if this section is skipped/incomplete).
      required: s.required ?? true,
      // PRD-4 v1.1 §3.2 / §4.6 per-section time limit (Phase 4e).
      // null = inherit_test (section uses the test-wide timer, no extra timer);
      // number = custom limit in minutes (section timer starts on entry).
      timeLimitMinutes: s.timeLimitMinutes ?? null,
      topicPassRule: (s.topicPassRuleJson as PassRule | null) ?? null,
      // PRD-11: stratified-draw blueprint. Included only when set so packages
      // without quotas stay byte-identical (FR-02); runtime reads section.drawBlueprint.
      ...(s.drawBlueprintJson ? { drawBlueprint: s.drawBlueprintJson } : {}),
      topicFeedback: s.topic.feedback || null,
      recommendedCourses: s.courses.map((c) => ({ title: c.title, url: c.url })),
      recommendedEvents: s.events.map((e) => ({ title: e.title })),
      questions: s.questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        data: q.dataJson,
        correct: q.correctJson,
        points: q.points || 1,
        difficulty: q.difficulty || 50,
        mediaUrl: q.mediaUrl || null,
        mediaType: q.mediaType || null,
        feedback: q.feedback || null,
        feedbackMode: q.feedbackMode || "general",
        feedbackCorrect: q.feedbackCorrect || null,
        feedbackIncorrect: q.feedbackIncorrect || null,
        // PRD-10: graded answer scoring. Included only when set so packages for
        // unscored questions stay byte-identical (FR-02); runtime reads q.scoring.
        ...(q.scoringJson ? { scoring: q.scoringJson } : {}),
        // PRD-11: sub-topic tags drive the stratified draw (drawSection matches a
        // stratum tag against q.tags). Included only when non-empty so packages
        // for untagged questions stay byte-identical (FR-02); the draw blueprint
        // is useless without them.
        ...(Array.isArray(q.tags) && q.tags.length ? { tags: q.tags } : {}),
      })),
    })),
  };

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
        // Include all questions for this topic (they will be filtered by difficulty in runtime)
        questions: s.questions.map((q) => ({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          data: q.dataJson,
          correct: q.correctJson,
          points: q.points || 1,
          difficulty: q.difficulty || 50,
          mediaUrl: q.mediaUrl || null,
          mediaType: q.mediaType || null,
          feedback: q.feedback || null,
          feedbackMode: q.feedbackMode || "general",
          feedbackCorrect: q.feedbackCorrect || null,
          feedbackIncorrect: q.feedbackIncorrect || null,
          // PRD-10: graded answer scoring (see standard-section map above).
          ...(q.scoringJson ? { scoring: q.scoringJson } : {}),
        })),
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
    };
  }

  // Add content pages (re-sanitize richText/html values before packaging)
  if (data.contentPages && data.contentPages.length > 0) {
    test.contentPages = data.contentPages.map((page) => {
      const rawValues = (page.valuesJson as { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> }) ?? {};
      const values = rawValues.values ?? {};
      // Re-sanitize all string values that may contain HTML
      const sanitizedValues: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        sanitizedValues[k] = typeof v === "string" ? sanitizeHtml(v) : v;
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
      label: rv.label,
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
        label: s.label,
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
