/**
 * @module tests/workbook-adaptive
 *
 * PRD-48 Э4: лист «Адаптивные уровни». Проверяются свойства контракта: круг «сериализовал —
 * разобрал», смещение «Номер» ↔ `level_index` на единицу, порядок уровней внутри темы и
 * построчные ошибки — занятый номер, неизвестный тип порога, пустое название, границы
 * сложности.
 */
import { describe, it, expect } from "vitest";
import {
  ADAPTIVE_LEVEL_HEADERS,
  adaptiveLevelKey,
  parseAdaptiveLevelSheet,
  serializeAdaptiveLevelRows,
  type AdaptiveTopicSource,
} from "../server/utils/workbook-adaptive";

const TOPIC: AdaptiveTopicSource = {
  topicName: "Финансы",
  levels: [
    {
      levelIndex: 0,
      levelName: "Базовый",
      minDifficulty: 0,
      maxDifficulty: 40,
      questionsCount: 5,
      passThreshold: 60,
      passThresholdType: "percent",
      feedback: "Начните с основ.",
    },
    {
      levelIndex: 1,
      levelName: "Продвинутый",
      minDifficulty: 41,
      maxDifficulty: 100,
      questionsCount: 3,
      passThreshold: 2,
      passThresholdType: "absolute",
      feedback: null,
    },
  ],
};

