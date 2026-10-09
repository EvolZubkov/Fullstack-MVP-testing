/**
 * @module tests/pass-condition
 * @description The pass condition stated before the learner answers: the cover tile
 * (`course.passCondition`) and the section intro line, mark and timer warning
 * (`sectionIntro.passCondition` / `isRequired` / `timerWarning`). One shared module builds
 * them for both hosts; the rules mirror what `aggregateStandardResult` actually grades.
 */
import { describe, it, expect } from "vitest";
import {
  buildCoursePassCondition,
  sectionPassConditionText,
  sectionIsRequiredForVerdict,
  sectionTimerWarningText,
} from "../shared/template/pass-condition";
import { buildStartState } from "../shared/template/start-state";
import { buildSectionIntroContext } from "../shared/template/result-context";

const OVERALL = { type: "percent", value: 80 };
const CUSTOM = { source: "custom", type: "absolute", value: 7 };
const INHERIT = { source: "inherit_overall" };
const NONE = { source: "none" };

describe("cover — the topic part of the pass condition", () => {
  const sections = [
    { required: true, topicPassRule: CUSTOM },
    { required: true, topicPassRule: INHERIT },
    { required: false, topicPassRule: CUSTOM },
    { required: true, topicPassRule: NONE },
  ];

  it("«Все обязательные темы»: the gated required topics", () => {
    expect(buildCoursePassCondition("required_topics_only", OVERALL, sections)).toEqual({
      count: 2,
      total: 2,
      kind: "required",
      countLabel: "2 из 2",
      label: "обязательных тем для прохождения",
    });
  });

  it("«Общий результат и обязательные темы»: the same count", () => {
    expect(buildCoursePassCondition("overall_and_required_topics", OVERALL, sections)?.count).toBe(2);
  });

  it("«Все темы»: every gated topic, required or not", () => {
    const c = buildCoursePassCondition("all_topics_passed", OVERALL, sections);
    expect(c).toMatchObject({ count: 3, kind: "all", countLabel: "3 из 3", label: "тем для прохождения" });
  });

  it("an absent `required` reads as required, like the grader", () => {
    expect(buildCoursePassCondition("required_topics_only", OVERALL, [{ topicPassRule: CUSTOM }])?.count).toBe(1);
  });

  it("«как у теста» does not gate when the test has no overall rule", () => {
    const c = buildCoursePassCondition("required_topics_only", { type: "none", value: 0 }, [
      { required: true, topicPassRule: INHERIT },
      { required: true, topicPassRule: CUSTOM },
    ]);
    expect(c?.count).toBe(1);
  });

  it("a per-variant rule gates even before the variant is known", () => {
    const byVariant = { source: "by_variant", byForm: { f1: { type: "percent", value: 60 } } };
    const c = buildCoursePassCondition("required_topics_only", { type: "none", value: 0 }, [
      { required: true, topicPassRule: byVariant },
    ]);
    expect(c?.count).toBe(1);
  });

  it("no tile under «Только общий результат», for a legacy test and without gated topics", () => {
    expect(buildCoursePassCondition("overall_only", OVERALL, sections)).toBeNull();
    expect(buildCoursePassCondition(null, OVERALL, sections)).toBeNull();
    expect(buildCoursePassCondition("required_topics_only", OVERALL, [{ required: true, topicPassRule: NONE }])).toBeNull();
  });

  it("the start builder carries it, and drops it for a measurement method", () => {
    const base = {
      maxAttempts: 1,
      completedAttempts: 0,
      hasCompletedResults: false,
      canStartNew: true,
    };
    const info = { title: "T", passPercent: 80, passDecisionPolicy: "required_topics_only", overallPassRule: OVERALL, sections };
    expect(buildStartState({ ...base, info }).course.passCondition?.countLabel).toBe("2 из 2");
    expect(buildStartState({ ...base, info: { ...info, hasGradedContent: false } }).course.passCondition).toBeUndefined();
    expect("passCondition" in buildStartState({ ...base, info: { title: "T" } }).course).toBe(false);
  });
});

