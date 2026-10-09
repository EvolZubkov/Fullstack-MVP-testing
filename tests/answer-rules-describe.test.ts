import { describe, it, expect } from "vitest";

import type { AnswerRuleSet } from "../shared/answer-check";
import {
  describeNumericRule,
  describeProbe,
  formatRuleNumber,
  numericRuleTitle,
} from "../shared/answer-check/describe";

describe("formatRuleNumber", () => {
  it("печатает по-русски: запятая, без хвостовых нулей", () => {
    expect(formatRuleNumber(3.14)).toBe("3,14");
    expect(formatRuleNumber(1500)).toBe("1500");
    expect(formatRuleNumber(0.5)).toBe("0,5");
    expect(formatRuleNumber(-25)).toBe("-25");
  });

  it("не разворачивает дробь в бесконечный хвост", () => {
    expect(formatRuleNumber(1 / 3)).toBe("0,333333");
  });
});

describe("numericRuleTitle — заголовок свёрнутой строки", () => {
  it("называет оператор, а не только «равно»", () => {
    expect(numericRuleTitle({ kind: "number", op: "eq", value: -25 }, "°C")).toBe("равно -25 °C");
    expect(numericRuleTitle({ kind: "number", op: "gte", value: 0.5 }, "")).toBe("больше или равно 0,5");
    expect(numericRuleTitle({ kind: "number", op: "ne", value: 0 }, "")).toBe("не равно 0");
  });

  it("допуск попадает в заголовок только там, где он действует", () => {
    const eq = { kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } } as const;
    expect(numericRuleTitle(eq, "°C")).toBe("равно -25 °C ±2");
    const pct = { kind: "number", op: "eq", value: 1500, tolerance: { unit: "pct", value: 2 } } as const;
    expect(numericRuleTitle(pct, "")).toBe("равно 1500 ±2 %");
  });
});

describe("describeNumericRule — расшифровка словами (FR-28aa2)", () => {
  it("допуск в единицах разворачивается в границы", () => {
    const rule = { kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } } as const;
    expect(describeNumericRule(rule, "°C")).toBe("Засчитывается ответ от -27 до -23 °C");
  });

  it("допуск в процентах пересчитывается в те же границы", () => {
    const rule = { kind: "number", op: "eq", value: 1500, tolerance: { unit: "pct", value: 2 } } as const;
    expect(describeNumericRule(rule, "")).toBe("Засчитывается ответ от 1470 до 1530");
  });

  it("равенство без допуска называет одно значение", () => {
    expect(describeNumericRule({ kind: "number", op: "eq", value: 7 }, "")).toBe("Засчитывается ответ ровно 7");
  });

  it("границы читаются словами", () => {
    expect(describeNumericRule({ kind: "number", op: "gt", value: 0 }, "")).toBe(
      "Засчитывается ответ больше 0",
    );
    expect(describeNumericRule({ kind: "number", op: "gte", value: 0.5 }, "")).toBe(
      "Засчитывается ответ не меньше 0,5",
    );
    expect(describeNumericRule({ kind: "number", op: "lt", value: 100 }, "мм")).toBe(
      "Засчитывается ответ меньше 100 мм",
    );
    expect(describeNumericRule({ kind: "number", op: "lte", value: 100 }, "мм")).toBe(
      "Засчитывается ответ не больше 100 мм",
    );
  });

  it("«не равно» называет то, что НЕ засчитывается", () => {
    expect(describeNumericRule({ kind: "number", op: "ne", value: 0 }, "")).toBe(
      "Засчитывается любой ответ, кроме 0",
    );
    const window = { kind: "number", op: "ne", value: 100, tolerance: { unit: "abs", value: 5 } } as const;
    expect(describeNumericRule(window, "")).toBe("Засчитывается любой ответ, кроме значений от 95 до 105");
  });

  it("без единицы хвоста не остаётся", () => {
    expect(describeNumericRule({ kind: "number", op: "eq", value: 7 }, "  ")).toBe(
      "Засчитывается ответ ровно 7",
    );
  });
});

describe("describeProbe — объяснение вердикта пробы (FR-28g, FR-28h)", () => {
  const TEXT_SET: AnswerRuleSet = {
    answerKind: "text",
    join: "any",
    rules: [
      { kind: "text", match: "wildcard", value: "Ростехнадзор" },
      { kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" },
    ],
  };

  it("называет сработавшее правило", () => {
    const text = describeProbe(TEXT_SET, { passed: true, perRule: [false, true] });
    expect(text).toBe(
      "Выполнено правило «Федеральная служба по * надзору». Проба не сохраняется и на статистику не влияет.",
    );
  });

  it("при связке «любое» и полном промахе объясняет, чего не хватило", () => {
    const text = describeProbe(TEXT_SET, { passed: false, perRule: [false, false] });
    expect(text).toBe(
      "Не выполнено ни одно правило, а ответ засчитывается, если выполнено любое из них. " +
        "Проба не сохраняется и на статистику не влияет.",
    );
  });

  it("при связке «все» называет первое невыполненное", () => {
    const all: AnswerRuleSet = { ...TEXT_SET, join: "all" };
    const text = describeProbe(all, { passed: false, perRule: [true, false] });
    expect(text).toBe(
      "Не выполнено правило «Федеральная служба по * надзору», а ответ засчитывается, " +
        "если выполнены все. Проба не сохраняется и на статистику не влияет.",
    );
  });

  it("при связке «все» и полном попадании говорит об этом", () => {
    const all: AnswerRuleSet = { ...TEXT_SET, join: "all" };
    const text = describeProbe(all, { passed: true, perRule: [true, true] });
    expect(text).toBe("Выполнены все правила. Проба не сохраняется и на статистику не влияет.");
  });

  it("числовое правило называется так же, как в свёрнутой строке", () => {
    const set: AnswerRuleSet = {
      answerKind: "number",
      join: "any",
      unit: "°C",
      rules: [{ kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } }],
    };
    expect(describeProbe(set, { passed: true, perRule: [true] })).toBe(
      "Выполнено правило «равно -25 °C ±2». Проба не сохраняется и на статистику не влияет.",
    );
  });
});
