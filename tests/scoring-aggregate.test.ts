/**
 * @module tests/scoring-aggregate
 * @description PRD-18 — golden tests for the SINGLE shared standard-result engine
 * (`shared/scoring/aggregate.ts` + `shared/scoring/pass-rule.ts`) that BOTH the web
 * grader (`server/routes/attempts.ts`) and the SCORM runtime
 * (`resultsPage.js calculateResults`, via `window.TBTemplate.aggregateStandardResult`)
 * now call. Pins the pass-rule resolution (inherit_overall / none / custom /
 * legacy), the PRD-10 FR-10 count basis (Σ earned points), partial credit, and the
 * exact regression that prompted the unification: every-correct on a test whose
 * sections inherit the overall threshold must read «пройден», not «не пройден».
 */
import { describe, it, expect } from "vitest";
import {
  aggregateStandardResult, aggregateAdaptiveResult,
  type AggregateSection, type AdaptiveTopicInput,
} from "../shared/scoring/aggregate";
import { resolveOverallRule, resolveTopicRule, checkPassRule } from "../shared/scoring/pass-rule";

const single = (correctIndex: number, answer: number | null, points = 1): AggregateSection["questions"][number] => ({
  type: "single",
  correct: { correctIndex },
  scoring: null,
  points,
  answer,
});

function section(topicId: string, rule: unknown, qs: AggregateSection["questions"]): AggregateSection {
  return { topicId, topicName: topicId, topicPassRule: rule, questions: qs };
}

// ─── pass-rule resolver ─────────────────────────────────────────────────────────

describe("resolveOverallRule", () => {
  it("maps stored shapes to a runtime rule (or null for none)", () => {
    expect(resolveOverallRule({ type: "percent", value: 80 })).toEqual({ type: "percent", value: 80 });
    expect(resolveOverallRule({ type: "absolute", value: 5 })).toEqual({ type: "count", value: 5 });
    expect(resolveOverallRule({ type: "none", value: 0 })).toBeNull();
    expect(resolveOverallRule(null)).toBeNull();
  });
});

describe("resolveTopicRule", () => {
  const overall = { type: "percent" as const, value: 80 };
  it("inherit_overall → the overall rule («Как у теста»)", () => {
    expect(resolveTopicRule({ source: "inherit_overall" }, overall)).toEqual(overall);
    expect(resolveTopicRule({ source: "inherit_overall" }, null)).toBeNull();
  });
  it("none → null (no gate)", () => {
    expect(resolveTopicRule({ source: "none" }, overall)).toBeNull();
  });
  it("custom → its own {type,value}; absolute → count", () => {
    expect(resolveTopicRule({ source: "custom", type: "percent", value: 60 }, overall)).toEqual({ type: "percent", value: 60 });
    expect(resolveTopicRule({ source: "custom", type: "absolute", value: 3 }, overall)).toEqual({ type: "count", value: 3 });
  });
  it("legacy {type,value} → itself; null/undefined → null", () => {
    expect(resolveTopicRule({ type: "percent", value: 70 }, overall)).toEqual({ type: "percent", value: 70 });
    expect(resolveTopicRule(null, overall)).toBeNull();
    expect(resolveTopicRule(undefined, overall)).toBeNull();
  });
});

describe("resolveTopicRule — by_variant (PRD-24)", () => {
  const overall = { type: "percent" as const, value: 70 };
  const rule = {
    source: "by_variant",
    byForm: { f1: { type: "percent", value: 65 }, f2: { type: "absolute", value: 7 } },
  };

  it("resolves the delivered variant's percent threshold", () => {
    expect(resolveTopicRule(rule, overall, { formId: "f1" })).toEqual({ type: "percent", value: 65 });
  });

  it("resolves the delivered variant's absolute threshold as a count rule", () => {
    expect(resolveTopicRule(rule, overall, { formId: "f2" })).toEqual({ type: "count", value: 7 });
  });

  it("degrades to the overall rule when the delivered formId is unknown (FR-09)", () => {
    expect(resolveTopicRule(rule, overall, { formId: "gone" })).toEqual(overall);
    expect(resolveTopicRule(rule, overall, { formId: null })).toEqual(overall);
    expect(resolveTopicRule(rule, overall, undefined)).toEqual(overall);
  });

  it("degrades to null when the overall rule is «none» and the variant is unresolved", () => {
    expect(resolveTopicRule(rule, null, { formId: "gone" })).toBeNull();
  });

  it("coerces a malformed threshold value to 0 for both types", () => {
    const broken = {
      source: "by_variant",
      byForm: { f1: { type: "percent" }, f2: { type: "absolute", value: "x" } },
    };
    expect(resolveTopicRule(broken, overall, { formId: "f1" })).toEqual({ type: "percent", value: 0 });
    expect(resolveTopicRule(broken, overall, { formId: "f2" })).toEqual({ type: "count", value: 0 });
  });
});

