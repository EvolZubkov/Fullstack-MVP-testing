/**
 * @module features/tests/editor/__tests__/test-editor.question-order.test
 * @description PRD-30 Э5: the topic's delivery-order setting survives the round
 * trip API → editor model → save payload.
 *
 * The mapper is where a new section column dies quietly: a field the reader
 * forgets defaults to «random» on every load (the author's choice silently
 * reverts), and a field the writer forgets never leaves the browser (the editor
 * shows the switch off, the database keeps saying on).
 */
import { describe, it, expect } from "vitest";
import { mapApiSectionsToEditor, mapEditorSectionsToPayload } from "../test-editor.mappers";
import type { TestEditorModel, EditorSection } from "../test-editor.types";
import { defaultRetakePolicy } from "../test-editor.mappers";

function makeModel(sections: EditorSection[]): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_by_topics",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "T", description: "", status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [], feedbackAssets: [], feedbackEvents: [],
      webhookUrl: "", telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true, skipReviewWhenComplete: false, quickAdvance: false,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections,
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
  } as TestEditorModel;
}

function makeSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "t1",
    topicName: "T1",
    maxQuestions: 10,
    drawCount: 5,
    drawAll: false,
    required: true,
    timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
    ...over,
  };
}

const readOrder = (questionOrder: unknown) =>
  mapApiSectionsToEditor({ sections: [{ topicId: "t", maxQuestions: 5, questionOrder }] })[0].questionOrder;

describe("mapApiSectionsToEditor — reading the delivery order (FR-02)", () => {
  it("keeps an explicit fixed", () => {
    expect(readOrder("fixed")).toBe("fixed");
  });

  it("keeps an explicit random", () => {
    expect(readOrder("random")).toBe("random");
  });

  it("a legacy section without the column inherits the test (FR-18)", () => {
    expect(readOrder(undefined)).toBeNull();
  });

  it("a malformed value degrades to «inherit» rather than freezing the order", () => {
    expect(readOrder("whatever")).toBeNull();
    expect(readOrder(null)).toBeNull();
    expect(readOrder(42)).toBeNull();
  });
});

describe("mapEditorSectionsToPayload — writing the delivery order (FR-02)", () => {
  it("sends fixed when the author turned the shuffle off", () => {
    const payload = mapEditorSectionsToPayload(makeModel([makeSection({ questionOrder: "fixed" })]));

    expect(payload[0].questionOrder).toBe("fixed");
  });

  it("sends null for a topic that follows the test — «как в тесте» (FR-18)", () => {
    const payload = mapEditorSectionsToPayload(makeModel([makeSection()]));

    expect(payload[0].questionOrder).toBeNull();
  });

  it("sends an explicit random when the topic OVERRIDES an ordering test", () => {
    const payload = mapEditorSectionsToPayload(makeModel([makeSection({ questionOrder: "random" })]));

    expect(payload[0].questionOrder).toBe("random");
  });
});

describe("round trip", () => {
  it("API → model → payload preserves fixed", () => {
    const [section] = mapApiSectionsToEditor({
      sections: [{ topicId: "t1", maxQuestions: 5, drawCount: 5, questionOrder: "fixed" }],
    });

    const payload = mapEditorSectionsToPayload(makeModel([{ ...makeSection(), ...section }]));

    expect(payload[0].questionOrder).toBe("fixed");
  });
});
