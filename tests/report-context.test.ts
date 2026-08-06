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
import {
  buildResultContext,
  buildAdaptiveResultContext,
  NO_LEVEL_CONFIRMED_LABEL,
} from "../shared/template/result-context";
import { LEVEL_SCHEMES } from "../shared/template/level-ramp";
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

  it("вердикт темы трёхпозиционный: неопределённый НЕ печатается как «Не пройден»", () => {
    // Экран у темы без вердикта не показывает метку вовсе (`topicView`: passed ===
    // true / false / иначе пусто). Отчёт печатал ту же тему как «Не пройден», то есть
    // утверждал о ней то, чего экран не утверждает, — и делал это красной плашкой.
    const rows = (over: Record<string, unknown>) =>
      (buildReportContext(input({ result: { ...input().result, topicResults: [topic(over)] } }))
        .result.topicResults as any[])[0];
    expect(rows({ passed: true }).verdictLabel).toBe("Пройден");
    expect(rows({ passed: false }).verdictLabel).toBe("Не пройден");
    expect(rows({ passed: null }).verdictLabel).toBe("");
    expect(rows({ passed: undefined }).verdictLabel).toBe("");
    // Класс полосы и плашки идёт из общего построителя и уже трёхпозиционный —
    // пиннится здесь, чтобы пустая метка не осталась с красным классом.
    expect(rows({ passed: null }).passClass).toBe("");
  });

  it("в отчёте всегда есть строка баллов по теме", () => {
    // Отчёт — документ: досчитать баллы по теме читателю потом нечем.
    expect((buildReportContext(input()).result.topicResults as any[])?.[0].pointsLabel).toBe("3 / 5");
  });

  it("строка баллов по теме остаётся в отчёте даже при выключенной сводке (issue #30)", () => {
    // На ЭКРАНЕ выключенная сводка баллов гасит и построчный «Баллов» темы...
    const screen = buildResultContext(input().result, "Демо-тест", {
      withTopicPoints: true,
      hasPassThreshold: true,
      measures: {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler",
        indicatorKind: "label",
        scales: [],
        indicators: [],
        hasPassThreshold: true,
        blockSettings: { scoreSummary: "hide" },
      },
    });
    expect(screen.result.hideScoreSummary).toBe(true);
    expect((screen.result.topicResults as any[])[0].pointsLabel).toBeUndefined();

    // ...но у отчёта — скачанного документа — своей настройки нет, строка остаётся.
    const ctx = buildReportContext(input(), {
      measures: {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler",
        indicatorKind: "label",
        scales: [],
        indicators: [],
        hasPassThreshold: true,
        blockSettings: { scoreSummary: "hide" },
      },
    });
    expect((ctx.result.topicResults as any[])?.[0].pointsLabel).toBe("3 / 5");
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

/**
 * Обратная связь ТЕСТА, какой её нормализует хост (`normalizeFeedback`) перед сборкой
 * контекста: самый общий источник консолидированного блока, и первый в нём.
 */
const TEST_FEEDBACK = {
  text: "Разберите ошибки.",
  links: [{ title: "Курс по сетям", url: "https://e/net" }],
  events: [{ title: "Семинар по инфраструктуре" }],
  assets: [{ title: "Памятка теста", url: "assets/media/test.pdf" }],
};

/** Вложение темы, как его кладёт в результат попытки хост (адрес уже нормализован). */
const TOPIC_ASSET = { title: "Разбор темы", url: "assets/media/topic.pdf" };

/** Отчёт по попытке, в которой сработали все уровни обратной связи. */
const feedbackInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  ...input(),
  feedback: TEST_FEEDBACK,
  hasPassThreshold: true,
  result: {
    ...input().result,
    topicResults: [topic({ feedbackTexts: ["Текст темы", "Текст раздела"], recommendedAssets: [TOPIC_ASSET] })],
  },
  ...over,
});

/** Контекст ЭКРАНА на том же входе — эталон, с которым сверяется отчёт. */
const screenOf = (i: ReportInput) =>
  buildResultContext(i.result, i.testName || "", {
    withTopicPoints: true,
    ...(i.feedback ? { testFeedback: i.feedback } : {}),
    ...(i.hasPassThreshold !== undefined ? { hasPassThreshold: i.hasPassThreshold } : {}),
  });

