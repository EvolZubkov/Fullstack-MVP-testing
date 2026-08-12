/**
 * @module tests/workbook-question-order
 *
 * PRD-30 Э6: both new columns survive the Excel round trip.
 *
 *   - «Вопросы» → «Индекс в теме» (`questions.order_index`);
 *   - «Структура» → «Случайный порядок вопросов» (`test_sections.question_order`).
 *
 * Two properties matter beyond the plain round trip. A workbook WITHOUT the new
 * columns must import exactly as before (authors keep old files), and an empty
 * cell must mean the default — «не задано» for the index, «да» (random) for the
 * section — never 0 and never `fixed`, which would silently freeze delivery.
 */
import { describe, it, expect } from "vitest";
import {
  parseSettingsSheet,
  parseStructureRow,
  serializeSettingsRows,
  serializeStructureRow,
} from "../server/utils/workbook-sheets";
import { QUESTION_HEADERS, serializeQuestionRow } from "../server/services/questions-export";

const section = {
  topicName: "Охрана труда",
  sortOrder: 0,
  drawCount: 8,
  topicPassRuleJson: null,
  required: true,
};

/** Question shape the exporter reads (only the fields under test matter). */
const question = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "Q?",
  dataJson: { options: ["A", "B"] },
  correctJson: { correctIndex: 0 },
  difficulty: 50,
  shuffleAnswers: true,
  tags: [],
  orderIndex: null,
  feedback: null,
  feedbackMode: "general",
  feedbackCorrect: null,
  feedbackIncorrect: null,
  mediaUrl: null,
  mediaType: null,
  ...over,
});

describe("«Вопросы» → колонка «Индекс в теме» (PRD-30 FR-15)", () => {
  it("колонка объявлена в каноническом порядке заголовков", () => {
    expect(QUESTION_HEADERS).toContain("Индекс в теме");
  });

  it("экспорт выводит индекс", () => {
    const row = serializeQuestionRow(question({ orderIndex: 20 }) as never, "Охрана труда");

    expect(row["Индекс в теме"]).toBe(20);
  });

  it("экспорт выводит ноль как ноль — это обычный индекс", () => {
    const row = serializeQuestionRow(question({ orderIndex: 0 }) as never, "Охрана труда");

    expect(row["Индекс в теме"]).toBe(0);
  });

  it("вопрос без индекса даёт пустую ячейку, а не 0", () => {
    const row = serializeQuestionRow(question({ orderIndex: null }) as never, "Охрана труда");

    expect(row["Индекс в теме"]).toBe("");
  });
});

describe("«Структура» → колонка «Случайный порядок вопросов» (PRD-30 FR-15)", () => {
  const base = {
    "Раздел": "Охрана труда",
    "Порядок": "1",
    "Вопросов в выборке": "8",
    "Тип порога": "",
    "Порог": "",
    "Обязательный": "да",
  };

  it("«нет» читается как fixed", () => {
    const r = parseStructureRow({ ...base, "Случайный порядок вопросов": "нет" }, 0);

    expect(r).toMatchObject({ ok: true, value: { questionOrder: "fixed" } });
  });

  it("«да» читается как random", () => {
    const r = parseStructureRow({ ...base, "Случайный порядок вопросов": "да" }, 0);

    expect(r).toMatchObject({ ok: true, value: { questionOrder: "random" } });
  });

  it("пустая ячейка = «как в тесте»: тема следует правилу теста (FR-18)", () => {
    const r = parseStructureRow({ ...base, "Случайный порядок вопросов": "" }, 0);

    expect(r).toMatchObject({ ok: true, value: { questionOrder: null } });
  });

  it("книга БЕЗ колонки импортируется как раньше — тема наследует тест", () => {
    const r = parseStructureRow(base, 0);

    expect(r).toMatchObject({ ok: true, value: { questionOrder: null } });
  });

  it("экспорт выводит «нет» для темы с заданным порядком", () => {
    const row = serializeStructureRow({ ...section, questionOrder: "fixed" });

    expect(row["Случайный порядок вопросов"]).toBe("нет");
  });

  it("экспорт выводит «да» для темы со случайной выдачей", () => {
    const row = serializeStructureRow({ ...section, questionOrder: "random" });

    expect(row["Случайный порядок вопросов"]).toBe("да");
  });

  it("секция без переопределения экспортируется пустой ячейкой (FR-18)", () => {
    const row = serializeStructureRow(section);

    expect(row["Случайный порядок вопросов"]).toBe("");
  });

  it("round trip «как в тесте»: пустая ячейка возвращается пустой", () => {
    const exported = serializeStructureRow({ ...section, questionOrder: null });
    const parsed = parseStructureRow(
      { "Раздел": "Тема", "Порядок": 1, "Вопросов в выборке": 5, ...exported },
      0,
    );

    expect(parsed).toMatchObject({ ok: true, value: { questionOrder: null } });
  });
});

describe("round trip «Структура»", () => {
  it("export → import сохраняет fixed", () => {
    const exported = serializeStructureRow({ ...section, questionOrder: "fixed" });

    const parsed = parseStructureRow(exported as Record<string, unknown>, 0);

    expect(parsed).toMatchObject({ ok: true, value: { questionOrder: "fixed" } });
  });
});

/**
 * PRD-30 FR-22: правило ТЕСТА живёт на листе «Настройки» — список
 * «параметр/значение», а не таблица колонок: настроек теста по одной штуке, и
 * новая не должна расширять строку, которая уже есть у каждого автора.
 */
describe("лист «Настройки» — правило теста", () => {
  it("«Порядок выдачи вопросов» читается по всем трём значениям", () => {
    for (const [label, expected] of [
      ["Фиксированный порядок", "fixed"],
      ["Перемешивание", "random"],
      ["Полное перемешивание", "shuffle_all"],
      ["  полное ПЕРЕМЕШИВАНИЕ ", "shuffle_all"],
    ] as const) {
      const { draft, errors } = parseSettingsSheet([
        { "Параметр": "Порядок выдачи вопросов", "Значение": label },
      ]);
      expect(errors).toEqual([]);
      expect(draft.test.questionOrder).toBe(expected);
    }
  });

  it("пустое значение не меняет порядок, мусорное даёт ошибку строки", () => {
    expect(parseSettingsSheet([{ "Параметр": "Порядок выдачи вопросов", "Значение": "" }]).draft.test)
      .toEqual({});
    expect(parseSettingsSheet([{ "Параметр": "Порядок выдачи вопросов", "Значение": "как-нибудь" }]).errors)
      .toHaveLength(1);
  });

  it("порядок выдачи переживает круг «экспорт — импорт»", () => {
    const rows = serializeSettingsRows({ questionOrder: "fixed" });
    expect(parseSettingsSheet(rows).draft.test.questionOrder).toBe("fixed");
    expect(serializeSettingsRows({ questionOrder: null })
      .find((r) => r["Параметр"] === "Порядок выдачи вопросов")?.["Значение"]).toBe("");
  });
});
