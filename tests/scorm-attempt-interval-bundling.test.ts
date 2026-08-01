/**
 * @module tests/scorm-attempt-interval-bundling
 *
 * PRD-31 (FR-14 / §5.4): what the package carries per barrier. The bundling
 * condition splits, and getting it wrong is invisible until a live run:
 *
 *   - barrier A (cooldown) still bakes the policy AND the resolved plugin — the
 *     pre-Initialize gate reads both, and `RetakeGate.isGated` keys off them;
 *   - barrier B (hour interval) bakes the policy WITHOUT a plugin, because it is
 *     decided after Initialize from suspend_data. An interval-only test must not
 *     look gated, or the gate would fire with no plugin to consult;
 *   - a test with NEITHER barrier carries neither field, so its package stays
 *     byte-identical to what it has always been.
 *
 * Exercised through the pure `buildTestJson` rather than a full package build: the
 * full build writes `uploads/scorm/identifiers.json`, a file shared across
 * concurrently running suites.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson, type ExportData } from "../server/scorm/builders/test-json";
import type { RetakePolicy } from "../shared/schema";

const TOPIC_ID = "interval-topic";

function question(id: string) {
  return {
    id,
    topicId: TOPIC_ID,
    type: "single",
    prompt: `Q ${id}`,
    dataJson: { options: ["A", "B"] },
    correctJson: { correctIndex: 0 },
    difficulty: 50,
    mediaUrl: null,
    mediaType: null,
    feedback: null,
    feedbackMode: "general",
    feedbackCorrect: null,
    feedbackIncorrect: null,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function bake(retakePolicyJson: RetakePolicy | null) {
  const topic = {
    id: TOPIC_ID, name: "Тема", description: "", feedback: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const data = {
    test: {
      id: "t1", title: "Тест", description: "", mode: "standard",
      showDifficultyLevel: true, overallPassRuleJson: { type: "percent", value: 70 },
      webhookUrl: null, feedback: null, timeLimitMinutes: null, maxAttempts: 3,
      showCorrectAnswers: true, startPageContent: null, published: true, status: "published",
      folderId: null, designSettingsJson: { templateId: "default", params: {} },
      retakePolicyJson,
      createdAt: new Date(), updatedAt: new Date(),
    },
    sections: [{
      id: "s1", testId: "t1", topicId: TOPIC_ID, drawCount: 2, sortOrder: 0,
      required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
      topic, questions: [question("a"), question("b")], courses: [], events: [],
    }],
    adaptiveSettings: null, contentPages: [],
    designSettings: { templateId: "default", params: {} },
    telemetry: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = buildTestJson(data as unknown as ExportData);
  return JSON.parse(json) as {
    retakePolicy?: Record<string, unknown>;
    retakePlugin?: Record<string, unknown>;
  };
}

const cooldownPolicy = {
  enabled: true,
  cooldownPeriodDays: 30,
  gateMode: "before_internal_start",
  eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
} as unknown as RetakePolicy;

const intervalPolicy = {
  enabled: false,
  gateMode: "before_internal_start",
  eligibilityPlugin: null,
  attemptInterval: { enabled: true, hours: 24 },
} as unknown as RetakePolicy;

describe("SCORM bake — access barriers", () => {
  it("carries neither field when no barrier is configured", () => {
    const baked = bake(null);
    expect(baked.retakePolicy).toBeUndefined();
    expect(baked.retakePlugin).toBeUndefined();
  });

  it("carries neither field when the policy exists but both barriers are off", () => {
    const baked = bake({
      enabled: false,
      cooldownPeriodDays: 30,
      gateMode: "before_internal_start",
      eligibilityPlugin: null,
    } as unknown as RetakePolicy);
    expect(baked.retakePolicy).toBeUndefined();
    expect(baked.retakePlugin).toBeUndefined();
  });

  it("bakes policy AND plugin for the cooldown barrier", () => {
    const baked = bake(cooldownPolicy);
    expect(baked.retakePolicy).toMatchObject({ enabled: true, cooldownPeriodDays: 30 });
    expect(baked.retakePlugin).toMatchObject({ runtimeEntry: "webtutorCooldown" });
    // No interval branch when the author did not configure one.
    expect(baked.retakePolicy?.attemptInterval).toBeUndefined();
  });

  it("bakes the interval WITHOUT a plugin, and not as a gated test", () => {
    const baked = bake(intervalPolicy);
    expect(baked.retakePolicy?.attemptInterval).toEqual({ enabled: true, hours: 24 });
    expect(baked.retakePolicy?.eligibilityPlugin).toBeNull();
    // `enabled` is the COOLDOWN's switch — RetakeGate.isGated reads it, so an
    // interval-only package must not present itself as gated.
    expect(baked.retakePolicy?.enabled).toBe(false);
    expect(baked.retakePlugin).toBeUndefined();
  });

  it("carries both barriers when both are configured", () => {
    const baked = bake({
      ...(cooldownPolicy as unknown as Record<string, unknown>),
      attemptInterval: { enabled: true, hours: 12 },
    } as unknown as RetakePolicy);
    expect(baked.retakePolicy).toMatchObject({ enabled: true, cooldownPeriodDays: 30 });
    expect(baked.retakePolicy?.attemptInterval).toEqual({ enabled: true, hours: 12 });
    expect(baked.retakePlugin).toMatchObject({ runtimeEntry: "webtutorCooldown" });
  });
});
