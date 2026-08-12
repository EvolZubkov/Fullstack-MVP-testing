/**
 * @module shared/template/__tests__/results-layout
 *
 * PRD-49. The STANDARD results layout of the default design template prints an
 * UMBRELLA heading plus one sub-block per entry of `result.blocks`, in the order
 * the Core resolved — no hard-coded block headings, no second copy of «which
 * sub-block is visible» in the markup.
 *
 * The layout is read from disk on purpose: the contract under test is the shipped
 * file, not a fixture that could drift away from it.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compileTemplate } from "../dsl";

const LAYOUT = fs.readFileSync(
  path.join(process.cwd(), "server/scorm/templates/default/layouts/results.html"),
  "utf-8",
);

const CTX = {
  course: { title: "Тест" },
  labels: {
    results: { heading: "Ваш результат", recommendations: "Рекомендации" },
    facts: { questions: "вопросов", correct: "верно", points: "баллов" },
    topic: { correct: "Правильно", points: "Баллов" },
    recommendations: { courses: "Пройти обучение", events: "Мероприятия", assets: "Материалы" },
  },
  result: {
    passClass: "is-pass",
    statusLabel: "Пройден",
    scorePercent: 80,
    totalQuestions: 10,
    correct: 8,
    earnedPoints: 8,
    blocks: [
      { key: "topics", heading: "По темам", isTopics: true },
      { key: "summary", heading: "Общий балл", isSummary: true },
    ],
    topicResults: [
      { topicName: "Тема", passClass: "is-pass", statusLabel: "Пройден", percent: 80, total: 5, correct: 4 },
    ],
  },
};

describe("results layout (PRD-49)", () => {
  it("prints the umbrella heading and the sub-block headings in the context order", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    const umbrella = html.indexOf("Ваш результат");
    const topics = html.indexOf("По темам");
    const summary = html.indexOf("Общий балл");
    expect(umbrella).toBeGreaterThan(-1);
    expect(umbrella).toBeLessThan(topics);
    expect(topics).toBeLessThan(summary);
  });

  it("prints no umbrella heading when the author switched it off", () => {
    const html = compileTemplate(LAYOUT)({
      ...CTX,
      labels: { ...CTX.labels, results: { heading: "", recommendations: "Рекомендации" } },
    });
    expect(html).not.toContain("Ваш результат");
  });

  it("prints a sub-block whose heading is switched off", () => {
    const blocks = [{ key: "summary", heading: "", isSummary: true }];
    const html = compileTemplate(LAYOUT)({ ...CTX, result: { ...CTX.result, blocks } });
    expect(html).toContain("tb-score-strip");
  });

  it("prints the fact labels from the context", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    expect(html).toContain("вопросов");
    expect(html).toContain("баллов");
  });

  it("prints nothing of the umbrella when no sub-block is visible", () => {
    const html = compileTemplate(LAYOUT)({ ...CTX, result: { ...CTX.result, blocks: [] } });
    expect(html).not.toContain("Ваш результат");
    expect(html).not.toContain("tb-score-strip");
  });

  // Scales and indicators live inside the SAME loop, so their markup is reached only
  // through `@root.` paths. Asserted by MARKUP classes, not by headings: the headings now
  // come from the context and would pass even if the branch printed nothing else.
  it("prints the scales and indicators sections when their sub-blocks are visible", () => {
    const html = compileTemplate(LAYOUT)({
      ...CTX,
      result: {
        ...CTX.result,
        blocks: [
          { key: "scales", heading: "По шкалам", isScales: true },
          { key: "indicators", heading: "Показатели", isIndicators: true },
        ],
        scalesBlockClass: "tb-measures tb-measures--chart",
        scales: [{ name: "Шкала", renderKind: "band_ruler", levelLabel: "Высокий", toneClass: "" }],
        indicators: [{ name: "Показатель", renderKind: "label", levelLabel: "Норма", bannerVariant: "info" }],
      },
    });
    expect(html).toContain("tb-measures__list");
    expect(html).toContain('data-render="band_ruler"');
    expect(html).toContain('data-render="label"');
    expect(html).toContain("Шкала");
    expect(html).toContain("Показатель");
  });

  // The separator is the LOOP's business now: one `{{#unless @first}}` instead of the old
  // per-block conditions. Two sub-blocks = exactly one rule between them.
  it("puts exactly one separator between two sub-blocks", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    const body = html.slice(html.indexOf("По темам"));
    expect(body.match(/<hr class="ou-separator/g) ?? []).toHaveLength(1);
  });

  // `data-path` nodes are filled by the DOM pass, which addresses them by attribute: a
  // duplicated node would be filled twice and the screen would print the number twice.
  it("keeps every data-path node unique", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    const paths = (html.match(/data-path="[^"]+"/g) ?? []).filter(
      (p) => p !== 'data-path="result.totalQuestions"', // the strip prints it twice by design
    );
    expect(new Set(paths).size).toBe(paths.length);
  });
});
