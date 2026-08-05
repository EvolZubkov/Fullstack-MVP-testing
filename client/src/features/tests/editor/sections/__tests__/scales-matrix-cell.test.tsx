/**
 * @module features/tests/editor/sections/__tests__/scales-matrix-cell.test
 * @description Regression tests for the «Вклады вопросов» contribution cell
 * ({@link MatrixCell}). Drives a real cell through a stateful model and asserts
 * the value committed to the draft: a comma decimal is parsed (not silently
 * saved as its integer part / 0), and negatives — including negative fractions —
 * are preserved (they were flipped back to positive / zero before the fix).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScalesSection } from "../scales-section";
import type { TestEditorModel, EditorSection, ScaleModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1", topicName: "Финансы", maxQuestions: 12, drawCount: 5, drawAll: false,
    required: true, timeLimit: { source: "inherit_test" }, feedback: { format: "plain", text: "" },
    feedbackLinks: [], feedbackAssets: [], feedbackEvents: [], defaultPoints: null, ...over,
  };
}

function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    id: "test-1", version: 1, mode: "standard", flowMode: "linear_flat", flowSettings: {}, folderId: null,
    basic: { title: "Sample", description: "", status: "draft", feedback: { format: "plain", text: "" },
      feedbackLinks: [], feedbackAssets: [], feedbackEvents: [], webhookUrl: "", telemetryEnabled: false },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true, quickAdvance: false, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [], adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [], scales: [], measurements: [], retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] }, ...overrides,
  };
}

const dbQuestions = [
  { id: "q1", topicId: "top-1", type: "single", prompt: "Вопрос 1", dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 } },
];

const SCALE: ScaleModel = {
  key: "comp", label: "Компетенция", type: "number", aggregation: "sum",
  normalization: "none", direction: "positive", bands: [], domainMin: null, domainMax: null,
  valence: "none", learnerVisibility: "hidden", scormTarget: "none", sortOrder: 0,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = String(url).includes("/api/questions") ? dbQuestions : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

/** Renders the section over a real stateful draft and reports the latest model. */
function Harness({ onModel }: { onModel: (m: TestEditorModel) => void }) {
  const [model, setModel] = useState<TestEditorModel>(() =>
    baseModel({ sections: [buildSection()], scales: [SCALE] }),
  );
  return (
    <ScalesSection
      model={model}
      testId="test-1"
      updateModel={(updater) => setModel((m) => { const next = updater(m); onModel(next); return next; })}
    />
  );
}

/** Open «Вклады вопросов», expand the first question card, return its first cell. */
async function openFirstCell(): Promise<HTMLInputElement> {
  fireEvent.click(screen.getByRole("button", { name: "Вклады вопросов" }));
  const card = await screen.findByTestId("contrib-card-0");
  fireEvent.click(card.querySelector("button.tb-level-card__chev")!);
  return (await screen.findByLabelText(/Вклад «A\. А» в шкалу comp/)) as HTMLInputElement;
}

/** Simulate progressive left-to-right typing (change event per growing prefix). */
function typeInto(input: HTMLInputElement, final: string) {
  for (let i = 1; i <= final.length; i++) {
    fireEvent.change(input, { target: { value: final.slice(0, i) } });
  }
}

function committedValue(model: TestEditorModel | null): number | undefined {
  return model?.measurements[0]?.value;
}

describe("«Вклады вопросов» contribution cell", () => {
  it("parses a comma decimal (was silently saved as 0)", async () => {
    let last: TestEditorModel | null = null;
    render(<QueryClientProvider client={new QueryClient()}><Harness onModel={(m) => (last = m)} /></QueryClientProvider>);
    const input = await openFirstCell();
    typeInto(input, "0,5");
    await waitFor(() => expect(committedValue(last)).toBe(0.5));
  });

  it("preserves a plain negative", async () => {
    let last: TestEditorModel | null = null;
    render(<QueryClientProvider client={new QueryClient()}><Harness onModel={(m) => (last = m)} /></QueryClientProvider>);
    const input = await openFirstCell();
    typeInto(input, "-1");
    await waitFor(() => expect(committedValue(last)).toBe(-1));
  });

  it("preserves a negative fraction typed with a comma (was flipped to 0/positive)", async () => {
    let last: TestEditorModel | null = null;
    render(<QueryClientProvider client={new QueryClient()}><Harness onModel={(m) => (last = m)} /></QueryClientProvider>);
    const input = await openFirstCell();
    typeInto(input, "-0,5");
    await waitFor(() => expect(committedValue(last)).toBe(-0.5));
    // The minus must survive in the field (the "-0" re-sync no longer clobbers it).
    expect(input.value).toBe("-0,5");
  });

  it("clears the cell (removes the row) when emptied", async () => {
    let last: TestEditorModel | null = null;
    render(<QueryClientProvider client={new QueryClient()}><Harness onModel={(m) => (last = m)} /></QueryClientProvider>);
    const input = await openFirstCell();
    typeInto(input, "2");
    await waitFor(() => expect(committedValue(last)).toBe(2));
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(last?.measurements.length).toBe(0));
  });
});