describe("section intro — the threshold line", () => {
  it("a percent rule", () => {
    expect(sectionPassConditionText({ type: "percent", value: 70 }, 10)).toBe("Для прохождения: 70 %");
  });

  it("a points rule, out of the delivered points", () => {
    expect(sectionPassConditionText({ type: "count", value: 7 }, 10)).toBe("Для прохождения: 7 баллов из 10");
    expect(sectionPassConditionText({ type: "count", value: 1 }, 5)).toBe("Для прохождения: 1 балл из 5");
    expect(sectionPassConditionText({ type: "count", value: 3 }, 5)).toBe("Для прохождения: 3 балла из 5");
    expect(sectionPassConditionText({ type: "count", value: 12 }, 20)).toBe("Для прохождения: 12 баллов из 20");
    expect(sectionPassConditionText({ type: "count", value: 7.5 }, 10.5)).toBe("Для прохождения: 7,5 балла из 10,5");
  });

  it("unknown delivered points: the threshold alone", () => {
    expect(sectionPassConditionText({ type: "count", value: 7 }, null)).toBe("Для прохождения: 7 баллов");
  });

  it("no line without a gate or with nothing to grade", () => {
    expect(sectionPassConditionText(null, 10)).toBe("");
    expect(sectionPassConditionText({ type: "percent", value: 70 }, 0)).toBe("");
  });
});

describe("section intro — the «Обязательная тема» mark", () => {
  const rule = { type: "count" as const, value: 7 };

  it("only where the obligation decides the verdict", () => {
    expect(sectionIsRequiredForVerdict("required_topics_only", true, rule)).toBe(true);
    expect(sectionIsRequiredForVerdict("overall_and_required_topics", undefined, rule)).toBe(true);
    expect(sectionIsRequiredForVerdict("overall_only", true, rule)).toBe(false);
    expect(sectionIsRequiredForVerdict("all_topics_passed", true, rule)).toBe(false);
    expect(sectionIsRequiredForVerdict(null, true, rule)).toBe(false);
  });

  it("not for an optional topic, nor for a topic without a threshold", () => {
    expect(sectionIsRequiredForVerdict("required_topics_only", false, rule)).toBe(false);
    expect(sectionIsRequiredForVerdict("required_topics_only", true, null)).toBe(false);
  });
});

describe("section intro — the timer warning", () => {
  it("names the button and the section budget", () => {
    expect(sectionTimerWarningText(17, "Далее")).toBe(
      "После нажатия кнопки «Далее» начнётся отсчёт времени раздела — 17 мин. Поставить тест на паузу будет нельзя.",
    );
  });

  it("no warning without a section limit", () => {
    expect(sectionTimerWarningText(null, "Далее")).toBe("");
    expect(sectionTimerWarningText(0, "Далее")).toBe("");
  });

  it("the builder puts all three on `sectionIntro`", () => {
    const { sectionIntro } = buildSectionIntroContext({
      sectionNumber: 2,
      sectionsTotal: 8,
      topicName: "Корпоративные финансы",
      questionCount: 10,
      timeLimitMinutes: 17,
      passRule: { type: "count", value: 7 },
      possiblePoints: 10,
      required: true,
      passDecisionPolicy: "required_topics_only",
    });
    expect(sectionIntro.passCondition).toBe("Для прохождения: 7 баллов из 10");
    expect(sectionIntro.isRequired).toBe(true);
    expect(sectionIntro.timerWarning).toContain("17 мин");
  });

  it("an input without the new facts builds the intro as before", () => {
    const { sectionIntro } = buildSectionIntroContext({ sectionNumber: 1, topicName: "T", questionCount: 3 });
    expect(sectionIntro.passCondition).toBe("");
    expect(sectionIntro.isRequired).toBe(false);
    expect(sectionIntro.timerWarning).toBe("");
  });
});
