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
  it("заголовки разводят владельца и раздел отдельными колонками", () => {
    expect(FEEDBACK_HEADERS).toEqual(["Кому", "Раздел", "Формат", "Текст"]);
    expect(RECOMMENDATION_HEADERS).toEqual([
      "Кому", "Раздел", "Номер уровня", "Тип", "Заголовок", "Ссылка",
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

  it("обратная связь теста и раздела ходит по кругу", () => {
    const fb = serializeFeedbackRows(PAYLOAD, [{ topicName: "Финансы", feedback: PAYLOAD }]);
    const rec = serializeRecommendationRows(PAYLOAD, [{ topicName: "Финансы", feedback: PAYLOAD }]);
    const { test, byTopic, errors } = parseFeedbackSheets(fb, rec);

    expect(errors).toEqual([]);
    expect(test).toEqual(PAYLOAD);
    expect(byTopic.get("финансы")).toEqual(PAYLOAD);
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