describe("checkPassRule", () => {
  it("null passes; percent compares %; count compares Σ earned points (FR-10)", () => {
    expect(checkPassRule(null, 0, 0)).toBe(true);
    expect(checkPassRule({ type: "percent", value: 80 }, 80, 0)).toBe(true);
    expect(checkPassRule({ type: "percent", value: 80 }, 79.9, 0)).toBe(false);
    expect(checkPassRule({ type: "count", value: 5 }, 0, 5)).toBe(true);
    expect(checkPassRule({ type: "count", value: 5 }, 100, 4.5)).toBe(false);
  });
});

// ─── the aggregation + the regression ───────────────────────────────────────────

describe("aggregateStandardResult", () => {
  it("REGRESSION: every-correct with inherit_overall sections → пройден (was не пройден)", () => {
    const r = aggregateStandardResult({
      overallPassRule: { type: "percent", value: 80 },
      sections: [
        section("Демо", { source: "inherit_overall" }, [single(0, 0), single(1, 1)]),
        section("IPTV", { source: "inherit_overall" }, [single(0, 0), single(2, 2)]),
      ],
    });
    expect(r.percent).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.topicResults.every((t) => t.passed === true)).toBe(true);
  });

  it("inherit_overall topic below the overall threshold fails and demotes overall", () => {
    const r = aggregateStandardResult({
      overallPassRule: { type: "percent", value: 80 },
      sections: [
        section("A", { source: "inherit_overall" }, [single(0, 0), single(0, 0)]), // 100%
        section("B", { source: "inherit_overall" }, [single(0, 0), single(0, 1), single(0, 1)]), // 33%
      ],
    });
    expect(r.topicResults[0].passed).toBe(true);
    expect(r.topicResults[1].passed).toBe(false);
    expect(r.passed).toBe(false); // overall % may pass but a topic gate fails
  });

  it("none topic is informational (passed=null) and never demotes the test", () => {
    const r = aggregateStandardResult({
      overallPassRule: { type: "percent", value: 50 },
      sections: [
        section("graded", { source: "custom", type: "percent", value: 50 }, [single(0, 0), single(0, 0)]), // 100%
        section("survey", { source: "none" }, [single(0, 1), single(0, 1)]), // 0% but no gate
      ],
    });
    expect(r.topicResults[1].passed).toBeNull();
    expect(r.passed).toBe(true);
  });

  it("count rule uses Σ earned points, not the fully-correct count (FR-10)", () => {
    // 3 questions worth 2 points each = 6 possible; 2 correct = 4 earned points.
    const r = aggregateStandardResult({
      overallPassRule: { type: "absolute", value: 4 }, // need 4 earned points
      sections: [section("T", { source: "none" }, [single(0, 0, 2), single(0, 0, 2), single(0, 1, 2)])],
    });
    expect(r.earnedPoints).toBe(4);
    expect(r.correct).toBe(2);
    expect(r.passed).toBe(true); // 4 >= 4
    const r2 = aggregateStandardResult({
      overallPassRule: { type: "absolute", value: 5 },
      sections: [section("T", { source: "none" }, [single(0, 0, 2), single(0, 0, 2), single(0, 1, 2)])],
    });
    expect(r2.passed).toBe(false); // 4 < 5
  });

  it("multiplies effective points and counts only fully-correct toward `correct`", () => {
    const r = aggregateStandardResult({
      overallPassRule: { type: "none", value: 0 },
      sections: [section("T", null, [single(0, 0, 3), single(0, 1, 3)])], // 1 correct of 2, 3 pts each
    });
    expect(r.possiblePoints).toBe(6);
    expect(r.earnedPoints).toBe(3);
    expect(r.correct).toBe(1);
    expect(r.passed).toBe(true); // overall none → no gate
  });
});

// ─── PRD-26: measurement-only questions stay OUT of the grade ───────────────────

