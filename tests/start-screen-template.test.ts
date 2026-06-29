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

  describe("PRD-19 Block F — cooldown / prior result on the start screen (FR-20)", () => {
    it("cooldown (date only, SCORM pre-Initialize): cooldown card + DISABLED start, no actions", () => {
      const root = render({ cooldown: { availableDateHuman: "30.06.2026", daysUntil: 2 } });
      // Cooldown card with the next-available date and the derived «через N дн.».
      expect(root.querySelector(".start-cooldown")).toBeTruthy();
      expect(root.querySelector('[data-path="state.cooldown.availableDateHuman"]')?.textContent).toBe("30.06.2026");
      expect(root.textContent).toContain("через");
      expect(root.querySelector('[data-path="state.cooldown.daysUntil"]')?.textContent).toBe("2");
      // FR-20: start button rendered but DISABLED (not hidden), and NOT clickable.
      const disabled = root.querySelector(".start-btn[disabled]");
      expect(disabled?.textContent).toBe("Начать тестирование");
      expect(root.querySelector('[data-action="start-test"]')).toBeNull();
      // No prior result on the pre-Initialize SCORM path.
      expect(root.querySelector(".start-prior-row")).toBeNull();
      expect(actions(root)).toEqual([]);
    });

    it("cooldown + prior result + report (web): prior summary inside the cooldown card", () => {
      const root = render({
        cooldown: { availableDateHuman: "30.06.2026", daysUntil: 2 },
        priorResult: { percent: 65, verdictLabel: "не пройдено", verdictClass: "prior-fail", attemptsLabel: "попытка 2 из 3" },
        canViewResults: true,
        canDownloadReport: true,
      });
      const cd = root.querySelector(".start-cooldown")!;
      expect(cd.querySelector('[data-path="state.priorResult.percent"]')?.textContent).toBe("65");
      expect(cd.querySelector(".prior-fail")?.textContent).toBe("не пройдено");
      expect(cd.querySelector('[data-path="state.priorResult.attemptsLabel"]')?.textContent).toBe("попытка 2 из 3");
      // Review + download grouped in the card; start stays disabled (no start-test).
      expect(actions(root)).toEqual(["view-results", "download-report"]);
      expect(root.querySelector(".start-btn[disabled]")).toBeTruthy();
    });

    it("eligible retake (FR-19): separate prior card, start enabled, no duplicate review", () => {
      const root = render({
        canStart: true,
        startLabel: "Начать тестирование заново",
        canViewResults: true,
        canDownloadReport: true,
        priorResult: { percent: 88, verdictLabel: "пройдено", verdictClass: "", attemptsLabel: "" },
      });
      // Eligible ⇒ the prior summary is its own card, NOT the cooldown card.
      expect(root.querySelector(".start-prior")).toBeTruthy();
      expect(root.querySelector(".start-cooldown")).toBeNull();
      expect(root.querySelector(".prior-fail")).toBeNull(); // passed ⇒ no fail class
      // Review + download live in the prior card; the standalone start-actions
      // «Мой результат» is suppressed (no duplicate) when a prior card is shown.
      expect(actions(root)).toEqual(["view-results", "download-report", "start-test"]);
    });
  });
});
