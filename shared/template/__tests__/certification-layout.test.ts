/**
 * @module shared/template/__tests__/certification-layout
 *
 * PRD-49 task 15. The "Сертификация" (certification) design template is brought to
 * parity with the default template's results-heading scheme: an UMBRELLA heading plus
 * one sub-block per entry of `result.blocks`, in the order the Core resolved — no
 * hard-coded block headings, no second copy of "which sub-block is visible / in what
 * order" in the markup.
 *
 * Certification's composition and order DIFFER from the default template on purpose
 * (read straight from the shipped layouts, not assumed):
 *   - `results.html`:          summary, indicators, scales, topics (indicators sit
 *                               BEFORE scales, unlike the default template).
 *   - `results.adaptive.html`: topics, indicators, scales (no summary block ever).
 * The manifest's `resultsBlockOrder` must declare exactly this per-screen composition,
 * or the guard the certification manifest test below performs would fail — that guard
 * is the parity check PRD-49 leaves to this template specifically (spec section 9: "no
 * automatic parity gate between templates, only the layout gate").
 *
 * The layouts and the manifest are read from disk on purpose: the contract under test
 * is the shipped files, not a fixture that could drift away from them.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compileTemplate } from "../dsl";

const LAYOUT = fs.readFileSync(
  path.join(process.cwd(), "templates/certification/layouts/results.html"),
  "utf-8",
);

const ADAPTIVE_LAYOUT = fs.readFileSync(
  path.join(process.cwd(), "templates/certification/layouts/results.adaptive.html"),
  "utf-8",
);

const SECTION_LAYOUT = fs.readFileSync(
  path.join(process.cwd(), "templates/certification/layouts/section-results.html"),
  "utf-8",
);

const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "templates/certification/manifest.json"), "utf-8"),
) as {
  labels: Array<{ key: string; default: string }>;
  resultsBlockOrder: Record<string, string[]>;
};

// Fixture wording is deliberately DIFFERENT from the strings the layout used to
// hard-code ("По шкалам", "Ваш результат", "Результаты по темам", "Рекомендации"): a
// test that reused those strings could pass even if the layout still printed them
// itself instead of reading the context, which is exactly the regression this file
// guards against.
const CTX = {
  course: { title: "Тест" },
  labels: {
    results: { heading: "Сводный результат", recommendations: "Что делать дальше" },
    facts: { questions: "заданий", correct: "правильно", points: "очков" },
    topic: { correct: "Верно", points: "Очки" },
    recommendations: { courses: "Обучающие курсы", events: "Встречи", assets: "Файлы" },
  },
  result: {
    passClass: "is-pass",
    statusLabel: "Пройден",
    scorePercent: 80,
    totalQuestions: 10,
    correct: 8,
    earnedPoints: 8,
    // Order matches the certification manifest's resultsBlockOrder.default:
    // summary, indicators, scales, topics.
    blocks: [
      { key: "summary", heading: "Итоговый балл", isSummary: true },
      { key: "indicators", heading: "Профиль показателей", isIndicators: true },
      { key: "scales", heading: "Измерения", isScales: true },
      { key: "topics", heading: "Разбивка по темам", isTopics: true },
    ],
    indicators: [
      { name: "Показатель", renderKind: "label", levelLabel: "Норма", bannerVariant: "info", showValue: true, valueLabel: "5" },
    ],
    scalesBlockClass: "tb-measures tb-measures--chart",
    scales: [{ name: "Шкала", renderKind: "band_ruler", levelLabel: "Высокий", toneClass: "" }],
    topicResults: [
      { topicName: "Тема", passClass: "is-pass", statusLabel: "Пройден", percent: 80, total: 5, correct: 4, pointsLabel: "4" },
    ],
  },
};

describe("certification results layout (PRD-49 task 15)", () => {
  it("prints the umbrella heading and the sub-block headings in the context order", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    const umbrella = html.indexOf("Сводный результат");
    const summary = html.indexOf("Итоговый балл");
    const indicators = html.indexOf("Профиль показателей");
    const scales = html.indexOf("Измерения");
    const topics = html.indexOf("Разбивка по темам");
    expect(umbrella).toBeGreaterThan(-1);
    expect(umbrella).toBeLessThan(summary);
    // Certification's own order: indicators before scales (unlike the default template).
    expect(summary).toBeLessThan(indicators);
    expect(indicators).toBeLessThan(scales);
    expect(scales).toBeLessThan(topics);
  });

  it("does not hard-code the old sub-block headings", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    expect(html).not.toContain("По шкалам");
    expect(html).not.toContain("Ваш результат");
    expect(html).not.toContain("Результаты по темам");
  });

  it("prints no umbrella heading when the author switched it off", () => {
    const html = compileTemplate(LAYOUT)({
      ...CTX,
      labels: { ...CTX.labels, results: { heading: "", recommendations: "Что делать дальше" } },
    });
    expect(html).not.toContain("Сводный результат");
  });

  it("prints a sub-block whose heading is switched off", () => {
    const blocks = [{ key: "summary", heading: "", isSummary: true }];
    const html = compileTemplate(LAYOUT)({ ...CTX, result: { ...CTX.result, blocks } });
    expect(html).toContain("tb-score-strip");
  });

  it("prints the fact and topic-card labels from the context", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    expect(html).toContain("заданий");
    expect(html).toContain("правильно");
    expect(html).toContain("очков");
    expect(html).toContain("Верно");
    expect(html).toContain("Очки");
  });

  it("prints the recommendations heading and group labels from the context", () => {
    const html = compileTemplate(LAYOUT)({
      ...CTX,
      result: {
        ...CTX.result,
        recommendations: { hasAny: true, links: [{ url: "https://x", title: "Курс" }] },
      },
    });
    expect(html).toContain("Что делать дальше");
    expect(html).not.toContain(">Рекомендации<");
    expect(html).toContain("Обучающие курсы");
    expect(html).not.toContain(">Пройти обучение<");
  });

  it("renders without throwing and without the umbrella heading when `labels` is absent from the context", () => {
    const { labels: _labels, ...ctxWithoutLabels } = CTX;
    let html = "";
    expect(() => {
      html = compileTemplate(LAYOUT)(ctxWithoutLabels);
    }).not.toThrow();
    // The umbrella is looked up via `labels.results.heading`, so it disappears.
    expect(html).not.toContain("Сводный результат");
    // Sub-block headings are already-resolved text on `result.blocks[].heading` (the
    // Core bakes them in before the layout ever sees `labels`), so they still print.
    expect(html).toContain("Итоговый балл");
    // Content itself still prints regardless.
    expect(html).toContain("tb-score-strip");
    expect(html).toContain("tb-measures__list");
    expect(html).toContain("tb-topics-grid");
  });

  // Scales and indicators live inside the SAME loop, so their markup is reached only
  // through `@root.` paths. Asserted by MARKUP classes, not by headings.
  it("prints the indicators and scales sections when their sub-blocks are visible", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    expect(html).toContain("tb-measures__list");
    expect(html).toContain('data-render="band_ruler"');
    expect(html).toContain('data-render="label"');
    expect(html).toContain("Шкала");
    expect(html).toContain("Показатель");
  });

  it("puts exactly one separator between adjacent sub-blocks", () => {
    const html = compileTemplate(LAYOUT)(CTX);
    const body = html.slice(html.indexOf("Итоговый балл"));
    // Three separators for four sub-blocks (summary | indicators | scales | topics).
    expect(body.match(/<hr class="ou-separator/g) ?? []).toHaveLength(3);
  });
});

const ADAPTIVE_CTX = {
  course: { title: "Тест" },
  labels: {
    results: { heading: "Итоги по разделам", recommendations: "Куда двигаться" },
    recommendations: { courses: "Курсы", events: "Мероприятия", assets: "Материалы" },
  },
  result: {
    // Order matches the certification manifest's resultsBlockOrder["results.adaptive"]:
    // topics, indicators, scales — never summary.
    blocks: [
      { key: "topics", heading: "Темы теста", isTopics: true },
      { key: "indicators", heading: "Индикаторы результата", isIndicators: true },
      { key: "scales", heading: "Шкальные измерения", isScales: true },
    ],
    topicResults: [
      { topicName: "Тема", levelClass: "is-pass", levelLabel: "Высокий", hasFeedback: false, hasRecommendations: false },
    ],
    indicators: [{ name: "Показатель", levelLabel: "Норма", bannerVariant: "info" }],
    scalesBlockClass: "tb-measures tb-measures--chart",
    scales: [{ name: "Шкала", renderKind: "band_ruler", levelLabel: "Высокий", toneClass: "" }],
  },
};

describe("certification adaptive results layout (PRD-49 task 15)", () => {
  it("prints the umbrella heading and the sub-block headings in the context order", () => {
    const html = compileTemplate(ADAPTIVE_LAYOUT)(ADAPTIVE_CTX);
    const umbrella = html.indexOf("Итоги по разделам");
    const topics = html.indexOf("Темы теста");
    const indicators = html.indexOf("Индикаторы результата");
    const scales = html.indexOf("Шкальные измерения");
    expect(umbrella).toBeGreaterThan(-1);
    expect(umbrella).toBeLessThan(topics);
    // Certification's own order: topics, THEN indicators, THEN scales.
    expect(topics).toBeLessThan(indicators);
    expect(indicators).toBeLessThan(scales);
  });

  it("does not hard-code the old sub-block headings", () => {
    const html = compileTemplate(ADAPTIVE_LAYOUT)(ADAPTIVE_CTX);
    expect(html).not.toContain("Результаты по темам");
    expect(html).not.toContain("По шкалам");
    // The umbrella replaces the old "Ваш результат" indicators heading, but the
    // screen's OWN static title ("Тест завершён") is not a PRD-49 label and stays.
    expect(html).not.toContain("Ваш результат");
    expect(html).toContain("Тест завершён");
  });

  it("prints the recommendations heading from the context, not a hard-coded one", () => {
    const html = compileTemplate(ADAPTIVE_LAYOUT)({
      ...ADAPTIVE_CTX,
      result: {
        ...ADAPTIVE_CTX.result,
        recommendations: { hasAny: true, texts: true, textsHtml: ["<p>Текст</p>"] },
      },
    });
    expect(html).toContain("Куда двигаться");
    expect(html).not.toContain(">Рекомендации<");
  });

  it("renders without throwing and without headings when `labels` is absent from the context", () => {
    const { labels: _labels, ...ctxWithoutLabels } = ADAPTIVE_CTX;
    let html = "";
    expect(() => {
      html = compileTemplate(ADAPTIVE_LAYOUT)(ctxWithoutLabels);
    }).not.toThrow();
    expect(html).not.toContain("Итоги по разделам");
    // Content itself still prints — only the headings are gone.
    expect(html).toContain("tb-topics-grid");
    expect(html).toContain("tb-measures__list");
  });
});

const SECTION_CTX = {
  course: { title: "Тест" },
  labels: {
    section: { eyebrow: "Итог раздела" },
    facts: { questions: "заданий", correct: "правильно" },
  },
  sectionResult: {
    topicName: "Раздел 1",
    scorePercent: 60,
    ringDashoffset: 120,
    passClass: "is-pass",
    statusLabel: "Раздел пройден",
    hasVerdict: true,
    correct: 3,
    total: 5,
    continueLabel: "Продолжить",
  },
};

describe("certification section-results layout (PRD-49 task 15)", () => {
  it("prints the section eyebrow and the fact labels from the context", () => {
    const html = compileTemplate(SECTION_LAYOUT)(SECTION_CTX);
    expect(html).toContain("Итог раздела");
    expect(html).toContain("заданий");
    expect(html).toContain("правильно");
    expect(html).not.toContain("Итоги раздела");
  });

  it("renders without throwing and without the eyebrow when `labels` is absent from the context", () => {
    const { labels: _labels, ...ctxWithoutLabels } = SECTION_CTX;
    let html = "";
    expect(() => {
      html = compileTemplate(SECTION_LAYOUT)(ctxWithoutLabels);
    }).not.toThrow();
    expect(html).not.toContain("Итог раздела");
    // Content itself still prints — only the labels are gone.
    expect(html).toContain('data-path="sectionResult.total"');
  });
});

describe("certification manifest (PRD-49 task 15, results-heading parity)", () => {
  it("declares all 15 label keys, each with a non-empty default", () => {
    const expectedKeys = [
      "results.heading",
      "results.recommendations",
      "results.summary",
      "results.scales",
      "results.indicators",
      "results.topics",
      "recommendations.courses",
      "recommendations.events",
      "recommendations.assets",
      "facts.questions",
      "facts.correct",
      "facts.points",
      "topic.correct",
      "topic.points",
      "section.eyebrow",
    ];
    expect(MANIFEST.labels).toBeTruthy();
    const declaredKeys = MANIFEST.labels.map((label) => label.key);
    expect([...declaredKeys].sort()).toEqual([...expectedKeys].sort());
    for (const label of MANIFEST.labels) {
      expect(typeof label.default).toBe("string");
      expect(label.default.length).toBeGreaterThan(0);
    }
  });

  it("declares resultsBlockOrder matching the ACTUAL composition and order of its own layouts", () => {
    // Read straight from the shipped results.html / results.adaptive.html (task
    // description, "проверь это сам по файлам") — not copied from the default
    // template's own order, which differs (indicators/scales are swapped here).
    expect(MANIFEST.resultsBlockOrder.default).toEqual(["summary", "indicators", "scales", "topics"]);
    expect(MANIFEST.resultsBlockOrder["results.adaptive"]).toEqual(["topics", "indicators", "scales"]);
  });

  it("cross-checks the declared order against the branch order actually present in results.html", () => {
    const order = ["isSummary", "isIndicators", "isScales", "isTopics"]
      .map((flag) => ({ key: flag.replace(/^is/, "").toLowerCase(), index: LAYOUT.indexOf(`{{#if ${flag}}}`) }))
      .filter((entry) => entry.index !== -1)
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.key);
    expect(order).toEqual(MANIFEST.resultsBlockOrder.default);
  });

  it("cross-checks the declared order against the branch order actually present in results.adaptive.html", () => {
    const order = ["isTopics", "isIndicators", "isScales"]
      .map((flag) => ({ key: flag.replace(/^is/, "").toLowerCase(), index: ADAPTIVE_LAYOUT.indexOf(`{{#if ${flag}}}`) }))
      .filter((entry) => entry.index !== -1)
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.key);
    expect(order).toEqual(MANIFEST.resultsBlockOrder["results.adaptive"]);
  });
});