describe("консолидированный блок обратной связи в отчёте", () => {
  it("совпадает с блоком ЭКРАНА на одном входе — состав, порядок, дедуп", () => {
    const ctx = buildReportContext(feedbackInput());
    expect(ctx.result.recommendations).toEqual(screenOf(feedbackInput()).result.recommendations);
    // Порядок пиннится явно: общее раньше частного, тест раньше темы.
    expect(ctx.result.recommendations?.texts).toEqual([
      "Разберите ошибки.",
      "Текст темы",
      "Текст раздела",
    ]);
    expect(ctx.result.recommendations?.assets).toEqual([
      { title: "Памятка теста", url: "assets/media/test.pdf" },
      TOPIC_ASSET,
    ]);
    expect(ctx.result.recommendations?.links).toEqual(TEST_FEEDBACK.links);
    expect(ctx.result.recommendations?.events).toEqual(TEST_FEEDBACK.events);
  });

  it("текст, написанный и у теста, и у темы, печатается один раз", () => {
    const ctx = buildReportContext(
      feedbackInput({
        result: {
          ...input().result,
          topicResults: [topic({ feedbackTexts: ["Разберите ошибки.", "Текст раздела"] })],
        },
      }),
    );
    expect(ctx.result.recommendations?.texts).toEqual(["Разберите ошибки.", "Текст раздела"]);
  });

  it("у ПРОЙДЕННОЙ темы ни текст, ни вложение в отчёт не идут", () => {
    const ctx = buildReportContext(
      feedbackInput({
        result: {
          ...input().result,
          topicResults: [
            topic({ passed: true, feedbackTexts: ["Текст темы"], recommendedAssets: [TOPIC_ASSET] }),
          ],
        },
      }),
    );
    // Обратная связь ТЕСТА при этом остаётся: тест-то не пройден.
    expect(ctx.result.recommendations?.texts).toEqual(["Разберите ошибки."]);
    expect(ctx.result.recommendations?.assets).toEqual([
      { title: "Памятка теста", url: "assets/media/test.pdf" },
    ]);
  });

  it("явно пройденный тест молчит и в отчёте", () => {
    const ctx = buildReportContext(
      feedbackInput({
        result: {
          ...input().result,
          passed: true,
          topicResults: [topic({ passed: true, feedbackTexts: ["Текст темы"] })],
        },
      }),
    );
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("отчёт без обратной связи блока не несёт", () => {
    expect(buildReportContext(input()).result.recommendations).toBeUndefined();
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

  it("несёт тот же консолидированный блок, что адаптивный ЭКРАН", () => {
    // Обратная связь — свойство ТЕСТА, а не режима выдачи: у адаптивного отчёта блок
    // собирается тем же сборщиком и из тех же источников.
    const withFeedback = adaptiveInput({
      feedback: TEST_FEEDBACK,
      result: {
        topicResults: [
          {
            topicName: "БД",
            achievedLevelIndex: null,
            achievedLevelName: null,
            feedbackTexts: ["Текст темы"],
            recommendedAssets: [TOPIC_ASSET],
          },
        ],
      },
    });
    const ctx = buildAdaptiveReportContext(withFeedback);
    const screen = buildAdaptiveResultContext(withFeedback.result, withFeedback.testName, {
      testFeedback: TEST_FEEDBACK,
    });
    expect(ctx.result.recommendations).toEqual(screen.result.recommendations);
    expect(ctx.result.recommendations?.texts).toEqual(["Разберите ошибки.", "Текст темы"]);
    expect(ctx.result.recommendations?.assets).toEqual([
      { title: "Памятка теста", url: "assets/media/test.pdf" },
      TOPIC_ASSET,
    ]);
  });

  it("тема с ПОДТВЕРЖДЁННЫМ уровнем своих материалов в отчёт не отдаёт", () => {
    const ctx = buildAdaptiveReportContext(
      adaptiveInput({
        result: {
          topicResults: [
            {
              topicName: "Сети",
              achievedLevelIndex: 1,
              achievedLevelName: "Базовый",
              feedbackTexts: ["Текст темы"],
              recommendedAssets: [TOPIC_ASSET],
            },
          ],
        },
      }),
    );
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("адаптивный отчёт без обратной связи блока не несёт", () => {
    expect(buildAdaptiveReportContext(adaptiveInput()).result.recommendations).toBeUndefined();
  });

  /**
   * issue #33. Отчёт не вправе показать иное, чем экран, с которого его скачали (§5.2),
   * поэтому измерения печатаются и в адаптивном документе — тем же сборщиком и с тем же
   * составом карточек.
   */
  describe("измерения в адаптивном отчёте", () => {
    const MEASURES = {
      ramp: LEVEL_SCHEMES.traffic,
      scaleKind: "band_ruler" as const,
      indicatorKind: "label" as const,
      scales: [
        {
          key: "comm",
          name: "Коммуникация",
          value: 8,
          visibility: "level_and_value" as const,
          interpretation: {
            domainMin: 0,
            domainMax: 10,
            valence: "higher_is_better" as const,
            bands: [
              { min: 0, max: 5, level: "low", label: "Низкий" },
              { min: 5.01, max: 10, level: "high", label: "Высокий" },
            ],
          },
        },
      ],
      indicators: [
        {
          key: "profile",
          name: "Профиль",
          value: "ok",
          visibility: "level" as const,
          interpretation: {
            domainMin: null,
            domainMax: null,
            valence: "none" as const,
            bands: [],
            outcomes: [{ code: "ok", label: "Устойчивый" }],
          },
        },
      ],
    };

    it("печатает шкалы и показатели", () => {
      const ctx = buildAdaptiveReportContext(adaptiveInput(), { measures: MEASURES });
      expect(ctx.result.scales?.map((s: any) => s.name)).toEqual(["Коммуникация"]);
      expect(ctx.result.scales?.[0].levelLabel).toBe("Высокий");
      expect(ctx.result.indicators?.map((i: any) => i.levelLabel)).toEqual(["Устойчивый"]);
    });

    it("без измерений документ прежний", () => {
      const ctx = buildAdaptiveReportContext(adaptiveInput());
      expect(ctx.result.scales).toBeUndefined();
      expect(ctx.result.indicators).toBeUndefined();
    });

    it("радар подчиняется переключателю ВАРИАНТА отчёта", () => {
      const threeAxes = {
        ...MEASURES,
        showRadar: true,
        scales: ["a", "b", "c"].map((key, i) => ({
          ...MEASURES.scales[0], key, name: `Шкала ${key}`, value: 2 + i * 3,
        })),
      };
      expect(buildAdaptiveReportContext(adaptiveInput(), { measures: threeAxes }).result.scalesChart?.axes)
        .toHaveLength(3);
      expect(
        buildAdaptiveReportContext(adaptiveInput(), { measures: { ...threeAxes, showRadar: false } })
          .result.scalesChart,
      ).toBeUndefined();
    });
  });
});
