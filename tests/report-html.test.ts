/**
 * @module tests/report-html
 *
 * The attempt REPORT's markup (`shared/report/report-html`) — the single source both
 * hosts rasterize into the PDF. It used to live only inside the SCORM package, so the
 * web host had no report at all; these tests pin the contract that now spans both:
 * what the page prints, and the `.pdf-link-btn` chips `export-pdf` turns into real PDF
 * links.
 */

import { describe, it, expect } from "vitest";
import {
  buildReportHtml,
  buildAdaptiveReportHtml,
  reportFileName,
  sanitizeFileName,
  pluralize,
  formatTimestamp,
  type ReportInput,
  type AdaptiveReportInput,
} from "../shared/report/report-html";

const topic = (over: Record<string, unknown> = {}) => ({
  topicId: "t1",
  topicName: "Криптография",
  correct: 3,
  total: 5,
  percent: 60,
  earnedPoints: 3,
  possiblePoints: 5,
  passed: false as boolean | null,
  ...over,
});

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  testName: "Демо-тест",
  learnerName: "Ольга Швецова",
  timestamp: "2026-07-29T20:00:00.000Z",
  attemptsCount: 2,
  result: {
    passed: false,
    percent: 60,
    totalQuestions: 5,
    correct: 3,
    earnedPoints: 3,
    possiblePoints: 5,
    topicResults: [topic()],
  },
  ...over,
});

