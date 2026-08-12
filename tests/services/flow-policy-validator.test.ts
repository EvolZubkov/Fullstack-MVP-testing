/**
 * @module tests/services/flow-policy-validator
 * @description Unit tests for {@link validateFlowPolicy} — PRD-4 v1.1 L3
 * server-side guard. Pure function, no DB needed.
 */
import { describe, it, expect } from "vitest";
import { validateFlowPolicy } from "../../server/services/flow-policy-validator";
import type {
  AdaptiveTopicPayload,
  SectionPayload,
  TestPayload,
} from "../../server/services/test-settings";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function buildTest(overrides: Partial<TestPayload> = {}): TestPayload {
  return {
    title: "Sample",
    description: null,
    overallPassRuleJson: { type: "percent", value: 70 },
    mode: "standard",
    flowPolicyJson: null,
    ...overrides,
  };
}

function buildSection(over: Partial<SectionPayload> = {}): SectionPayload {
  return {
    topicId: "topic-1",
    drawCount: 5,
    required: true,
    ...over,
  };
}

function buildAdaptiveTopic(over: Partial<AdaptiveTopicPayload> = {}): AdaptiveTopicPayload {
  return {
    topicId: "topic-1",
    enabled: true,
    failureFeedback: null,
    failureLinks: [],
    levels: [
      {
        levelIndex: 0,
        levelName: "Базовый",
        minDifficulty: 0,
        maxDifficulty: 50,
        questionsCount: 5,
        passThreshold: 70,
        passThresholdType: "percent",
        links: [],
      },
    ],
    ...over,
  };
}

// ─── Rule 1: (adaptive, linear_flat) blocked ─────────────────────────────────

describe("validateFlowPolicy — (adaptive, linear_flat) blocked", () => {
  it("returns adaptive_flat_unsupported violation when mode=adaptive AND no flowMode (defaults to linear_flat)", () => {
    const violations = validateFlowPolicy(
      buildTest({ mode: "adaptive", flowPolicyJson: null }),
      [buildSection()],
      [buildAdaptiveTopic()],
    );
    expect(violations).toContainEqual(
      expect.objectContaining({ code: "adaptive_flat_unsupported" }),
    );
  });

  it("returns adaptive_flat_unsupported when mode=adaptive AND flowMode=linear_flat explicitly", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "adaptive",
        flowPolicyJson: { mode: "linear_flat" },
      }),
      [buildSection()],
      [buildAdaptiveTopic()],
    );
    expect(violations).toContainEqual(
      expect.objectContaining({ code: "adaptive_flat_unsupported" }),
    );
  });

  it("no violation for (standard, linear_flat)", () => {
    const violations = validateFlowPolicy(
      buildTest({ mode: "standard", flowPolicyJson: null }),
      [buildSection()],
      undefined,
    );
    expect(
      violations.filter((v) => v.code === "adaptive_flat_unsupported"),
    ).toHaveLength(0);
  });

  it("no violation for (adaptive, linear_by_topics)", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "adaptive",
        flowPolicyJson: { mode: "linear_by_topics" },
      }),
      [buildSection()],
      [buildAdaptiveTopic()],
    );
    expect(
      violations.filter((v) => v.code === "adaptive_flat_unsupported"),
    ).toHaveLength(0);
  });

  it("no violation for (adaptive, router_by_topics)", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "adaptive",
        flowPolicyJson: { mode: "router_by_topics" },
      }),
      [buildSection()],
      [buildAdaptiveTopic()],
    );
    expect(
      violations.filter((v) => v.code === "adaptive_flat_unsupported"),
    ).toHaveLength(0);
  });
});

// ─── Rule 2: strict adaptive section gating ──────────────────────────────────

describe("validateFlowPolicy — strict adaptive section gating", () => {
  it("flags section without matching adaptive topic in adaptive mode", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "adaptive",
        flowPolicyJson: { mode: "linear_by_topics" },
      }),
      [buildSection({ topicId: "topic-orphan" })],
      [], // no adaptive topics → section has no matching levels
    );
    expect(violations).toContainEqual(
      expect.objectContaining({
        code: "adaptive_section_no_levels",
        field: "sections[0].topicId",
      }),
    );
  });

  it("flags section with topic but empty levels[]", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "adaptive",
        flowPolicyJson: { mode: "linear_by_topics" },
      }),
      [buildSection({ topicId: "topic-1" })],
      [buildAdaptiveTopic({ topicId: "topic-1", levels: [] })],
    );
    expect(violations).toContainEqual(
      expect.objectContaining({ code: "adaptive_section_no_levels" }),
    );
  });

  it("no violation when every section has a topic with non-empty levels", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "adaptive",
        flowPolicyJson: { mode: "linear_by_topics" },
      }),
      [
        buildSection({ topicId: "topic-1" }),
        buildSection({ topicId: "topic-2" }),
      ],
      [
        buildAdaptiveTopic({ topicId: "topic-1" }),
        buildAdaptiveTopic({ topicId: "topic-2" }),
      ],
    );
    expect(
      violations.filter((v) => v.code === "adaptive_section_no_levels"),
    ).toHaveLength(0);
  });

  it("does not apply gating when mode=standard", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "standard",
        flowPolicyJson: { mode: "linear_by_topics" },
      }),
      [buildSection({ topicId: "topic-1" })],
      [], // no adaptive setup — fine in standard mode
    );
    expect(violations).toHaveLength(0);
  });

  it("does not apply gating when sections is empty/undefined", () => {
    const violations = validateFlowPolicy(
      buildTest({
        mode: "adaptive",
        flowPolicyJson: { mode: "linear_by_topics" },
      }),
      undefined,
      undefined,
    );
    expect(
      violations.filter((v) => v.code === "adaptive_section_no_levels"),
    ).toHaveLength(0);
  });
});
