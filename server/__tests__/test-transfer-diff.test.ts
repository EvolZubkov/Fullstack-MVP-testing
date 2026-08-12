/**
 * @module server/__tests__/test-transfer-diff
 *
 * The table of cases for the decision core. Every mode of the form and every topic policy is
 * proved here, without a database: `diffTransfer` is a pure function of (package, target,
 * options), which is exactly why the semantics can be pinned down case by case.
 *
 * The case that matters most is the one the author is warned about: a `delete` must appear
 * ONLY where a mode can genuinely erase something, and never for the parts declared safe.
 */
import { describe, it, expect } from "vitest";
import {
  diffTransfer,
  type TargetSnapshot,
  type TransferOptions,
  type TransferOperation,
} from "../services/test-transfer/diff";
import type { TestTransferPackage } from "../services/test-transfer/package";
import type { TestSnapshotContent } from "../services/test-snapshot";

/** A package with one topic, two questions, two scales, an indicator and a results page. */
function sourcePackage(): TestTransferPackage {
  const content = {
    test: {
      id: "src-test",
      title: "Опросник",
      overallPassRuleJson: { type: "percent", value: 55 },
      introJson: { results: { text: "<p>Вступление</p>" } },
    },
    topics: [{ id: "topic-a", name: "Лидерство" }],
    sections: [{ id: "sec-a", testId: "src-test", topicId: "topic-a" }],
    questionsByTopic: {
      "topic-a": [
        { id: "q-1", topicId: "topic-a", prompt: "Первый вопрос" },
        { id: "q-2", topicId: "topic-a", prompt: "Второй вопрос" },
      ],
    },
    scales: [
      { id: "sc-vdo", testId: "src-test", key: "vdo", label: "Вдохновляющий" },
      { id: "sc-emp", testId: "src-test", key: "emp", label: "Эмпатичный" },
    ],
    measurements: [{ id: "m-1", testId: "src-test", questionId: "q-1", scaleId: "sc-vdo", value: 1 }],
    resultVariables: [{ id: "rv-1", testId: "src-test", name: "lead_style", formula: "1" }],
    contentPages: [{ id: "page-res", testId: "src-test", kind: "results" }],
    questionScoring: [{ id: "qs-1", testId: "src-test", questionId: "q-1", points: 2 }],
    topicCoursesByTopic: {},
    topicEventsByTopic: {},
    adaptiveSettings: [],
    adaptiveLevels: [],
    adaptiveLevelLinksByLevel: {},
  } as unknown as TestSnapshotContent;

  return {
    formatVersion: 1,
    exportedAt: "2026-08-12T00:00:00.000Z",
    appVersion: "2.13.0",
    content,
    media: [],
    missingMedia: [],
  };
}

/** A receiving installation that has nothing at all. */
function emptyTarget(): TargetSnapshot {
  return {
    test: null,
    sections: [],
    topics: [],
    scales: [],
    measurements: [],
    resultVariables: [],
    contentPages: [],
    questionScoring: [],
    questionsUsedInAttempts: new Set(),
    takenTopicNames: [],
  };
}

/**
 * A receiver that already holds this test, imported once before: the same identifiers, plus
 * a question and a scale of its own that the package does not carry.
 */
function populatedTarget(): TargetSnapshot {
  return {
    test: { id: "src-test" },
    sections: [{ id: "sec-a", topicId: "topic-a" }],
    topics: [
      {
        id: "topic-a",
        name: "Лидерство",
        questions: [
          { id: "q-1", prompt: "Первый вопрос (старая редакция)" },
          { id: "q-9", prompt: "Лишний вопрос темы" },
        ],
      },
    ],
    scales: [
      { id: "tgt-vdo", key: "vdo", label: "Вдохновляющий" },
      { id: "tgt-old", key: "old", label: "Отменённая шкала" },
    ],
    measurements: [{ id: "m-1", questionId: "q-1", scaleId: "tgt-vdo" }],
    resultVariables: [{ id: "rv-1", name: "lead_style" }],
    contentPages: [{ id: "tgt-page", kind: "results" }],
    questionScoring: [{ id: "qs-1", questionId: "q-1" }],
    questionsUsedInAttempts: new Set(["q-9"]),
    takenTopicNames: ["Лидерство"],
  };
}

