/**
 * @module tests/scorm-section-intro-pass-condition
 * @description The package's «Введение раздела» states the topic threshold the grader will
 * apply: the rule resolved against the overall one and the DELIVERED variant (the same
 * resolution `computeSectionResult` runs), out of the prices of the delivered graded
 * questions. Runs the shipped `contentPage.js` over the real shared engines.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveOverallRule, resolveTopicRule } from "../shared/scoring/pass-rule";
import {
  sectionPassConditionText,
  sectionIsRequiredForVerdict,
  sectionTimerWarningText,
} from "../shared/template/pass-condition";
import { formatMinutesHuman } from "../shared/template/duration";

const src = readFileSync(resolve(process.cwd(), "server/scorm/template/app/render/contentPage.js"), "utf8");

/** The runtime's helpers over a stubbed package state. */
function load(state: unknown, TEST_DATA: unknown, formId: string | null = null) {
  vi.stubGlobal("TBTemplate", {
    resolveOverallRule,
    resolveTopicRule,
    sectionPassConditionText,
    sectionIsRequiredForVerdict,
    sectionTimerWarningText,
    formatMinutesHuman,
  });
  const TBQType = { isMeasurementOnly: (q: { measure?: boolean }) => q.measure === true };
  const deliveredFormId = () => formId;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    "state",
    "TEST_DATA",
    "TBQType",
    "deliveredFormId",
    `${src}\n;return { sectionIntroPassRule, sectionIntroPossiblePoints, buildSectionIntroFallback };`,
  )(state, TEST_DATA, TBQType, deliveredFormId);
}

afterEach(() => vi.unstubAllGlobals());

const flat = [
  { topicId: "t1", question: { points: 2 } },
  { topicId: "t1", question: { points: 3 } },
  { topicId: "t1", question: { points: 4, measure: true } },
  { topicId: "t1", question: {} },
  { topicId: "t2", question: { points: 10 } },
];

describe("SCORM section intro — the threshold of the topic", () => {
  it("sums the prices of the delivered graded questions of the topic", () => {
    const rt = load({ flatQuestions: flat }, { overallPassRule: null });
    // 2 + 3 + default 1; the measurement question brings nothing.
    expect(rt.sectionIntroPossiblePoints("t1")).toBe(6);
    expect(rt.sectionIntroPossiblePoints("t9")).toBeNull();
  });

  it("resolves «как у теста» through the overall rule", () => {
    const rt = load({ flatQuestions: flat }, { overallPassRule: { type: "percent", value: 80 } });
    expect(rt.sectionIntroPassRule({ topicId: "t1", topicPassRule: { source: "inherit_overall" } })).toEqual({
      type: "percent",
      value: 80,
    });
  });

  it("a per-variant rule takes the DELIVERED variant's threshold", () => {
    const rule = { source: "by_variant", byForm: { A: { type: "absolute", value: 7 }, B: { type: "absolute", value: 5 } } };
    const rt = load({ flatQuestions: flat }, { overallPassRule: null }, "B");
    expect(rt.sectionIntroPassRule({ topicId: "t1", topicPassRule: rule })).toEqual({ type: "count", value: 5 });
  });

  it("the fallback builder carries the new fields when the bundle has them", () => {
    const rt = load({ flatQuestions: flat }, { overallPassRule: null });
    const { sectionIntro } = rt.buildSectionIntroFallback({
      topicName: "T",
      questionCount: 4,
      timeLimitMinutes: 17,
      passRule: { type: "count", value: 4 },
      possiblePoints: 6,
      required: true,
      passDecisionPolicy: "required_topics_only",
    });
    expect(sectionIntro.passCondition).toBe("Для прохождения: 4 балла из 6");
    expect(sectionIntro.isRequired).toBe(true);
    expect(sectionIntro.timerWarning).toContain("«Далее»");
  });
});
