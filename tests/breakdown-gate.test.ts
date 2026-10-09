import { describe, it, expect } from "vitest";
import { aggregateStandardResult } from "@shared/scoring/aggregate";

/** Тест из одной темы: два вопроса с тегом «Право», один с тегом «Охрана труда». */
function input(opts: {
  topicPassRule?: unknown;
  overall?: unknown;
  gate?: boolean;
}) {
  return {
    overallPassRule: opts.overall ?? { type: "percent", value: 70 },
    passDecisionPolicy: "overall_and_required_topics",
    breakdownGateEnabled: opts.gate,
    sections: [
      {
        topicId: "s1",
        topicName: "Тема",
        topicPassRule: opts.topicPassRule ?? { source: "inherit_overall" },
        required: true,
        questions: [
          { type: "single" as const, correct: { correctIndex: 0 }, points: 1, answer: 0, axisKeys: { tag: ["Право"] } },
          { type: "single" as const, correct: { correctIndex: 0 }, points: 1, answer: 0, axisKeys: { tag: ["Право"] } },
          { type: "single" as const, correct: { correctIndex: 0 }, points: 1, answer: 1, axisKeys: { tag: ["Охрана труда"] } },
        ],
      },
    ],
  };
}

describe("PRD-50 §16: гейт подтем", () => {
  it("выключен — тема судится своим правилом, исход подтем штампуется", () => {
    const result = aggregateStandardResult(input({}));
    // 2 из 3 баллов = 66.7 % < 70 % — тема и так не пройдена своим правилом.
    expect(result.topicResults[0].passed).toBe(false);
    const rows = result.topicResults[0].breakdown;
    expect(rows.find((r) => r.key === "Право")?.passed).toBe(true);
    expect(rows.find((r) => r.key === "Охрана труда")?.passed).toBe(false);
  });

  it("выключен — проваленная подтема не роняет пройденную тему", () => {
    const result = aggregateStandardResult(input({ overall: { type: "percent", value: 50 } }));
    expect(result.topicResults[0].passed).toBe(true);
    expect(result.topicResults[0].breakdown.find((r) => r.key === "Охрана труда")?.passed).toBe(false);
  });

  it("включён — проваленная подтема роняет пройденную тему", () => {
    const result = aggregateStandardResult(
      input({ overall: { type: "percent", value: 50 }, gate: true }),
    );
    expect(result.topicResults[0].passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("тема «не проверять отдельно» не судит и свои подтемы", () => {
    const result = aggregateStandardResult(
      input({ topicPassRule: { source: "none" }, gate: true }),
    );
    expect(result.topicResults[0].passed).toBeNull();
    for (const row of result.topicResults[0].breakdown) {
      expect(row.passed).toBeNull();
      expect(row.thresholdPercent).toBeNull();
    }
  });

  it("сводные записи судятся общим порогом теста", () => {
    const result = aggregateStandardResult(input({ overall: { type: "percent", value: 50 } }));
    expect(result.breakdowns.find((r) => r.key === "Право")?.passed).toBe(true);
    expect(result.breakdowns.find((r) => r.key === "Охрана труда")?.passed).toBe(false);
  });
});
