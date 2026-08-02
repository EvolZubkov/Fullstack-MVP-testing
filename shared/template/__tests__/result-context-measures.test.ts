import { describe, it, expect } from "vitest";
import { buildResultContext, normalizeFeedback } from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";

const BASE = {
  passed: false,
  percent: 0,
  totalQuestions: 22,
  correct: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  topicResults: [],
};

const MEASURES = {
  ramp: LEVEL_SCHEMES.traffic,
  scaleKind: "band_ruler" as const,
  indicatorKind: "label" as const,
  scales: [
    {
      key: "emotional_exhaustion",
      name: "Эмоциональное истощение",
      value: 27,
      visibility: "level_and_value" as const,
      interpretation: {
        domainMin: 0,
        domainMax: 45,
        valence: "lower_is_better" as const,
        bands: [
          { min: 0, max: 14, level: "low", label: "Низкий" },
          { min: 15, max: 24, level: "moderate", label: "Умеренный" },
          { min: 25, max: 45, level: "high", label: "Высокий", feedback: { text: "Восстановите режим отдыха." } },
        ],
      },
    },
  ],
  indicators: [
    {
      key: "burnout_level",
      name: "Состояние",
      value: "growing",
      visibility: "level" as const,
      interpretation: {
        domainMin: null,
        domainMax: null,
        valence: "none" as const,
        bands: [],
        outcomes: [
          { code: "growing", label: "Возрастающее истощение", tone: "attention" as const,
            feedback: { text: "Обсудите нагрузку с руководителем.", links: [{ title: "Курс", url: "/c" }] } },
        ],
      },
    },
  ],
  testFeedback: { text: "Опросник носит справочный характер." },
};

