/**
 * @module shared/template/__tests__/result-context-feedback-assets
 *
 * PRD-32, приёмочный дефект Д-2: вложение, приложенное к ТЕМЕ
 * (`topics.feedback_json`) или к РАЗДЕЛУ теста (`test_sections.feedback_json`),
 * индексировалось и отдавалось по прямой ссылке, но на экране итогов его не было —
 * блок «Материалы» собирался только из обратной связи теста, исходов показателей и
 * диапазонов шкал.
 *
 * Здесь проверяется общий для обоих хостов слой: нормализованное вложение темы
 * доезжает до `result.recommendations.assets`, в том числе у теста БЕЗ измерений,
 * и один файл, приложенный и к тесту, и к теме, не даёт дубля.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext, feedbackAssets } from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";

const TOPIC_PDF = { title: "Разбор темы", url: "/api/media/aaaa" };
const SECTION_PDF = { title: "Памятка раздела", url: "/api/media/bbbb" };

function topicRow(assets: Array<{ title: string; url?: string }>) {
  return {
    topicId: "t1",
    topicName: "Тема",
    correct: 3,
    total: 4,
    percent: 75,
    earnedPoints: 3,
    possiblePoints: 4,
    passed: true,
    recommendedAssets: assets,
  };
}

function baseInput(topicResults: ReturnType<typeof topicRow>[]) {
  return {
    passed: true,
    percent: 75,
    totalQuestions: 4,
    correct: 3,
    earnedPoints: 3,
    possiblePoints: 4,
    topicResults,
  };
}

describe("вложения темы и раздела в блоке «Материалы»", () => {
  it("довозит вложения темы и раздела до result.recommendations.assets", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF, SECTION_PDF])]), "Тест");
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF, SECTION_PDF]);
    expect(ctx.result.recommendations?.hasAny).toBe(true);
  });

  it("показывает их и у теста БЕЗ шкал и показателей", () => {
    // Контрольный тест не передаёт `measures` вовсе — раньше блок рекомендаций
    // собирался только внутри этой ветки, поэтому вложение темы не показывалось
    // никогда.
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF])]), "Тест");
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("не даёт дубля, когда один файл приложен и к тесту, и к теме — остаётся копия теста", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF])]), "Тест", {
      measures: {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler",
        indicatorKind: "label",
        scales: [],
        indicators: [],
        testFeedback: { links: [], events: [], assets: [TOPIC_PDF] },
      },
    });
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("общий источник идёт раньше частного: вложение теста впереди вложения темы", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF])]), "Тест", {
      measures: {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler",
        indicatorKind: "label",
        scales: [],
        indicators: [],
        testFeedback: { links: [], events: [], assets: [SECTION_PDF] },
      },
    });
    expect(ctx.result.recommendations?.assets).toEqual([SECTION_PDF, TOPIC_PDF]);
  });

  it("один и тот же файл, приложенный и к теме, и к разделу, показывается один раз", () => {
    // Хост склеивает вложения темы и раздела в один список — дедупликация сборщика
    // работает и внутри него, иначе автор, приложивший один файл в обоих местах,
    // получил бы две одинаковые ссылки.
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF, TOPIC_PDF])]), "Тест");
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("вложения разных тем сливаются в один список без разделения по темам", () => {
    const second = { ...topicRow([SECTION_PDF]), topicId: "t2", topicName: "Тема 2" };
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF]), second]), "Тест");
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF, SECTION_PDF]);
  });

  it("тема без вложений оставляет контекст прежним", () => {
    const ctx = buildResultContext(baseInput([topicRow([])]), "Тест");
    expect(ctx.result.recommendations).toBeUndefined();
  });
});

describe("feedbackAssets", () => {
  it("склеивает вложения нескольких блоков в порядке передачи", () => {
    const assets = feedbackAssets(
      { assets: [{ title: "Разбор темы", url: "/api/media/aaaa" }] },
      { assets: [{ title: "Памятка раздела", url: "/api/media/bbbb" }] },
    );
    expect(assets).toEqual([TOPIC_PDF, SECTION_PDF]);
  });

  it("применяет ЕДИНОЕ правило выбора адреса: `url` бьёт унаследованный `scormHref`", () => {
    const assets = feedbackAssets({
      assets: [{ title: "Разбор темы", url: "/api/media/aaaa", scormHref: "assets/media/old.pdf" }],
    });
    expect(assets).toEqual([TOPIC_PDF]);
  });

  it("выбрасывает вложение без адреса и терпит отсутствующий блок", () => {
    expect(feedbackAssets(null, undefined, { assets: [{ title: "Не загружен" }] })).toEqual([]);
  });
});