describe("aggregateStandardResult — measurement-only scales (PRD-26 FR-08/FR-09)", () => {
  /** A scale in measurement mode: no `correctIndex` at all. */
  const measurement = (answer: number | null, points = 1): AggregateSection["questions"][number] => ({
    type: "scale",
    correct: {},
    scoring: null,
    points,
    answer,
  });
  /** A scale with a correct graduation — an ordinary graded question. */
  const checkedScale = (correctIndex: number, answer: number | null, points = 1): AggregateSection["questions"][number] => ({
    type: "scale",
    correct: { correctIndex },
    scoring: null,
    points,
    answer,
  });
  const percent70 = { type: "percent", value: 70 };

  it("does not count a measurement question in points or in the question total", () => {
    const r = aggregateStandardResult({
      sections: [section("t", { source: "inherit_overall" }, [measurement(2), measurement(5)])],
      overallPassRule: percent70,
    });
    expect(r.possiblePoints).toBe(0);
    expect(r.earnedPoints).toBe(0);
    expect(r.totalQuestions).toBe(0);
    expect(r.scoredQuestions).toBe(0);
    expect(r.correct).toBe(0);
  });

  it("a purely measurement test is not «failed»: there is no threshold to miss", () => {
    // The regression this pins: with the questions counted, possible=2 and earned=0
    // gave 0% and «не зачтено» for an opinion inventory that has no right answers.
    const r = aggregateStandardResult({
      sections: [section("t", { source: "inherit_overall" }, [measurement(2), measurement(5)])],
      overallPassRule: percent70,
    });
    expect(r.percent).toBe(0);
    expect(r.overallPassed).toBe(true);
    expect(r.passed).toBe(true);
    // The section is UNGATED rather than failed at 0%.
    expect(r.topicResults[0].passed).toBeNull();
  });

  it("keeps the percent of a MIXED section on the graded questions only", () => {
    // Two graded questions (one right) + three measurement items. The percent must be
    // 50%, not 20% — the survey items are not wrong answers.
    const r = aggregateStandardResult({
      sections: [
        section("t", { source: "inherit_overall" }, [
          single(0, 0),
          single(0, 1),
          measurement(0),
          measurement(3),
          measurement(5),
        ]),
      ],
      overallPassRule: percent70,
    });
    expect(r.possiblePoints).toBe(2);
    expect(r.earnedPoints).toBe(1);
    expect(r.percent).toBe(50);
    expect(r.totalQuestions).toBe(2);
    expect(r.scoredQuestions).toBe(2);
    expect(r.correct).toBe(1);
    expect(r.topicResults[0].total).toBe(2);
    expect(r.topicResults[0].passed).toBe(false);
  });

  it("gates a section that has at least one graded question", () => {
    const r = aggregateStandardResult({
      sections: [
        section("graded", { source: "inherit_overall" }, [single(0, 0), measurement(4)]),
        section("survey", { source: "inherit_overall" }, [measurement(1), measurement(2)]),
      ],
      overallPassRule: percent70,
    });
    // The graded section passes on its own single question; the survey stays ungated.
    expect(r.topicResults[0].passed).toBe(true);
    expect(r.topicResults[1].passed).toBeNull();
    expect(r.percent).toBe(100);
    expect(r.passed).toBe(true);
  });

  it("a scale WITH a correct graduation is an ordinary graded question", () => {
    const r = aggregateStandardResult({
      sections: [section("t", { source: "inherit_overall" }, [checkedScale(3, 3), checkedScale(3, 1)])],
      overallPassRule: percent70,
    });
    expect(r.possiblePoints).toBe(2);
    expect(r.earnedPoints).toBe(1);
    expect(r.totalQuestions).toBe(2);
    expect(r.scoredQuestions).toBe(2);
    expect(r.correct).toBe(1);
    expect(r.percent).toBe(50);
  });

  it("weighted graduations still price a measurement question at zero", () => {
    // «Веса» may be authored on a measurement scale by mistake (or left over from a
    // type switch). FR-25: the values are kept but must not reach the grade.
    const weighted: AggregateSection["questions"][number] = {
      type: "scale",
      correct: {},
      scoring: { kind: "weighted", weights: [0, 1, 2, 3, 4, 5] },
      points: 5,
      answer: 5,
    };
    const r = aggregateStandardResult({
      sections: [section("t", { source: "inherit_overall" }, [weighted])],
      overallPassRule: percent70,
    });
    expect(r.earnedPoints).toBe(0);
    expect(r.possiblePoints).toBe(0);
    expect(r.scoredQuestions).toBe(0);
  });

  it("other types are never treated as measurement-only", () => {
    // A guard against the predicate widening by accident: an unanswered single choice
    // is a WRONG answer, not an unscored question.
    const r = aggregateStandardResult({
      sections: [section("t", { source: "inherit_overall" }, [single(0, null)])],
      overallPassRule: percent70,
    });
    expect(r.possiblePoints).toBe(1);
    expect(r.scoredQuestions).toBe(1);
    expect(r.percent).toBe(0);
    expect(r.topicResults[0].passed).toBe(false);
  });
});

