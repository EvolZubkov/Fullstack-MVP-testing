/**
 * @module shared/template/__tests__/result-context-breakdown-block
 * @description PRD-50 FR-28/FR-30/FR-44 (Э4): сводный блок разреза в области ТЕСТА.
 *
 * Блок печатает записи, СОХРАНЁННЫЕ с попыткой, и ничего не пересуммирует: ключ, живущий
 * в двух разделах, ядро уже свело в одну запись области теста (FR-04), и сложение
 * секционных строк дало бы другое число.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";
import type { CtxResultBlock } from "../context";

/** Ключ «ПДн» выдан в ДВУХ разделах — по одной записи на раздел и одна на тест. */
const lawRow = {
  scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
  unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50,
};
const hrRow = {
  scope: "section:hr", axis: "tag", key: "ПДн", items: 2, answered: 1, earned: 2, possible: 2,
  unitEarned: 2, unitPossible: 2, percentPoints: 100, percentUnits: 100,
};
/** Запись области теста: ЧЕТЫРЕ вопроса, 3 из 4 баллов — не сумма процентов разделов. */
const testRow = {
  scope: "test", axis: "tag", key: "ПДн", items: 4, answered: 3, earned: 3, possible: 4,
  unitEarned: 3, unitPossible: 4, percentPoints: 75, percentUnits: 75,
};

const topics = [
  { topicName: "Право", correct: 1, total: 2, percent: 50, earnedPoints: 1, possiblePoints: 2,
    passed: false, breakdown: [lawRow] },
  { topicName: "Кадры", correct: 2, total: 2, percent: 100, earnedPoints: 2, possiblePoints: 2,
    passed: true, breakdown: [hrRow] },
];

const result = {
  passed: false, percent: 75, totalQuestions: 4, correct: 3,
  earnedPoints: 3, possiblePoints: 4, topicResults: topics, breakdowns: [testRow],
};

const build = (display: unknown, extra: Record<string, unknown> = {}) =>
  buildResultContext(result as never, "Тест", { breakdownDisplay: display, ...extra } as never);

const blockKeys = (blocks?: CtxResultBlock[]) => (blocks ?? []).map((b) => b.key);
const rowsOf = (ctx: ReturnType<typeof build>) =>
  (ctx.result as { breakdown?: Array<Record<string, unknown>> }).breakdown;

describe("старая настройка читается без изменения поведения", () => {
  it("настройка без положения показа даёт ровно вложенные полосы и НИ ОДНОГО нового поля", () => {
    const ctx = build({ visibility: "bar", basis: "units" });
    expect("breakdown" in ctx.result).toBe(false);
    expect(blockKeys(ctx.result.blocks)).not.toContain("breakdown");
    // Вложенные полосы на месте — ровно то, что печатал тест до этого этапа.
    const topic = ctx.result.topicResults![0] as { breakdown?: unknown[] };
    expect(topic.breakdown).toHaveLength(1);
  });

  it("hidden гасит ОБЕ проекции, как бы ни было задано положение (FR-31)", () => {
    const ctx = build({ visibility: "hidden", basis: "units", placement: "both" });
    expect("breakdown" in ctx.result).toBe(false);
    expect((ctx.result.topicResults![0] as { breakdown?: unknown[] }).breakdown).toBeUndefined();
  });

  it("настройки нет вовсе — контекст прежний", () => {
    const ctx = buildResultContext(result as never, "Тест", {} as never);
    expect("breakdown" in ctx.result).toBe(false);
  });
});

describe("положение показа разреза (FR-44)", () => {
  it("«block» печатает сводный блок и убирает вложенные полосы", () => {
    const ctx = build({ visibility: "bar", basis: "units", placement: "block" });
    expect(rowsOf(ctx)).toHaveLength(1);
    expect((ctx.result.topicResults![0] as { breakdown?: unknown[] }).breakdown).toBeUndefined();
  });

  it("«both» печатает и полосы, и блок", () => {
    const ctx = build({ visibility: "bar", basis: "units", placement: "both" });
    expect(rowsOf(ctx)).toHaveLength(1);
    expect((ctx.result.topicResults![0] as { breakdown?: unknown[] }).breakdown).toHaveLength(1);
  });

  it("«topics» — это и есть умолчание: блока нет", () => {
    const ctx = build({ visibility: "bar", basis: "units", placement: "topics" });
    expect("breakdown" in ctx.result).toBe(false);
  });
});

describe("блок печатает сохранённые записи и НЕ пересуммирует их (FR-04)", () => {
  it("ключ из двух разделов даёт ОДНУ сводную строку с числами области теста", () => {
    const ctx = build({ visibility: "bar_and_value", basis: "points", placement: "block" });
    const rows = rowsOf(ctx)!;
    expect(rows).toHaveLength(1);
    // 75 % — сохранённая запись области теста. Сумма секционных дала бы 3/4 в баллах
    // тоже, но 50 + 100 = 150 или среднее 75 — это уже РАСЧЁТ, которого блок не делает;
    // сторож стоит на составе строки, а не на арифметике.
    expect(rows[0]).toEqual({
      key: "ПДн",
      items: 4,
      answered: 3,
      earned: 3,
      possible: 4,
      percent: 75,
      percentUnits: 75,
      percentPoints: 75,
      barPercent: 75,
      showValue: true,
      valueLabel: "75 %",
      // PRD-50 §16 (FR-54): исход в составе строки есть, но фикстура сделана без него —
      // сводная запись пришла без порога, и строка печатается нейтрально.
      passed: null,
      passClass: "",
    });
  });

  it("строка блока подчиняется той же базе показа, что вложенная", () => {
    const units = { ...testRow, percentUnits: 40, percentPoints: 75 };
    const ctx = buildResultContext({ ...result, breakdowns: [units] } as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units", placement: "block" },
    } as never);
    expect(rowsOf(ctx)![0]).toMatchObject({ barPercent: 40, showValue: false, valueLabel: "" });
  });

  it("записей области теста нет — ни поля, ни подблока", () => {
    const ctx = buildResultContext({ ...result, breakdowns: [] } as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units", placement: "both" },
    } as never);
    expect("breakdown" in ctx.result).toBe(false);
    expect(blockKeys(ctx.result.blocks)).not.toContain("breakdown");
  });
});

describe("блок в порядке блоков итогов (FR-28)", () => {
  const display = { visibility: "bar", basis: "units", placement: "block" };

  it("несёт заголовок из надписи results.breakdown и свой флаг", () => {
    const ctx = build(display, { labels: { "results.breakdown": "Разрез результата" } });
    const block = (ctx.result.blocks ?? []).find((b) => b.key === "breakdown");
    expect(block).toMatchObject({ heading: "Разрез результата", isBreakdown: true });
  });

  it("автор двигает блок там же, где шкалы и показатели", () => {
    const ctx = build(display, { blockOrder: ["breakdown", "summary", "topics"] });
    expect(blockKeys(ctx.result.blocks)).toEqual(["breakdown", "summary", "topics"]);
  });

  it("шаблон, не знающий ключа, блок не печатает и не ломается (FR-30)", () => {
    // Сторонний манифест реестра PRD-3, объявивший состав БЕЗ разреза.
    const ctx = build(display, {
      templateBlockOrder: ["summary", "topics"],
      labels: { "results.breakdown": "Разрез результата" },
    });
    expect(blockKeys(ctx.result.blocks)).toEqual(["summary", "topics"]);
    // Данные при этом остаются в контексте: их печатает шаблон, который ключ знает.
    expect(rowsOf(ctx)).toHaveLength(1);
  });
});
