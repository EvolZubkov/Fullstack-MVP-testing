import { describe, it, expect } from "vitest";
import { buildAdaptiveResultContext, buildResultContext, normalizeFeedback } from "../result-context";
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
};

/**
 * The test's OWN feedback block. Passed as its own option, NOT inside `MEASURES`: a
 * test's feedback is due to the learner whether or not the test measures anything.
 */
const TEST_FEEDBACK = { text: "Опросник носит справочный характер." };

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
    const ctx = buildResultContext(BASE, "Маслач", { testFeedback: TEST_FEEDBACK, measures: MEASURES });
    expect(ctx.result.recommendations!.texts).toEqual([
      "Опросник носит справочный характер.",
      "Обсудите нагрузку с руководителем.",
      "Восстановите режим отдыха.",
    ]);
    expect(ctx.result.recommendations!.links).toHaveLength(1);
  });

  it("приводит вложения к ссылке и отбрасывает незагруженные", () => {
    // Ранее собранные данные несут адрес PDF в scormHref — блок читает и их.
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
    };
    const ctx = buildResultContext(BASE, "Маслач", { measures: withAssets });
    expect(ctx.result.recommendations!.assets).toEqual([{ title: "Памятка.pdf", url: "/a/p.pdf" }]);
  });

  it("берёт рекомендации только у сработавших интервалов", () => {
    const low = { ...MEASURES, scales: [{ ...MEASURES.scales[0], value: 5 }], indicators: [] };
    const ctx = buildResultContext(BASE, "Маслач", { measures: low });
    // Ничего не сработало — блока рекомендаций в контексте нет вовсе.
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("настройка блока перебивает автоматику наличия", () => {
    const ctx = buildResultContext(BASE, "Маслач", {
      testFeedback: TEST_FEEDBACK,
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

/**
 * issue #33. Шкалы и показатели — свойство ТЕСТА, а не режима выдачи: адаптивный тест
 * задаёт вопросы, на которых висят вклады, и считает по ним ровно те же значения. Разница
 * с обычным экраном ровно одна — сводки баллов у адаптивного нет, поэтому её настройка
 * здесь не читается.
 */
const ADAPTIVE_BASE = {
  passed: false,
  topicResults: [
    { topicName: "Тема A", achievedLevelIndex: 1, achievedLevelName: "Средний" },
  ],
};

describe("buildAdaptiveResultContext + measures", () => {
  it("без измерений контекст прежний", () => {
    const ctx = buildAdaptiveResultContext(ADAPTIVE_BASE, "Адаптивный");
    expect(ctx.result.scales).toBeUndefined();
    expect(ctx.result.indicators).toBeUndefined();
    expect(ctx.result.adaptive).toBe(true);
  });

  it("кладёт те же карточки, что и обычный экран", () => {
    const ctx = buildAdaptiveResultContext(ADAPTIVE_BASE, "Адаптивный", { measures: MEASURES });
    const standard = buildResultContext(BASE, "Обычный", { measures: MEASURES });
    expect(ctx.result.scales).toEqual(standard.result.scales);
    expect(ctx.result.indicators).toEqual(standard.result.indicators);
    // Уровни тем на месте: измерения добавляются к результату, а не вместо него.
    expect(ctx.result.topicResults).toHaveLength(1);
  });

  it("не включает скрытые шкалы и слушается настройки блока", () => {
    const hidden = { ...MEASURES, scales: [{ ...MEASURES.scales[0], visibility: "hidden" as const }] };
    expect(buildAdaptiveResultContext(ADAPTIVE_BASE, "Адаптивный", { measures: hidden }).result.scales)
      .toBeUndefined();
    const off = { ...MEASURES, blockSettings: { indicators: "hide" as const } };
    expect(buildAdaptiveResultContext(ADAPTIVE_BASE, "Адаптивный", { measures: off }).result.indicators)
      .toBeUndefined();
  });

  it("настройка сводки баллов на адаптивный экран не влияет", () => {
    // Сводки у этого экрана нет вовсе — гасить нечего, и признак не выставляется.
    const ctx = buildAdaptiveResultContext(ADAPTIVE_BASE, "Адаптивный", {
      measures: { ...MEASURES, blockSettings: { scoreSummary: "hide" as const } },
    });
    expect(ctx.result.hideScoreSummary).toBeUndefined();
    expect(ctx.result.scales).toHaveLength(1);
  });

  it("рекомендации собираются в порядке тест, показатель, шкала, тема", () => {
    const input = {
      passed: false,
      topicResults: [
        {
          topicName: "Тема A",
          achievedLevelIndex: null,
          achievedLevelName: null,
          feedbackTexts: ["Повторите модуль."],
        },
      ],
    };
    const ctx = buildAdaptiveResultContext(input, "Адаптивный", {
      testFeedback: TEST_FEEDBACK,
      measures: MEASURES,
    });
    expect(ctx.result.recommendations!.texts).toEqual([
      "Опросник носит справочный характер.",
      "Обсудите нагрузку с руководителем.",
      "Восстановите режим отдыха.",
      "Повторите модуль.",
    ]);
  });

  it("радар строится по тому же переключателю", () => {
    const threeScales = {
      ...MEASURES,
      chartSettings: { scalesChartKind: "radar" as const },
      scales: ["a", "b", "c"].map((key, i) => ({
        ...MEASURES.scales[0],
        key,
        name: `Шкала ${key}`,
        value: 10 + i * 10,
      })),
    };
    const ctx = buildAdaptiveResultContext(ADAPTIVE_BASE, "Адаптивный", { measures: threeScales });
    expect(ctx.result.scalesChart!.axes).toHaveLength(3);
    expect(ctx.result.scalesBlockClass).toBe("tb-measures tb-measures--chart");
  });
});

describe("вердикт теста", () => {
  it("измерительный тест без порога не получает вердикта", () => {
    const ctx = buildResultContext(BASE, "Маслач", { measures: MEASURES });
    expect(ctx.result.statusLabel).toBe("");
    expect(ctx.result.passClass).toBe("");
  });

  it("контрольный тест вердикт сохраняет", () => {
    // Points on purpose: a control test earns its verdict from the SAME pair as any
    // other — a threshold and something to grade. `BASE` is the measurement fixture
    // (`possiblePoints: 0`), and asserting «Пройден» on it asserted the defect below.
    const ctx = buildResultContext({ ...BASE, passed: true, earnedPoints: 8, possiblePoints: 10 }, "Контрольный");
    expect(ctx.result.statusLabel).toBe("Пройден");
    expect(ctx.result.passClass).toBe("is-pass");
  });

  // The gate used to live INSIDE the measures branch, so a test with neither scales nor
  // indicators never reached it: the header asserted «Пройден» while the feedback block
  // — gated by the very same «does this test grade» question — printed at the same time.
  // Both halves are checked together in each case: the screen must not contradict itself.
  it("контрольный тест без оцениваемых вопросов вердикта не выносит", () => {
    const ctx = buildResultContext({ ...BASE, passed: true }, "Опросник", {
      hasPassThreshold: true,
      testFeedback: TEST_FEEDBACK,
    });
    expect(ctx.result.statusLabel).toBe("");
    expect(ctx.result.passClass).toBe("");
    expect(ctx.result.recommendations!.texts).toEqual([TEST_FEEDBACK.text]);
  });

  it("контрольный тест без порога вердикта не выносит", () => {
    const ctx = buildResultContext(
      { ...BASE, passed: true, earnedPoints: 8, possiblePoints: 10 },
      "Без порога",
      { hasPassThreshold: false, testFeedback: TEST_FEEDBACK },
    );
    expect(ctx.result.statusLabel).toBe("");
    expect(ctx.result.passClass).toBe("");
    expect(ctx.result.recommendations!.texts).toEqual([TEST_FEEDBACK.text]);
  });

  // ABSENT MEANS «UNKNOWN», and unknown only ever resolves in favour of showing — the
  // same asymmetry the feedback gate has. A host that has not been taught to send the
  // flag must not lose the verdict of every graded test it renders.
  it("неизвестный признак порога вердикта не гасит", () => {
    const ctx = buildResultContext({ ...BASE, passed: true, earnedPoints: 8, possiblePoints: 10 }, "Легаси-хост");
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

describe("строка «Баллов» темы следует за настройкой сводки (issue #30)", () => {
  const withTopic = { ...BASE, topicResults: [{ topicId: "t1", topicName: "Тема 1", correct: 3, total: 4, percent: 75, earnedPoints: 3, possiblePoints: 4, passed: null }] };

  it("скрытая сводка гасит и строку «Баллов» у темы в пакете", () => {
    const ctx = buildResultContext(withTopic, "Маслач", {
      withTopicPoints: true,
      measures: { ...MEASURES, hasPassThreshold: true, blockSettings: { scoreSummary: "hide" as const } },
    });
    expect(ctx.result.hideScoreSummary).toBe(true);
    expect((ctx.result.topicResults as any[])[0].pointsLabel).toBeUndefined();
  });

  it("видимая сводка сохраняет строку «Баллов» у темы в пакете", () => {
    const ctx = buildResultContext(withTopic, "Маслач", {
      withTopicPoints: true,
      measures: { ...MEASURES, hasPassThreshold: true, blockSettings: { scoreSummary: "show" as const } },
    });
    expect(ctx.result.hideScoreSummary).toBeUndefined();
    expect((ctx.result.topicResults as any[])[0].pointsLabel).toBe("3 / 4");
  });

  it("без измерений withTopicPoints работает как раньше", () => {
    const ctx = buildResultContext(withTopic, "Контрольный", { withTopicPoints: true });
    expect((ctx.result.topicResults as any[])[0].pointsLabel).toBe("3 / 4");
  });
});

describe("тема, которой нечего сказать, карточки не получает", () => {
  // aggregateStandardResult никогда не засчитывает измерительные вопросы в `total`
  // темы — у чисто измерительной темы `total: 0` и `possiblePoints: 0`. Все слоты
  // карточки такой темы гасятся поодиночке: «Правильно» — по `total`, «Баллов» — по
  // `pointsLabel`, плашка вердикта — по пустой метке. Остаётся заголовок «Результаты
  // по темам», разделитель и карточка с названием темы и вечно пустой полосой —
  // ровно та бессмыслица, ради которой существует `hideScoreSummary`, уровнем ниже.
  // Такая тема выбывает из `topicResults` целиком: пустой массив макеты гасят вместе
  // с заголовком (`{{#if result.topicResults}}`), включая сторонние шаблоны.
  const measurementOnlyTopic = {
    ...BASE,
    topicResults: [{ topicId: "t1", topicName: "Тема 1", correct: 0, total: 0, percent: 0, earnedPoints: 0, possiblePoints: 0, passed: null }],
  };

  it("сводка показана, но у темы нет оцениваемых вопросов — карточки нет", () => {
    const ctx = buildResultContext(measurementOnlyTopic, "Маслач", {
      withTopicPoints: true,
      measures: { ...MEASURES, hasPassThreshold: true, blockSettings: { scoreSummary: "show" as const } },
    });
    expect(ctx.result.topicResults).toEqual([]);
  });

  it("без измерений тоже нет", () => {
    const ctx = buildResultContext(measurementOnlyTopic, "Контрольный", { withTopicPoints: true });
    expect(ctx.result.topicResults).toEqual([]);
  });

  it("тема с оцениваемыми вопросами остаётся, даже когда «Баллов» скрыты настройкой", () => {
    const graded = {
      ...BASE,
      topicResults: [{ topicId: "t1", topicName: "Тема 1", correct: 3, total: 4, percent: 75, earnedPoints: 3, possiblePoints: 4, passed: null }],
    };
    const ctx = buildResultContext(graded, "Маслач", {
      withTopicPoints: true,
      measures: { ...MEASURES, hasPassThreshold: true, blockSettings: { scoreSummary: "hide" as const } },
    });
    expect(ctx.result.topicResults).toHaveLength(1);
    expect((ctx.result.topicResults as any[])[0].pointsLabel).toBeUndefined();
  });

  it("тема без оценивания, но с курсами, карточку сохраняет — курсы темы больше показать негде", () => {
    const withCourses = {
      ...BASE,
      topicResults: [
        {
          ...measurementOnlyTopic.topicResults[0],
          recommendedCourses: [{ title: "Курс A", url: "https://e/a" }],
        },
      ],
    };
    const ctx = buildResultContext(withCourses, "Маслач", { withTopicPoints: true });
    expect(ctx.result.topicResults).toHaveLength(1);
    expect((ctx.result.topicResults as any[])[0].hasRecommendations).toBe(true);
  });

  it("тема без оценивания, но с вердиктом, карточку сохраняет — вердикт вынесен, значит есть что сказать", () => {
    const judged = {
      ...BASE,
      topicResults: [{ ...measurementOnlyTopic.topicResults[0], passed: false }],
    };
    const ctx = buildResultContext(judged, "Контрольный", { withTopicPoints: true });
    expect(ctx.result.topicResults).toHaveLength(1);
    expect((ctx.result.topicResults as any[])[0].statusLabel).toBe("Не пройдено");
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

  // Упаковщик переписывает на путь внутри пакета именно `url`, а `scormHref` не трогает:
  // при обоих заполненных полях легаси-адрес ведёт туда, где файла уже нет.
  it("предпочитает url, когда заполнены оба поля", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [
        { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "assets/media/2222.pdf", scormHref: "feedback/legacy.pdf" },
      ],
    });
    expect(block?.assets).toEqual([{ title: "Памятка", url: "assets/media/2222.pdf" }]);
  });

  it("пустой url не перебивает scormHref — пустая строка не адрес", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [
        { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", url: "", scormHref: "feedback/legacy.pdf" },
      ],
    });
    expect(block?.assets).toEqual([{ title: "Памятка", url: "feedback/legacy.pdf" }]);
  });

  it("читает scormHref, когда url не заполнен (ранее собранные данные)", () => {
    const block = normalizeFeedback({
      text: "",
      links: [],
      events: [],
      assets: [
        { title: "Памятка", fileName: "p.pdf", mimeType: "application/pdf", scormHref: "feedback/legacy.pdf" },
      ],
    });
    expect(block?.assets).toEqual([{ title: "Памятка", url: "feedback/legacy.pdf" }]);
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