// ─── PRD-24: the delivered variant decides which threshold gates the topic ───────

describe("aggregateStandardResult — by_variant delivery (PRD-24)", () => {
  const byVariant = {
    source: "by_variant",
    byForm: { fA: { type: "percent", value: 50 }, fB: { type: "percent", value: 100 } },
  };
  const overall = { type: "percent" as const, value: 40 };
  /** 1 correct of 2 → topic percent = 50. */
  const qs = () => [single(0, 0), single(0, 1)];

  it("gates the topic by the threshold of the variant actually delivered", () => {
    const passed = aggregateStandardResult({
      overallPassRule: overall,
      sections: [{ ...section("T", byVariant, qs()), formId: "fA" }], // 50% >= 50
    });
    expect(passed.topicResults[0].passed).toBe(true);

    const failed = aggregateStandardResult({
      overallPassRule: overall,
      sections: [{ ...section("T", byVariant, qs()), formId: "fB" }], // 50% < 100
    });
    expect(failed.topicResults[0].passed).toBe(false);
    expect(failed.passed).toBe(false); // a failed gated topic sinks the whole test
  });

  it("degrades to the overall rule when the attempt pinned no variant (FR-09)", () => {
    const r = aggregateStandardResult({
      overallPassRule: overall,
      sections: [section("T", byVariant, qs())], // no formId → overall 40
    });
    expect(r.topicResults[0].passed).toBe(true); // 50% >= 40
  });

  it("reports the rule that actually gated the topic (FR-10 label source)", () => {
    const r = aggregateStandardResult({
      overallPassRule: overall,
      sections: [
        { ...section("T", byVariant, qs()), formId: "fB" },
        { ...section("U", { source: "none" }, qs()) },
      ],
    });
    // raw rule is kept as-is; the resolved one is the delivered variant's threshold
    expect(r.topicResults[0].passRule).toEqual(byVariant);
    expect(r.topicResults[0].resolvedPassRule).toEqual({ type: "percent", value: 100 });
    // an ungated topic reports no resolved rule
    expect(r.topicResults[1].resolvedPassRule).toBeNull();
  });
});

// ─── adaptive aggregation ────────────────────────────────────────────────────────

/** A delivered level tally for `levelsState` (in sorted order). */
function lvlState(over: Partial<AdaptiveTopicInput["levelsState"][number]> = {}): AdaptiveTopicInput["levelsState"][number] {
  return { levelIndex: 0, levelName: "L", status: "passed", answeredCount: 2, correctCount: 2, ...over };
}

