/**
 * Unit tests for the multi-sheet workbook parsers/serializers (PRD-14 FR-15,
 * server/utils/workbook-sheets.ts): bands grammar, scale/result-variable/
 * measurement row parsing, source-key validation.
 */
import { describe, it, expect } from "vitest";
import {
  parseBands,
  serializeBands,
  parseScaleRow,
  parseResultVariableRow,
  parseMeasurementRow,
  validateSourceKey,
  parseBool,
  parseStructureRow,
  serializeStructureRow,
  parseVariantThresholdRow,
  serializeVariantThresholdRow,
  parseQuotaRow,
  serializeQuotaRow,
  parseScoringOverrideRow,
  serializeScoringOverrideRow,
} from "../server/utils/workbook-sheets";

describe("parseBands / serializeBands", () => {
  it("пусто → []", () => {
    expect(parseBands("")).toEqual({ ok: true, value: [] });
  });

  it("разбирает диапазоны с подписями", () => {
    const r = parseBands("0..16 low «Низкий»; 17..26 mid «Средний»; 27..54 high «Высокий»");
    expect(r).toEqual({
      ok: true,
      value: [
        { min: 0, max: 16, level: "low", label: "Низкий" },
        { min: 17, max: 26, level: "mid", label: "Средний" },
        { min: 27, max: 54, level: "high", label: "Высокий" },
      ],
    });
  });

  it("подпись опциональна", () => {
    expect(parseBands("0..10 a")).toEqual({ ok: true, value: [{ min: 0, max: 10, level: "a" }] });
  });

  it("запятая внутри подписи «…» не ломает разбор", () => {
    const r = parseBands("0..10 a «Низкий, спокойный»");
    expect(r.ok && r.value[0].label).toBe("Низкий, спокойный");
    expect(r.ok && r.value.length).toBe(1);
  });

  it("min > max → ошибка", () => {
    expect(parseBands("10..0 a").ok).toBe(false);
  });

  it("мусор → ошибка", () => {
    expect(parseBands("abc").ok).toBe(false);
  });

  it("round-trip serialize ∘ parse", () => {
    const cell = "0..16 low «Низкий»; 17..54 high «Высокий»";
    const parsed = parseBands(cell);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeBands(parsed.value)).toBe(cell);
  });
});

describe("parseBool", () => {
  it("да/yes/true/1 → true; иначе false", () => {
    for (const v of ["да", "Yes", "TRUE", "1", "истина"]) expect(parseBool(v)).toBe(true);
    for (const v of ["нет", "no", "", "0", "x"]) expect(parseBool(v)).toBe(false);
  });
});

describe("parseScaleRow", () => {
  it("разбирает строку шкалы с диапазонами", () => {
    const r = parseScaleRow({
      "Ключ": "ee",
      "Название": "Истощение",
      "Тип": "level",
      "Агрегация": "sum",
      "Диапазоны": "0..16 low «Низкий»",
      "Показывать ученику": "да",
      "SCORM": "both",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      key: "ee",
      label: "Истощение",
      type: "level",
      aggregation: "sum",
      showToLearner: true,
      scormTarget: "both",
      configJson: { bands: [{ min: 0, max: 16, level: "low", label: "Низкий" }] },
    });
  });

  it("без ключа → ошибка", () => {
    expect(parseScaleRow({ "Название": "X" }).ok).toBe(false);
  });

  it("дефолты агрегации/нормализации/направления", () => {
    const r = parseScaleRow({ "Ключ": "k", "Название": "L", "Тип": "number" });
    expect(r.ok && r.value).toMatchObject({ aggregation: "sum", normalization: "none", direction: "positive" });
  });
});

describe("parseResultVariableRow", () => {
  it("разбирает показатель и маппит «Управляет статусом»", () => {
    const r = parseResultVariableRow({
      "Имя": "passed",
      "Метка": "Сдал",
      "Тип": "boolean",
      "Формула": "score >= 60",
      "Управляет статусом": "успех",
    });
    expect(r.ok && r.value).toMatchObject({
      name: "passed",
      label: "Сдал",
      type: "boolean",
      formula: "score >= 60",
      controlsStatus: "success",
    });
  });

  it("неизвестный статус → ошибка", () => {
    expect(parseResultVariableRow({ "Имя": "x", "Управляет статусом": "abc" }).ok).toBe(false);
  });
});

