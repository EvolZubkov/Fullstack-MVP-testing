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
    expect(RECOMMENDATION_HEADERS).toEqual(["Кому", "Раздел", "Тип", "Заголовок", "Ссылка"]);
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