/** All five parts on, both modes at their safe default, topics merged. */
function options(overrides: Partial<TransferOptions> = {}): TransferOptions {
  return {
    parts: { structure: true, scoring: true, scales: true, results: true, media: true },
    modes: { scoring: "upsert", scales: "upsert" },
    topics: { "topic-a": "merge" },
    newId: () => "fresh-id",
    ...overrides,
  };
}

/** Operations of one entity kind, for readable assertions. */
function of(ops: TransferOperation[], entity: string): TransferOperation[] {
  return ops.filter((op) => op.entity === entity);
}

describe("diffTransfer: an empty receiver", () => {
  it("creates everything the package carries", () => {
    const ops = diffTransfer(sourcePackage(), emptyTarget(), options());

    expect(of(ops, "test")).toEqual([
      { kind: "create", entity: "test", id: "src-test", sourceId: "src-test", title: "Опросник" },
    ]);
    expect(of(ops, "question").map((op) => op.kind)).toEqual(["create", "create"]);
    expect(of(ops, "scale").map((op) => op.id)).toEqual(["sc-vdo", "sc-emp"]);
    expect(ops.some((op) => op.kind === "delete")).toBe(false);
  });
});

describe("diffTransfer: parts that are switched off", () => {
  it("produces no operations for a part the author did not take", () => {
    const ops = diffTransfer(
      sourcePackage(),
      populatedTarget(),
      options({
        parts: { structure: false, scoring: true, scales: false, results: true, media: true },
      }),
    );

    expect(of(ops, "question")).toEqual([]);
    expect(of(ops, "topic")).toEqual([]);
    expect(of(ops, "section")).toEqual([]);
    expect(of(ops, "scale")).toEqual([]);
    expect(of(ops, "measurement")).toEqual([]);
    expect(of(ops, "resultVariable")).toEqual([]);
    // The parts that ARE taken still work.
    expect(of(ops, "contentPage")).not.toEqual([]);
    expect(of(ops, "questionScoring")).not.toEqual([]);
  });
});

describe("diffTransfer: scales and indicators", () => {
  it("upsert updates the scale matched by key, adds the missing one and leaves the extra alone", () => {
    const ops = diffTransfer(sourcePackage(), populatedTarget(), options());

    const scales = of(ops, "scale");
    // The key is the author's stable handle: the package's `sc-vdo` is this receiver's `tgt-vdo`.
    expect(scales).toContainEqual({
      kind: "update",
      entity: "scale",
      id: "tgt-vdo",
      sourceId: "sc-vdo",
      title: "Вдохновляющий",
    });
    expect(scales).toContainEqual({
      kind: "create",
      entity: "scale",
      id: "sc-emp",
      sourceId: "sc-emp",
      title: "Эмпатичный",
    });
    expect(scales.some((op) => op.kind === "delete")).toBe(false);
  });

  it("replace deletes the scale the package does not carry", () => {
    const ops = diffTransfer(
      sourcePackage(),
      populatedTarget(),
      options({ modes: { scoring: "upsert", scales: "replace" } }),
    );

    expect(of(ops, "scale")).toContainEqual({
      kind: "delete",
      entity: "scale",
      id: "tgt-old",
      title: "Отменённая шкала",
      usedInAttempts: false,
    });
  });

  it("matches an indicator by name when the identifier is unknown here", () => {
    const target = populatedTarget();
    target.resultVariables = [{ id: "other-id", name: "lead_style" }];

    const ops = diffTransfer(sourcePackage(), target, options());

    expect(of(ops, "resultVariable")).toEqual([
      {
        kind: "update",
        entity: "resultVariable",
        id: "other-id",
        sourceId: "rv-1",
        title: "lead_style",
      },
    ]);
  });
});

