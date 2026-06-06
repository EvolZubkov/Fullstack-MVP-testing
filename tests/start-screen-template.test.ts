// @vitest-environment jsdom
/**
 * @module tests/start-screen-template
 *
 * Headless verification of the start (intro) screen template (PRD-12 #3): the real
 * default `start.html` renders the test info + the correct state-driven actions
 * (start / resume / exhausted) and custom content, via the unified renderer.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";

const startLayout = fs.readFileSync(
  path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "start.html"),
  "utf8",
);

const course = {
  title: "Базовые технологии",
  description: "Описание теста",
  questionCount: 40,
  passPercent: 80,
  timeLimitMinutes: 30,
  maxAttempts: 3,
  startPageContent: "Внимание: на прохождение даётся одна попытка в день.",
};

function render(state: Record<string, unknown>): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, { layout: startLayout, context: { course, state } });
  return root;
}

const actions = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[data-action]")).map((b) => b.getAttribute("data-action"));

describe("start.html — info + state-driven actions", () => {
  it("binds test info (title, counts, pass %, time, attempts) and custom content", () => {
    const root = render({ canStart: true, startLabel: "Начать тестирование" });
    expect(root.querySelector('[data-path="course.title"]')?.textContent).toBe("Базовые технологии");
    expect(root.querySelector('[data-path="course.questionCount"]')?.textContent).toBe("40");
    expect(root.querySelector('[data-path="course.passPercent"]')?.textContent).toBe("80");
    expect(root.textContent).toContain("Ограничение времени"); // {{#if timeLimitMinutes}}
    expect(root.textContent).toContain("Попыток разрешено"); // {{#if maxAttempts}}
    expect(root.textContent).toContain("одна попытка в день"); // {{#if startPageContent}}
  });

  it("fresh attempt: start + back, no resume/exhausted", () => {
    const root = render({ canStart: true, startLabel: "Начать тестирование", showBack: true });
    expect(actions(root)).toEqual(["start-test", "back"]);
    expect(root.querySelector('[data-action="start-test"]')?.textContent).toBe("Начать тестирование");
    expect(root.textContent).not.toContain("Попытки закончились");
  });

  it("in-progress: resume (labelled) + start (relabelled) + back", () => {
    const root = render({
      canResume: true,
      resumeLabel: "Продолжить тест",
      canStart: true,
      startLabel: "Начать заново",
      showBack: true,
    });
    expect(actions(root)).toEqual(["resume", "start-test", "back"]);
    expect(root.querySelector('[data-action="resume"]')?.textContent).toBe("Продолжить тест");
    expect(root.querySelector('[data-action="start-test"]')?.textContent).toBe("Начать заново");
  });

  it("exhausted: note + back only", () => {
    const root = render({ exhausted: true, canStart: false, canResume: false, showBack: true });
    expect(actions(root)).toEqual(["back"]);
    expect(root.textContent).toContain("Попытки закончились");
  });

  it("SCORM-richer actions gate on flags absent from the web context", () => {
    // The host superset: resume-with-restart + review + no back (the SCORM start).
    const root = render({
      canResume: true,
      resumeLabel: "Продолжить с места остановки",
      resumeNote: "Незавершённый тест — вопрос 2 из 5",
      canRestart: true,
      canViewResults: true,
    });
    expect(actions(root)).toEqual(["resume", "restart", "view-results"]);
    expect(root.textContent).toContain("Незавершённый тест — вопрос 2 из 5");
    expect(root.querySelector('[data-action="back"]')).toBeNull();
  });
});
