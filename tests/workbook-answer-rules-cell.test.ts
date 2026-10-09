/**
 * @module tests/workbook-answer-rules-cell
 * @description Грамматика ячейки правил проверки в книге Excel (PRD-57 FR-31, Э10).
 *
 * Ячейка — единственное место книги, где эталон не число и не список номеров, а
 * КОНСТРУКЦИЯ. Поэтому её разбор и печать проверяются отдельно от листов: круг «печать —
 * разбор» обязан возвращать тот же набор правил, иначе книга молча подменит эталон.
 */
import { describe, it, expect } from "vitest";

import {
  parseRulesCell,
  printRulesCell,
} from "../server/services/workbook-answer-rules";

const short = (raw: string, opts: Parameters<typeof parseRulesCell>[1] = { type: "short" }) =>
  parseRulesCell(raw, opts);

describe("текстовые правила", () => {
  it("строка ячейки — одно правило обычного сравнения", () => {
    const parsed = short("Ростехнадзор\nФедеральная служба по * надзору");
    expect(parsed.errors).toEqual([]);
    expect(parsed.set).toEqual({
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "wildcard", value: "Ростехнадзор" },
        { kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" },
      ],
    });
  });

  it("регулярное выражение объявляется префиксом", () => {
    const parsed = short(String.raw`регулярное: ^(РТН|Ростехнадзор)$`);
    expect(parsed.set?.rules).toEqual([
      { kind: "text", match: "regex", value: String.raw`^(РТН|Ростехнадзор)$` },
    ]);
  });

  it("принимает латинский алиас префикса", () => {
    const parsed = short(String.raw`regex: ^\d+$`);
    expect(parsed.set?.rules[0]).toEqual({ kind: "text", match: "regex", value: String.raw`^\d+$` });
  });

  it("долгое выражение помечено, иначе пакет исполнил бы его снова", () => {
    const parsed = short(String.raw`регулярное (долгое): ^(\S+\s?)+ надзору$`);
    expect(parsed.set?.rules[0]).toEqual({
      kind: "text",
      match: "regex",
      value: String.raw`^(\S+\s?)+ надзору$`,
      slow: true,
    });
  });

  it("пустая ячейка даёт набор без правил, а не ошибку", () => {
    const parsed = short("   \n  ");
    expect(parsed.errors).toEqual([]);
    expect(parsed.set).toEqual({ answerKind: "text", join: "any", rules: [] });
  });
});

describe("числовые правила", () => {
  it("оператор, число и допуск", () => {
    const parsed = short("= 3,14 ± 0,01");
    expect(parsed.set).toEqual({
      answerKind: "number",
      join: "any",
      rules: [{ kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.01 } }],
    });
  });

  it("процентный допуск", () => {
    const parsed = short("= 100 ± 5%");
    expect(parsed.set?.rules[0]).toEqual({
      kind: "number",
      op: "eq",
      value: 100,
      tolerance: { unit: "pct", value: 5 },
    });
  });

  it("все шесть операторов и их алиасы", () => {
    const parsed = short("> 1\n>= 2\n< 3\n<= 4\n<> 5\n!= 6");
    expect(parsed.set?.rules.map((r: { op?: string }) => r.op)).toEqual([
      "gt", "gte", "lt", "lte", "ne", "ne",
    ]);
  });

  it("диапазон записывается двумя правилами и связкой, а не своей записью", () => {
    const parsed = short(">= 10\n<= 20", { type: "short", join: "все" });
    expect(parsed.set?.join).toBe("all");
    expect(parsed.set?.rules).toHaveLength(2);
  });

  it("единица измерения приезжает своей колонкой", () => {
    const parsed = short("= 25 ± 2", { type: "short", unit: "°C" });
    expect(parsed.set?.unit).toBe("°C");
  });

  it("вид ответа объявленный текстом сильнее похожести на число", () => {
    const parsed = short("= 5", { type: "short", answerKind: "текст" });
    expect(parsed.set?.answerKind).toBe("text");
    expect(parsed.set?.rules[0]).toEqual({ kind: "text", match: "wildcard", value: "= 5" });
  });

  it("объявленное число с нечисловой строкой — ошибка, а не молчаливый текст", () => {
    const parsed = short("Ростехнадзор", { type: "short", answerKind: "число" });
    expect(parsed.set).toBeUndefined();
    expect(parsed.errors.join(" ")).toContain("Ростехнадзор");
  });

  it("неизвестный допуск называется ошибкой", () => {
    const parsed = short("= 3,14 ± примерно", { type: "short", answerKind: "число" });
    expect(parsed.errors).toHaveLength(1);
  });
});

