/**
 * @module tests/report-context
 *
 * PRD-27 §5 — публичный контекст страницы отчёта.
 *
 * Два инварианта, которые здесь пиннятся:
 *   1. `result.*` приходит из ТОГО ЖЕ построителя, что у экрана результатов: отчёт не
 *      вправе показать иной вердикт, чем экран, с которого его скачали (§5.2);
 *   2. DSL ничего не считает — проценты, смещение дуги, колонки сетки, склонения и даты
 *      лежат в контексте ГОТОВЫМИ (§5.3).
 */

import { describe, it, expect } from "vitest";
import {
  buildReportContext,
  buildAdaptiveReportContext,
  reportGridColumns,
  attemptsCountLabel,
} from "../shared/report/report-context";
import { buildResultContext, NO_LEVEL_CONFIRMED_LABEL } from "../shared/template/result-context";
import type { ReportInput, AdaptiveReportInput } from "../shared/report/report-html";

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

describe("готовые значения (§5.3)", () => {
  it("колонки сетки тем: не больше трёх", () => {
    expect([0, 1, 2, 3, 7].map(reportGridColumns)).toEqual([1, 1, 2, 3, 3]);
  });

  it("подпись числа попыток склоняется и не бывает нулевой", () => {
    expect(attemptsCountLabel(1)).toBe("Лучший результат за 1 попытку");
    expect(attemptsCountLabel(3)).toBe("Лучший результат за 3 попытки");
    expect(attemptsCountLabel(11)).toBe("Лучший результат за 11 попыток");
    expect(attemptsCountLabel(undefined)).toBe("Лучший результат за 1 попытку");
    expect(attemptsCountLabel(0)).toBe("Лучший результат за 1 попытку");
  });
});

describe("контекст обычного отчёта", () => {
  it("result.* НЕ расходится с контекстом ЭКРАНА результатов (§5.2)", () => {
    const ctx = buildReportContext(input());
    const screen = buildResultContext(input().result, "Демо-тест", { withTopicPoints: true });
    expect(ctx.course).toEqual(screen.course);
    // Отчёт ДОПОЛНЯЕТ result.* своими готовыми подписями (§5.3), поэтому проверяется
    // надмножество: каждое поле, которым владеет экран, должно совпадать значение в
    // значение — иначе отчёт покажет иной вердикт, чем экран, с которого его скачали.
    for (const [key, value] of Object.entries(screen.result)) {
      if (key === "topicResults") continue;
      expect((ctx.result as Record<string, unknown>)[key], key).toEqual(value);
    }
    const screenRows = screen.result.topicResults ?? [];
    const reportRows = (ctx.result.topicResults ?? []) as Array<Record<string, unknown>>;
    expect(reportRows).toHaveLength(screenRows.length);
    screenRows.forEach((screenRow, i) => {
      for (const [key, value] of Object.entries(screenRow)) {
        expect(reportRows[i][key], key).toEqual(value);
      }
    });
  });

  it("несёт готовые дату, число попыток и колонки", () => {
    const ctx = buildReportContext(input());
    expect(ctx.report.attemptDateLabel).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    expect(ctx.report.attemptsCountLabel).toBe("Лучший результат за 2 попытки");
    expect(ctx.report.gridColumns).toBe(1);
  });

  it("гейтит строку слушателя по наличию имени", () => {
    expect(buildReportContext(input()).report.hasLearnerName).toBe(true);
    expect(buildReportContext(input({ learnerName: null })).report.hasLearnerName).toBe(false);
    // Пробелы именем не считаются: иначе макет напечатал бы «Слушатель:» без имени.
    expect(buildReportContext(input({ learnerName: "   " })).report.hasLearnerName).toBe(false);
  });

  it("в отчёте всегда есть строка баллов по теме", () => {
    // Отчёт — документ: досчитать баллы по теме читателю потом нечем.
    expect(buildReportContext(input()).result.topicResults?.[0].pointsLabel).toBe("3 / 5");
  });

  it("картинки приходят значениями полей ВАРИАНТА, а не отдельным блоком (FR-05)", () => {
    // Ядро не знает ни имён этих полей, ни их файлов: и то и другое объявляет шаблон.
    const withImages = buildReportContext(input(), {
      values: { backgroundImage: "data:image/png;base64,AA", logoImage: "data:image/png;base64,BB" },
    });
    expect(withImages.report.values.backgroundImage).toBe("data:image/png;base64,AA");
    expect(withImages.report.values.logoImage).toBe("data:image/png;base64,BB");

    // Вариант без картинок — в контексте их и нет, макет гейтит свои строки сам.
    const plain = buildReportContext(input());
    expect(plain.report.values).toEqual({});
    expect((plain.report as unknown as Record<string, unknown>).backgroundUrl).toBeUndefined();
    expect((plain.report as unknown as Record<string, unknown>).hasLogo).toBeUndefined();
  });

  it("значения settings[] варианта приходят в report.values", () => {
    const ctx = buildReportContext(input(), { values: { headline: "Итоги аттестации", showRecs: false } });
    expect(ctx.report.values).toEqual({ headline: "Итоги аттестации", showRecs: false });
  });

  it("копирует values, а не держит ссылку на объект хоста", () => {
    const values = { headline: "A" };
    const ctx = buildReportContext(input(), { values });
    values.headline = "B";
    expect(ctx.report.values.headline).toBe("A");
  });

  it("несёт design.* активного шаблона и признак предпросмотра", () => {
    const ctx = buildReportContext(input(), { design: { logoUrl: "/l.png" }, isPreview: true });
    expect(ctx.design).toEqual({ logoUrl: "/l.png" });
    expect(ctx.report.isPreview).toBe(true);
    expect(buildReportContext(input()).report.isPreview).toBe(false);
  });
});