/** Строка уровня с заполненными обязательными ячейками; `over` меняет проверяемую. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Раздел": "Финансы",
    "Номер": 1,
    "Название": "Базовый",
    "Сложность от": 0,
    "Сложность до": 40,
    "Вопросов": 5,
    "Тип порога": "Процент",
    "Порог": 60,
    "Обратная связь": "",
    ...over,
  };
}

describe("лист «Адаптивные уровни»", () => {
  it("колонки описывают уровень целиком и не обещают формата обратной связи", () => {
    expect(ADAPTIVE_LEVEL_HEADERS).toEqual([
      "Раздел", "Номер", "Название", "Сложность от", "Сложность до", "Вопросов",
      "Тип порога", "Порог", "Обратная связь",
    ]);
    expect(ADAPTIVE_LEVEL_HEADERS).not.toContain("Формат");
  });

  it("уровни темы ходят по кругу", () => {
    const rows = serializeAdaptiveLevelRows([TOPIC]);
    const { byTopic, topicNames, errors } = parseAdaptiveLevelSheet(rows);

    expect(errors).toEqual([]);
    expect(topicNames.get("финансы")).toBe("Финансы");
    expect(byTopic.get("финансы")).toEqual([
      {
        levelIndex: 0,
        levelName: "Базовый",
        minDifficulty: 0,
        maxDifficulty: 40,
        questionsCount: 5,
        passThreshold: 60,
        passThresholdType: "percent",
        feedback: "Начните с основ.",
      },
      {
        levelIndex: 1,
        levelName: "Продвинутый",
        minDifficulty: 41,
        maxDifficulty: 100,
        questionsCount: 3,
        passThreshold: 2,
        passThresholdType: "absolute",
        feedback: null,
      },
    ]);
  });

  // Смещение на единицу — самая вероятная ошибка этого листа: в книге номера с 1, в модели
  // `level_index` с 0. Круг её не ловит (две ошибки гасят друг друга), поэтому обе стороны
  // закреплены по отдельности.
  it("«Номер» в книге с 1, а level_index в модели с 0", () => {
    const rows = serializeAdaptiveLevelRows([TOPIC]);
    expect(rows.map((r) => r["Номер"])).toEqual([1, 2]);

    const { byTopic } = parseAdaptiveLevelSheet([row({ "Номер": 3 })]);
    expect(byTopic.get("финансы")?.[0].levelIndex).toBe(2);
  });

  it("уровни одной темы упорядочены номером, а не порядком строк", () => {
    const { byTopic, errors } = parseAdaptiveLevelSheet([
      row({ "Номер": 3, "Название": "Третий" }),
      row({ "Номер": 1, "Название": "Первый" }),
      row({ "Номер": 2, "Название": "Второй" }),
    ]);
    expect(errors).toEqual([]);
    expect(byTopic.get("финансы")?.map((l) => l.levelName)).toEqual(["Первый", "Второй", "Третий"]);
    expect(byTopic.get("финансы")?.map((l) => l.levelIndex)).toEqual([0, 1, 2]);
  });

  it("пустой «Номер» занимает следующий свободный внутри темы", () => {
    const { byTopic, errors } = parseAdaptiveLevelSheet([
      row({ "Номер": "", "Название": "Первый" }),
      row({ "Номер": "", "Название": "Второй" }),
      row({ "Раздел": "Право", "Номер": "", "Название": "Свой первый" }),
    ]);
    expect(errors).toEqual([]);
    expect(byTopic.get("финансы")?.map((l) => l.levelIndex)).toEqual([0, 1]);
    expect(byTopic.get("право")?.map((l) => l.levelIndex)).toEqual([0]);
  });

  it("повторённый номер в одной теме — ошибка строки, а не тихая замена", () => {
    const { byTopic, errors } = parseAdaptiveLevelSheet([
      row({ "Номер": 1, "Название": "Первый" }),
      row({ "Номер": 1, "Название": "Двойник" }),
      // Тот же номер в ДРУГОЙ теме — норма: адрес уровня включает раздел.
      row({ "Раздел": "Право", "Номер": 1, "Название": "Первый в праве" }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("уже описан выше");
    expect(byTopic.get("финансы")?.map((l) => l.levelName)).toEqual(["Первый"]);
    expect(byTopic.get("право")).toHaveLength(1);
  });

  it("неизвестный «Тип порога» — ошибка, пустой — «Процент»", () => {
    const bad = parseAdaptiveLevelSheet([row({ "Тип порога": "Медаль" })]);
    expect(bad.errors).toHaveLength(1);
    expect(bad.byTopic.size).toBe(0);

    const empty = parseAdaptiveLevelSheet([row({ "Тип порога": "" })]);
    expect(empty.errors).toEqual([]);
    expect(empty.byTopic.get("финансы")?.[0].passThresholdType).toBe("percent");

    const absolute = parseAdaptiveLevelSheet([row({ "Тип порога": "Сумма баллов" })]);
    expect(absolute.byTopic.get("финансы")?.[0].passThresholdType).toBe("absolute");
  });

  it("пустое «Название» — ошибка: имени по умолчанию у уровня нет", () => {
    const { errors, byTopic } = parseAdaptiveLevelSheet([row({ "Название": "  " })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Название");
    expect(byTopic.size).toBe(0);
  });

  it("границы сложности вне 0..100 и перевёрнутая пара — ошибки строки", () => {
    expect(parseAdaptiveLevelSheet([row({ "Сложность от": -1 })]).errors).toHaveLength(1);
    expect(parseAdaptiveLevelSheet([row({ "Сложность до": 101 })]).errors).toHaveLength(1);

    const inverted = parseAdaptiveLevelSheet([row({ "Сложность от": 60, "Сложность до": 40 })]);
    expect(inverted.errors).toHaveLength(1);
    expect(inverted.errors[0]).toContain("больше");
    expect(inverted.byTopic.size).toBe(0);
  });

  it("раздел и обязательные числа нужны, пустые строки пропускаются", () => {
    const { errors } = parseAdaptiveLevelSheet([
      row({ "Раздел": "" }),
      row({ "Вопросов": "" }),
      row({ "Порог": "" }),
      { "Раздел": "", "Номер": "", "Название": "", "Сложность от": "", "Сложность до": "",
        "Вопросов": "", "Тип порога": "", "Порог": "", "Обратная связь": "" },
    ]);
    expect(errors).toHaveLength(3);
  });

  it("адреса уровней собираются в том же виде, что ждут «Рекомендации»", () => {
    const { levelKeys } = parseAdaptiveLevelSheet([
      row({ "Номер": 1 }),
      row({ "Номер": 2, "Название": "Продвинутый" }),
    ]);
    expect([...levelKeys]).toEqual([adaptiveLevelKey("финансы", 1), adaptiveLevelKey("финансы", 2)]);
  });
});
