/**
 * @module tests/result-context-parity
 *
 * Locks the SHARED results-context builder (PRD-12 §10): the single source of the
 * results shaping (passClass / statusLabel / ring offset / per-topic rows / adaptive
 * level labels). Proves (a) the base output (web) and the SCORM-opts output, and
 * (b) PARITY — the web adapter (server/services/result-context, from an AttemptResult)
 * and a direct shared call on the equivalent normalized input produce the identical
 * `result` core, so the two hosts cannot drift.
 */

import { describe, it, expect } from "vitest";
import {
  buildResultContext as sharedBuild,
  buildAdaptiveResultContext as sharedAdaptive,
} from "../shared/template/result-context";
import {
  buildResultContext as webBuild,
  buildAdaptiveResultContext as webAdaptiveBuild,
  buildReportInput,
  buildAdaptiveReportInput,
} from "../server/services/result-context";
import { buildReportContext, buildAdaptiveReportContext } from "../shared/report/report-context";

const normalized = {
  passed: true,
  percent: 80,
  totalQuestions: 5,
  totalCorrect: 4,
  totalEarnedPoints: 4,
  totalPossiblePoints: 5,
  // shared input field names:
};

const sharedInput = {
  passed: true,
  percent: 80,
  totalQuestions: 5,
  correct: 4,
  earnedPoints: 4,
  possiblePoints: 5,
  topicResults: [
    { topicId: "t1", topicName: "Тема 1", correct: 4, total: 5, percent: 80, earnedPoints: 4, possiblePoints: 5, passed: true },
  ],
};

// The web's AttemptResult shape (overall*/total*) for the same data.
const attemptResult = {
  overallPassed: true,
  overallPercent: 80,
  totalQuestions: 5,
  totalCorrect: 4,
  totalEarnedPoints: 4,
  totalPossiblePoints: 5,
  topicResults: [
    { topicId: "t1", topicName: "Тема 1", correct: 4, total: 5, percent: 80, earnedPoints: 4, possiblePoints: 5, passed: true },
  ],
} as any;

describe("shared buildResultContext", () => {
  it("base output: Core-prepared fields, no SCORM extras", () => {
    const { result } = sharedBuild(sharedInput, "Тест");
    expect(result.passClass).toBe("is-pass");
    expect(result.statusLabel).toBe("Пройден");
    expect(result.scorePercent).toBe(80);
    expect(result.ringDashoffset).toBe(Math.round(2 * Math.PI * 63 * 0.2));
    const t0 = (result.topicResults as any[])[0];
    expect(t0.passClass).toBe("is-pass");
    expect(t0.statusLabel).toBe("Пройдено");
    expect(t0.pointsLabel).toBeUndefined(); // web omits the points row
    expect(result.recommendedCourses).toBeUndefined();
    expect(result.backAction).toBeUndefined();
  });

  it("SCORM opts: points row + recommendations + back action", () => {
    const { result } = sharedBuild(
      { ...sharedInput, topicResults: [{ ...sharedInput.topicResults[0], requiredLabel: "Требуется: 70%", feedback: "ок" }] },
      "Тест",
      {
        withTopicPoints: true,
        recommendedCourses: [{ title: "Курс", url: "#" }],
        backAction: "back-to-start",
        backLabel: "Назад",
      },
    );
    const t0 = (result.topicResults as any[])[0];
    expect(t0.pointsLabel).toBe("4 / 5");
    expect(t0.requiredLabel).toBe("Требуется: 70%");
    // Текст обратной связи в строку темы не попадает и в стандартном режиме не
    // печатается — он живёт в консолидированном блоке.
    expect(t0.feedback).toBeUndefined();
    expect(result.recommendedCourses?.length).toBe(1);
    expect(result.backAction).toBe("back-to-start");
  });
});

