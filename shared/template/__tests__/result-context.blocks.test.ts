import { describe, it, expect } from "vitest";
import { buildResultContext, type ResultInput } from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";

const INPUT: ResultInput = {
  passed: true,
  percent: 80,
  totalQuestions: 10,
  correct: 8,
  earnedPoints: 8,
  possiblePoints: 10,
  topicResults: [],
};

/** One topic with something to say, so the `topics` sub-block becomes visible. */
const TOPIC = {
  topicId: "t1",
  topicName: "Тема",
  correct: 4,
  total: 5,
  percent: 80,
  passed: true,
  earnedPoints: 4,
  possiblePoints: 5,
};

/** One visible scale and one visible indicator — enough for both measurement sub-blocks. */
const MEASURES = {
  ramp: LEVEL_SCHEMES.traffic,
  scaleKind: "band_ruler" as const,
  indicatorKind: "label" as const,
  scales: [
    {
      key: "stress",
      name: "Стресс",
      value: 27,
      visibility: "level_and_value" as const,
      interpretation: {
        domainMin: 0,
        domainMax: 45,
        valence: "lower_is_better" as const,
        bands: [{ min: 0, max: 45, level: "high", label: "Высокий" }],
      },
    },
  ],
  indicators: [
    {
      key: "state",
      name: "Состояние",
      value: "growing",
      visibility: "level" as const,
      interpretation: {
        domainMin: null,
        domainMax: null,
        valence: "none" as const,
        bands: [],
        outcomes: [{ code: "growing", label: "Возрастает", tone: "attention" as const }],
      },
    },
  ],
  blockSettings: { scoreSummary: "show" as const },
};

const LABELS = {
  "results.heading": "Ваш результат",
  "results.summary": "Общий балл",
  "results.scales": "По шкалам",
  "results.indicators": "По показателям",
  "results.topics": "По темам",
};

describe("buildResultContext — sub-blocks (PRD-49)", () => {
  it("carries the resolved labels as a nested tree", () => {
    const ctx = buildResultContext(INPUT, "Тест", { labels: LABELS, hasPassThreshold: true });
    expect((ctx.labels as Record<string, Record<string, string>>).results.scales).toBe("По шкалам");
  });

  it("keeps the context untouched when the caller passes no labels", () => {
    const ctx = buildResultContext(INPUT, "Тест", { hasPassThreshold: true });
    expect("labels" in ctx).toBe(false);
    // The summary is the only visible sub-block, and it carries no heading of its own.
    expect(ctx.result.blocks).toEqual([{ key: "summary", heading: "", isSummary: true }]);
  });

  it("lists only the visible sub-blocks, in the resolved order", () => {
    const ctx = buildResultContext(INPUT, "Тест", {
      labels: LABELS,
      hasPassThreshold: true,
      blockOrder: ["topics", "summary"],
    });
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["summary"]);
    expect(ctx.result.blocks?.[0]).toMatchObject({ key: "summary", isSummary: true, heading: "Общий балл" });
  });

  it("puts the sub-blocks in the author's order", () => {
    const ctx = buildResultContext({ ...INPUT, topicResults: [{ topicId: "t1", topicName: "Тема", correct: 4, total: 5, percent: 80, passed: true, earnedPoints: 4, possiblePoints: 5 }] }, "Тест", {
      labels: LABELS,
      hasPassThreshold: true,
      blockOrder: ["topics", "summary"],
    });
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["topics", "summary"]);
    expect(ctx.result.blocks?.[0]).toMatchObject({ key: "topics", isTopics: true, heading: "По темам" });
  });

  it("gives a switched-off label an empty heading without dropping the block", () => {
    const ctx = buildResultContext(INPUT, "Тест", {
      labels: { ...LABELS, "results.summary": "" },
      hasPassThreshold: true,
    });
    expect(ctx.result.blocks?.[0]).toMatchObject({ key: "summary", heading: "" });
  });

  it("lists no sub-block when the summary is switched off and nothing else is shown", () => {
    const ctx = buildResultContext({ ...INPUT, possiblePoints: 0 }, "Тест", {
      labels: LABELS,
      measures: {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler" as const,
        indicatorKind: "label" as const,
        scales: [],
        indicators: [],
        blockSettings: { scoreSummary: "hide" as const },
      },
    });
    expect(ctx.result.blocks ?? []).toEqual([]);
  });

  it("flags every sub-block with the name its layout gates on", () => {
    // Covers `isScales`/`isIndicators` too: a misspelt flag makes a block vanish from the
    // screen without any host throwing, so all four names are asserted somewhere.
    const ctx = buildResultContext(
      { ...INPUT, topicResults: [TOPIC] },
      "Тест",
      { labels: LABELS, hasPassThreshold: true, measures: MEASURES },
    );
    expect(ctx.result.blocks).toEqual([
      { key: "summary", heading: "Общий балл", isSummary: true },
      { key: "scales", heading: "По шкалам", isScales: true },
      { key: "indicators", heading: "По показателям", isIndicators: true },
      { key: "topics", heading: "По темам", isTopics: true },
    ]);
  });

  it("cannot print a sub-block the template's screen does not have", () => {
    // The adaptive results screen has never carried a score summary: the template's list
    // leaves `summary` out, so the author's order cannot bring it back.
    const ctx = buildResultContext({ ...INPUT, topicResults: [TOPIC] }, "Тест", {
      labels: LABELS,
      hasPassThreshold: true,
      templateBlockOrder: ["topics", "scales", "indicators"],
      blockOrder: ["summary", "topics"],
    });
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["topics"]);
  });

  it("keeps the summary visible for a control test with nothing to grade", () => {
    // A test without `measures` never reaches the score-summary toggle, so the summary is
    // shown exactly as it always was — the sub-block list must say the same.
    const ctx = buildResultContext({ ...INPUT, possiblePoints: 0 }, "Тест", { labels: LABELS });
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["summary"]);
  });
});
