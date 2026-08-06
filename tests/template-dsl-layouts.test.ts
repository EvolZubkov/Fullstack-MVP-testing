/**
 * @module tests/template-dsl-layouts
 *
 * Integration check that the DSL renderer (PRD-12 0-1,
 * shared/template/dsl) handles the REAL default-template layouts. This retires
 * the inventory risk "вёрстка опережает движок" (phase0-renderer-inventory.md):
 * layouts/results.html and start.html were authored in the target mustache DSL
 * before the engine existed. We render the actual files against a public context
 * and assert the `{{ }}` / `{{#if}}` / `{{#each}}` parts resolve, while the
 * `data-*` attributes (handled by the later DOM pass) pass through untouched.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderTemplate } from "../shared/template/dsl";

const LAYOUTS_DIR = path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts");

/** Permissive context covering every namespace the default layouts touch. */
const ctx = {
  course: { title: "Демо-тест", description: "Описание", questionCount: 10, passPercent: 70 },
  state: { questionCounterLabel: "Вопрос 1 из 10" },
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

describe("DSL renders real default-template layouts", () => {
  const files = fs.readdirSync(LAYOUTS_DIR).filter((f) => f.endsWith(".html"));

  it("finds the layout files", () => {
    expect(files).toContain("results.html");
    expect(files).toContain("start.html");
  });

  it.each(files)("compiles and renders %s without throwing", (file) => {
    const html = fs.readFileSync(path.join(LAYOUTS_DIR, file), "utf8");
    expect(() => renderTemplate(html, ctx)).not.toThrow();
  });

  it("resolves the mustache in results.html and leaves data-* attributes intact", () => {
    const html = fs.readFileSync(path.join(LAYOUTS_DIR, "results.html"), "utf8");
    const out = renderTemplate(html, ctx);

    // {{ result.passClass }} mixed into the verdict tag class resolves
    expect(out).toContain("ou-tag is-fail");
    expect(out).not.toContain("Поздравляем!");

    // {{#each result.topicResults}} iterated with item-scoped fields
    expect(out).toContain("Тема A");
    expect(out).toContain("Тема B");
    expect(out).toContain("Результаты по темам"); // {{#if result.topicResults}}

    // {{ percent }} inside an inline width style resolves per each-item
    expect(out).toContain("width: 80%");
    expect(out).toContain("width: 40%");

    // {{ result.passClass }} mixed into the ring fill class resolves
    expect(out).toContain("ou-ring__fill is-fail");

    // data-path is NOT a mustache tag — left verbatim for the DOM pass
    expect(out).toContain('data-path="course.title"');
  });

  it("handles {{#if}} guards in start.html (absent course fields -> skipped)", () => {
    const html = fs.readFileSync(path.join(LAYOUTS_DIR, "start.html"), "utf8");
    const out = renderTemplate(html, { course: { title: "X" } });
    // timeLimitMinutes / maxAttempts absent -> their blocks are dropped
    expect(out).not.toContain("Ограничение времени");
    expect(out).not.toContain("Попыток разрешено");
  });
});