describe("host parity", () => {
  it("web adapter (AttemptResult) === shared base on equivalent input", () => {
    const web = webBuild(attemptResult, "Тест");
    const shared = sharedBuild(sharedInput, "Тест");
    expect(web).toEqual(shared);
  });

  // PRD-32 (приёмочный дефект Д-2). Веб хранит вложения темы и раздела в самом
  // результате попытки, пакет запекает их в раздел TEST_DATA — но дальше оба хоста
  // отдают их ОДНОМУ общему сборщику под одним именем, поэтому блок «Материалы»
  // на обоих экранах один и тот же.
  // Тема здесь НЕ пройдена: материалы темы отдаются ученику только при провале
  // (согласованное решение владельца — одно правило на текст, курсы и вложения темы).
  it("вложения темы/раздела: адаптер веба === общий сборщик на том же входе", () => {
    const assets = [{ title: "Разбор темы", url: "/api/media/aaaa" }];
    const web = webBuild(
      { ...attemptResult, topicResults: [{ ...attemptResult.topicResults[0], passed: false, recommendedAssets: assets }] },
      "Тест",
    );
    const shared = sharedBuild(
      { ...sharedInput, topicResults: [{ ...sharedInput.topicResults[0], passed: false, recommendedAssets: assets }] },
      "Тест",
    );
    expect(web).toEqual(shared);
    expect(web.result.recommendations?.assets).toEqual(assets);
  });

  // Тексты обратной связи темы и раздела ходят тем же путём, что вложения: веб хранит
  // их в результате попытки (`TopicResult.feedbackTexts`), пакет запечёт их в раздел
  // TEST_DATA — и оба отдадут общему сборщику ОДНО поле `feedbackTexts`, поэтому
  // консолидированный блок на обоих экранах одинаков.
  it("тексты темы/раздела: адаптер веба === общий сборщик на том же входе", () => {
    const feedbackTexts = ["Текст темы", "Текст раздела"];
    const web = webBuild(
      { ...attemptResult, topicResults: [{ ...attemptResult.topicResults[0], passed: false, feedbackTexts }] },
      "Тест",
    );
    const shared = sharedBuild(
      { ...sharedInput, topicResults: [{ ...sharedInput.topicResults[0], passed: false, feedbackTexts }] },
      "Тест",
    );
    expect(web).toEqual(shared);
    expect(web.result.recommendations?.texts).toEqual(feedbackTexts);
  });

  // Дефект Д-3. Веб собирает `testFeedback` из своего `MeasuresSource`, пакет — из
  // `TEST_DATA.testFeedbackJson`, но оба отдают его общему сборщику ОДНОЙ опцией,
  // не завязанной на измерения. Тест без шкал и показателей — общий случай.
  it("обратная связь теста без измерений: адаптер веба === общий сборщик", () => {
    const feedback = {
      format: "plain",
      text: "Спасибо за участие.",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "/api/media/cccc" }],
    };
    // Попытка ПРОВАЛЕНА: обратную связь теста ученик получает во всех состояниях, кроме
    // явного успеха, поэтому именно провал показывает, что она доезжает целиком.
    const web = webBuild({ ...attemptResult, overallPassed: false }, "Опрос", {
      scales: [],
      variables: [],
      blockSettings: {},
      hasPassThreshold: true,
      testFeedback: feedback,
    } as never);
    const shared = sharedBuild({ ...sharedInput, passed: false }, "Опрос", {
      hasPassThreshold: true,
      testFeedback: { text: "Спасибо за участие.", links: [], events: [], assets: [{ title: "Памятка", url: "/api/media/cccc" }] },
    });
    expect(web).toEqual(shared);
    expect(web.result.recommendations?.texts).toEqual(["Спасибо за участие."]);
    expect(web.result.recommendations?.assets).toEqual([{ title: "Памятка", url: "/api/media/cccc" }]);
  });

  // Гейт по вердикту ТЕСТА: пройденный тест не показывает работу над ошибками. Веб
  // достаёт признак порога из `MeasuresSource`, который его маршрут читает для КАЖДОЙ
  // попытки, пакет — из `TEST_DATA.overallPassRule`; общему сборщику оба отдают одну
  // опцию, поэтому молчать или говорить они обязаны одинаково.
  it("явно пройденный тест: оба хоста молчат об обратной связи теста", () => {
    const feedback = { format: "plain", text: "Разберите ошибки.", links: [], events: [], assets: [] };
    const web = webBuild(attemptResult, "Контрольный", {
      scales: [],
      variables: [],
      blockSettings: {},
      hasPassThreshold: true,
      testFeedback: feedback,
    } as never);
    const shared = sharedBuild(sharedInput, "Контрольный", {
      hasPassThreshold: true,
      testFeedback: { text: "Разберите ошибки.", links: [], events: [], assets: [] },
    });
    expect(web).toEqual(shared);
    expect(web.result.recommendations).toBeUndefined();
  });

  it("тест без порога: оба хоста показывают его обратную связь и при passed", () => {
    // Край PRD-29 на обоих хостах сразу: вердикт не выносился, и обратная связь — это
    // и есть результат измерительного метода.
    const feedback = { format: "plain", text: "Ваш профиль.", links: [], events: [], assets: [] };
    const web = webBuild(attemptResult, "Маслач", {
      scales: [],
      variables: [],
      blockSettings: {},
      hasPassThreshold: false,
      testFeedback: feedback,
    } as never);
    const shared = sharedBuild(sharedInput, "Маслач", {
      hasPassThreshold: false,
      testFeedback: { text: "Ваш профиль.", links: [], events: [], assets: [] },
    });
    expect(web).toEqual(shared);
    expect(web.result.recommendations?.texts).toEqual(["Ваш профиль."]);
  });
});