describe("parseMeasurementRow", () => {
  it("разбирает вклад и маппит источник", () => {
    const r = parseMeasurementRow({
      "Вопрос": "q1",
      "Шкала": "ee",
      "Источник": "вариант",
      "Ключ источника": "0",
      "Значение": "3",
      "Вес": "2",
    });
    expect(r.ok && r.value).toEqual({
      questionRef: "q1",
      scaleKey: "ee",
      sourceType: "option",
      sourceKey: "0",
      value: 3,
      weight: 2,
    });
  });

  it("вес по умолчанию = 1", () => {
    const r = parseMeasurementRow({ "Вопрос": "q1", "Шкала": "ee", "Источник": "вопрос", "Значение": "1" });
    expect(r.ok && r.value.weight).toBe(1);
  });

  it("неизвестный источник → ошибка", () => {
    expect(parseMeasurementRow({ "Вопрос": "q", "Шкала": "s", "Источник": "xxx", "Значение": "1" }).ok).toBe(false);
  });

  it("нечисловое значение → ошибка", () => {
    expect(parseMeasurementRow({ "Вопрос": "q", "Шкала": "s", "Источник": "вопрос", "Значение": "abc" }).ok).toBe(false);
  });
});

describe("parseStructureRow", () => {
  it("разбирает раздел с порогом «Сумма баллов»", () => {
    const r = parseStructureRow(
      { "Раздел": "О компании", "Порядок": "1", "Вопросов в выборке": "12", "Тип порога": "Сумма баллов", "Порог": "15", "Обязательный": "да" },
      0,
    );
    expect(r.ok && r.value).toEqual({
      topicName: "О компании",
      sortOrder: 1,
      drawCount: 12,
      passRule: { source: "custom", type: "absolute", value: 15 },
      required: true,
    });
  });

  it("«Процент» → custom percent", () => {
    const r = parseStructureRow({ "Раздел": "X", "Вопросов в выборке": "5", "Тип порога": "Процент", "Порог": "70" }, 3);
    expect(r.ok && r.value.passRule).toEqual({ source: "custom", type: "percent", value: 70 });
    expect(r.ok && r.value.sortOrder).toBe(3); // «Порядок» пуст → индекс строки
  });

  it("пустой тип порога → наследование; «нет» → не проверять", () => {
    const inh = parseStructureRow({ "Раздел": "X", "Вопросов в выборке": "5" }, 0);
    expect(inh.ok && inh.value.passRule).toEqual({ source: "inherit_overall" });
    const none = parseStructureRow({ "Раздел": "X", "Вопросов в выборке": "5", "Тип порога": "Нет" }, 0);
    expect(none.ok && none.value.passRule).toEqual({ source: "none" });
  });

  it("required по умолчанию true, «нет» → false", () => {
    expect(parseStructureRow({ "Раздел": "X", "Вопросов в выборке": "5" }, 0)).toMatchObject({ value: { required: true } });
    expect(parseStructureRow({ "Раздел": "X", "Вопросов в выборке": "5", "Обязательный": "нет" }, 0)).toMatchObject({ value: { required: false } });
  });

  it("нет темы / некорректный drawCount / неизвестный тип → ошибка", () => {
    expect(parseStructureRow({ "Вопросов в выборке": "5" }, 0).ok).toBe(false);
    expect(parseStructureRow({ "Раздел": "X", "Вопросов в выборке": "0" }, 0).ok).toBe(false);
    expect(parseStructureRow({ "Раздел": "X", "Вопросов в выборке": "5", "Тип порога": "abc", "Порог": "1" }, 0).ok).toBe(false);
  });

  it("round-trip serialize ∘ parse (absolute)", () => {
    const row = { "Раздел": "О компании", "Порядок": "1", "Вопросов в выборке": "12", "Тип порога": "Сумма баллов", "Порог": "15", "Обязательный": "да" };
    const parsed = parseStructureRow(row, 0);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = serializeStructureRow({
      topicName: parsed.value.topicName,
      sortOrder: parsed.value.sortOrder,
      drawCount: parsed.value.drawCount,
      topicPassRuleJson: parsed.value.passRule,
      required: parsed.value.required,
    });
    expect(out).toMatchObject({ "Раздел": "О компании", "Вопросов в выборке": 12, "Тип порога": "Сумма баллов", "Порог": 15, "Обязательный": "да" });
  });
});

