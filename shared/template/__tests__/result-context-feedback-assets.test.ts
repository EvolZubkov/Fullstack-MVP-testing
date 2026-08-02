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
import { buildResultContext, feedbackAssets, topicFeedbackTexts } from "../result-context";

const TOPIC_PDF = { title: "Разбор темы", url: "/api/media/aaaa" };
const SECTION_PDF = { title: "Памятка раздела", url: "/api/media/bbbb" };

/**
 * Строка темы, по умолчанию НЕ ПРОЙДЕННОЙ: всё, что автор повесил на тему — текст,
 * курсы, мероприятия, вложения, — показывается ученику только при провале темы
 * (согласованное решение владельца, задача 4 консолидации). Поэтому провал и есть
 * базовый случай этих проверок; сам гейт проверяется отдельным блоком ниже.
 */
function topicRow(
  assets: Array<{ title: string; url?: string }>,
  feedbackTexts: string[] = [],
  passed: boolean | null = false,
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
      testFeedback: { links: [], events: [], assets: [TOPIC_PDF] },
    });
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("общий источник идёт раньше частного: вложение теста впереди вложения темы", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF])]), "Тест", {
      testFeedback: { links: [], events: [], assets: [SECTION_PDF] },
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

describe("обратная связь ТЕСТА в блоке рекомендаций (дефект Д-3)", () => {
  // Обратная связь теста никогда не была частью измерений: она оказалась внутри их
  // ветки лишь потому, что PRD-29 собирал там весь блок. Тест без шкал и показателей —
  // самая массовая конфигурация продукта.
  const TEST_FEEDBACK = {
    text: "Спасибо за участие.",
    links: [],
    events: [],
    assets: [{ title: "Памятка", url: "/api/media/cccc" }],
  };

  it("текст и вложение доезжают у теста БЕЗ шкал и показателей", () => {
    const ctx = buildResultContext(baseInput([topicRow([])]), "Опрос", { testFeedback: TEST_FEEDBACK });
    expect(ctx.result.recommendations?.texts).toEqual(["Спасибо за участие."]);
    expect(ctx.result.recommendations?.assets).toEqual([{ title: "Памятка", url: "/api/media/cccc" }]);
  });

  it("идёт ПЕРВОЙ — раньше вложений темы и раздела", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF])]), "Опрос", { testFeedback: TEST_FEEDBACK });
    expect(ctx.result.recommendations?.assets).toEqual([
      { title: "Памятка", url: "/api/media/cccc" },
      TOPIC_PDF,
    ]);
  });

  it("её отсутствие оставляет контекст прежним", () => {
    const ctx = buildResultContext(baseInput([topicRow([])]), "Опрос", { testFeedback: null });
    expect(ctx.result.recommendations).toBeUndefined();
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

  it("текст, совпадающий с обратной связью теста, не повторяется — остаётся экземпляр теста", () => {
    // Дедупликация оставляет ПЕРВОЕ вхождение, а тест идёт первым источником: общая
    // формулировка выигрывает у своей копии на теме. Порядок здесь нагружен: у темы
    // повтор стоит ПОСЛЕ собственного текста, поэтому позиция «Общей рекомендации»
    // показывает, чей экземпляр остался — тестовый, а не темы.
    const ctx = buildResultContext(baseInput([topicRow([], ["Текст темы", "Общая рекомендация"])]), "Тест", {
      testFeedback: { text: "Общая рекомендация", links: [], events: [], assets: [] },
    });
    expect(ctx.result.recommendations?.texts).toEqual(["Общая рекомендация", "Текст темы"]);
  });

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

describe("гейт по вердикту темы: материалы темы — только при провале", () => {
  // Согласованное решение владельца: всё, что автор повесил на ТЕМУ (текст, курсы,
  // мероприятия, вложения), — это помощь по невзятой теме. До консолидации курсы и
  // мероприятия уже гейтились провалом, а тексты и вложения показывались всем: три
  // ресурса одной темы жили по двум разным правилам, и после сведения их в один блок
  // расхождение стало бы видно на экране.
  it("у ПРОЙДЕННОЙ темы ни текст, ни вложения в блок не попадают", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], true)]), "Тест");
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("у НЕпройденной темы попадают оба", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], false)]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст темы"]);
    expect(ctx.result.recommendations?.assets).toEqual([TOPIC_PDF]);
  });

  it("тема БЕЗ вердикта (passed: null) молчит — как молчат курсы", () => {
    // У темы не задан порог, поэтому «не сдал» про ученика не сказано. Правило одно на
    // все три ресурса темы: `vrRecommended` в рантайме пакета пропускает тему по
    // `tr.passed !== false`, значит и текст с вложением при null не показываются.
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], null)]), "Тест");
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("гейт потемный: молчит только пройденная тема, провалившаяся говорит", () => {
    const passedTopic = topicRow([TOPIC_PDF], ["Текст пройденной"], true);
    const failedTopic = { ...topicRow([SECTION_PDF], ["Текст проваленной"], false), topicId: "t2", topicName: "Тема 2" };
    const ctx = buildResultContext(baseInput([passedTopic, failedTopic]), "Тест");
    expect(ctx.result.recommendations?.texts).toEqual(["Текст проваленной"]);
    expect(ctx.result.recommendations?.assets).toEqual([SECTION_PDF]);
  });

  it("обратной связи ТЕСТА гейт темы не касается — она про тест целиком", () => {
    const ctx = buildResultContext(baseInput([topicRow([TOPIC_PDF], ["Текст темы"], true)]), "Тест", {
      testFeedback: { text: "Спасибо за участие.", links: [], events: [], assets: [SECTION_PDF] },
    });
    expect(ctx.result.recommendations?.texts).toEqual(["Спасибо за участие."]);
    expect(ctx.result.recommendations?.assets).toEqual([SECTION_PDF]);
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
  it("отдаёт текст темы, затем текст раздела", () => {
    expect(topicFeedbackTexts({ feedbackJson: { text: "Текст темы" } }, { text: "  Текст раздела  " }))
      .toEqual(["Текст темы", "Текст раздела"]);
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
