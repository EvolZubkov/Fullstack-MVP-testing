/**
 * @module server/services/flow-policy-validator
 * @description PRD-4 v1.1 server-side L3 validation: rejects invalid
 * `(mode × flowMode)` combinations + enforces strict gating for adaptive
 * mode. Mirrors the client-side rules in
 * [test-editor.validation.ts](../../client/src/features/tests/editor/test-editor.validation.ts)
 * so a non-UI client (curl/scripts/bypass) cannot persist an invalid test.
 *
 * The full client-side validator covers many other FR rules; this module
 * intentionally narrows to the two PRD-4 v1.1 contract additions:
 *   - `(adaptive, linear_flat)` is blocked (deferred to a future PRD).
 *   - Strict gating: in adaptive mode every section in `sections[]` must
 *     have a matching adaptive topic with at least one configured level.
 */

import type { FlowMode } from "./content-pages-lifecycle";
import type { AdaptiveTopicPayload, SectionPayload, TestPayload } from "./test-settings";

/** A single validation violation, mirrors client `ValidationIssue` shape. */
export type FlowPolicyViolation = {
  code: "adaptive_flat_unsupported" | "adaptive_section_no_levels";
  field: string;
  message: string;
};

/**
 * Thrown by the service when {@link validateFlowPolicy} returns violations.
 * The route layer translates this to HTTP 422 with the violation list.
 */
export class FlowPolicyValidationError extends Error {
  readonly violations: FlowPolicyViolation[];

  constructor(violations: FlowPolicyViolation[]) {
    super("flow_policy_invalid");
    this.name = "FlowPolicyValidationError";
    this.violations = violations;
  }
}

/**
 * Validates PRD-4 v1.1 contract on a test payload pre-write. Returns the
 * empty array when the payload is acceptable; otherwise the caller throws
 * {@link FlowPolicyValidationError} with the result.
 *
 * - `test.mode` defaults to `"standard"` when absent (matches `apiToEditorModel`).
 * - `flowMode` is read from `test.flowPolicyJson.mode`, defaulting to
 *   `"linear_flat"` per FR-40 (same logic as {@link extractFlowMode} in the
 *   test-settings service).
 */
export function validateFlowPolicy(
  test: TestPayload,
  sections: SectionPayload[] | undefined,
  adaptiveSettings: AdaptiveTopicPayload[] | undefined,
): FlowPolicyViolation[] {
  const violations: FlowPolicyViolation[] = [];

  const mode = test.mode ?? "standard";
  const flowMode = extractFlowModeFromPayload(test.flowPolicyJson);

  // Rule 1: (adaptive, linear_flat) is blocked, deferred to future PRD.
  if (mode === "adaptive" && flowMode === "linear_flat") {
    violations.push({
      code: "adaptive_flat_unsupported",
      field: "flowPolicyJson.mode",
      message:
        "Адаптивный режим в плоском сценарии (linear_flat) пока не поддерживается. " +
        "Выберите 'linear_by_topics' или 'router_by_topics'.",
    });
  }

  // Rule 2: strict gating — every section in adaptive mode must have non-empty levels.
  if (mode === "adaptive" && sections && sections.length > 0) {
    const adaptiveByTopic = new Map<string, AdaptiveTopicPayload>();
    for (const t of adaptiveSettings ?? []) {
      adaptiveByTopic.set(t.topicId, t);
    }
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const topic = adaptiveByTopic.get(section.topicId);
      const levelsCount = topic?.levels?.length ?? 0;
      if (levelsCount === 0) {
        violations.push({
          code: "adaptive_section_no_levels",
          field: `sections[${i}].topicId`,
          message:
            `Section with topicId="${section.topicId}" requires at least one ` +
            `adaptive level in adaptive mode (PRD-4 v1.1 strict gating).`,
        });
      }
    }
  }

  return violations;
}

function extractFlowModeFromPayload(flowPolicyJson: unknown): FlowMode {
  if (typeof flowPolicyJson === "object" && flowPolicyJson !== null) {
    const mode = (flowPolicyJson as { mode?: unknown }).mode;
    if (mode === "linear_by_topics" || mode === "router_by_topics") return mode;
  }
  return "linear_flat";
}
