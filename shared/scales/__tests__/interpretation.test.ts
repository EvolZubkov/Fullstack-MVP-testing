// shared/scales/__tests__/interpretation.test.ts
import { describe, it, expect } from "vitest";
import {
  findBand,
  findOutcome,
  parseScaleInterpretation,
  parseIndicatorInterpretation,
} from "../interpretation";

const MASLACH_EE = [
  { min: 0, max: 14, level: "low", label: "Низкий", text: "Ресурс в норме." },
  { min: 15, max: 24, level: "moderate", label: "Умеренный" },
  { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." },
];

describe("findBand", () => {
  it("возвращает интервал, в который попало значение", () => {
    expect(findBand(MASLACH_EE, 27)?.level).toBe("high");
    expect(findBand(MASLACH_EE, 14)?.level).toBe("low");
    expect(findBand(MASLACH_EE, 15)?.level).toBe("moderate");
  });

  it("включает обе границы", () => {
    expect(findBand(MASLACH_EE, 0)?.level).toBe("low");
    expect(findBand(MASLACH_EE, 45)?.level).toBe("high");
  });

  it("возвращает null вне интервалов и на пустом списке", () => {
    expect(findBand(MASLACH_EE, 46)).toBeNull();
    expect(findBand([], 10)).toBeNull();
  });
});

describe("findOutcome", () => {
  const OUTCOMES = [
    { code: "engaged", label: "Вовлечённость" },
    { code: "burnout", label: "Выгорание", text: "Требует внимания специалиста." },
  ];

  it("находит исход по коду", () => {
    expect(findOutcome(OUTCOMES, "burnout")?.label).toBe("Выгорание");
  });

  it("возвращает null для неизвестного кода", () => {
    expect(findOutcome(OUTCOMES, "unknown")).toBeNull();
  });

  it("приводит булево значение к кодам true/false", () => {
    const b = [{ code: "true", label: "Да" }, { code: "false", label: "Нет" }];
    expect(findOutcome(b, true)?.label).toBe("Да");
    expect(findOutcome(b, false)?.label).toBe("Нет");
  });
});

describe("parseScaleInterpretation", () => {
  it("читает домен, направление и интервалы из config_json", () => {
    const parsed = parseScaleInterpretation({
      domainMin: 0,
      domainMax: 45,
      valence: "lower_is_better",
      bands: MASLACH_EE,
    });
    expect(parsed.domainMin).toBe(0);
    expect(parsed.domainMax).toBe(45);
    expect(parsed.valence).toBe("lower_is_better");
    expect(parsed.bands).toHaveLength(3);
  });

  it("выводит домен из охвата интервалов, когда он не задан", () => {
    const parsed = parseScaleInterpretation({ bands: MASLACH_EE });
    expect(parsed.domainMin).toBe(0);
    expect(parsed.domainMax).toBe(45);
  });

  it("даёт нейтральное направление и пустой домен на пустом конфиге", () => {
    const parsed = parseScaleInterpretation({});
    expect(parsed.valence).toBe("none");
    expect(parsed.domainMin).toBeNull();
    expect(parsed.domainMax).toBeNull();
    expect(parsed.bands).toEqual([]);
  });

  it("явный null домена — это ОТСУТСТВИЕ домена, а не ноль", () => {
    // Редактор сохраняет незаполненный домен именно так (`domainMin: null`), а не
    // отсутствием ключа. `Number(null)` равен нулю и конечен, поэтому домен становился
    // отрезком 0..0 — и карточка печатала учащемуся «18 из 0».
    const parsed = parseScaleInterpretation({ domainMin: null, domainMax: null, bands: [] });
    expect(parsed.domainMin).toBeNull();
    expect(parsed.domainMax).toBeNull();
  });

  it("пустая строка домена тоже не число", () => {
    // Пустое числовое поле формы доезжает строкой; `Number("")` — ноль.
    const parsed = parseScaleInterpretation({ domainMin: "", domainMax: "", bands: [] });
    expect(parsed.domainMin).toBeNull();
    expect(parsed.domainMax).toBeNull();
  });

  it("интервал без границы отбрасывается, а не сползает в ноль", () => {
    const parsed = parseScaleInterpretation({
      bands: [{ min: null, max: 14, level: "low" }, { min: 15, max: 24, level: "moderate" }],
    });
    expect(parsed.bands.map((b) => b.level)).toEqual(["moderate"]);
  });

  it("сортирует интервалы по возрастанию min", () => {
    const parsed = parseScaleInterpretation({
      bands: [{ min: 25, max: 45, level: "high" }, { min: 0, max: 14, level: "low" }],
    });
    expect(parsed.bands.map((b) => b.level)).toEqual(["low", "high"]);
  });
});

describe("parseIndicatorInterpretation", () => {
  it("читает перечень исходов", () => {
    const parsed = parseIndicatorInterpretation({
      outcomes: [{ code: "engaged", label: "Вовлечённость" }],
    });
    expect(parsed.outcomes).toHaveLength(1);
    expect(parsed.bands).toEqual([]);
  });

  it("читает интервалы для числового показателя", () => {
    const parsed = parseIndicatorInterpretation({ bands: MASLACH_EE });
    expect(parsed.bands).toHaveLength(3);
    expect(parsed.outcomes).toEqual([]);
  });
});
