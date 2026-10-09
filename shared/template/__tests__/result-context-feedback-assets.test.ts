/**
 * @module shared/template/__tests__/result-context-feedback-assets
 *
 * PRD-32, приёмочный дефект Д-2: вложение, приложенное к ТЕМЕ
 * (`topics.feedback_json`) или к РАЗДЕЛУ теста (`test_sections.feedback_json`),
 * индексировалось и отдавалось по прямой ссылке, но на экране итогов его не было —
 * блок «Материалы» собирался только из обратной связи теста, исходов показателей и
 * диапазонов шкал.
 *
 * Дефект Д-3 — то же место с другой стороны: обратная связь САМОГО теста собиралась
 * внутри ветки измерений, поэтому у теста без шкал и показателей блока рекомендаций не
 * было вовсе.
 *
 * Здесь проверяется общий для обоих хостов слой: нормализованные вложения темы и
 * обратная связь теста доезжают до `result.recommendations`, в том числе у теста БЕЗ
 * измерений, и один файл, приложенный дважды, не даёт дубля.
 */
import { describe, it, expect } from "vitest";
import {
  buildAdaptiveResultContext,
  buildResultContext,
  feedbackAssets,
  topicFeedbackTexts,
} from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";

const TOPIC_PDF = { title: "Разбор темы", url: "/api/media/aaaa" };
const SECTION_PDF = { title: "Памятка раздела", url: "/api/media/bbbb" };

/**
 * Строка темы, по умолчанию БЕЗ ВЕРДИКТА (`passed: null`) — так выглядит подавляющее
 * большинство тем реального теста: потемные пороги задают редко. Всё, что автор повесил
 * на тему (текст, курсы, мероприятия, вложения), молчит только при ЯВНОМ прохождении
 * темы — согласованное решение владельца; отсутствие вердикта успехом не считается.
 * Поэтому базовый случай этих проверок — тема, которая показывает материалы; сам гейт
 * проверяется отдельным блоком ниже.
 */
function topicRow(
  assets: Array<{ title: string; url?: string }>,
  feedbackTexts: string[] = [],
  passed: boolean | null = null,
) {
  return {
    topicId: "t1",
    topicName: "Тема",
    correct: 3,
    total: 4,
    percent: 75,
    earnedPoints: 3,
    possiblePoints: 4,
    passed,
    recommendedAssets: assets,
    feedbackTexts,
  };
}

function baseInput(topicResults: ReturnType<typeof topicRow>[], overrides: { passed?: boolean; possiblePoints?: number } = {}) {
  return {
    passed: true,
    percent: 75,
    totalQuestions: 4,
    correct: 3,
    earnedPoints: 3,
    possiblePoints: 4,
    topicResults,
    ...overrides,
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

  // PRD-61 §10: здесь были две проверки про вложение, приложенное к САМОМУ ТЕСТУ, — про
  // дедупликацию с темой и про порядок «общее раньше частного». Уровень теста снят, второго
  // источника у этих правил не осталось: дедупликация проверяется ниже на паре «тема и
  // раздел», порядок — на паре тем.

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

describe("обратная связь ТЕСТА снята (PRD-61 §10)", () => {
  const TEST_FEEDBACK = {
    text: "Спасибо за участие.",
    links: [],
    events: [],
    assets: [{ title: "Памятка", url: "/api/media/cccc" }],
  };

  it("ни текст, ни вложение теста в блок не попадают — ни при каком исходе", () => {
    for (const passed of [true, false]) {
      const ctx = buildResultContext(baseInput([topicRow([])], { passed }), "Опрос", {
        testFeedback: TEST_FEEDBACK,
        hasPassThreshold: true,
      });
      expect(ctx.result.recommendations).toBeUndefined();
    }
  });

  it("материалы ТЕМ при этом печатаются как печатались", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF])]), "Опрос", {
      testFeedback: TEST_FEEDBACK,
    });
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });
});