describe("diffTransfer: topic policies", () => {
  it("merge updates the matched question, adds the missing one and keeps the extra", () => {
    const ops = diffTransfer(sourcePackage(), populatedTarget(), options());

    const questions = of(ops, "question");
    expect(questions).toContainEqual({
      kind: "update",
      entity: "question",
      id: "q-1",
      sourceId: "q-1",
      title: "Первый вопрос",
    });
    expect(questions).toContainEqual({
      kind: "create",
      entity: "question",
      id: "q-2",
      sourceId: "q-2",
      title: "Второй вопрос",
    });
    expect(questions.some((op) => op.kind === "delete")).toBe(false);
  });

  it("replace deletes the question of the topic the package does not carry", () => {
    const ops = diffTransfer(
      sourcePackage(),
      populatedTarget(),
      options({ topics: { "topic-a": "replace" } }),
    );

    expect(of(ops, "question")).toContainEqual({
      kind: "delete",
      entity: "question",
      id: "q-9",
      title: "Лишний вопрос темы",
      usedInAttempts: true,
    });
  });

  it("new leaves the existing topic untouched and creates one under another name", () => {
    const ops = diffTransfer(
      sourcePackage(),
      populatedTarget(),
      options({ topics: { "topic-a": "new" } }),
    );

    const topics = of(ops, "topic");
    expect(topics).toEqual([
      {
        kind: "create",
        entity: "topic",
        id: "fresh-id",
        sourceId: "topic-a",
        title: "Лидерство (импорт 2)",
      },
    ]);
    // Both questions land in the NEW topic, and nothing of the existing one is touched.
    expect(of(ops, "question").map((op) => op.kind)).toEqual(["create", "create"]);
    expect(ops.some((op) => op.kind === "delete")).toBe(false);
  });
});

describe("diffTransfer: an adaptive test", () => {
  it("carries the adaptive configuration and never deletes any of it", () => {
    const pkg = sourcePackage();
    const content = pkg.content as unknown as Record<string, unknown>;
    content.adaptiveSettings = [{ id: "as-1", testId: "src-test", topicId: "topic-a" }];
    content.adaptiveLevels = [{ id: "lv-1", testId: "src-test", title: "Базовый" }];
    content.adaptiveLevelLinksByLevel = { "lv-1": [{ id: "ln-1", levelId: "lv-1" }] };

    const target = populatedTarget();
    target.adaptiveSettings = [{ id: "as-1" }];
    target.adaptiveLevels = [];
    target.adaptiveLevelLinks = [{ id: "ln-old" }];

    const ops = diffTransfer(pkg, target, options({ topics: { "topic-a": "replace" } }));

    expect(of(ops, "adaptiveSetting")).toEqual([
      { kind: "update", entity: "adaptiveSetting", id: "as-1", sourceId: "as-1", title: "topic-a" },
    ]);
    expect(of(ops, "adaptiveLevel")).toEqual([
      { kind: "create", entity: "adaptiveLevel", id: "lv-1", sourceId: "lv-1", title: "Базовый" },
    ]);
    expect(of(ops, "adaptiveLevelLink")).toEqual([
      { kind: "create", entity: "adaptiveLevelLink", id: "ln-1", sourceId: "ln-1", title: "lv-1" },
    ]);
    // Even under the harshest topic policy the adaptive rows are never removed: they are
    // configuration of the test, not content the author chose to replace.
    expect(ops.filter((op) => op.entity.startsWith("adaptive") && op.kind === "delete")).toEqual([]);
  });
});

describe("diffTransfer: the test row, which three parts write into", () => {
  it("withholds the columns of a part the author declined", () => {
    const ops = diffTransfer(
      sourcePackage(),
      populatedTarget(),
      options({
        parts: { structure: true, scoring: false, scales: true, results: false, media: true },
      }),
    );

    const [test] = of(ops, "test");
    expect(test.kind).toBe("update");
    // The pass rule belongs to «Оценивание», the intro block and appearance to «Итоги».
    expect(test.omitFields).toEqual([
      "overallPassRuleJson",
      "defaultQuestionPoints",
      "introJson",
      "designSettingsJson",
      "reportSettingsJson",
    ]);
  });

  it("carries the whole row when every part is taken", () => {
    const ops = diffTransfer(sourcePackage(), populatedTarget(), options());

    expect(of(ops, "test")[0].omitFields).toBeUndefined();
  });
});

describe("diffTransfer: the parts declared safe", () => {
  it("never deletes for results and appearance", () => {
    const target = populatedTarget();
    target.contentPages = [
      { id: "tgt-page", kind: "results" },
      { id: "tgt-extra", kind: "info" },
    ];

    const ops = diffTransfer(sourcePackage(), target, options());

    expect(of(ops, "contentPage").some((op) => op.kind === "delete")).toBe(false);
    // A system page is matched by KIND: `sort_order` is not an identity (a workbook import
    // leaves every page at 0), and the receiver's own identifier must be kept.
    expect(of(ops, "contentPage")).toContainEqual({
      kind: "update",
      entity: "contentPage",
      id: "tgt-page",
      sourceId: "page-res",
      title: "results",
    });
  });
});
