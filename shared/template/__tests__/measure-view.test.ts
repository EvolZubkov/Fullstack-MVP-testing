// shared/template/__tests__/measure-view.test.ts
import { describe, it, expect } from "vitest";
import { buildMeasureView, resolveRenderKind } from "../measure-view";
import { LEVEL_SCHEMES } from "../level-ramp";

const EE_BANDS = [
  { min: 0, max: 14, level: "low", label: "Низкий" },
  { min: 15, max: 24, level: "moderate", label: "Умеренный" },
  { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." },
];

function ee(overrides: Partial<Parameters<typeof buildMeasureView>[0]> = {}) {
  return buildMeasureView({
    key: "emotional_exhaustion",
    name: "Эмоциональное истощение",
    value: 27,
    visibility: "level_and_value",
    interpretation: { domainMin: 0, domainMax: 45, valence: "lower_is_better", bands: EE_BANDS },
    requestedKind: "band_ruler",
    ramp: LEVEL_SCHEMES.traffic,
    ...overrides,
  });
}

describe("resolveRenderKind", () => {
  it("оставляет запрошенный вид, когда он выполним", () => {
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: true, isNumeric: true }))
      .toBe("band_ruler");
  });

  it("откатывает линейку до значения из максимума без интервалов", () => {
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: false, isNumeric: true }))
      .toBe("value_of_max");
  });

  it("откатывает кольцо до значения без домена", () => {
    expect(resolveRenderKind("ring", { hasDomain: false, hasBands: false, isNumeric: true }))
      .toBe("value");
  });

  it("НИКОГДА не подставляет кольцо автоматически вместо линейки", () => {
    // Кольцо печатает процент, а при normalization: none процент не определён.
    // Как явный выбор автора оно допустимо, как автозамена — нет.
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: false, isNumeric: true }))
      .not.toBe("ring");
  });

  it("для нечислового значения всегда метка", () => {
    expect(resolveRenderKind("ring", { hasDomain: true, hasBands: true, isNumeric: false }))
      .toBe("label");
  });

  it("градиент требует домена и отсутствия интервалов", () => {
    expect(resolveRenderKind("gradient_bar", { hasDomain: true, hasBands: false, isNumeric: true }))
      .toBe("gradient_bar");
    expect(resolveRenderKind("gradient_bar", { hasDomain: true, hasBands: true, isNumeric: true }))
      .toBe("band_ruler");
  });
});

