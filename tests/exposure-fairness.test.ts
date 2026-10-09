/**
 * @module tests/exposure-fairness
 * @description PRD-55 (FR-21, FR-22): поправка обязана сокращать разброс показов и НЕ обязана
 * смещать трудность выдачи. Требование проверяемое, а не декларативное, — вот его проверка.
 *
 * Моделируется жизненный цикл банка: счётчик копится по ходу, как в эксплуатации, а не задаётся
 * заранее. Именно в этом режиме поправка и работает — она реагирует на собственные прошлые
 * решения, и проверять её на статичных счётчиках значило бы проверять не то.
 *
 * Если первая проверка когда-нибудь покраснеет, это находка о величине предела `R`, а не повод
 * ослабить порог: смысл теста в том, чтобы такая находка стала видимой.
 */
import { describe, it, expect } from "vitest";
import { computeWeights, weightedPick } from "../shared/draw/exposure";

const BANK_SIZE = 25;
const FORM_SIZE = 20;
const ATTEMPTS = 200;

interface BankItem {
  id: string;
  difficulty: number;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/**
 * Прогоняет серию попыток и возвращает разброс показов и среднюю трудность выданных форм.
 * @param weighted - Считать ли веса по накопленной экспозиции (иначе все веса равны).
 * @param seed - Зерно генератора, одно на оба режима.
 */
function simulate(weighted: boolean, seed: number): { spread: number; avgDifficulty: number } {
  const bank: BankItem[] = Array.from({ length: BANK_SIZE }, (_, i) => ({
    id: `q${i}`,
    // Трудность разложена по банку равномерно: если поправка вымывает лёгкие или трудные
    // задания, средняя трудность формы поедет, и вторая проверка это увидит.
    difficulty: (i % 5) * 25,
  }));
  const counts = new Map<string, number>();
  const rnd = seeded(seed);
  const difficulties: number[] = [];

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const weights = weighted
      ? computeWeights(bank.map((q) => q.id), counts)
      : new Map(bank.map((q) => [q.id, 1] as const));
    const form = weightedPick(bank, FORM_SIZE, weights, rnd);
    for (const q of form) counts.set(q.id, (counts.get(q.id) ?? 0) + 1);
    difficulties.push(form.reduce((s, q) => s + q.difficulty, 0) / form.length);
  }

  const shown = bank.map((q) => counts.get(q.id) ?? 0);
  const mean = shown.reduce((a, b) => a + b, 0) / shown.length;
  const spread = Math.sqrt(shown.reduce((a, b) => a + (b - mean) ** 2, 0) / shown.length);
  const avgDifficulty = difficulties.reduce((a, b) => a + b, 0) / difficulties.length;
  return { spread, avgDifficulty };
}

describe("экспозиция: честность поправки", () => {
  it("сокращает разброс числа показов", () => {
    const weighted = simulate(true, 12345);
    const uniform = simulate(false, 12345);
    expect(weighted.spread).toBeLessThan(uniform.spread);
  });

  it("сокращение устойчиво к зерну генератора", () => {
    for (const seed of [1, 777, 20260912]) {
      expect(simulate(true, seed).spread).toBeLessThan(simulate(false, seed).spread);
    }
  });

  it("не смещает среднюю трудность выданных форм", () => {
    for (const seed of [1, 777, 20260912]) {
      const weighted = simulate(true, seed).avgDifficulty;
      const uniform = simulate(false, seed).avgDifficulty;
      expect(Math.abs(weighted - uniform)).toBeLessThan(2);
    }
  });

  it("ни одно задание банка не выпадает из оборота", () => {
    const bank = Array.from({ length: BANK_SIZE }, (_, i) => ({ id: `q${i}` }));
    const counts = new Map<string, number>();
    const rnd = seeded(4242);
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const weights = computeWeights(bank.map((q) => q.id), counts);
      for (const q of weightedPick(bank, FORM_SIZE, weights, rnd)) {
        counts.set(q.id, (counts.get(q.id) ?? 0) + 1);
      }
    }
    for (const item of bank) {
      expect(counts.get(item.id) ?? 0).toBeGreaterThan(0);
    }
  });
});

/**
 * PRD-55 для АДАПТИВНОЙ выдачи: банк уровня узок — полоса трудности отсекает большую часть
 * темы, — и там выработка головы заметнее, чем в разделе обычного теста. Замер повторяет
 * основной, но на пуле уровня: восемь заданий в полосе, три на уровень.
 */
describe("экспозиция: честность поправки на уровне адаптивного теста", () => {
  const LEVEL_POOL = 8;
  const LEVEL_SIZE = 3;

  /** Разброс показов внутри полосы трудности за серию попыток. */
  function simulateLevel(weighted: boolean, seed: number): number {
    const pool = Array.from({ length: LEVEL_POOL }, (_, i) => ({ id: `lvl-q${i}` }));
    const counts = new Map<string, number>();
    const rnd = seeded(seed);

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const weights = weighted
        ? computeWeights(pool.map((q) => q.id), counts)
        : new Map(pool.map((q) => [q.id, 1] as const));
      for (const q of weightedPick(pool, LEVEL_SIZE, weights, rnd)) {
        counts.set(q.id, (counts.get(q.id) ?? 0) + 1);
      }
    }

    const shown = pool.map((q) => counts.get(q.id) ?? 0);
    const mean = shown.reduce((a, b) => a + b, 0) / shown.length;
    return Math.sqrt(shown.reduce((a, b) => a + (b - mean) ** 2, 0) / shown.length);
  }

  it("сокращает разброс показов и в узком пуле уровня", () => {
    for (const seed of [1, 777, 20260914]) {
      expect(simulateLevel(true, seed)).toBeLessThan(simulateLevel(false, seed));
    }
  });

  it("ни одно задание полосы не выпадает из оборота", () => {
    // Узкий пул — там, где детерминированный обход был бы особенно соблазнителен: предел
    // отношения весов держит отбор статистическим, и хвост полосы тоже выдаётся.
    const pool = Array.from({ length: LEVEL_POOL }, (_, i) => ({ id: `lvl-q${i}` }));
    const counts = new Map<string, number>();
    const rnd = seeded(31337);
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const weights = computeWeights(pool.map((q) => q.id), counts);
      for (const q of weightedPick(pool, LEVEL_SIZE, weights, rnd)) {
        counts.set(q.id, (counts.get(q.id) ?? 0) + 1);
      }
    }
    for (const item of pool) expect(counts.get(item.id) ?? 0).toBeGreaterThan(0);
  });
});
