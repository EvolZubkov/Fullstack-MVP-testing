import type { Test, TestSection, Topic, Question, TopicCourse, TopicEvent, PassRule, AdaptiveTopicSettings, AdaptiveLevel, AdaptiveLevelLink, ContentPage } from "@shared/schema";
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

  const test: any = {
    id: data.test.id,
    title: data.test.title,
    description: data.test.description,
    mode: data.test.mode || "standard",
    showDifficultyLevel: data.test.showDifficultyLevel ?? true,
    overallPassRule: overallPassRule,
    webhookUrl: data.test.webhookUrl,
    testFeedback: data.test.feedback || null,
    timeLimitMinutes: data.test.timeLimitMinutes || null,
    maxAttempts: data.test.maxAttempts || null,
    showCorrectAnswers: data.test.showCorrectAnswers || false,
    startPageContent: data.test.startPageContent || null,
    passPercent: passPercent,
    totalQuestions: totalQuestions,
    sections: data.sections.map((s) => ({
      topicId: s.topic.id,
      topicName: s.topic.name,
      drawCount: s.drawCount,
      topicPassRule: (s.topicPassRuleJson as PassRule | null) ?? null,
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
        templateKey: page.templateKey,
        sortOrder: page.sortOrder,
        values: sanitizedValues,
        placeholderStyles: rawValues.placeholderStyles ?? {},
        autoAdvance: page.autoAdvance,
        autoAdvanceDelayMs: page.autoAdvanceDelayMs,
      };
    });
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