describe("buildMeasureView", () => {
  it("подставляет метку и текст сработавшего интервала", () => {
    const v = ee();
    expect(v.levelLabel).toBe("Высокий");
    expect(v.text).toBe("Ресурс расходуется быстрее.");
  });

  it("подписывает значение как «X из Y»", () => {
    expect(ee().valueLabel).toBe("27 из 45");
  });

  it("отдаёт число и максимум порознь для ou-slider__val", () => {
    expect(ee().valueText).toBe("27");
    expect(ee().maxText).toBe("45");
  });

  it("ставит засечки на края домена и начала интервалов", () => {
    expect(ee().marks).toEqual([
      { percent: 0, label: "0" },
      { percent: 33.3, label: "15" },
      { percent: 55.6, label: "25" },
      { percent: 100, label: "45" },
    ]);
  });

  it("готовит класс плашки и вариант баннера по тону", () => {
    const v = ee();
    expect(v.tone).toBe("critical");
    expect(v.toneClass).toBe("tb-tone--critical");
    expect(v.bannerVariant).toBe("error");
  });

  it("скрывает значение при видимости level", () => {
    const v = ee({ visibility: "level" });
    expect(v.showValue).toBe(false);
    expect(v.levelLabel).toBe("Высокий");
  });

  it("строит смежные зоны, покрывающие домен целиком", () => {
    const zones = ee().zones;
    expect(zones).toHaveLength(3);
    expect(zones[0].leftPercent).toBeCloseTo(0);
    // Ширины округлены до десятых, поэтому сумма 99.9 — сверяем с точностью до единиц.
    const total = zones.reduce((sum, z) => sum + z.widthPercent, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("помечает текущую зону", () => {
    expect(ee().zones.map((z) => z.current)).toEqual([false, false, true]);
  });

  it("ставит маркер по сырому значению", () => {
    expect(ee().markerPercent).toBeCloseTo(60);
  });

  it("при lower_is_better первая зона благоприятна", () => {
    expect(ee().zones[0].color).toBe(LEVEL_SCHEMES.traffic.favorable);
  });

  it("при higher_is_better первая зона неблагоприятна", () => {
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "higher_is_better", bands: EE_BANDS },
    });
    expect(v.zones[0].color).toBe(LEVEL_SCHEMES.traffic.unfavorable);
  });

  it("средний интервал получает тон «внимание», а не «нейтральный»", () => {
    // Тон обязан совпадать с цветом своей зоны: середина рампы жёлтая, значит и
    // плашка уровня жёлтая. Нейтральный тон остаётся только за valence: none.
    const v = ee({ value: 20 });
    expect(v.levelLabel).toBe("Умеренный");
    expect(v.tone).toBe("attention");
  });

  it("при valence none тон нейтральный на любом интервале", () => {
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "none", bands: EE_BANDS },
    });
    expect(v.tone).toBe("neutral");
  });

  it("переопределение тона на интервале побеждает вычисленный", () => {
    const bands = [{ ...EE_BANDS[0] }, { ...EE_BANDS[1] }, { ...EE_BANDS[2], tone: "critical" as const }];
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "lower_is_better", bands },
    });
    expect(v.tone).toBe("critical");
  });

  it("строковое значение отдаёт метку исхода и пустые зоны", () => {
    const v = buildMeasureView({
      key: "burnout_level",
      name: "Состояние",
      value: "growing",
      visibility: "level",
      interpretation: {
        domainMin: null,
        domainMax: null,
        valence: "none",
        bands: [],
        outcomes: [{ code: "growing", label: "Возрастающее истощение", tone: "attention" }],
      },
      requestedKind: "band_ruler",
      ramp: LEVEL_SCHEMES.traffic,
    });
    expect(v.renderKind).toBe("label");
    expect(v.levelLabel).toBe("Возрастающее истощение");
    expect(v.tone).toBe("attention");
    expect(v.zones).toEqual([]);
  });

  it("строковое значение без совпадающего исхода показывает сырое значение нейтральным тоном", () => {
    // Пустой словарь исходов (или код, которого в нём нет) — не повод молчать:
    // тон уже нейтральный (base), но заголовок карточки должен нести хоть что-то,
    // а не оставаться пустым — иначе неотличимо от сломанного рендера.
    const v = buildMeasureView({
      key: "burnout_level",
      name: "Состояние",
      value: "growing",
      visibility: "level_and_value",
      interpretation: { domainMin: null, domainMax: null, valence: "none", bands: [], outcomes: [] },
      requestedKind: "band_ruler",
      ramp: LEVEL_SCHEMES.traffic,
    });
    expect(v.levelLabel).toBe("growing");
    expect(v.tone).toBe("neutral");
    expect(v.bannerVariant).toBe("info");
  });

  it("считает смещение кольца для вида ring", () => {
    const v = ee({ requestedKind: "ring" });
    expect(v.renderKind).toBe("ring");
    expect(v.percent).toBe(60);
    expect(v.ringDashoffset).toBeCloseTo(158.3, 0);
  });

  it("кольцо опознаётся признаком, а не смещением дуги", () => {
    // На максимуме шкалы смещение равно нулю. Признак обязан остаться истинным,
    // иначе кольцо пропадёт ровно у того результата, который его заполняет.
    const v = ee({ value: 45, requestedKind: "ring" });
    expect(v.ringDashoffset).toBe(0);
    expect(v.isRing).toBe(true);
    expect(v.percent).toBe(100);
  });

  it("у видов без кольца признака нет", () => {
    expect(ee().isRing).toBeUndefined();
  });

  it("значение вне интервалов даёт пустую метку без падения", () => {
    const v = ee({ value: 99 });
    expect(v.levelLabel).toBe("");
    expect(v.tone).toBe("neutral");
  });
});

describe("PRD-49: слоты показа названия и уровня (признаки инвертированы)", () => {
  // Тумблеры гасят ПОКАЗ слота, а не данные: метка уровня и название остаются в виде —
  // они нужны отчёту, аналитике и выгрузке, свернуть их вправе только макет.
  //
  // Признаки инвертированы (`hideName`/`hideLevel`/`hideBanner`), как `hideScoreSummary`
  // в `result-context.ts`: отсутствие ключа обязано означать «показывать», иначе
  // рукописный контекст (превью шаблона, старые фикстуры), который никогда не
  // упоминает эти поля, молча теряет слот.
  it("по умолчанию оба слота показываются — гасящих ключей нет вовсе", () => {
    const v = ee();
    expect(v.hideName).toBeUndefined();
    expect(v.hideLevel).toBeUndefined();
  });

  it("showName: false гасит показ (hideName: true), но не название в данных", () => {
    const v = ee({ showName: false });
    expect(v.hideName).toBe(true);
    expect(v.name).toBe("Эмоциональное истощение");
  });

  it("showLevel: false гасит показ (hideLevel: true), но метка уровня и пояснение остаются в данных", () => {
    const v = ee({ showLevel: false });
    expect(v.hideLevel).toBe(true);
    expect(v.levelLabel).toBe("Высокий");
    expect(v.text).toBe("Ресурс расходуется быстрее.");
  });

  describe("hideBanner: банер гасится, только если печатать нечего", () => {
    it("метка без текста — банер не гасится", () => {
      const v = ee({ value: 5 }); // low, без text
      expect(v.levelLabel).toBe("Низкий");
      expect(v.text).toBeUndefined();
      expect(v.hideBanner).toBeUndefined();
    });

    it("текст без заголовка (showLevel: false) — банер не гасится из-за пояснения", () => {
      const v = ee({ showLevel: false });
      expect(v.levelLabel).toBe("Высокий");
      expect(v.text).toBe("Ресурс расходуется быстрее.");
      expect(v.hideBanner).toBeUndefined();
    });

    it("ни метки, ни текста — банер гасится", () => {
      const v = ee({ value: 5, showLevel: false }); // low, без text, метка погашена
      expect(v.text).toBeUndefined();
      expect(v.hideBanner).toBe(true);
    });
  });
});

