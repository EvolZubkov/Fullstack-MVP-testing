/**
 * @module shared/draw/__tests__/exposure
 * @description PRD-55 (FR-12 - FR-17): вес сравнителен ВНУТРИ пула, ограничен пределом R и
 * вырождается в единицу, когда сравнивать нечего.
 */
import { describe, it, expect } from "vitest";
import { computeWeights, weightedPick, EXPOSURE_WEIGHT_RATIO } from "../exposure";

const counts = (pairs: Array<[string, number]>) => new Map(pairs);

/** Линейный конгруэнтный генератор: воспроизводимая случайность для статистических проверок. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("computeWeights", () => {
  it("равные счётчики дают равные веса", () => {
    const w = computeWeights(["a", "b", "c"], counts([["a", 5], ["b", 5], ["c", 5]]));
    expect([...w.values()]).toEqual([1, 1, 1]);
  });

  it("нет данных — все веса единичны", () => {
    const w = computeWeights(["a", "b"], counts([]));
    expect([...w.values()]).toEqual([1, 1]);
  });

  it("самое горячее задание получает 1, самое свежее — R", () => {
    const w = computeWeights(["a", "b"], counts([["a", 10], ["b", 0]]));
    expect(w.get("a")).toBe(1);
    expect(w.get("b")).toBe(EXPOSURE_WEIGHT_RATIO);
  });

  it("промежуточное задание раскладывается линейно", () => {
    const w = computeWeights(["a", "b", "c"], counts([["a", 10], ["b", 5], ["c", 0]]));
    expect(w.get("b")).toBeCloseTo(1 + (EXPOSURE_WEIGHT_RATIO - 1) * 0.5, 10);
  });

  it("отсутствующий в карте счётчик означает ноль выдач", () => {
    const w = computeWeights(["a", "b"], counts([["a", 4]]));
    expect(w.get("b")).toBe(EXPOSURE_WEIGHT_RATIO);
  });

  it("пустой пул даёт пустую карту", () => {
    expect(computeWeights([], counts([])).size).toBe(0);
  });

  it("единственное задание пула весит единицу", () => {
    const w = computeWeights(["a"], counts([["a", 99]]));
    expect(w.get("a")).toBe(1);
  });

  it("шкала СРАВНИТЕЛЬНАЯ: одинаковый разрыв даёт одинаковые веса при любых абсолютных числах", () => {
    const small = computeWeights(["a", "b"], counts([["a", 2], ["b", 0]]));
    const large = computeWeights(["a", "b"], counts([["a", 2000], ["b", 0]]));
    expect([...small.values()]).toEqual([...large.values()]);
  });

  it("вес не выходит за пределы [1, R] ни при каком разбросе", () => {
    const w = computeWeights(
      ["a", "b", "c", "d"],
      counts([["a", 0], ["b", 1], ["c", 500], ["d", 10000]]),
    );
    for (const v of w.values()) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(EXPOSURE_WEIGHT_RATIO);
    }
  });
});

describe("weightedPick", () => {
  // При одинаковом U ключ U^(1/w) тем больше, чем больше вес: 0.5 < 0.5^(1/2) < 0.5^(1/4).
  const half = () => 0.5;

  it("при равном случайном числе порядок задаёт вес", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const w = new Map([["a", 1], ["b", 4], ["c", 2]]);
    expect(weightedPick(pool, 3, w, half).map((q) => q.id)).toEqual(["b", "c", "a"]);
  });

  it("берёт ровно k заданий", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const w = new Map([["a", 1], ["b", 4], ["c", 2]]);
    expect(weightedPick(pool, 2, w, half).map((q) => q.id)).toEqual(["b", "c"]);
  });

  it("k больше пула — возвращает весь пул", () => {
    const pool = [{ id: "a" }, { id: "b" }];
    expect(weightedPick(pool, 5, new Map([["a", 1], ["b", 1]]), half)).toHaveLength(2);
  });

  it("пустой пул — пустой результат", () => {
    expect(weightedPick([], 3, new Map(), half)).toEqual([]);
  });

  it("k <= 0 — пустой результат", () => {
    expect(weightedPick([{ id: "a" }], 0, new Map(), half)).toEqual([]);
  });

  it("вес по умолчанию — единица", () => {
    const pool = [{ id: "a" }, { id: "b" }];
    expect(weightedPick(pool, 2, new Map(), half)).toHaveLength(2);
  });

  it("при равных весах распределение равномерно", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const w = new Map(pool.map((q) => [q.id, 1] as const));
    const hits: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const rnd = seeded(1);
    for (let i = 0; i < 4000; i += 1) {
      for (const q of weightedPick(pool, 1, w, rnd)) hits[q.id] += 1;
    }
    for (const id of ["a", "b", "c", "d"]) {
      expect(hits[id]).toBeGreaterThan(700);
      expect(hits[id]).toBeLessThan(1300);
    }
  });

  it("свежее задание выпадает чаще горячего, но горячее не исчезает", () => {
    const pool = [{ id: "hot" }, { id: "fresh" }];
    const w = new Map([["hot", 1], ["fresh", EXPOSURE_WEIGHT_RATIO]]);
    const rnd = seeded(7);
    let freshFirst = 0;
    for (let i = 0; i < 4000; i += 1) {
      if (weightedPick(pool, 1, w, rnd)[0].id === "fresh") freshFirst += 1;
    }
    expect(freshFirst).toBeGreaterThan(2400);
    expect(freshFirst).toBeLessThan(3600);
  });
});
