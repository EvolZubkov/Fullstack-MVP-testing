/**
 * @module features/tests/editor/__tests__/use-test-editor.branches.test
 * @description Branch-coverage companion to {@link use-test-editor.coverage.test}.
 * Targets the two internal helpers the coverage suite does not exercise across
 * every arm:
 *   - `tabOfField` — the field-prefix → owning-tab attribution, including the
 *     prefixes the real validator never emits (`runtime`, `retakePolicy`,
 *     `design`, `scoring`, and the `structure` right-operand of the flow OR),
 *     plus the `composition` fallback for an unknown field.
 *   - `buildTabStatuses` — both the error loop and the warning loop.
 *
 * Both helpers are module-private and only observable through the hook's
 * `tabStatuses`, which is derived from the debounced `validation`. To drive
 * arbitrary field paths (impossible via the real validator), `validateTestEditor`
 * is mocked to echo a per-test result. The GET is stubbed so an edit-mode draft
 * loads and `tabStatuses` becomes non-empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ValidationIssue, ValidationResult } from "../test-editor.types";

// Feed arbitrary validation results so every `tabOfField` arm and the
// `buildTabStatuses` warning loop can be reached — the real validator only emits
// a subset of the possible field prefixes.
const mockValidation = vi.hoisted(() => ({
  current: { errors: [], warnings: [] } as ValidationResult,
}));
vi.mock("../test-editor.validation", () => ({
  validateTestEditor: () => mockValidation.current,
}));

import { useTestEditor } from "../use-test-editor";

const TEST_ID = "test-branch-1";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildApiResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TEST_ID,
    version: 3,
    title: "Sample Test",
    description: "",
    mode: "standard",
    status: "draft",
    overallPassRuleJson: { type: "percent", value: 70 },
    passDecisionPolicy: "overall_only",
    webhookUrl: null,
    feedbackJson: { format: "plain", text: "", links: [], assets: [] },
    telemetryEnabled: false,
    timeLimitMinutes: null,
    maxAttempts: null,
    showCorrectAnswers: false,
    sections: [
      { id: "section-1", topicId: "topic-1", topicName: "Основы ИБ", drawCount: 5, required: true, maxQuestions: 10 },
    ],
    adaptiveSettings: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

function installApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.split("?")[0];
      if (/^\/api\/tests\/[^/]+$/.test(path) && method === "GET") return jsonResponse(buildApiResponse());
      return jsonResponse({}, 200);
    }),
  );
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const editOpts = { mode: "edit" as const, testId: TEST_ID };

function issue(field: string, severity: "error" | "warning"): ValidationIssue {
  return { field, code: "test", message: field, severity };
}

/**
 * Render the hook in edit mode with a mocked validation result and wait for the
 * debounced `validation` to reflect it (so `tabStatuses` is recomputed).
 */
async function renderWithValidation(result: ValidationResult) {
  installApi();
  mockValidation.current = result;
  const hook = renderHook(() => useTestEditor(editOpts), { wrapper: wrapper() });
  await waitFor(() => expect(hook.result.current.model).not.toBeNull());
  await waitFor(() => expect(hook.result.current.validation).toBe(result), { timeout: 1500 });
  return hook;
}

beforeEach(() => {
  mockValidation.current = { errors: [], warnings: [] };
});
afterEach(() => vi.unstubAllGlobals());

// ─── tabOfField — error attribution across every prefix ─────────────────────────

describe("useTestEditor — tabOfField error attribution", () => {
  it("routes each field prefix to its owning tab (all arms + default fallback)", async () => {
    const errors: ValidationIssue[] = [
      issue("sections", "error"), // → composition
      issue("adaptive.topics", "error"), // → settings
      issue("passRules.overall.value", "error"), // → settings
      issue("runtime.timeLimit", "error"), // → settings
      issue("retakePolicy.cooldown", "error"), // → settings
      issue("basic.title", "error"), // → settings
      issue("design.logo", "error"), // → design
      issue("flow.mode", "error"), // → structure (left OR operand)
      issue("structure.router", "error"), // → structure (right OR operand)
      issue("scoring.default", "error"), // → scoring
      issue("scales[0].key", "error"), // → scales
      issue("resultVariables[0].name", "error"), // → metrics
      issue("somethingUnknown", "error"), // → composition (fallback)
    ];
    const { result } = await renderWithValidation({ errors, warnings: [] });
    const s = result.current.tabStatuses;

    expect(s.composition.error).toBe(true);
    expect(s.settings.error).toBe(true);
    expect(s.design.error).toBe(true);
    expect(s.structure.error).toBe(true);
    expect(s.scoring.error).toBe(true);
    expect(s.scales.error).toBe(true);
    expect(s.metrics.error).toBe(true);
    // No warnings were injected — the warning flags stay clear.
    expect(s.settings.warning).toBe(false);
  });

  it("attributes the flow prefix to structure without warnings when only flow errs", async () => {
    const { result } = await renderWithValidation({
      errors: [issue("flowMode", "error")],
      warnings: [],
    });
    const s = result.current.tabStatuses;
    expect(s.structure.error).toBe(true);
    expect(s.composition.error).toBe(false);
    expect(s.settings.error).toBe(false);
  });
});

// ─── buildTabStatuses — warning loop ────────────────────────────────────────────

describe("useTestEditor — buildTabStatuses warning loop", () => {
  it("flags the owning tab for each warning (no error flags when warnings-only)", async () => {
    const warnings: ValidationIssue[] = [
      issue("adaptive.topics[0].levels", "warning"), // → settings
      issue("scales[0]", "warning"), // → scales
      issue("design.theme", "warning"), // → design
      issue("resultVariables[1]", "warning"), // → metrics
    ];
    const { result } = await renderWithValidation({ errors: [], warnings });
    const s = result.current.tabStatuses;

    expect(s.settings.warning).toBe(true);
    expect(s.scales.warning).toBe(true);
    expect(s.design.warning).toBe(true);
    expect(s.metrics.warning).toBe(true);
    // Warnings do not raise error flags.
    expect(s.settings.error).toBe(false);
    expect(s.scales.error).toBe(false);
  });

  it("marks both error and warning on the same tab when both are present", async () => {
    const { result } = await renderWithValidation({
      errors: [issue("scoring.default", "error")],
      warnings: [issue("scoring.override", "warning")],
    });
    const s = result.current.tabStatuses;
    expect(s.scoring.error).toBe(true);
    expect(s.scoring.warning).toBe(true);
  });
});