describe("числовой показатель без полос интерпретации", () => {
  // Массовый случай PRD-2: показатель считает ЧИСЛО («Отрыв ведущего стиля»), полос
  // толкования у него нет, а вид показателей в шаблоне по умолчанию — «метка».
  // Карточка при этом не несла ничего: уровня нет (полос нет), значение гасил вид.
  function gap(overrides: Partial<Parameters<typeof buildMeasureView>[0]> = {}) {
    return buildMeasureView({
      key: "lead_gap",
      name: "Отрыв ведущего стиля",
      value: 18,
      visibility: "level_and_value",
      interpretation: { domainMin: null, domainMax: null, valence: "none", bands: [], outcomes: [] },
      requestedKind: "label",
      ramp: LEVEL_SCHEMES.traffic,
      ...overrides,
    });
  }

  it("показывает значение, хотя вид — «метка»", () => {
    // Вид отвечает за ФОРМУ показа значения (диаграмма, линейка, голое число), а
    // видимость — за то, показывать ли его вообще. «Метка» = без диаграммы, а не
    // «без значения»: иначе автор выбрал «уровень и значение» и не получил ни того,
    // ни другого.
    const v = gap();
    expect(v.renderKind).toBe("label");
    expect(v.showValue).toBe(true);
    expect(v.valueText).toBe("18");
    expect(v.valueLabel).toBe("18");
  });

  it("при видимости «уровень» значение остаётся скрытым", () => {
    expect(gap({ visibility: "level" }).showValue).toBe(false);
  });

  it("у строкового исхода отдельного значения нет — метка исхода и есть значение", () => {
    // Здесь `showValue` обязан остаться ложным: значение и уровень — одно и то же,
    // и карточка напечатала бы код исхода дважды.
    const v = gap({
      value: "growing",
      interpretation: {
        domainMin: null,
        domainMax: null,
        valence: "none",
        bands: [],
        outcomes: [{ code: "growing", label: "Возрастающее истощение" }],
      },
    });
    expect(v.showValue).toBe(false);
    expect(v.levelLabel).toBe("Возрастающее истощение");
  });
});

describe("gradient_bar: шкала без уровней", () => {
  /** Типология: домен объявлен, уровней нет, оценки нет. */
  function style(overrides: Partial<Parameters<typeof buildMeasureView>[0]> = {}) {
    return buildMeasureView({
      key: "kom",
      name: "Командный",
      value: 40,
      visibility: "level_and_value",
      interpretation: { domainMin: 0, domainMax: 98, valence: "none", bands: [] },
      requestedKind: "gradient_bar",
      ramp: LEVEL_SCHEMES.traffic,
      ...overrides,
    });
  }

  it("рисует ОДНУ полосу во всю длину домена", () => {
    const view = style();
    expect(view.renderKind).toBe("gradient_bar");
    expect(view.zones).toHaveLength(1);
    expect(view.zones[0].leftPercent).toBe(0);
    expect(view.zones[0].widthPercent).toBe(100);
  });

  it("ставит маркер по положению значения в домене", () => {
    // 40 из 0..98 — это 40.8 %.
    expect(style().markerPercent).toBeCloseTo(40.8, 1);
  });

  it("при валентности «Без оценки» красит НЕЙТРАЛЬНОЙ схемой", () => {
    // Та же политика, что у зон линейки: у типологии нет лучшего и худшего уровня,
    // поэтому светофорная рампа высказала бы вердикт, которого методика не выносит.
    const neutral = style().zones[0].color;
    const graded = style({ interpretation: { domainMin: 0, domainMax: 98, valence: "higher_is_better", bands: [] } })
      .zones[0].color;
    expect(neutral).not.toBe(graded);
    expect(neutral).toMatch(/^215 16%/);
  });

  it("красит полосу цветом, заданным автором для этой шкалы", () => {
    // Цвет объявлен в «Оформлении шкал» и до сих пор читался только розой. У типологии он
    // несёт ИДЕНТИЧНОСТЬ шкалы, поэтому полоса обязана совпадать с сектором розы.
    expect(style({ color: "271 76% 53%" }).zones[0].color).toBe("271 76% 53%");
  });

  it("без заданного цвета остаётся нейтральной", () => {
    expect(style().zones[0].color).toMatch(/^215 16%/);
  });

  it("НЕ берёт авторский цвет, когда у шкалы объявлено направление", () => {
    // PRD-46 §7: где направление объявлено, цвет высказывает вердикт, и подменять им
    // рампу нельзя — иначе «хорошо» и «плохо» перестанут читаться с одного взгляда.
    const view = style({
      color: "271 76% 53%",
      interpretation: { domainMin: 0, domainMax: 98, valence: "higher_is_better", bands: [] },
    });
    expect(view.zones[0].color).not.toBe("271 76% 53%");
  });
});
