/**
 * @module shared/template/question-progress-context.test
 * Unit tests for the PRD-19 Block C progress-pills builder.
 */
import { describe, it, expect } from "vitest";
import { buildQuestionProgress, type BuildQuestionProgressInput } from "./question-progress-context";

const flat: BuildQuestionProgressInput["questions"] = [
  { id: "q1" },
  { id: "q2" },
  { id: "q3" },
  { id: "q4" },
];

describe("buildQuestionProgress", () => {
  it("returns null when there are no questions", () => {
    expect(
      buildQuestionProgress({ questions: [], statuses: {}, currentIndex: 0, commitScope: "test" }),
    ).toBeNull();
  });

  it("returns null on an out-of-range current index (e.g. a content page)", () => {
    expect(
      buildQuestionProgress({ questions: flat, statuses: {}, currentIndex: -1, commitScope: "test" }),
    ).toBeNull();
  });

  it("flat scope: current is is-current, statuses map, counts, frontier blocks the future", () => {
    const r = buildQuestionProgress({
      questions: flat,
      statuses: { q1: "answered", q2: "skipped" },
      currentIndex: 2,
      commitScope: "test",
    })!;
    expect(r.total).toBe(4);
    expect(r.answeredCount).toBe(1);
    expect(r.skippedCount).toBe(1);
    expect(r.states.map((s) => s.statusClass)).toEqual(["is-answered", "is-skipped", "is-current", ""]);
    // Frontier: issued (<= current) are clickable; the future q4 is not.
    expect(r.states.map((s) => s.clickable)).toEqual([true, true, true, false]);
    // goto target is the absolute index; display number is 1-based.
    expect(r.states[0]).toMatchObject({ index: 0, number: 1 });
    expect(r.states[3].ariaLabel).toBe("Вопрос 4, не выдан");
  });

  it("sectional scope: pills are limited to the current section and renumbered", () => {
    const sectioned: BuildQuestionProgressInput["questions"] = [
      { id: "a1", topicId: "A" },
      { id: "a2", topicId: "A" },
      { id: "b1", topicId: "B" },
      { id: "b2", topicId: "B" },
    ];
    const r = buildQuestionProgress({
      questions: sectioned,
      statuses: { a1: "answered", a2: "answered", b1: "answered" },
      currentIndex: 3, // in section B
      commitScope: "section",
      scopeLabel: "Вопросы раздела «B»",
    })!;
    expect(r.scopeLabel).toBe("Вопросы раздела «B»");
    expect(r.total).toBe(2); // only B
    expect(r.states.map((s) => s.index)).toEqual([2, 3]); // absolute indices of B
    expect(r.states.map((s) => s.number)).toEqual([1, 2]); // renumbered within section
    expect(r.states[1].statusClass).toBe("is-current");
  });

  it("a committed section locks all its pills", () => {
    const sectioned: BuildQuestionProgressInput["questions"] = [
      { id: "a1", topicId: "A" },
      { id: "a2", topicId: "A" },
    ];
    const r = buildQuestionProgress({
      questions: sectioned,
      statuses: { a1: "answered", a2: "answered" },
      currentIndex: 1,
      commitScope: "section",
      sectionCommitted: { A: true },
    })!;
    expect(r.states.every((s) => !s.clickable)).toBe(true);
  });

  it("allIssued opens the frontier (review screen)", () => {
    const r = buildQuestionProgress({
      questions: flat,
      statuses: { q1: "answered", q2: "skipped" },
      currentIndex: flat.length, // past-the-end sentinel
      commitScope: "test",
      allIssued: true,
    })!;
    expect(r.states.every((s) => s.clickable)).toBe(true);
    // No is-current when past the end.
    expect(r.states.some((s) => s.statusClass === "is-current")).toBe(false);
  });

  it("strict mode (allowReturn=false) makes the whole map read-only", () => {
    const r = buildQuestionProgress({
      questions: flat,
      statuses: { q1: "answered", q2: "answered" },
      currentIndex: 2,
      commitScope: "test",
      allowReturn: false,
    })!;
    expect(r.states.every((s) => !s.clickable)).toBe(true);
    // Pills still render as a progress indicator.
    expect(r.total).toBe(4);
  });

  it("review marking applies correct/incorrect/unanswered classes", () => {
    const r = buildQuestionProgress({
      questions: flat,
      statuses: { q1: "answered", q2: "answered", q3: "skipped" },
      currentIndex: 3,
      commitScope: "test",
      reviewMarking: true,
      correctness: { q1: "correct", q2: "incorrect" },
    })!;
    expect(r.states.map((s) => s.statusClass)).toEqual([
      "is-correct",
      "is-incorrect",
      "is-unanswered",
      "is-unanswered",
    ]);
  });
});