describe("buildResultContext + measures", () => {
  it("не добавляет новых полей, когда измерений нет", () => {
    const ctx = buildResultContext(BASE, "Тест");
    expect(ctx.result.scales).toBeUndefined();
    expect(ctx.result.indicators).toBeUndefined();
    expect(ctx.result.recommendations).toBeUndefined();
    expect(ctx.result.showScoreSummary).toBeUndefined();
  });

  it("кладёт карточки шкал и показателей", () => {
    const ctx = buildResultContext(BASE, "Маслач", { measures: MEASURES });
    expect(ctx.result.scales).toHaveLength(1);
    expect(ctx.result.scales![0].levelLabel).toBe("Высокий");
    expect(ctx.result.indicators).toHaveLength(1);
    expect(ctx.result.indicators![0].levelLabel).toBe("Возрастающее истощение");
  });

  it("не включает скрытые шкалы", () => {
    const hidden = { ...MEASURES, scales: [{ ...MEASURES.scales[0], visibility: "hidden" as const }] };
    const ctx = buildResultContext(BASE, "Маслач", { measures: hidden });
    expect(ctx.result.scales).toBeUndefined();
  });

  it("собирает рекомендации в порядке тест, показатель, шкала", () => {
    const ctx = buildResultContext(BASE, "Маслач", { measures: MEASURES });
    expect(ctx.result.recommendations!.texts).toEqual([
      "Опросник носит справочный характер.",
      "Обсудите нагрузку с руководителем.",
      "Восстановите режим отдыха.",
    ]);
    expect(ctx.result.recommendations!.links).toHaveLength(1);
  });

  it("приводит вложения к ссылке и отбрасывает незагруженные", () => {
    // Редактор хранит канонический дескриптор PDF, где адрес лежит в scormHref.
    const withAssets = {
      ...MEASURES,
      indicators: [
        {
          ...MEASURES.indicators[0],
          interpretation: {
            ...MEASURES.indicators[0].interpretation,
            outcomes: [
              {
                code: "growing",
                label: "Возрастающее истощение",
                feedback: {
                  assets: [
                    { title: "Памятка.pdf", fileName: "p.pdf", mimeType: "application/pdf", scormHref: "/a/p.pdf" },
                    { title: "Не загружено.pdf", fileName: "q.pdf", mimeType: "application/pdf" },
                  ],
                },
              },
            ],
          },
        },
      ],
      scales: [],
      testFeedback: null,
    };
    const ctx = buildResultContext(BASE, "Маслач", { measures: withAssets });
    expect(ctx.result.recommendations!.assets).toEqual([{ title: "Памятка.pdf", url: "/a/p.pdf" }]);
  });

  it("берёт рекомендации только у сработавших интервалов", () => {
    const low = { ...MEASURES, scales: [{ ...MEASURES.scales[0], value: 5 }], indicators: [], testFeedback: null };
    const ctx = buildResultContext(BASE, "Маслач", { measures: low });
    // Ничего не сработало — блока рекомендаций в контексте нет вовсе.
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("настройка блока перебивает автоматику наличия", () => {
    const ctx = buildResultContext(BASE, "Маслач", {
      measures: { ...MEASURES, blockSettings: { scales: "hide" as const } },
    });
    expect(ctx.result.scales).toBeUndefined();
    // Скрытый блок не отдаёт рекомендаций: ученик не видел, что их вызвало.
    expect(ctx.result.recommendations!.texts).toEqual([
      "Опросник носит справочный характер.",
      "Обсудите нагрузку с руководителем.",
    ]);
  });
});

describe("вердикт теста", () => {
  it("измерительный тест без порога не получает вердикта", () => {
    const ctx = buildResultContext(BASE, "Маслач", { measures: MEASURES });
    expect(ctx.result.statusLabel).toBe("");
    expect(ctx.result.passClass).toBe("");
  });

  it("контрольный тест вердикт сохраняет", () => {
    const ctx = buildResultContext({ ...BASE, passed: true }, "Контрольный");
    expect(ctx.result.statusLabel).toBe("Пройден");
    expect(ctx.result.passClass).toBe("is-pass");
  });

  it("тест с порогом сохраняет вердикт и при наличии измерений", () => {
    // У смешанного теста есть оцениваемые вопросы, поэтому возможных баллов больше нуля
    // — это второй признак, без которого порог по умолчанию 70% ничего не значит.
    const ctx = buildResultContext({ ...BASE, passed: true, earnedPoints: 8, possiblePoints: 10 }, "Смешанный", {
      measures: { ...MEASURES, hasPassThreshold: true },
    });
    expect(ctx.result.statusLabel).toBe("Пройден");
    expect(ctx.result.passClass).toBe("is-pass");
    expect(ctx.result.hideScoreSummary).toBeUndefined();
  });

  it("вердикт следует за порогом, а не за настройкой блока сводки", () => {
    // Автор принудительно показал сводку баллов, но порога у теста по-прежнему нет.
    const shown = buildResultContext(BASE, "Маслач", {
      measures: { ...MEASURES, blockSettings: { scoreSummary: "show" as const } },
    });
    expect(shown.result.statusLabel).toBe("");
    // И наоборот: спрятанная сводка контрольного теста вердикта не отменяет.
    const hidden = buildResultContext({ ...BASE, passed: false, earnedPoints: 3, possiblePoints: 10 }, "Контрольный", {
      measures: { ...MEASURES, hasPassThreshold: true, blockSettings: { scoreSummary: "hide" as const } },
    });
    expect(hidden.result.statusLabel).toBe("Не пройден");
    expect(hidden.result.hideScoreSummary).toBe(true);
  });
});

describe("сводка баллов", () => {
  it("контрольный тест не получает признака скрытия — отсутствие означает «показывать»", () => {
    const ctx = buildResultContext(BASE, "Контрольный");
    expect(ctx.result.hideScoreSummary).toBeUndefined();
  });

  it("измерительный тест без порога скрывает сводку явно", () => {
    const ctx = buildResultContext(BASE, "Маслач", { measures: MEASURES });
    expect(ctx.result.hideScoreSummary).toBe(true);
  });

  it("настройка show возвращает сводку при отсутствии порога", () => {
    const ctx = buildResultContext(BASE, "Маслач", {
      measures: { ...MEASURES, blockSettings: { scoreSummary: "show" } },
    });
    expect(ctx.result.hideScoreSummary).toBeUndefined();
  });
});

describe("нечего оценивать", () => {
  // Любой новый тест несёт порог 70% по умолчанию, поэтому у измерительного теста
  // признак порога стоит, а оценивать при этом нечего: возможных баллов ноль.
  const NOTHING = { ...BASE, possiblePoints: 0, earnedPoints: 0 };

  it("измерительный тест с порогом по умолчанию не показывает сводку", () => {
    const ctx = buildResultContext(NOTHING, "Маслач", {
      measures: { ...MEASURES, hasPassThreshold: true },
    });
    expect(ctx.result.hideScoreSummary).toBe(true);
  });

  it("и не показывает вердикт", () => {
    const ctx = buildResultContext(NOTHING, "Маслач", {
      measures: { ...MEASURES, hasPassThreshold: true },
    });
    expect(ctx.result.statusLabel).toBe("");
    expect(ctx.result.passClass).toBe("");
  });

  it("контрольный тест с баллами вердикт и сводку сохраняет", () => {
    const ctx = buildResultContext(
      { ...BASE, possiblePoints: 10, earnedPoints: 8, passed: true },
      "Контрольный",
    );
    expect(ctx.result.hideScoreSummary).toBeUndefined();
    expect(ctx.result.statusLabel).toBe("Пройден");
  });

  it("настройка show перебивает автоматику и при нулевых баллах", () => {
    const ctx = buildResultContext(NOTHING, "Маслач", {
      measures: { ...MEASURES, hasPassThreshold: true, blockSettings: { scoreSummary: "show" as const } },
    });
    expect(ctx.result.hideScoreSummary).toBeUndefined();
    // Вердикт следует за парой «порог и есть что оценивать», а не за настройкой блока.
    expect(ctx.result.statusLabel).toBe("");
  });
});

describe("normalizeFeedback — адрес вложения", () => {
  it("берёт url, когда scormHref не заполнен (веб-хост)", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [
        { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "/api/media/11111111-1111-1111-1111-111111111111" },
      ],
    });
    expect(block?.assets).toEqual([
      { title: "Памятка", url: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);
  });

  it("предпочитает scormHref, когда он есть (пакет, собранный ранее)", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [
        { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "/api/media/2222", scormHref: "assets/media/p.pdf" },
      ],
    });
    expect(block?.assets).toEqual([{ title: "Памятка", url: "assets/media/p.pdf" }]);
  });

  it("отбрасывает дескриптор без обоих адресов", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [{ title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf" }],
    });
    expect(block?.assets).toEqual([]);
  });
});