describe("правила пропусков", () => {
  const blankIds = ["city", "year"];

  it("имя пропуска стоит перед правилом", () => {
    const parsed = parseRulesCell("[city] Москва\n[city] Санкт-Петербург\n[year] = 1703", {
      type: "blanks",
      blankIds,
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.blanks).toEqual([
      {
        id: "city",
        answerKind: "text",
        join: "any",
        rules: [
          { kind: "text", match: "wildcard", value: "Москва" },
          { kind: "text", match: "wildcard", value: "Санкт-Петербург" },
        ],
      },
      {
        id: "year",
        answerKind: "number",
        join: "any",
        rules: [{ kind: "number", op: "eq", value: 1703 }],
      },
    ]);
  });

  it("порядок пропусков берётся из текста задания, а не из ячейки", () => {
    const parsed = parseRulesCell("[year] = 1703\n[city] Москва", { type: "blanks", blankIds });
    expect(parsed.blanks?.map((b: { id: string }) => b.id)).toEqual(["city", "year"]);
  });

  it("пропуск без правил остаётся в наборе: это несделанная работа, а не потеря", () => {
    const parsed = parseRulesCell("[city] Москва", { type: "blanks", blankIds });
    expect(parsed.blanks?.[1]).toEqual({ id: "year", answerKind: "text", join: "any", rules: [] });
  });

  it("имя, которого нет в тексте задания, — ошибка", () => {
    const parsed = parseRulesCell("[country] Россия", { type: "blanks", blankIds });
    expect(parsed.blanks).toBeUndefined();
    expect(parsed.errors.join(" ")).toContain("country");
  });

  it("вид ответа и связка объявляются у САМОГО пропуска: колонка их не выразит", () => {
    const parsed = parseRulesCell(
      "[city: все]\n[city] Москва\n[city] столица\n[year: число]\n[year] = 1703",
      { type: "blanks", blankIds },
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.blanks?.[0]).toMatchObject({ id: "city", answerKind: "text", join: "all" });
    // Объявленный вид сильнее вывода по правилам, а не наоборот.
    expect(parsed.blanks?.[1].answerKind).toBe("number");
  });

  it("непонятное свойство пропуска — ошибка, а не молчаливое умолчание", () => {
    const parsed = parseRulesCell("[city: хитрое]\n[city] Москва", { type: "blanks", blankIds });
    expect(parsed.errors.join(" ")).toContain("хитрое");
  });

  it("колонки вида и связки служат умолчанием для пропусков без объявления", () => {
    const parsed = parseRulesCell("[city] Москва\n[city] столица", {
      type: "blanks",
      blankIds,
      join: "все",
    });
    expect(parsed.blanks?.[0].join).toBe("all");
  });

  it("правило без имени пропуска — ошибка: к какому полю его отнести, неизвестно", () => {
    const parsed = parseRulesCell("Москва", { type: "blanks", blankIds });
    expect(parsed.errors).toHaveLength(1);
  });
});

describe("развёрнутый ответ", () => {
  it("правил не имеет вовсе", () => {
    expect(parseRulesCell("", { type: "long" })).toEqual({ errors: [] });
  });

  it("непустая ячейка — ошибка автора, а не значение на выброс", () => {
    const parsed = parseRulesCell("что угодно", { type: "long" });
    expect(parsed.errors).toHaveLength(1);
  });
});

describe("печать и круг", () => {
  const roundTrip = (
    type: "short" | "blanks",
    correct: unknown,
    opts: Partial<Parameters<typeof parseRulesCell>[1]> = {},
  ) => {
    const cell = printRulesCell(type, correct);
    const parsed = parseRulesCell(cell, { type, blankIds: ["city", "year"], ...opts });
    expect(parsed.errors).toEqual([]);
    return type === "short" ? parsed.set : { blanks: parsed.blanks };
  };

  it("текстовый набор переживает круг", () => {
    const set = {
      answerKind: "text",
      join: "all",
      rules: [
        { kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" },
        { kind: "text", match: "regex", value: String.raw`^РТН$`, slow: true },
      ],
    };
    expect(roundTrip("short", set, { join: "все" })).toEqual(set);
  });

  it("числовой набор переживает круг вместе с единицей и допуском", () => {
    const set = {
      answerKind: "number",
      join: "any",
      unit: "°C",
      rules: [
        { kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } },
        { kind: "number", op: "gte", value: 0 },
      ],
    };
    expect(roundTrip("short", set, { unit: "°C" })).toEqual(set);
  });

  it("пропуск со связкой «все» и числом вопреки написанию переживает круг", () => {
    const correct = {
      blanks: [
        {
          id: "city",
          answerKind: "text",
          join: "all",
          rules: [
            { kind: "text", match: "wildcard", value: "Москва" },
            { kind: "text", match: "wildcard", value: "* столица" },
          ],
        },
        { id: "year", answerKind: "number", join: "any", rules: [] },
      ],
    };
    expect(roundTrip("blanks", correct)).toEqual(correct);
  });

  it("набор пропусков переживает круг", () => {
    const correct = {
      blanks: [
        { id: "city", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Москва" }] },
        { id: "year", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 1703 }] },
      ],
    };
    expect(roundTrip("blanks", correct)).toEqual(correct);
  });

  it("печать канонична: русский префикс, знак допуска, неравенство", () => {
    const cell = printRulesCell("short", {
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "regex", value: "^a$" }],
    });
    expect(cell).toBe("регулярное: ^a$");
    const numeric = printRulesCell("short", {
      answerKind: "number",
      join: "any",
      rules: [
        { kind: "number", op: "ne", value: 0 },
        { kind: "number", op: "eq", value: 1.5, tolerance: { unit: "pct", value: 10 } },
      ],
    });
    expect(numeric).toBe("<> 0\n= 1,5 ± 10%");
  });
});
