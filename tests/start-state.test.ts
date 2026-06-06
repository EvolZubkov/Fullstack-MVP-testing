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
});