/**
 * Отчёт веб-хоста собирается КЛИЕНТОМ из входа, который готовит этот же адаптер, и
 * обязан нести тот же консолидированный блок, что экран той же попытки: тексты теста,
 * тем и разделов, курсы, мероприятия и вложения — в одном составе и порядке.
 */
describe("вход отчёта питает блок экрана", () => {
  const material = {
    scales: [],
    variables: [],
    blockSettings: {},
    hasPassThreshold: true,
    testFeedback: {
      format: "plain",
      text: "Разберите ошибки.",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "/api/media/cccc" }],
    },
  } as never;

  const failedTopic = {
    ...attemptResult.topicResults[0],
    passed: false,
    feedbackTexts: ["Текст темы", "Текст раздела"],
    recommendedAssets: [{ title: "Разбор темы", url: "/api/media/aaaa" }],
  };

  it("стандартный: контекст отчёта === блок экрана на той же попытке", () => {
    const result = { ...attemptResult, overallPassed: false, topicResults: [failedTopic] };
    const screen = webBuild(result, "Тест", material);
    const report = buildReportContext(buildReportInput(result, "Тест", {}, material));
    expect(report.result.recommendations).toEqual(screen.result.recommendations);
    expect(report.result.recommendations?.texts).toEqual([
      "Разберите ошибки.",
      "Текст темы",
      "Текст раздела",
    ]);
  });

  it("адаптивный: контекст отчёта === блок адаптивного экрана", () => {
    const result = {
      overallPassed: false,
      topicResults: [
        {
          topicName: "БД",
          achievedLevelIndex: null,
          achievedLevelName: null,
          feedbackTexts: ["Текст темы"],
          recommendedAssets: [{ title: "Разбор темы", url: "/api/media/aaaa" }],
        },
      ],
    } as never;
    const screen = webAdaptiveBuild(result, "Адаптивный", material);
    const report = buildAdaptiveReportContext(buildAdaptiveReportInput(result, "Адаптивный", {}, material));
    expect(report.result.recommendations).toEqual(screen.result.recommendations);
    expect(report.result.recommendations?.texts).toEqual(["Разберите ошибки.", "Текст темы"]);
    expect(report.result.recommendations?.assets).toEqual([
      { title: "Памятка", url: "/api/media/cccc" },
      { title: "Разбор темы", url: "/api/media/aaaa" },
    ]);
  });

  it("без материала экрана отчёт остаётся прежним — блока нет", () => {
    const result = { ...attemptResult, overallPassed: false };
    expect(buildReportContext(buildReportInput(result, "Тест")).result.recommendations).toBeUndefined();
  });
});