const adaptiveInput = (over: Partial<AdaptiveReportInput> = {}): AdaptiveReportInput => ({
  testName: "Адаптивный тест",
  learnerName: "Ольга Швецова",
  timestamp: "2026-07-29T20:00:00.000Z",
  result: {
    topicResults: [
      { topicName: "Сети", achievedLevelIndex: 1, achievedLevelName: "Базовый", totalQuestionsAnswered: 10, totalCorrect: 4 },
      { topicName: "БД", achievedLevelIndex: null, achievedLevelName: null },
    ],
  },
  ...over,
});

describe("контекст адаптивного отчёта", () => {
  it("уровневые строки и та же формулировка недостигнутого уровня, что на экране", () => {
    const ctx = buildAdaptiveReportContext(adaptiveInput());
    expect(ctx.result.adaptive).toBe(true);
    const rows = ctx.result.topicResults as Array<Record<string, unknown>>;
    expect(rows[0].levelLabel).toBe("Базовый");
    expect(rows[1].levelLabel).toBe(NO_LEVEL_CONFIRMED_LABEL);
  });

  it("добавляет готовые счётчики и гейт для них", () => {
    const rows = buildAdaptiveReportContext(adaptiveInput()).result.topicResults as Array<Record<string, unknown>>;
    expect(rows[0].hasCounts).toBe(true);
    expect(rows[0].answeredLabel).toBe("Вопросов: 10");
    expect(rows[0].correctLabel).toBe("Правильных: 4");
    // Тема без счётчиков: макет обязан скрыть строку, а не печатать нули.
    expect(rows[1].hasCounts).toBe(false);
  });

  it("считает колонки по числу тем", () => {
    expect(buildAdaptiveReportContext(adaptiveInput()).report.gridColumns).toBe(2);
  });

  it("баллов у адаптивного отчёта нет", () => {
    const ctx = buildAdaptiveReportContext(adaptiveInput());
    expect(ctx.result.scorePercent).toBeUndefined();
    expect(ctx.result.earnedPoints).toBeUndefined();
  });
});
