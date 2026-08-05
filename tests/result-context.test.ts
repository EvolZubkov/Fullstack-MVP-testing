// @vitest-environment jsdom
/**
 * @module tests/result-context
 *
 * End-to-end verification of the results bridge (PRD-12 task 2-4): the server
 * context builder (server/services/result-context) turns a computed AttemptResult
 * into the runtime context, which the unified renderer (shared/template/render-screen)
 * draws against the REAL default results layout. Proves resultJson → context →
 * correct DOM headless, before wiring any host.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildResultContext, buildAdaptiveResultContext } from "../server/services/result-context";
import { renderScreenInto } from "../shared/template/render-screen";
import type { AttemptResult } from "../shared/schema";

const resultsLayout = fs.readFileSync(
  path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "results.html"),
  "utf8",
);

const attemptResult: AttemptResult = {
  totalCorrect: 6,
  totalQuestions: 10,
  overallPercent: 60,
  totalEarnedPoints: 6,
  totalPossiblePoints: 10,
  overallPassed: false,
  topicResults: [
    { topicId: "t1", topicName: "Тема A", correct: 4, total: 5, percent: 80, earnedPoints: 4, possiblePoints: 5, passed: true, passRule: null, recommendedCourses: [] },
    { topicId: "t2", topicName: "Тема B", correct: 2, total: 5, percent: 40, earnedPoints: 2, possiblePoints: 5, passed: false, passRule: null, recommendedCourses: [] },
  ],
};

describe("buildResultContext (unit)", () => {
  const ctx = buildResultContext(attemptResult, "Демо-тест");

  it("maps score + presentational fields", () => {
    expect(ctx.course.title).toBe("Демо-тест");
    expect(ctx.result.scorePercent).toBe(60);
    expect(ctx.result.passed).toBe(false);
    expect(ctx.result.passClass).toBe("is-fail");
    expect(ctx.result.statusLabel).toBe("Не пройден");
  });

  it("maps per-topic rows with Core-prepared class + label", () => {
    const topics = ctx.result.topicResults as Array<Record<string, unknown>>;
    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({ topicName: "Тема A", percent: 80, passClass: "is-pass", statusLabel: "Пройдено" });
    expect(topics[1]).toMatchObject({ topicName: "Тема B", percent: 40, passClass: "is-fail", statusLabel: "Не пройдено" });
  });
});

describe("buildResultContext → render real results.html (e2e)", () => {
  const ctx = buildResultContext(attemptResult, "Демо-тест");
  const root = document.createElement("div");
  renderScreenInto(root, { layout: resultsLayout, context: ctx });

  it("binds title + score from the built context", () => {
    expect(root.querySelector('[data-path="course.title"]')?.textContent).toBe("Демо-тест");
    expect(root.querySelector('[data-path="result.scorePercent"]')?.textContent).toBe("60");
  });

  it("renders the fail verdict and the per-topic cards", () => {
    expect(root.querySelector(".tb-scene__headtag")?.textContent).toContain("Не пройден");
    expect(root.textContent).toContain("Тема A");
    expect(root.textContent).toContain("Тема B");
    const widths = Array.from(root.querySelectorAll(".tb-topic-card__bar .ou-progress__fill")).map(
      (b) => (b as HTMLElement).style.width,
    );
    expect(widths).toContain("80%");
    expect(widths).toContain("40%");
  });

  it("prepares the ring offset for the score ring", () => {
    expect(root.querySelector(".ou-ring__fill")?.getAttribute("stroke-dashoffset")).toBeTruthy();
  });
});

// TD-02: recommended courses (links) and events of the topics the learner has NOT
// mastered must surface on the web template results screen, deduped, mirroring the SCORM
// runtime (`vrRecommended`). «Not mastered» is everything except an explicit pass — the
// owner's one rule for all four things a topic carries; a topic with no verdict at all is
// the commonest case, since per-topic thresholds are rarely set.
describe("buildResultContext recommendations (TD-02 web parity)", () => {
  const withRecs: AttemptResult = {
    ...attemptResult,
    topicResults: [
      // Passed topic — its recommendations must be IGNORED.
      {
        topicId: "t1", topicName: "Тема A", correct: 4, total: 5, percent: 80,
        earnedPoints: 4, possiblePoints: 5, passed: true, passRule: null,
        recommendedCourses: [{ title: "Курс зачёт", url: "https://e.test/ok" }],
        recommendedEvents: [{ title: "Вебинар зачёт" }],
      },
      // Failed topic — its recommendations surface.
      {
        topicId: "t2", topicName: "Тема B", correct: 2, total: 5, percent: 40,
        earnedPoints: 2, possiblePoints: 5, passed: false, passRule: null,
        recommendedCourses: [{ title: "Курс по ИБ", url: "https://e.test/sec" }],
        recommendedEvents: [{ title: "Конференция по ИБ", url: "https://e.test/conf" }, { title: "Митап" }],
      },
      // Second failed topic — duplicate course (deduped) + duplicate event (deduped).
      {
        topicId: "t3", topicName: "Тема C", correct: 1, total: 5, percent: 20,
        earnedPoints: 1, possiblePoints: 5, passed: false, passRule: null,
        recommendedCourses: [{ title: "Курс по ИБ", url: "https://e.test/sec" }],
        recommendedEvents: [{ title: "Митап" }],
      },
      // Topic with NO verdict (no per-topic threshold) — nothing was judged, so it is not
      // a success and its recommendations surface too.
      {
        topicId: "t4", topicName: "Тема D", correct: 3, total: 5, percent: 60,
        earnedPoints: 3, possiblePoints: 5, passed: null, passRule: null,
        recommendedCourses: [{ title: "Курс по охране труда", url: "https://e.test/ot" }],
        recommendedEvents: [{ title: "Инструктаж" }],
      },
    ],
  } as AttemptResult;
  const ctx = buildResultContext(withRecs, "Демо-тест");

  it("aggregates + dedups courses/events of every topic except the PASSED one", () => {
    const courses = (ctx.result.recommendedCourses ?? []) as Array<{ title: string; url?: string }>;
    const events = (ctx.result.recommendedEvents ?? []) as Array<{ title: string; url?: string }>;
    expect(courses.map((c) => c.title)).toEqual(["Курс по ИБ", "Курс по охране труда"]);
    expect(events.map((e) => e.title)).toEqual(["Конференция по ИБ", "Митап", "Инструктаж"]);
  });

  it("renders the events into the real results.html", () => {
    const root = document.createElement("div");
    renderScreenInto(root, { layout: resultsLayout, context: ctx });
    expect(root.textContent).toContain("Конференция по ИБ");
    expect(root.textContent).toContain("Митап");
  });
});

// PRD-29 §6.7 on the WEB adapter. A test with neither scales nor indicators — the
// commonest configuration there is — never hands the shared builder a `measures` block,
// and the verdict gate used to live inside that branch. The result was a screen
// contradicting itself: a green «Пройден» in the header while the feedback block, gated
// by the same «does this test grade» question, printed underneath.
describe("вердикт контрольного теста (PRD-29 §6.7)", () => {
  const nothingGraded: AttemptResult = {
    ...attemptResult,
    overallPassed: true,
    totalCorrect: 0,
    totalQuestions: 0,
    overallPercent: 0,
    totalEarnedPoints: 0,
    totalPossiblePoints: 0,
    topicResults: [],
  };
  // What `resultsMaterialForAttempt` returns for a test without measurements: no scales,
  // no indicators, but the pass rule and the test's own feedback are read all the same.
  const controlMaterial = {
    scales: [],
    variables: [],
    blockSettings: {},
    hasPassThreshold: true,
    testFeedback: { text: "Повторите материал курса." },
  };

  it("порог есть, оценивать нечего — шапки нет, обратная связь на месте", () => {
    const ctx = buildResultContext(nothingGraded, "Опросник", controlMaterial);
    expect(ctx.result.statusLabel).toBe("");
    expect(ctx.result.passClass).toBe("");
    expect(ctx.result.recommendations?.texts).toEqual(["Повторите материал курса."]);
  });

  it("порога у теста нет — вердикта тоже нет", () => {
    const graded: AttemptResult = { ...nothingGraded, totalPossiblePoints: 10, totalEarnedPoints: 10, overallPercent: 100 };
    const ctx = buildResultContext(graded, "Без порога", { ...controlMaterial, hasPassThreshold: false });
    expect(ctx.result.statusLabel).toBe("");
  });

  it("порог и баллы на месте — вердикт остаётся, обратная связь молчит", () => {
    const graded: AttemptResult = { ...nothingGraded, totalPossiblePoints: 10, totalEarnedPoints: 10, overallPercent: 100 };
    const ctx = buildResultContext(graded, "Контрольный", controlMaterial);
    expect(ctx.result.statusLabel).toBe("Пройден");
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("в реальном макете плашка не рисуется вовсе", () => {
    const root = document.createElement("div");
    renderScreenInto(root, {
      layout: resultsLayout,
      context: buildResultContext(nothingGraded, "Опросник", controlMaterial),
    });
    expect(root.querySelector(".tb-scene__headtag .ou-tag")).toBeNull();
    expect(root.textContent).not.toContain("Пройден");
    expect(root.textContent).toContain("Повторите материал курса.");
  });
});

const adaptiveLayout = fs.readFileSync(
  path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "results.adaptive.html"),
  "utf8",
);

const adaptiveResult = {
  mode: "adaptive",
  overallPassed: true,
  topicResults: [
    {
      topicId: "a",
      topicName: "Внутренние коммуникации",
      achievedLevelIndex: 1,
      achievedLevelName: "Средний",
      feedback: "Ваш уровень знаний по данной теме — средний",
      recommendedCourses: [{ title: "Курс по коммуникациям", url: "https://example.test/comm" }],
    },
    {
      topicId: "b",
      topicName: "Безопасность",
      achievedLevelIndex: null,
      achievedLevelName: null,
      feedback: "",
      recommendedCourses: [],
    },
  ],
};

describe("buildAdaptiveResultContext → render real results.adaptive.html (e2e)", () => {
  const ctx = buildAdaptiveResultContext(adaptiveResult, "Адаптивный тест");
  const root = document.createElement("div");
  renderScreenInto(root, { layout: adaptiveLayout, context: ctx });

  it("renders the neutral hero with the test title", () => {
    expect(root.textContent).toContain("Тест завершён");
    expect(root.querySelector('[data-path="course.title"]')?.textContent).toBe("Адаптивный тест");
  });

  it("renders achieved level tags per topic", () => {
    expect(root.textContent).toContain("Внутренние коммуникации");
    expect(root.textContent).toContain("Средний");
    // A level was confirmed -> the neutral (solid accent) tone.
    expect(root.querySelector(".ou-tag.ou-tag--solid.ou-tag--accent")).not.toBeNull();
    // Nothing confirmed -> the label says so and the tone is the error one: the
    // learner did not reach even the minimum level the test defines.
    expect(root.textContent).toContain("Безопасность");
    expect(root.textContent).toContain("Минимально требуемый уровень не подтверждён");
    expect(root.querySelector(".ou-tag.ou-tag--solid.ou-tag--error")).not.toBeNull();
  });

  // The rung the learner stopped on is content, not colour: whichever level was
  // confirmed, the tag looks the same and only the label differs.
  it("gives every confirmed level the same tone, whatever its rung", () => {
    const built = buildAdaptiveResultContext(
      {
        mode: "adaptive",
        overallPassed: true,
        topicResults: [
          { topicName: "Верх", achievedLevelIndex: 2, achievedLevelName: "Продвинутый" },
          { topicName: "Низ", achievedLevelIndex: 0, achievedLevelName: "Базовый" },
        ],
      },
      "Адаптивный тест",
    );
    const rows = built.result.topicResults as Array<{ levelLabel: string; levelClass: string }>;
    expect(rows.map((r) => r.levelLabel)).toEqual(["Продвинутый", "Базовый"]);
    expect(rows[0].levelClass).toBe(rows[1].levelClass);
    expect(rows[0].levelClass).toBe("ou-tag--solid ou-tag--accent");
  });

  it("renders feedback and recommendations only where present (nested each)", () => {
    expect(root.textContent).toContain("Ваш уровень знаний по данной теме — средний");
    const link = root.querySelector("a.tb-rec") as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("https://example.test/comm");
    expect(link?.textContent).toContain("Курс по коммуникациям");
    // exactly one feedback block and one recommendation chip (second topic has neither)
    expect(root.querySelectorAll(".tb-topic-card__fb-text")).toHaveLength(1);
    expect(root.querySelectorAll(".tb-rec")).toHaveLength(1);
  });
});