describe("aggregateAdaptiveResult", () => {
  it("resolves the achieved level POSITIONALLY and computes per-level percent + totals", () => {
    const r = aggregateAdaptiveResult({
      topics: [{
        topicId: "t1", topicName: "Тема",
        finalLevelIndex: 1, // POSITION in levelsState
        levelsState: [
          lvlState({ levelIndex: 0, levelName: "Низкий", status: "passed", answeredCount: 2, correctCount: 2 }),
          lvlState({ levelIndex: 1, levelName: "Средний", status: "passed", answeredCount: 4, correctCount: 3 }),
          lvlState({ levelIndex: 2, levelName: "Высокий", status: "pending", answeredCount: 0, correctCount: 0 }),
        ],
        levels: [
          { levelName: "Низкий", feedback: "f0", links: [{ title: "a", url: "u" }] },
          { levelName: "Средний", feedback: "f1", links: [{ title: "b", url: "v" }] },
          { levelName: "Высокий", feedback: "f2", links: [] },
        ],
      }],
    });
    const t = r.topicResults[0];
    expect(t.achievedLevelIndex).toBe(1);
    expect(t.achievedLevelName).toBe("Средний");
    expect(t.levelPercent).toBe(75); // 3/4
    expect(t.feedback).toBe("f1");
    expect(t.recommendedLinks).toEqual([{ title: "b", url: "v" }]);
    expect(t.totalQuestionsAnswered).toBe(6); // pending level excluded
    expect(t.totalCorrect).toBe(5);
    expect(t.levelsAttempted).toHaveLength(2); // only passed/failed
    expect(r.overallPassed).toBe(true);
  });

  it("REGRESSION: 1-based / non-contiguous levelIndex still resolves by POSITION (the old web value-match bug)", () => {
    // finalLevelIndex is a POSITION (1) — the middle slot. Its DB levelIndex is 2, not 1.
    // The retired web `.find(l => l.levelIndex === finalLevelIndex)` would have matched
    // levelIndex===1 (the FIRST slot) and reported the WRONG level. Positional is correct.
    const r = aggregateAdaptiveResult({
      topics: [{
        topicId: "t1", topicName: "Тема",
        finalLevelIndex: 1,
        levelsState: [
          lvlState({ levelIndex: 1, levelName: "Низкий", status: "passed", answeredCount: 2, correctCount: 1 }),
          lvlState({ levelIndex: 2, levelName: "Средний", status: "passed", answeredCount: 2, correctCount: 2 }),
          lvlState({ levelIndex: 3, levelName: "Высокий", status: "pending", answeredCount: 0, correctCount: 0 }),
        ],
        levels: [
          { levelName: "Низкий", feedback: "f-low", links: [] },
          { levelName: "Средний", feedback: "f-mid", links: [] },
          { levelName: "Высокий", feedback: "f-high", links: [] },
        ],
      }],
    });
    const t = r.topicResults[0];
    expect(t.achievedLevelName).toBe("Средний"); // position 1, NOT the levelIndex===1 row
    expect(t.feedback).toBe("f-mid");
    expect(t.levelPercent).toBe(100); // 2/2 of the middle slot
  });

  it("no level achieved → overallPassed=false, failure feedback + failure links", () => {
    const r = aggregateAdaptiveResult({
      topics: [{
        topicId: "t1", topicName: "Тема",
        finalLevelIndex: null,
        levelsState: [lvlState({ levelIndex: 0, status: "failed", answeredCount: 3, correctCount: 1 })],
        levels: [{ levelName: "Низкий", feedback: "f0", links: [{ title: "low", url: "u0" }] }],
        failureFeedback: "Тема не пройдена",
        failureLinks: [{ title: "low", url: "u0" }],
      }],
    });
    const t = r.topicResults[0];
    expect(t.achievedLevelIndex).toBeNull();
    expect(t.achievedLevelName).toBeNull();
    expect(t.levelPercent).toBe(0);
    expect(t.feedback).toBe("Тема не пройдена");
    expect(t.recommendedLinks).toEqual([{ title: "low", url: "u0" }]);
    expect(r.overallPassed).toBe(false);
  });

  it("guards an out-of-range finalLevelIndex (degrades to null, never throws)", () => {
    const r = aggregateAdaptiveResult({
      topics: [{
        topicId: "t1", topicName: "Тема",
        finalLevelIndex: 9, // out of range
        levelsState: [lvlState({ levelIndex: 0, status: "passed", answeredCount: 2, correctCount: 2 })],
        levels: [{ levelName: "Низкий", feedback: "f0", links: [] }],
      }],
    });
    const t = r.topicResults[0];
    expect(t.achievedLevelIndex).toBe(9); // echoed verbatim
    expect(t.achievedLevelName).toBeNull(); // but resolution is guarded
    expect(t.levelPercent).toBe(0);
    expect(r.overallPassed).toBe(true); // finalLevelIndex !== null
  });

  it("overallPassed is true only when EVERY topic achieved a level", () => {
    const ok: AdaptiveTopicInput = {
      topicId: "a", topicName: "A", finalLevelIndex: 0,
      levelsState: [lvlState()], levels: [{ levelName: "L" }],
    };
    const failed: AdaptiveTopicInput = {
      topicId: "b", topicName: "B", finalLevelIndex: null,
      levelsState: [lvlState({ status: "failed", correctCount: 0 })], levels: [{ levelName: "L" }],
    };
    expect(aggregateAdaptiveResult({ topics: [ok, ok] }).overallPassed).toBe(true);
    expect(aggregateAdaptiveResult({ topics: [ok, failed] }).overallPassed).toBe(false);
  });
});
