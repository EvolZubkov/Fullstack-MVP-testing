/**
 * @module features/tests/editor/sections/__tests__/result-variables-empty.test
 * @description The «Показатели» tab empty state must follow the DS pattern of the
 * approved wireframe (s-indicators-empty): a full-page `ou-empty--page` state with
 * the primary «Добавить показатель» action inside it — not a tight inline well with
 * the action stranded in a header row. Read-only hides the action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResultVariablesSection } from "../result-variables-section";
import type { TestEditorModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

function baseModel(): TestEditorModel {
  return {
    id: "test-1",
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample", description: "", status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [], feedbackAssets: [], feedbackEvents: [],
      webhookUrl: "", telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [], text: async () => "[]" })));
});
afterEach(() => vi.unstubAllGlobals());

function renderSection(props: { readOnly?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ResultVariablesSection model={baseModel()} testId="test-1" updateModel={() => {}} readOnly={props.readOnly} />
    </QueryClientProvider>,
  );
}

describe("«Показатели» empty state (DS conformance)", () => {
  it("uses the page-layout DS empty state with the primary action inside", () => {
    renderSection();
    const empty = screen.getByTestId("metrics-empty");
    expect(empty).toHaveClass("ou-empty--page");
    expect(screen.getByTestId("metrics-empty-add")).toBeInTheDocument();
    // The header add-button row is not rendered in the empty state.
    expect(screen.queryByTestId("metrics-add")).toBeNull();
  });

  it("hides the add action when read-only", () => {
    renderSection({ readOnly: true });
    expect(screen.getByTestId("metrics-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("metrics-empty-add")).toBeNull();
  });
});
