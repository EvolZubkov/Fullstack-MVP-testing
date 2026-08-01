import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";
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
