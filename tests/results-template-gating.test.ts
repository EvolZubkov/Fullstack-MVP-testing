// @vitest-environment jsdom
/**
 * @module tests/results-template-gating
 *
 * Guards the PRD-12 host-superset invariant for the results layouts: the SCORM
 * runtime renders the SAME `results.html` / `results.adaptive.html` as the web
 * host, with the SCORM-richer parts (per-topic points / threshold / feedback,
 * recommended courses & events, the back action, the adaptive PDF/retry/finish
 * actions) gated on context flags the WEB context never sets. So the web output
 * must stay identical (those blocks absent) while the SCORM context lights them
 * up. This test renders each layout with a web-shaped and a SCORM-shaped context
 * and asserts the gating, protecting "web byte-identical, SCORM enriched".
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";

const layoutsDir = path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts");
const resultsLayout = fs.readFileSync(path.join(layoutsDir, "results.html"), "utf8");
const adaptiveLayout = fs.readFileSync(path.join(layoutsDir, "results.adaptive.html"), "utf8");

function render(layout: string, context: unknown): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, { layout, context });
  return root;
}

const actions = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[data-action]")).map((b) => b.getAttribute("data-action"));

// Minimal web-shaped context (the shape buildResultContext produces — no SCORM extras).
const webResult = {
  course: { title: "Тест" },
  result: {
    passed: true,
    passClass: "is-pass",
    statusLabel: "Пройден",
    scorePercent: 80,
    ringDashoffset: 79,
    totalQuestions: 5,
    correct: 4,
    earnedPoints: 4,
    possiblePoints: 5,
    topicResults: [
      { topicName: "Тема 1", correct: 4, total: 5, percent: 80, passClass: "is-pass", statusLabel: "Пройдено" },
    ],
  },
};

describe("results.html — superset gating", () => {
  it("web context: restart action only, no SCORM-only blocks", () => {
    const root = render(resultsLayout, webResult);
    expect(actions(root)).toEqual(["restart"]);
    expect(root.querySelector(".tb-topic-card__req")).toBeNull();
    expect(root.querySelector(".tb-recs")).toBeNull();
    // The score-strip "баллов" fact always shows; only the per-topic points ROW is
    // gated — so scope the check to the topic card.
    expect(root.querySelector(".tb-topic-card")?.textContent).not.toContain("Баллов");
    expect(root.querySelectorAll(".tb-topic-card .ou-stat-row").length).toBe(1); // "Правильно" only
  });

  it("SCORM context: points row + threshold + per-topic feedback + recommendations + back action", () => {
    const scorm = {
      course: { title: "Тест" },
      result: {
        ...webResult.result,
        topicResults: [
          {
            ...webResult.result.topicResults[0],
            pointsLabel: "4.0 / 5.0",
            requiredLabel: "Требуется: 70%",
            // Unified per-topic feedback (plan 6.1): feedback + courses + events.
            feedback: "Отличный результат",
            hasFeedback: true,
            recommendedCourses: [{ title: "Курс A", url: "https://e/a" }],
            recommendedEvents: [{ title: "Семинар B" }],
            hasRecommendations: true,
          },
        ],
        backAction: "back-to-start",
        backLabel: "Вернуться к тесту",
      },
    };
    const root = render(resultsLayout, scorm);
    expect(actions(root)).toEqual(["back-to-start"]); // restart is hidden via {{#unless backAction}}
    expect(root.querySelector(".tb-topic-card__req")?.textContent).toContain("70%");
    expect(root.querySelectorAll(".tb-topic-card .ou-stat-row").length).toBe(2); // "Правильно" + "Баллов"
    expect(root.querySelector(".tb-topic-card")?.textContent).toContain("Баллов");
    expect(root.textContent).toContain("4.0 / 5.0");
    // Recommendations are per-topic chips now (not a result-level section).
    expect(root.querySelector(".tb-topic-card__fb-text")?.textContent).toContain("Отличный результат");
    const recs = [...root.querySelectorAll(".tb-topic-card .tb-rec")].map((r) => r.textContent);
    expect(recs).toContain("Курс A");
    expect(recs).toContain("Семинар B");
    expect(root.querySelector('[data-action="back-to-start"]')?.textContent).toBe("Вернуться к тесту");
  });
});

const webAdaptive = {
  course: { title: "Адаптивный тест" },
  result: {
    adaptive: true,
    topicResults: [
      { topicName: "Сети", levelLabel: "Средний", levelClass: "ou-tag--solid ou-tag--accent", hasFeedback: false, hasLinks: false },
    ],
  },
};

describe("results.adaptive.html — superset gating", () => {
  it("web context: restart action only", () => {
    const root = render(adaptiveLayout, webAdaptive);
    expect(actions(root)).toEqual(["restart"]);
    expect(root.querySelector('[data-action="download-report"]')).toBeNull();
    expect(root.querySelector('[data-action="finish"]')).toBeNull();
  });

  it("report + retry + finish actions, no web restart", () => {
    const scorm = {
      course: { title: "Адаптивный тест" },
      result: {
        ...webAdaptive.result,
        hasScormActions: true,
        // ONE report contract across both results layouts: the adaptive footer used to
        // read `showPdf`/`download-pdf`, a spelling only the package filled — so the
        // web host offered no report on adaptive tests (see shared/template/results-nav).
        nav: { showReport: true },
        canRetry: true,
        showFinish: true,
      },
    };
    const root = render(adaptiveLayout, scorm);
    expect(actions(root)).toEqual(["download-report", "restart-adaptive", "finish"]);
    expect(root.querySelector('[data-action="restart"]')).toBeNull();
  });

  it("the report shows on the WEB adaptive footer too (nav is host-filled)", () => {
    const web = {
      course: { title: "Адаптивный тест" },
      result: { ...webAdaptive.result, showBack: true, nav: { showReport: true } },
    };
    const root = render(adaptiveLayout, web);
    expect(actions(root)).toEqual(["results-back", "download-report", "restart"]);
  });

  it("renders per-topic level pill + feedback/links only where present", () => {
    const ctx = {
      course: { title: "T" },
      result: {
        adaptive: true,
        topicResults: [
          {
            topicName: "Сети",
            levelLabel: "Средний",
            levelClass: "ou-tag--solid ou-tag--accent",
            feedback: "Хорошо",
            hasFeedback: true,
            hasRecommendations: true,
            recommendedCourses: [{ title: "Курс TCP/IP", url: "https://e/x" }],
            recommendedEvents: [],
          },
          { topicName: "БД", levelLabel: "Минимально требуемый уровень не подтверждён", levelClass: "ou-tag--solid ou-tag--error", hasFeedback: false, hasRecommendations: false },
        ],
      },
    };
    const root = render(adaptiveLayout, ctx);
    const cards = root.querySelectorAll(".tb-topic-card");
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector(".tb-topic-card__fb-text")?.textContent).toContain("Хорошо");
    expect(cards[0].querySelector("a.tb-rec")?.getAttribute("href")).toBe("https://e/x");
    expect(cards[1].querySelector(".tb-topic-card__fb-text")).toBeNull();
    expect(cards[1].querySelector(".ou-tag")?.textContent).toContain("Минимально требуемый уровень не подтверждён");
  });
});