describe("report — standard page", () => {
  it("prints the verdict, the learner, the test and the score facts", () => {
    const html = buildReportHtml(input());
    expect(html).toContain("Тест не пройден");
    expect(html).toContain("Слушатель: Ольга Швецова");
    expect(html).toContain("Демо-тест");
    expect(html).toContain("60%");
    expect(html).toContain("3/5"); // correct / total
    expect(html).toContain("3.0"); // earned points, one decimal
  });

  it("counts attempts with the right Russian plural", () => {
    expect(buildReportHtml(input({ attemptsCount: 1 }))).toContain("за 1 попытку");
    expect(buildReportHtml(input({ attemptsCount: 2 }))).toContain("за 2 попытки");
    expect(buildReportHtml(input({ attemptsCount: 5 }))).toContain("за 5 попыток");
    // No attempt count at all still reads as one attempt, never «за 0 попыток».
    expect(buildReportHtml(input({ attemptsCount: undefined }))).toContain("за 1 попытку");
  });

  it("switches the headline when the test was passed", () => {
    const html = buildReportHtml(
      input({ result: { ...input().result, passed: true, percent: 100, correct: 5, earnedPoints: 5 } }),
    );
    expect(html).toContain("Тест пройден");
    expect(html).not.toContain("Тест не пройден");
  });

  it("recommends courses/events ONLY from failed topics, deduped", () => {
    const html = buildReportHtml(
      input({
        result: {
          ...input().result,
          topicResults: [
            topic({ recommendedCourses: [{ title: "Курс A", url: "https://e/a" }], recommendedEvents: [{ title: "Семинар B" }] }),
            // Same course again on another failed topic — must appear once.
            topic({ topicId: "t2", topicName: "Сети", recommendedCourses: [{ title: "Курс A", url: "https://e/a" }] }),
            // A PASSED topic contributes no guidance.
            topic({ topicId: "t3", topicName: "БД", passed: true, recommendedCourses: [{ title: "Курс C", url: "https://e/c" }] }),
          ],
        },
      }),
    );
    expect(html.match(/Курс A/g)).toHaveLength(1);
    expect(html).toContain("Семинар B");
    expect(html).not.toContain("Курс C");
  });

  it("marks course chips as PDF links (export-pdf turns them into real links)", () => {
    const html = buildReportHtml(
      input({ result: { ...input().result, topicResults: [topic({ recommendedCourses: [{ title: "Курс A", url: "https://e/a" }] })] } }),
    );
    expect(html).toContain('class="pdf-link-btn" data-url="https://e/a"');
  });

  it("shows per-topic feedback for FAILED topics only", () => {
    const failed = buildReportHtml(
      input({ result: { ...input().result, topicResults: [topic({ feedback: "Повторите материал" })] } }),
    );
    expect(failed).toContain("Повторите материал");
    const passed = buildReportHtml(
      input({ result: { ...input().result, topicResults: [topic({ passed: true, feedback: "Повторите материал" })] } }),
    );
    expect(passed).not.toContain("Повторите материал");
  });

  it("escapes author text", () => {
    const html = buildReportHtml(input({ testName: '<img src=x onerror="alert(1)">' }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("keeps the topic verdict readable: pill stacked under the name, never inline-clipped", () => {
    // Regression: side by side, the nowrap pill overflowed the three-column card
    // (`overflow: hidden`) and the verdict was cut off / overlapped the topic name.
    const html = buildReportHtml(input());
    expect(html).toContain("Не пройден");
    expect(html).toContain("display: inline-block");
    expect(html).not.toMatch(/justify-content: space-between;[^"]*align-items: flex-start/);
  });

  it("falls back to the gradient background and no logo when assets are missing", () => {
    const plain = buildReportHtml(input());
    expect(plain).toContain("linear-gradient(180deg, #1c1c2b 0%, #7700ff 100%)");
    expect(plain).not.toContain("<img");
    const branded = buildReportHtml(input(), { backgroundDataUrl: "data:image/png;base64,AA", logoDataUrl: "data:image/png;base64,BB" });
    expect(branded).toContain("background-image: url(data:image/png;base64,AA)");
    expect(branded).toContain('<img src="data:image/png;base64,BB"');
  });
});

const adaptiveInput = (over: Partial<AdaptiveReportInput> = {}): AdaptiveReportInput => ({
  testName: "Адаптивный тест",
  learnerName: "Ольга Швецова",
  timestamp: "2026-07-29T20:00:00.000Z",
  result: {
    topicResults: [
      { topicName: "Сети", achievedLevelIndex: 1, achievedLevelName: "Базовый", totalQuestionsAnswered: 10, totalCorrect: 4 },
      { topicName: "БД", achievedLevelIndex: null, achievedLevelName: null, totalQuestionsAnswered: 8, totalCorrect: 0 },
    ],
  },
  ...over,
});

describe("report — adaptive page", () => {
  it("prints levels instead of a score, wording the unreached topic as the screen does", () => {
    const html = buildAdaptiveReportHtml(adaptiveInput());
    expect(html).toContain("Адаптивное тестирование");
    expect(html).toContain("Базовый");
    // The learner opens this report FROM the results screen — same verdict, same words.
    expect(html).toContain("Минимально требуемый уровень не подтверждён");
    expect(html).not.toContain("Результат теста"); // no score card
  });

  it("prints the answered/correct counts on separate rows (no dangling separator)", () => {
    const html = buildAdaptiveReportHtml(adaptiveInput());
    expect(html).toContain("Вопросов: 10");
    expect(html).toContain("Правильных: 4");
    expect(html).not.toContain("| Правильных");
  });

  it("omits the counts row when the host has no counts", () => {
    const html = buildAdaptiveReportHtml(
      adaptiveInput({ result: { topicResults: [{ topicName: "Сети", achievedLevelIndex: 0, achievedLevelName: "Базовый" }] } }),
    );
    expect(html).not.toContain("Вопросов:");
  });

  it("lists recommended materials for every topic that has them", () => {
    const html = buildAdaptiveReportHtml(
      adaptiveInput({
        result: {
          topicResults: [
            {
              topicName: "Сети",
              achievedLevelIndex: null,
              achievedLevelName: null,
              recommendedCourses: [{ title: "Курс TCP/IP", url: "https://e/x" }],
            },
          ],
        },
      }),
    );
    expect(html).toContain("Рекомендуемые материалы");
    expect(html).toContain('class="pdf-link-btn" data-url="https://e/x"');
    expect(html).toContain("Курс TCP/IP");
  });
});

describe("report — file name and formatting helpers", () => {
  it("names the file «Результаты_<Тест>_дд_мм_гггг.pdf»", () => {
    expect(reportFileName("Демо тест", new Date(2026, 6, 30))).toBe("Результаты_Демо_тест_30_07_2026.pdf");
  });

  it("strips characters a file name cannot carry and caps the length", () => {
    expect(sanitizeFileName('Тест: "А/Б"')).toBe("Тест_АБ");
    expect(sanitizeFileName("x".repeat(80))).toHaveLength(50);
    expect(sanitizeFileName(null)).toBe("test");
  });

  it("plural forms follow the Russian teen exception", () => {
    expect(pluralize(11, "попытку", "попытки", "попыток")).toBe("попыток");
    expect(pluralize(21, "попытку", "попытки", "попыток")).toBe("попытку");
    expect(pluralize(23, "попытку", "попытки", "попыток")).toBe("попытки");
  });

  it("formats the attempt timestamp as дд.мм.гггг чч:мм", () => {
    expect(formatTimestamp(new Date(2026, 6, 5, 9, 7).toISOString())).toBe("05.07.2026 09:07");
  });
});