describe("тексты обратной связи темы и раздела в консолидированном блоке", () => {
  // Текст, написанный автором у темы и у раздела теста над ней, — такой же источник
  // общего блока, как вложения: показывается там, а не в карточке темы. Оба текста
  // приезжают одним массивом `feedbackTexts` (тема, затем раздел) — это контракт,
  // который обязаны заполнять ОБА хоста.
  it("довозит текст темы до result.recommendations.texts", () => {
    const ctx = buildResultContext(baseInput([topicRow([], ["Текст темы"])]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы"]);
    expect(ctx.result.recommendations?.hasAny).toBe(true);
  });

  it("довозит текст раздела — вторым элементом того же массива", () => {
    const ctx = buildResultContext(baseInput([topicRow([], ["Текст темы", "Текст раздела"])]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы", "Текст раздела"]);
  });

  it("один и тот же текст у темы и у раздела даёт ОДНУ строку", () => {
    const ctx = buildResultContext(baseInput([topicRow([], ["Повторим тему", "Повторим тему"])]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Повторим тему"]);
  });

  // PRD-61 §10: здесь была проверка дедупликации текста ТЕМЫ против текста ТЕСТА. Уровень
  // теста снят, второго источника не осталось; дедупликация одинаковых текстов проверяется
  // выше на паре «тема и раздел».

  it("тексты разных тем сливаются в один список без разделения по темам", () => {
    const second = { ...topicRow([], ["Текст второй темы"]), topicId: "t2", topicName: "Тема 2" };
    const ctx = buildResultContext(baseInput([topicRow([], ["Текст первой темы"]), second]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст первой темы", "Текст второй темы"]);
  });

  it("тема без текстов ничего не добавляет и пустого блока не рождает", () => {
    const ctx = buildResultContext(baseInput([topicRow([], [])]), "Тест");
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("пустой и пробельный текст не даёт пустой строки в блоке", () => {
    const ctx = buildResultContext(baseInput([topicRow([], ["", "   ", "Есть текст"])]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Есть текст"]);
  });

  it("отсутствие поля не ломает попытки, посчитанные до этой работы", () => {
    const legacy = { ...topicRow([TOPIC_PDF]), feedbackTexts: undefined };
    const ctx = buildResultContext(baseInput([legacy]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual([]);
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });
});

describe("гейт по вердикту ТЕМЫ: молчим только при явном прохождении", () => {
  // Согласованное решение владельца: материалы и тексты темы показываются ВСЕГДА, кроме
  // случая явного успеха. До консолидации правил было два: курсы и мероприятия темы
  // гейтились провалом, а тексты и вложения показывались всем — после сведения трёх
  // ресурсов в один блок расхождение стало бы видно на экране.
  it("у ПРОЙДЕННОЙ темы ни текст, ни вложения в блок не попадают", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], true)]), "Тест");
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("у НЕпройденной темы попадают оба", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], false)]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы"]);
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("тема БЕЗ вердикта (passed: null) показывает материалы наравне с проваленной", () => {
    // Край, ради которого правило и переписано: потемные пороги в стандартном тесте
    // задают редко, у такой темы вердикта нет вовсе. Считать «не судили» успехом значит
    // молча потерять всё, что автор повесил на темы в тестах без потемных порогов.
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], null)]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы"]);
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("гейт потемный: молчит только пройденная тема, остальные говорят", () => {
    const passedTopic = topicRow([TOPIC_PDF], ["Текст пройденной"], true);
    const failedTopic = { ...topicRow([SECTION_PDF], ["Текст проваленной"], false), topicId: "t2", topicName: "Тема 2" };
    const ctx = buildResultContext(baseInput([passedTopic, failedTopic]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст проваленной"]);
    expect(ctx.result.recommendations?.assets).toEqual([SECTION_PDF]);
  });

  it("пройденная тема молчит целиком — второго источника у блока больше нет", () => {
    // PRD-61 §10: здесь проверялось, что гейт ТЕМЫ не глушит обратную связь ТЕСТА. Её сняли,
    // и у блока остался один источник: пройденная тема молчит — значит блока нет вовсе.
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], true)]), "Тест", {
      testFeedback: { text: "Спасибо за участие.", links: [], events: [], assets: [SECTION_PDF] },
    });
    expect(ctx.result.recommendations).toBeUndefined();
  });
});

describe("гейт вердикта теста снят вместе с его обратной связью (PRD-61 §10)", () => {
  // Здесь был блок из восьми проверок правила «своя обратная связь теста молчит при явном
  // успехе»: с порогом и без, с нулём возможных баллов, с признаком из measures. Правило
  // ушло вместе с самим полем — гасить больше нечего.
  //
  // Осталось то, что этот блок стерёг с другой стороны: вердикт ТЕСТА никогда не глушил
  // материалы непройденных ТЕМ. Два уровня независимы, и это по-прежнему так.
  it("пройденный тест не глушит материалы непройденных тем", () => {
    const ctx = buildResultContext(
      baseInput([topicRow([TOPIC_PDF], ["Текст темы"], false)]),
      "Контрольный",
      { hasPassThreshold: true },
    );
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы"]);
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });
});

describe("адаптивный экран итогов: тот же блок, тот же сборщик", () => {
  // Требование «тексты обратной связи показываются на итогах» относится ко ВСЕМ тестам,
  // а не к части: адаптивный контекст собирает блок ТОЙ ЖЕ функцией и из тех же
  // источников (обратная связь теста, затем материалы тем), второй копии правила нет.
  //
  // Вердикт темы в адаптиве устроен иначе: не «пройдена/не пройдена», а достигнутый
  // уровень. Провал темы здесь — «не подтверждён ни один уровень»
  // (`achievedLevelIndex === null`): именно эту ветку движок
  // (`shared/scoring/aggregate.ts`) считает провальной — там он берёт `failureFeedback`
  // и гасит `overallPassed`, — и именно так пакет отображает адаптивную тему на
  // стандартную (`passed: tr.achievedLevelIndex !== null`, getAdaptiveResultForScorm).
  function adaptiveTopic(
    achievedLevelIndex: number | null,
    feedbackTexts: string[] = [],
    assets: Array<{ title: string; url?: string }> = [],
  ) {
    return {
      topicName: "Тема",
      achievedLevelIndex,
      achievedLevelName: achievedLevelIndex === null ? null : "Средний",
      feedbackTexts,
      recommendedAssets: assets,
    };
  }

  it("довозит текст и вложение темы, где НЕ подтверждён ни один уровень", () => {
    const ctx = buildAdaptiveResultContext(
      { topicResults: [adaptiveTopic(null, ["Текст темы"], [TOPIC_PDF])] },
      "Адаптивный тест",
    );
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы"]);
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
    expect(ctx.result.recommendations?.hasAny).toBe(true);
  });

  it("у темы с ПОДТВЕРЖДЁННЫМ уровнем материалы темы молчат", () => {
    const ctx = buildAdaptiveResultContext(
      { topicResults: [adaptiveTopic(1, ["Текст темы"], [TOPIC_PDF])] },
      "Адаптивный тест",
    );
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("гейт потемный: молчит тема с уровнем, говорит тема без уровня", () => {
    const ctx = buildAdaptiveResultContext(
      {
        topicResults: [
          adaptiveTopic(2, ["Текст подтверждённой"], [TOPIC_PDF]),
          { ...adaptiveTopic(null, ["Текст неподтверждённой"], [SECTION_PDF]), topicName: "Тема 2" },
        ],
      },
      "Адаптивный тест",
    );
    expect(ctx.result.recommendations?.texts).toEqual(["Текст неподтверждённой"]);
    expect(ctx.result.recommendations?.assets).toEqual([SECTION_PDF]);
  });

  it("обратная связь ТЕСТА снята и здесь — печатается только тема (PRD-61 §10)", () => {
    const ctx = buildAdaptiveResultContext(
      { topicResults: [adaptiveTopic(null, ["Текст темы"], [TOPIC_PDF])] },
      "Адаптивный тест",
      { testFeedback: { text: "Спасибо за участие.", links: [], events: [], assets: [SECTION_PDF] } },
    );
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы"]);
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("текст, совпадающий с обратной связью теста, не повторяется", () => {
    const ctx = buildAdaptiveResultContext(
      { topicResults: [adaptiveTopic(null, ["Общая рекомендация"])] },
      "Адаптивный тест",
      { testFeedback: { text: "Общая рекомендация", links: [], events: [], assets: [] } },
    );
    expect(ctx.result.recommendations?.texts).toEqual(["Общая рекомендация"]);
  });

  it("пустого блока не рождается: нет материалов — нет и `recommendations`", () => {
    const ctx = buildAdaptiveResultContext(
      { topicResults: [adaptiveTopic(null, ["", "   "], [])] },
      "Адаптивный тест",
    );
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("состав блока совпадает со стандартным на равном входе", () => {
    // Главная проверка «одна функция, а не копия»: на одинаковых материалах и
    // одинаковом вердикте темы оба режима обязаны отдать один и тот же блок.
    const material = { feedbackTexts: ["Текст темы"], recommendedAssets: [TOPIC_PDF] };
    const testFeedback = { text: "Спасибо за участие.", links: [], events: [], assets: [SECTION_PDF] };
    const standard = buildResultContext(
      baseInput([{ ...topicRow([TOPIC_PDF], ["Текст темы"], false), ...material }]),
      "Тест",
      { testFeedback },
    );
    const adaptive = buildAdaptiveResultContext(
      { topicResults: [{ topicName: "Тема", achievedLevelIndex: null, achievedLevelName: null, ...material }] },
      "Тест",
      { testFeedback },
    );
    expect(adaptive.result.recommendations).toEqual(standard.result.recommendations);
  });

  it("обратная связь ТЕСТА не печатается ни при каком исходе (PRD-61 §10)", () => {
    // Здесь проверялся гейт «пройденный тест не показывает работу над ошибками». Правило
    // ушло вместе с полем: теперь текст теста молчит и у пройденного, и у провалённого.
    const testFeedback = { text: "Спасибо за участие.", links: [], events: [], assets: [SECTION_PDF] };
    for (const passed of [true, false]) {
      const ctx = buildAdaptiveResultContext(
        { passed, topicResults: [adaptiveTopic(1)] },
        "Адаптивный тест",
        { testFeedback },
      );
      expect(ctx.result.recommendations).toBeUndefined();
    }
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

describe("topicFeedbackTexts", () => {
  // Правило приоритета источников живёт ЗДЕСЬ в одном экземпляре: и веб-оценка
  // (`server/routes/attempts.ts`), и сборка пакета (`server/scorm/builders/test-json.ts`)
  // зовут эту функцию. Вторая копия правила разъехалась бы молча, а проявилась бы
  // расхождением хостов — тем самым дефектом, который эта работа и чинит.
  it("текст раздела ЗАМЕНЯЕТ текст темы, а не дописывается к нему (§7.1a)", () => {
    // Сложение двух текстов признано дефектом владельцем 2026-09-02: ученик получал
    // склейку, которую автор нигде не видел. Разрешение — одно значение.
    expect(topicFeedbackTexts({ feedbackJson: { text: "Текст темы" } }, { text: "  Текст раздела  " }))
      .toEqual(["Текст раздела"]);
  });

  it("без текста раздела печатается текст темы", () => {
    expect(topicFeedbackTexts({ feedbackJson: { text: "Текст темы" } }, { text: "   " }))
      .toEqual(["Текст темы"]);
    expect(topicFeedbackTexts({ feedbackJson: { text: "Текст темы" } })).toEqual(["Текст темы"]);
  });

  it("читает легаси-колонку, когда feedback_json темы текста не несёт", () => {
    // Нынешний редактор темы шлёт только `feedback_json`, поэтому у тем, которых он не
    // касался, весь текст лежит в колонке — молчать по ним значит терять написанное.
    expect(topicFeedbackTexts({ feedbackJson: null, feedback: "Легаси-текст" })).toEqual(["Легаси-текст"]);
    expect(topicFeedbackTexts({ feedbackJson: { text: "   " }, feedback: "Легаси-текст" })).toEqual(["Легаси-текст"]);
  });

  it("при двух заполненных источниках побеждает действующий", () => {
    expect(topicFeedbackTexts({ feedbackJson: { text: "Новый текст" }, feedback: "Устаревшая копия" }))
      .toEqual(["Новый текст"]);
  });

  it("не кладёт пустых строк и не задваивает один и тот же текст", () => {
    expect(topicFeedbackTexts({ feedbackJson: { text: "Повторим тему" } }, { text: "Повторим тему" }))
      .toEqual(["Повторим тему"]);
    expect(topicFeedbackTexts({ feedbackJson: null, feedback: "   " }, { text: "" })).toEqual([]);
    expect(topicFeedbackTexts(null, null)).toEqual([]);
  });
});
