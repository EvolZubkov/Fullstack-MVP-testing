// @vitest-environment jsdom
/**
 * @module tests/render-screen
 *
 * jsdom verification of the unified renderer (PRD-12, shared/template/render-screen)
 * end-to-end on the REAL default results layout: DSL pass ({{#if}}/{{#unless}}/
 * {{#each}}/{{ }} incl. inside attributes) + the DOM passes (data-path text
 * bindings). Proves a layout + public context produce the expected DOM headless,
 * before the renderer is bundled into the SCORM package or mounted in the web host.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";

const resultsLayout = fs.readFileSync(
  path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "results.html"),
  "utf8",
);

const context = {
  course: { title: "Демо-тест" },
  result: {
    passed: false,
    ringDashoffset: 120,
    passClass: "is-fail",
    statusLabel: "Не пройден",
    scorePercent: 60,
    totalQuestions: 10,
    correct: 6,
    earnedPoints: 6,
    topicResults: [
      { topicName: "Тема A", passClass: "is-pass", statusLabel: "Пройдено", percent: 80, correct: 4, total: 5 },
      { topicName: "Тема B", passClass: "is-fail", statusLabel: "Не пройдено", percent: 40, correct: 2, total: 5 },
    ],
  },
};

describe("renderScreenInto — unified renderer on the real results layout", () => {
  const root = document.createElement("div");
  renderScreenInto(root, { layout: resultsLayout, context });

  it("resolves {{#if}} / {{#unless}} branches", () => {
    // {{#if result.topicResults}} (true) renders the per-topic section…
    expect(root.textContent).toContain("Результаты по темам");
    // …and {{#unless result.backAction}} (true — the context sets none) renders the
    // default restart button. The failed-verdict copy is now the bound statusLabel.
    expect(root.textContent).toContain("Пройти снова");
    expect(root.querySelector('[data-path="result.statusLabel"]')?.textContent).toBe("Не пройден");
  });

  it("iterates {{#each result.topicResults}} with item-scoped fields and attrs", () => {
    expect(root.textContent).toContain("Тема A");
    expect(root.textContent).toContain("Тема B");
    // Each topic's percent lands in its DS progress bar as an inline width.
    const widths = Array.from(root.querySelectorAll(".ou-progress__fill")).map((b) => b.getAttribute("style") || "");
    expect(widths.some((w) => w.includes("80%"))).toBe(true);
    expect(widths.some((w) => w.includes("40%"))).toBe(true);
  });

  it("binds [data-path] elements from the context (DOM pass)", () => {
    expect(root.querySelector('[data-path="course.title"]')?.textContent).toBe("Демо-тест");
    expect(root.querySelector('[data-path="result.scorePercent"]')?.textContent).toBe("60");
  });

  it("resolves {{ result.passClass }} mixed into a class attribute", () => {
    expect(root.querySelector(".ou-ring__fill")?.getAttribute("class")).toContain("is-fail");
  });

  it("fills a data-slot region with controlled HTML when provided", () => {
    const r2 = document.createElement("div");
    const layout = '<div class="q"><div data-slot="question-interaction"></div></div>';
    renderScreenInto(r2, { layout, context: {}, slots: { "question-interaction": "<button>A</button>" } });
    expect(r2.querySelector('[data-slot="question-interaction"]')?.innerHTML).toBe("<button>A</button>");
  });
});