describe("unified per-topic feedback (plan 6.1)", () => {
  // Курсы и мероприятия темы — общее для обоих режимов, и составляются одинаково.
  // ТЕКСТ обратной связи — уже нет: в стандартном режиме он живёт только в
  // консолидированном блоке, а в адаптивном `feedback` темы означает другое (обратную
  // связь достигнутого уровня либо текст провала темы) и в блок не подаётся.
  const fb = {
    feedback: "Повторите тему",
    recommendedCourses: [{ title: "Курс", url: "https://e.test/c" }],
    recommendedEvents: [{ title: "Вебинар" }],
  };
  const links = (t: any) => ({
    courses: t.recommendedCourses.length,
    events: t.recommendedEvents.length,
    hasRec: t.hasRecommendations,
  });
  const std = () =>
    (sharedBuild({ ...sharedInput, topicResults: [{ ...sharedInput.topicResults[0], ...fb }] }, "Тест").result
      .topicResults as any[])[0];
  const ad = () =>
    (sharedAdaptive(
      { passed: false, topicResults: [{ topicName: "T", achievedLevelIndex: 1, achievedLevelName: "Базовый", ...fb }] },
      "Тест",
    ).result.topicResults as any[])[0];

  it("standard and adaptive expose the same courses + events per topic", () => {
    expect(links(std())).toEqual(links(ad()));
    expect(links(std())).toEqual({ courses: 1, events: 1, hasRec: true });
  });

  it("стандартная строка темы текста обратной связи не несёт", () => {
    expect(std().hasFeedback).toBeUndefined();
    expect(std().feedback).toBeUndefined();
  });

  it("адаптивная строка темы несёт обратную связь уровня", () => {
    expect(ad().hasFeedback).toBe(true);
    expect(ad().feedback).toBe("Повторите тему");
  });
});

describe("shared buildAdaptiveResultContext", () => {
  const adaptiveInput = {
    passed: false,
    topicResults: [
      { topicName: "Сети", achievedLevelIndex: 1, achievedLevelName: "Средний", feedback: "ок", recommendedCourses: [{ title: "L", url: "#" }] },
      { topicName: "БД", achievedLevelIndex: null, achievedLevelName: null, feedback: "", recommendedCourses: [] },
    ],
  };

  it("base output: level views, no SCORM action flags", () => {
    const { result } = sharedAdaptive(adaptiveInput, "Адаптивный");
    expect(result.adaptive).toBe(true);
    const ts = result.topicResults as any[];
    expect(ts[0].levelLabel).toBe("Средний");
    // A level was confirmed — the neutral (solid accent) tone; WHICH level is the label's job.
    expect(ts[0].levelClass).toBe("ou-tag--solid ou-tag--accent");
    expect(ts[0].hasFeedback).toBe(true);
    expect(ts[0].hasRecommendations).toBe(true);
    expect(ts[1].levelLabel).toBe("Минимально требуемый уровень не подтверждён");
    expect(ts[1].levelClass).toBe("ou-tag--solid ou-tag--error");
    expect(result.hasScormActions).toBeUndefined();
  });

  // The ladder is the AUTHOR's and differs from test to test, and no rung is the
  // «target» one — so the rungs carry no colour of their own. The tag has exactly two
  // states, and any confirmed level looks the same however high it sits.
  it("tones the tag by confirmed / below-minimum only, never by the rung", () => {
    const tone = (achievedLevelIndex: number | null, achievedLevelName: string | null) =>
      (sharedAdaptive(
        { topicResults: [{ topicName: "Т", achievedLevelIndex, achievedLevelName }] },
        "Адаптивный",
      ).result.topicResults as any[])[0].levelClass;

    expect(tone(0, "Начальный")).toBe("ou-tag--solid ou-tag--accent");
    expect(tone(4, "Экспертный")).toBe("ou-tag--solid ou-tag--accent");
    expect(tone(null, null)).toBe("ou-tag--solid ou-tag--error");
  });

  it("SCORM opts: PDF/retry/finish action flags", () => {
    const { result } = sharedAdaptive(adaptiveInput, "Адаптивный", {
      hasScormActions: true,
      showPdf: true,
      canRetry: true,
      showFinish: false,
    });
    expect(result.hasScormActions).toBe(true);
    expect(result.showPdf).toBe(true);
    expect(result.canRetry).toBe(true);
    expect(result.showFinish).toBe(false);
  });
});

// `normalized` is the documentation anchor for the field-name mapping between hosts.
void normalized;
