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
