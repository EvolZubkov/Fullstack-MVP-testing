/**
 * @module shared/psychometrics/__tests__/scales
 */
import { describe, expect, it } from "vitest";

import { alphaOf } from "../reliability";
import {
  alphaIfMirrored,
  gradeDistribution,
  isDeadItem,
  looksIpsative,
  scaleValues,
  type ScaleResponse,
} from "../scales";

/** Пункт с пятью градациями, ответы разложены по трём из них. */
const ITEM: ScaleResponse[] = [
  { respondentId: "A", itemId: "s1", grade: 0, value: 1 },
  { respondentId: "B", itemId: "s1", grade: 2, value: 3 },
  { respondentId: "C", itemId: "s1", grade: 2, value: 3 },
  { respondentId: "D", itemId: "s1", grade: 4, value: 5 },
];

describe("gradeDistribution", () => {
  it("даёт долю на каждую градацию, включая невыбранные", () => {
    // Пустые столбики обязаны быть: без них форму распределения по гистограмме не увидеть.
    expect(gradeDistribution(ITEM, 5)).toEqual([0.25, 0, 0.5, 0, 0.25]);
  });

  it("число столбиков равно числу градаций ВОПРОСА, а не пяти", () => {
    // Шкалу задаёт автор (PRD-26): бывает и семибалльная, и десятибалльная (FR-30b).
    expect(gradeDistribution(ITEM, 7)).toHaveLength(7);
  });

  it("без ответов доли нулевые, а не выдуманные", () => {
    expect(gradeDistribution([], 3)).toEqual([0, 0, 0]);
  });
});

describe("isDeadItem", () => {
  it("пункт, где почти все ответили одинаково, мёртв", () => {
    // На гистограмме он виден мгновенно: один столбик почти во всю высоту.
    expect(isDeadItem([0.95, 0.05, 0, 0, 0])).toBe(true);
  });

  it("распределённый пункт живой", () => {
    expect(isDeadItem([0.25, 0, 0.5, 0, 0.25])).toBe(false);
  });
});

describe("alphaIfMirrored", () => {
  /** Шкала из трёх пунктов; у третьего вклад перепутан по знаку. */
  const SCALE: ScaleResponse[] = [];
  const rows: Array<[string, number, number, number]> = [
    ["R1", 1, 1, -1],
    ["R2", 2, 2, -2],
    ["R3", 3, 3, -3],
    ["R4", 4, 4, -4],
    ["R5", 5, 5, -5],
  ];
  for (const [respondentId, a, b, c] of rows) {
    SCALE.push({ respondentId, itemId: "s1", grade: a - 1, value: a });
    SCALE.push({ respondentId, itemId: "s2", grade: b - 1, value: b });
    SCALE.push({ respondentId, itemId: "s3", grade: c + 5, value: c });
  }

  it("переворот вклада ПОВЫШАЕТ альфу там, где пункт работал против шкалы", () => {
    // Это и есть вычислимое следствие вместо догадки о причине (FR-31b): подпись говорит, какой
    // стала бы альфа, и утверждение проверяемо.
    const before = alphaOf(scaleValues(SCALE));
    const after = alphaIfMirrored(SCALE, "s3");
    if (typeof before === "string" || typeof after === "string") throw new Error("ожидался коэффициент");

    expect(before.alpha).toBeLessThan(0.5);
    expect(after.alpha).toBeGreaterThan(0.9);
  });

  it("пересчёт идёт на ТЕХ ЖЕ наблюдениях — выборка не меняется", () => {
    const after = alphaIfMirrored(SCALE, "s3");
    if (typeof after === "string") throw new Error("ожидался коэффициент");
    expect(after.respondents).toBe(5);
    expect(after.items).toBe(3);
  });

  it("переворот пункта, который и так согласован, альфу не улучшает", () => {
    const before = alphaOf(scaleValues(SCALE));
    const after = alphaIfMirrored(SCALE, "s1");
    if (typeof before === "string" || typeof after === "string") throw new Error("ожидался коэффициент");
    expect(after.alpha).toBeLessThanOrEqual(before.alpha);
  });
});

describe("looksIpsative", () => {
  it("узнаёт методику с фиксированной суммой", () => {
    // Распределение баллов (PRD-44): участник раздаёт запас, и высокий балл одному пункту
    // неизбежно означает низкий другому — вклады связаны по построению, а не по качеству.
    const allocation: ScaleResponse[] = [
      { respondentId: "A", itemId: "s1", grade: 0, value: 7 },
      { respondentId: "A", itemId: "s2", grade: 0, value: 3 },
      { respondentId: "B", itemId: "s1", grade: 0, value: 2 },
      { respondentId: "B", itemId: "s2", grade: 0, value: 8 },
    ];
    expect(looksIpsative(allocation)).toBe(true);
  });

  it("обычную шкалу ипсативной не объявляет", () => {
    expect(looksIpsative(ITEM.concat({ respondentId: "A", itemId: "s2", grade: 1, value: 2 }))).toBe(false);
  });

  it("по одному респонденту вывода не делает", () => {
    expect(looksIpsative([ITEM[0]])).toBe(false);
  });
});