describe("parseQuotaRow", () => {
  it("разбирает квоту (режим по умолчанию «Ровно» = exact)", () => {
    const r = parseQuotaRow({ "Раздел": "О компании", "Тег": "Стратегия", "Количество": "4" });
    expect(r.ok && r.value).toEqual({ topicName: "О компании", tag: "Стратегия", count: 4, mode: "exact" });
  });

  it("«Не менее» → min", () => {
    const r = parseQuotaRow({ "Раздел": "X", "Тег": "t", "Количество": "2", "Режим": "Не менее" });
    expect(r.ok && r.value.mode).toBe("min");
  });

  it("нет тега / count < 1 / неизвестный режим → ошибка", () => {
    expect(parseQuotaRow({ "Раздел": "X", "Количество": "2" }).ok).toBe(false);
    expect(parseQuotaRow({ "Раздел": "X", "Тег": "t", "Количество": "0" }).ok).toBe(false);
    expect(parseQuotaRow({ "Раздел": "X", "Тег": "t", "Количество": "2", "Режим": "иногда" }).ok).toBe(false);
  });

  it("round-trip serialize ∘ parse", () => {
    const r = parseQuotaRow({ "Раздел": "О компании", "Тег": "Стратегия", "Количество": "4", "Режим": "Не менее" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serializeQuotaRow(r.value.topicName, { tag: r.value.tag, count: r.value.count, mode: r.value.mode })).toEqual({
      "Раздел": "О компании", "Тег": "Стратегия", "Количество": 4, "Режим": "Не менее",
    });
  });
});

describe("validateSourceKey", () => {
  it("вопрос: ключ должен быть пустым", () => {
    expect(validateSourceKey("question", "", 0)).toBeNull();
    expect(validateSourceKey("question", "1", 0)).not.toBeNull();
  });
  it("вариант: 0-based индекс в диапазоне", () => {
    expect(validateSourceKey("option", "0", 3)).toBeNull();
    expect(validateSourceKey("option", "2", 3)).toBeNull();
    expect(validateSourceKey("option", "3", 3)).not.toBeNull();
    expect(validateSourceKey("option", "-1", 3)).not.toBeNull();
  });
  it("пара/позиция: формат a:b, первый индекс < unitCount", () => {
    expect(validateSourceKey("matching_pair", "0:1", 2)).toBeNull();
    expect(validateSourceKey("matching_pair", "2:0", 2)).not.toBeNull();
    expect(validateSourceKey("ranking_position", "1:0", 3)).toBeNull();
    expect(validateSourceKey("ranking_position", "x", 3)).not.toBeNull();
  });
});

// ─── «Оценка» (PRD-15 block D, FR-36) ─────────────────────────────────────────

describe("parseScoringOverrideRow", () => {
  it("разбирает строку с баллом и сложностью; пустые ячейки → null", () => {
    const r = parseScoringOverrideRow({ "Вопрос": "q1", "Балл": "7", "Сложность": "80" });
    expect(r.ok && r.value).toEqual({ questionRef: "q1", points: 7, scoringRaw: "", difficulty: 80 });
  });

  it("балл 0 — валидное переопределение (без зачёта в этом тесте)", () => {
    const r = parseScoringOverrideRow({ "Вопрос": "q1", "Балл": "0" });
    expect(r.ok && r.value.points).toBe(0);
  });

  it("«Цена ответа» передаётся сырой строкой (резолв по типу вопроса позже)", () => {
    const r = parseScoringOverrideRow({ "Вопрос": "q1", "Цена ответа": "веса: 1 # 0" });
    expect(r.ok && r.value.scoringRaw).toBe("веса: 1 # 0");
  });

  it("ошибки: нет вопроса / нецелый балл / сложность вне 0..100 / пустая строка", () => {
    expect(parseScoringOverrideRow({ "Балл": "1" }).ok).toBe(false);
    expect(parseScoringOverrideRow({ "Вопрос": "q1", "Балл": "1.5" }).ok).toBe(false);
    expect(parseScoringOverrideRow({ "Вопрос": "q1", "Балл": "-1" }).ok).toBe(false);
    expect(parseScoringOverrideRow({ "Вопрос": "q1", "Сложность": "101" }).ok).toBe(false);
    expect(parseScoringOverrideRow({ "Вопрос": "q1" }).ok).toBe(false);
  });
});

describe("serializeScoringOverrideRow", () => {
  it("сериализует переопределения; null → пустая ячейка", () => {
    const row = serializeScoringOverrideRow(
      { points: 5, scoringJson: null, difficulty: null },
      "q1",
    );
    expect(row).toEqual({ "Вопрос": "q1", "Балл": 5, "Цена ответа": "", "Сложность": "" });
  });

  it("явное точное переопределение экспортируется как «точное»", () => {
    const row = serializeScoringOverrideRow(
      { points: null, scoringJson: { kind: "exact" }, difficulty: null },
      "q1",
    );
    expect(row["Цена ответа"]).toBe("точное");
  });

  it("градуированная конфигурация — в грамматике PRD-10", () => {
    const row = serializeScoringOverrideRow(
      { points: null, scoringJson: { kind: "weighted", weights: [1, 0] } as any, difficulty: 90 },
      "q2",
    );
    expect(row["Цена ответа"]).toBe("веса: 1 # 0");
    expect(row["Сложность"]).toBe(90);
  });
});

// ─── PRD-24: лист «Пороги вариантов» ─────────────────────────────────────────

describe("«По вариантам» на листе «Структура»", () => {
  it("разбирает тип порога «По вариантам» в правило без значения", () => {
    const r = parseStructureRow(
      { "Раздел": "О компании", "Вопросов в выборке": "12", "Тип порога": "По вариантам" },
      0,
    );
    // пороги приезжают отдельным листом, поэтому byForm пока пуст
    expect(r.ok && r.value.passRule).toEqual({ source: "by_variant", byForm: {} });
  });

  it("экспортирует правило by_variant без числа в «Порог»", () => {
    const row = serializeStructureRow({
      topicName: "О компании",
      sortOrder: 0,
      drawCount: 12,
      topicPassRuleJson: { source: "by_variant", byForm: { f1: { type: "percent", value: 60 } } },
      required: true,
    });
    expect(row["Тип порога"]).toBe("По вариантам");
    expect(row["Порог"]).toBe("");
  });
});

describe("parseVariantThresholdRow / serializeVariantThresholdRow", () => {
  it("разбирает строку с номером варианта", () => {
    const r = parseVariantThresholdRow({
      "Раздел": "О компании", "Вариант": "2", "Тип порога": "Сумма баллов", "Порог": "15",
    });
    expect(r.ok && r.value).toEqual({
      topicName: "О компании", variantNumber: 2, type: "absolute", value: 15,
    });
  });

  it("принимает «Вариант 3» как номер 3", () => {
    const r = parseVariantThresholdRow({
      "Раздел": "X", "Вариант": "Вариант 3", "Тип порога": "Процент", "Порог": "70",
    });
    expect(r.ok && r.value.variantNumber).toBe(3);
  });

  it("отвергает строку без раздела, без номера и с неизвестным типом", () => {
    expect(parseVariantThresholdRow({ "Вариант": "1", "Тип порога": "Процент", "Порог": "50" }).ok).toBe(false);
    expect(parseVariantThresholdRow({ "Раздел": "X", "Вариант": "", "Тип порога": "Процент", "Порог": "50" }).ok).toBe(false);
    expect(parseVariantThresholdRow({ "Раздел": "X", "Вариант": "1", "Тип порога": "abc", "Порог": "50" }).ok).toBe(false);
    expect(parseVariantThresholdRow({ "Раздел": "X", "Вариант": "1", "Тип порога": "Процент", "Порог": "" }).ok).toBe(false);
  });

  it("сериализует строку обратно (round-trip)", () => {
    const row = serializeVariantThresholdRow({
      topicName: "О компании", variantNumber: 2, type: "absolute", value: 15,
    });
    expect(row).toEqual({
      "Раздел": "О компании", "Вариант": 2, "Тип порога": "Сумма баллов", "Порог": 15,
    });
    const back = parseVariantThresholdRow(row);
    expect(back.ok && back.value).toEqual({
      topicName: "О компании", variantNumber: 2, type: "absolute", value: 15,
    });
  });
});

describe("parseVariantThresholdRow — граничные случаи", () => {
  it("принимает «Тема» как синоним «Раздела»", () => {
    const r = parseVariantThresholdRow({ "Тема": "О компании", "Вариант": "1", "Тип порога": "Процент", "Порог": "50" });
    expect(r.ok && r.value.topicName).toBe("О компании");
  });

  it("отвергает нулевой номер варианта и отрицательный порог", () => {
    expect(parseVariantThresholdRow({ "Раздел": "X", "Вариант": "0", "Тип порога": "Процент", "Порог": "50" }).ok).toBe(false);
    expect(parseVariantThresholdRow({ "Раздел": "X", "Вариант": "1", "Тип порога": "Процент", "Порог": "-1" }).ok).toBe(false);
  });

  it("порог 0 допустим (тема без требования по этому варианту)", () => {
    const r = parseVariantThresholdRow({ "Раздел": "X", "Вариант": "1", "Тип порога": "Процент", "Порог": "0" });
    expect(r.ok && r.value.value).toBe(0);
  });
});
