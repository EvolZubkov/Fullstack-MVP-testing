/**
 * @module tests/workbook-feedback
 *
 * PRD-48 Э2: листы «Обратная связь» и «Рекомендации». Проверяются свойства контракта:
 * владелец опознаётся однозначно (тема с именем «Тест» не уводит строку на уровень теста),
 * рекомендации склеиваются со своим владельцем, а сирота даёт ошибку строки.
 */
import { describe, it, expect } from "vitest";
import {
  FEEDBACK_HEADERS,
  RECOMMENDATION_HEADERS,
  serializeFeedbackRows,
  serializeRecommendationRows,
  parseFeedbackSheets,
} from "../server/utils/workbook-feedback";
import { adaptiveLevelKey } from "../server/utils/workbook-adaptive";

const PAYLOAD = {
  format: "richText" as const,
  text: "<b>Молодец</b>",
  links: [{ title: "Курс по финансам", url: "https://example.test/fin" }],
  assets: [{ title: "Памятка", url: "https://example.test/memo.pdf" }],
  events: [{ title: "Вебинар", url: "" }],
};

describe("листы «Обратная связь» и «Рекомендации»", () => {
  it("заголовки разводят владельца и его адрес отдельными колонками", () => {
    // Адрес владельца — это КОЛОНКИ, а не одна общая ячейка: тема с названием «Тест»
    // существует, и в общей колонке её обратная связь молча ушла бы на уровень теста.
    // «Подтема» стоит сразу за «Разделом»: вместе они один адрес (PRD-50 FR-50).
    // Толкование — две ПОСЛЕДНИЕ колонки: тот же владелец, но другая сущность.
    expect(FEEDBACK_HEADERS).toEqual([
      "Кому", "Раздел", "Подтема", "Формат", "Текст", "Формат толкования", "Толкование",
    ]);
    expect(RECOMMENDATION_HEADERS).toEqual([
      "Кому", "Раздел", "Подтема", "Номер уровня", "Тип", "Заголовок", "Ссылка",
    ]);
  });

  // Колонка звалась «Уровень», пока владельцев было двое. Книги, снятые до
  // переименования, обязаны читаться: значения не менялись, менялось имя колонки.
  it("старое имя колонки «Уровень» читается наравне с «Кому»", () => {
    const { test, byTopic, errors } = parseFeedbackSheets(
      [
        { "Уровень": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "ОС теста" },
        { "Уровень": "Раздел", "Раздел": "Финансы", "Формат": "Простой", "Текст": "ОС темы" },
      ],
      [{ "Уровень": "Тест", "Раздел": "", "Тип": "Курс", "Заголовок": "К", "Ссылка": "https://a.test" }],
    );
    expect(errors).toEqual([]);
    expect(test?.text).toBe("ОС теста");
    expect(test?.links).toEqual([{ title: "К", url: "https://a.test" }]);
    expect(byTopic.get("финансы")?.text).toBe("ОС темы");
  });

  it("обратная связь РАЗДЕЛА ходит по кругу", () => {
    const fb = serializeFeedbackRows(PAYLOAD, [{ topicName: "Финансы", feedback: PAYLOAD }]);
    const rec = serializeRecommendationRows(PAYLOAD, [{ topicName: "Финансы", feedback: PAYLOAD }]);
    const { test, byTopic, errors } = parseFeedbackSheets(fb, rec);

    expect(errors).toEqual([]);
    expect(byTopic.get("финансы")).toEqual(PAYLOAD);
    // PRD-61 §10: уровень «Тест» книга больше не ВЫГРУЖАЕТ, поэтому и обратно он не
    // приезжает — даже когда источник его несёт. Разбор чужой книги со строкой «Тест»
    // при этом по-прежнему работает: он проверяется отдельно, тестом ниже.
    expect(test).toBeUndefined();
  });

  it("уровень «Тест» не выгружается вовсе (PRD-61 §10)", () => {
    const rows = serializeFeedbackRows(PAYLOAD, [{ topicName: "Финансы", feedback: PAYLOAD }]);
    expect(rows.map((r) => r["Кому"])).toEqual(["Раздел"]);
  });

  it("тема с именем «Тест» не уводит строку на уровень теста", () => {
    const rows = [
      { "Кому": "Раздел", "Раздел": "Тест", "Формат": "Простой", "Текст": "ОС темы" },
    ];
    const { test, byTopic, errors } = parseFeedbackSheets(rows, []);
    expect(errors).toEqual([]);
    expect(test).toBeUndefined();
    expect(byTopic.get("тест")?.text).toBe("ОС темы");
  });

  it("рекомендация без владельца на листе «Обратная связь» даёт ошибку строки", () => {
    const { errors } = parseFeedbackSheets(
      [{ "Кому": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "ОС" }],
      [{ "Кому": "Раздел", "Раздел": "Право", "Тип": "Курс", "Заголовок": "К", "Ссылка": "https://a.test" }],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Право");
  });

  it("курс без ссылки — ошибка, мероприятие без ссылки — норма", () => {
    const owner = [{ "Кому": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "ОС" }];
    const bad = parseFeedbackSheets(owner, [
      { "Кому": "Тест", "Раздел": "", "Тип": "Курс", "Заголовок": "К", "Ссылка": "" },
    ]);
    expect(bad.errors).toHaveLength(1);

    const ok = parseFeedbackSheets(owner, [
      { "Кому": "Тест", "Раздел": "", "Тип": "Мероприятие", "Заголовок": "Вебинар", "Ссылка": "" },
    ]);
    expect(ok.errors).toEqual([]);
    expect(ok.test?.events).toEqual([{ title: "Вебинар", url: "" }]);
  });

  it("владелец с пустым текстом и без рекомендаций получает null", () => {
    const { test } = parseFeedbackSheets(
      [{ "Кому": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "" }],
      [],
    );
    expect(test).toBeNull();
  });

  it("«Номер уровня» у теста и раздела должен быть пустым", () => {
    const { errors } = parseFeedbackSheets(
      [{ "Кому": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "ОС" }],
      [{ "Кому": "Тест", "Раздел": "", "Номер уровня": 1, "Тип": "Курс", "Заголовок": "К", "Ссылка": "https://a.test" }],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Номер уровня");
  });

  it("неизвестный уровень и неизвестный тип дают ошибку своей строки", () => {
    const a = parseFeedbackSheets([{ "Кому": "Глава", "Раздел": "", "Формат": "Простой", "Текст": "x" }], []);
    expect(a.errors).toHaveLength(1);
    const b = parseFeedbackSheets(
      [{ "Кому": "Тест", "Раздел": "", "Формат": "Простой", "Текст": "ОС" }],
      [{ "Кому": "Тест", "Раздел": "", "Тип": "Книга", "Заголовок": "К", "Ссылка": "https://a.test" }],
    );
    expect(b.errors).toHaveLength(1);
  });
});

/**
 * PRD-48 Э4: третий владелец «Рекомендаций» — адаптивный уровень. Материал уровня это его
 * `links[]`, адрес — «Раздел» + «Номер уровня», а сам уровень обязан быть описан на листе
 * «Адаптивные уровни».
 */
describe("«Рекомендации»: материалы адаптивного уровня", () => {
  const KNOWN = new Set([adaptiveLevelKey("финансы", 1), adaptiveLevelKey("финансы", 2)]);
  const LEVEL_ROW = {
    "Кому": "Уровень",
    "Раздел": "Финансы",
    "Номер уровня": 1,
    "Тип": "Курс",
    "Заголовок": "Основы учёта",
    "Ссылка": "https://example.test/accounting",
  };

  it("материалы уровня ходят по кругу, а «Номер уровня» в книге считается с 1", () => {
    const rows = serializeRecommendationRows(null, [], [
      { topicName: "Финансы", levelIndex: 0, links: [{ title: "Основы учёта", url: "https://example.test/a" }] },
      { topicName: "Финансы", levelIndex: 1, links: [{ title: "Разбор кейсов", url: "https://example.test/b" }] },
    ]);
    expect(rows.map((r) => r["Номер уровня"])).toEqual([1, 2]);

    const { byLevel, errors } = parseFeedbackSheets([], rows, KNOWN);
    expect(errors).toEqual([]);
    expect(byLevel.get(adaptiveLevelKey("финансы", 1))).toEqual({
      topicKey: "финансы",
      topicName: "Финансы",
      number: 1,
      links: [{ title: "Основы учёта", url: "https://example.test/a" }],
    });
    expect(byLevel.get(adaptiveLevelKey("финансы", 2))?.links).toEqual([
      { title: "Разбор кейсов", url: "https://example.test/b" },
    ]);
  });

  it("уровень, не описанный на листе «Адаптивные уровни», — ошибка строки", () => {
    const unknown = parseFeedbackSheets([], [{ ...LEVEL_ROW, "Номер уровня": 5 }], KNOWN);
    expect(unknown.errors).toHaveLength(1);
    expect(unknown.errors[0]).toContain("Адаптивные уровни");

    // Книга вовсе без листа уровней: набор адресов не передан — значит, уровней в книге нет.
    const noSheet = parseFeedbackSheets([], [LEVEL_ROW]);
    expect(noSheet.errors).toHaveLength(1);
    expect(noSheet.byLevel.size).toBe(0);
  });

  it("«Материал» и «Мероприятие» уровню недоступны — ошибка с объяснением", () => {
    for (const type of ["Материал", "Мероприятие"]) {
      const { errors, byLevel } = parseFeedbackSheets([], [{ ...LEVEL_ROW, "Тип": type }], KNOWN);
      expect(errors, `тип «${type}»`).toHaveLength(1);
      expect(errors[0]).toContain("только заголовок и ссылка");
      expect(byLevel.size).toBe(0);
    }
  });

  it("курс уровня без ссылки и уровень без номера — ошибки строки", () => {
    const noUrl = parseFeedbackSheets([], [{ ...LEVEL_ROW, "Ссылка": "" }], KNOWN);
    expect(noUrl.errors).toHaveLength(1);

    const noNumber = parseFeedbackSheets([], [{ ...LEVEL_ROW, "Номер уровня": "" }], KNOWN);
    expect(noNumber.errors).toHaveLength(1);
    expect(noNumber.errors[0]).toContain("Номер уровня");
  });

  it("на листе «Обратная связь» владелец «Уровень» отвергается и говорит, где он живёт", () => {
    const { errors } = parseFeedbackSheets(
      [{ "Кому": "Уровень", "Раздел": "Финансы", "Формат": "Простой", "Текст": "ОС уровня" }],
      [],
      KNOWN,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Адаптивные уровни");
  });
});

describe("толкование на листе «Обратная связь»", () => {
  /** Раздел с двумя текстами и подтемой, у которой есть только толкование. */
  const SECTION = {
    topicName: "Финансы",
    feedback: { format: "plain" as const, text: "Повторите бюджетный цикл." },
    interpretation: { format: "plain" as const, text: "Читает управленческую отчётность." },
    keyInterpretation: { "отчётность": { format: "plain" as const, text: "Состав форм и сроки." } },
  };

  it("выгружается двумя колонками рядом с обратной связью", () => {
    const [row] = serializeFeedbackRows(null, [SECTION]);
    expect(row["Текст"]).toBe("Повторите бюджетный цикл.");
    expect(row["Толкование"]).toBe("Читает управленческую отчётность.");
    expect(row["Формат толкования"]).toBe("Простой");
  });

  it("владелец с ОДНИМ толкованием тоже получает строку", () => {
    // Раньше условием строки была только обратная связь: раздел, у которого автор написал
    // одно толкование, в книгу не попадал вовсе — выгрузил, загрузил, и текста нет.
    const rows = serializeFeedbackRows(null, [
      { topicName: "Финансы", interpretation: { format: "plain", text: "Только толкование." } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Текст"]).toBe("");
    expect(rows[0]["Толкование"]).toBe("Только толкование.");
  });

  it("подтема с одним толкованием получает свою строку", () => {
    const rows = serializeFeedbackRows(null, [SECTION]);
    const tagRow = rows.find((r) => r["Кому"] === "Подтема");
    expect(tagRow?.["Подтема"]).toBe("отчётность");
    expect(tagRow?.["Толкование"]).toBe("Состав форм и сроки.");
    expect(tagRow?.["Текст"]).toBe("");
  });

  it("пустой формат толкования не печатается: иначе строка без текста читалась бы как «написано пусто»", () => {
    const [row] = serializeFeedbackRows(null, [
      { topicName: "Финансы", feedback: { format: "plain", text: "Только совет." } },
    ]);
    expect(row["Формат толкования"]).toBe("");
    expect(row["Толкование"]).toBe("");
  });

  it("круг «выгрузил — загрузил» сохраняет оба текста", () => {
    const parsed = parseFeedbackSheets(serializeFeedbackRows(null, [SECTION]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.interpretationByTopic.get("финансы")).toEqual({
      format: "plain",
      text: "Читает управленческую отчётность.",
    });
    expect(parsed.interpretationByKey.get("финансы")?.get("отчётность")).toEqual({
      format: "plain",
      text: "Состав форм и сроки.",
    });
    expect(parsed.byTopic.get("финансы")?.text).toBe("Повторите бюджетный цикл.");
  });

  it("пустое толкование снимает переопределение, а не молчит", () => {
    const parsed = parseFeedbackSheets([
      { "Кому": "Раздел", "Раздел": "Финансы", "Подтема": "", "Формат": "Простой", "Текст": "Совет.", "Формат толкования": "", "Толкование": "" },
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.interpretationByTopic.get("финансы")).toBeNull();
  });

  it("раздел, которого книга не назвала, в карте отсутствует — его толкование не трогают", () => {
    const parsed = parseFeedbackSheets([]);
    expect(parsed.interpretationByTopic.size).toBe(0);
    expect(parsed.interpretationByKey.size).toBe(0);
  });

  it("у ТЕСТА толкования нет: заполненная ячейка — ошибка строки", () => {
    const parsed = parseFeedbackSheets([
      { "Кому": "Тест", "Раздел": "", "Подтема": "", "Формат": "Простой", "Текст": "Спасибо.", "Формат толкования": "Простой", "Толкование": "Толкование теста" },
    ]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain("Толкование");
    expect(parsed.test).toBeUndefined();
  });

  it("книга, выгруженная до появления колонок, толкования не трогает", () => {
    // Старая книга колонки не несёт вовсе. Отличить «ячейка пуста» от «колонки нет» можно
    // только по ЗАГОЛОВКАМ листа: без них пустая ячейка прочлась бы как «стереть», и книга
    // трёхмесячной давности снесла бы тексты, которых её автор в глаза не видел.
    const oldHeaders = new Set(["Кому", "Раздел", "Подтема", "Формат", "Текст"]);
    const parsed = parseFeedbackSheets(
      [
        { "Кому": "Раздел", "Раздел": "Финансы", "Подтема": "", "Формат": "Простой", "Текст": "Совет." },
        { "Кому": "Подтема", "Раздел": "Финансы", "Подтема": "Отчётность", "Формат": "Простой", "Текст": "Совет." },
      ],
      [],
      new Set<string>(),
      oldHeaders,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.byTopic.get("финансы")?.text).toBe("Совет.");
    expect(parsed.interpretationByTopic.size).toBe(0);
    expect(parsed.interpretationByKey.size).toBe(0);
  });

  it("книга нынешнего формата с пустой ячейкой толкование снимает", () => {
    // Обратная сторона того же правила: колонка ЕСТЬ — значит её пустота что-то значит.
    const parsed = parseFeedbackSheets(
      [
        { "Кому": "Раздел", "Раздел": "Финансы", "Подтема": "", "Формат": "Простой", "Текст": "Совет.", "Формат толкования": "", "Толкование": "" },
      ],
      [],
      new Set<string>(),
      new Set(FEEDBACK_HEADERS),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.interpretationByTopic.get("финансы")).toBeNull();
  });

  it("недопустимый формат толкования называет СВОЮ колонку", () => {
    const parsed = parseFeedbackSheets([
      { "Кому": "Раздел", "Раздел": "Финансы", "Подтема": "", "Формат": "Простой", "Текст": "Совет.", "Формат толкования": "Кривой", "Толкование": "Текст" },
    ]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain("Формат толкования");
  });
});
