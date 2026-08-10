/**
 * @module tests/start-state
 *
 * Unit tests for the SHARED start-state builder (PRD-12 §10): the single source of
 * the start-screen action model (the four cases of the bespoke SCORM chrome) now
 * produced identically by both hosts. Each host feeds normalized facts; this
 * builder assembles the gated flags the `start.html` layout reads.
 */

import { describe, it, expect } from "vitest";
import { buildStartState } from "../shared/template/start-state";

const info = { title: "Тест", questionCount: 20, passPercent: 70, maxAttempts: 3 };

describe("buildStartState", () => {
  it("first entry: start only", () => {
    const { course, state } = buildStartState({
      info,
      maxAttempts: 3,
      completedAttempts: 0,
      resume: null,
      hasCompletedResults: false,
      canStartNew: true,
    });
    expect(course.title).toBe("Тест");
    expect(course.questionCount).toBe(20);
    expect(state.canStart).toBe(true);
    expect(state.startLabel).toBe("Начать тестирование");
    expect(state.canResume).toBe(false);
    expect(state.canViewResults).toBe(false);
    expect(state.exhausted).toBe(false);
  });

  it("resumable session: continue-with-position + restart + review", () => {
    const { state } = buildStartState({
      info,
      maxAttempts: 3,
      completedAttempts: 1,
      resume: { index: 6, total: 20 },
      hasCompletedResults: true,
      canStartNew: true,
    });
    expect(state.canResume).toBe(true);
    expect(state.resumeLabel).toBe("Продолжить с места остановки");
    expect(state.resumeNote).toBe("Незавершённый тест — вопрос 7 из 20");
    expect(state.canRestart).toBe(true);
    expect(state.canViewResults).toBe(true);
    expect(state.canStart).toBe(false);
  });

  it("attempts remain + has results (no resume): restart-anew + review", () => {
    const { state } = buildStartState({
      info,
      maxAttempts: 3,
      completedAttempts: 1,
      resume: null,
      hasCompletedResults: true,
      canStartNew: true,
    });
    expect(state.canStart).toBe(true);
    expect(state.startLabel).toBe("Начать тестирование заново");
    expect(state.canViewResults).toBe(true);
    expect(state.canResume).toBe(false);
  });

  it("attempts exhausted + has results: review only", () => {
    const { state } = buildStartState({
      info,
      maxAttempts: 3,
      completedAttempts: 3,
      resume: null,
      hasCompletedResults: true,
      canStartNew: false,
    });
    expect(state.canViewResults).toBe(true);
    expect(state.canStart).toBe(false);
    expect(state.exhausted).toBe(false);
  });

  it("attempts exhausted + nothing to review: exhausted note", () => {
    const { state } = buildStartState({
      info,
      maxAttempts: 3,
      completedAttempts: 3,
      resume: null,
      hasCompletedResults: false,
      canStartNew: false,
    });
    expect(state.exhausted).toBe(true);
    expect(state.canStart).toBe(false);
    expect(state.canViewResults).toBe(false);
  });

  it("unlimited attempts: never exhausted", () => {
    const { state } = buildStartState({
      info: { title: "T" },
      maxAttempts: null,
      completedAttempts: 99,
      resume: null,
      hasCompletedResults: false,
      canStartNew: true,
    });
    expect(state.exhausted).toBe(false);
    expect(state.canStart).toBe(true);
  });

  it("showBack flag is passed through (web vs SCORM)", () => {
    expect(buildStartState({ info, maxAttempts: null, completedAttempts: 0, hasCompletedResults: false, canStartNew: true, showBack: true }).state.showBack).toBe(true);
    expect(buildStartState({ info, maxAttempts: null, completedAttempts: 0, hasCompletedResults: false, canStartNew: true }).state.showBack).toBe(false);
  });

  describe("PRD-29 §6.7 на обложке — порог только у теста, который оценивает", () => {
    it("измерительный тест: «проходной балл» не показывается", () => {
      const { course } = buildStartState({
        info: { ...info, hasGradedContent: false },
        maxAttempts: 3,
        completedAttempts: 0,
        resume: null,
        hasCompletedResults: false,
        canStartNew: true,
      });
      // The layouts gate the fact on `{{#if course.passPercent}}` — null hides it.
      expect(course.passPercent).toBeNull();
      // Everything else on the cover is untouched.
      expect(course.questionCount).toBe(20);
      expect(course.maxAttempts).toBe(3);
    });

    it("флаг не передан (старый хост) — порог показывается как раньше", () => {
      const { course } = buildStartState({
        info,
        maxAttempts: 3,
        completedAttempts: 0,
        resume: null,
        hasCompletedResults: false,
        canStartNew: true,
      });
      expect(course.passPercent).toBe(70);
    });

    it("тест оценивает — порог показывается", () => {
      const { course } = buildStartState({
        info: { ...info, hasGradedContent: true },
        maxAttempts: 3,
        completedAttempts: 0,
        resume: null,
        hasCompletedResults: false,
        canStartNew: true,
      });
      expect(course.passPercent).toBe(70);
    });
  });

  describe("PRD-19 Block F — cooldown / prior result (FR-20)", () => {
    it("cooldown present: start disabled (via state.cooldown), no resume, review where available", () => {
      const { state } = buildStartState({
        info,
        maxAttempts: 3,
        completedAttempts: 1,
        resume: { index: 4, total: 20 }, // even with a resumable session, cooldown blocks it
        hasCompletedResults: true,
        canStartNew: true,
        cooldown: { availableDateHuman: "30.06.2026", daysUntil: 2 },
      });
      expect(state.cooldown).toEqual({ availableDateHuman: "30.06.2026", daysUntil: 2 });
      expect(state.canStart).toBe(false);
      expect(state.canResume).toBe(false);
      expect(state.canRestart).toBe(false);
      // FR-20: reviewing the prior result stays available where the host supplies it.
      expect(state.canViewResults).toBe(true);
    });

    it("cooldown without prior data (SCORM pre-Initialize): date only, no review", () => {
      const { state } = buildStartState({
        info,
        maxAttempts: 3,
        completedAttempts: 0,
        resume: null,
        hasCompletedResults: false, // pre-Initialize: suspend_data unavailable
        canStartNew: false,
        cooldown: { availableDateHuman: "30.06.2026" },
      });
      expect(state.cooldown?.availableDateHuman).toBe("30.06.2026");
      expect(state.canViewResults).toBe(false);
      expect(state.priorResult).toBeUndefined();
      expect(state.canDownloadReport).toBeUndefined();
    });

    it("prior result (failed): verdict label/class + attempts label, percent rounded", () => {
      const { state } = buildStartState({
        info,
        maxAttempts: 3,
        completedAttempts: 1,
        resume: null,
        hasCompletedResults: true,
        canStartNew: true,
        priorResult: { percent: 64.7, passed: false, attemptNumber: 2, maxAttempts: 3 },
        canDownloadReport: true,
      });
      // eligible retake: start enabled AND prior summary shown (FR-19 "повтор: можно")
      expect(state.canStart).toBe(true);
      expect(state.priorResult).toEqual({
        percent: 65,
        verdictLabel: "не пройдено",
        verdictClass: "prior-fail",
        attemptsLabel: "попытка 2 из 3",
      });
      expect(state.canDownloadReport).toBe(true);
    });

    it("prior result (passed): no fail class, no attempts label when counts absent", () => {
      const { state } = buildStartState({
        info: { title: "T" },
        maxAttempts: null,
        completedAttempts: 1,
        resume: null,
        hasCompletedResults: true,
        canStartNew: true,
        priorResult: { percent: 88, passed: true },
      });
      expect(state.priorResult).toEqual({
        percent: 88,
        verdictLabel: "пройдено",
        verdictClass: "",
        attemptsLabel: "",
      });
      // «Скачать отчёт» absent unless explicitly downloadable.
      expect(state.canDownloadReport).toBeUndefined();
    });

    it("prior result (no resolved verdict): empty verdict label/class", () => {
      const { state } = buildStartState({
        info: { title: "T" },
        maxAttempts: null,
        completedAttempts: 1,
        resume: null,
        hasCompletedResults: true,
        canStartNew: true,
        priorResult: { percent: 50, passed: null },
      });
      expect(state.priorResult?.verdictLabel).toBe("");
      expect(state.priorResult?.verdictClass).toBe("");
    });
  });
});
