/**
 * @module shared/questions/__tests__/psycho-hash
 *
 * PRD-66 FR-09a: the fingerprint of a question's CONTENT. What is asserted here is
 * exactly what the correctness of observation series rests on — which edits start a new
 * series and which must not, because a false split throws away collected data and a
 * false merge mixes answers to two different instruments.
 */
import { describe, expect, it } from "vitest";

import { computePsychoHash } from "../psycho-hash";

const single = {
  type: "single",
  prompt: "Какая мера относится к антикоррупционным?",
  dataJson: { options: ["Проверка контрагента", "Согласование подарка", "Ежегодное обучение"] },
  correctJson: { correctIndex: 0 },
};

describe("computePsychoHash", () => {
  it("даёт одинаковый отпечаток одинаковому содержанию", () => {
    expect(computePsychoHash(single)).toBe(computePsychoHash({ ...single }));
  });

  it("меняет отпечаток при смене правильного ответа", () => {
    const moved = { ...single, correctJson: { correctIndex: 1 } };
    expect(computePsychoHash(moved)).not.toBe(computePsychoHash(single));
  });

  it("меняет отпечаток при правке текста задания", () => {
    const edited = { ...single, prompt: `${single.prompt} (ред.)` };
    expect(computePsychoHash(edited)).not.toBe(computePsychoHash(single));
  });

  it("меняет отпечаток при правке текста варианта", () => {
    const edited = {
      ...single,
      dataJson: { options: ["Проверка контрагента перед сделкой", "Согласование подарка", "Ежегодное обучение"] },
    };
    expect(computePsychoHash(edited)).not.toBe(computePsychoHash(single));
  });

  it("НЕ меняет отпечаток при перестановке вариантов с сохранением верного", () => {
    // BRD PA-15b: the fingerprint is built from «option text -> correctness» pairs, not
    // from indexes. A reshuffle is the same instrument, so the series must not break.
    const shuffled = {
      ...single,
      dataJson: { options: ["Ежегодное обучение", "Проверка контрагента", "Согласование подарка"] },
      correctJson: { correctIndex: 1 },
    };
    expect(computePsychoHash(shuffled)).toBe(computePsychoHash(single));
  });

  it("не зависит от окружающих пробелов в тексте задания", () => {
    const padded = { ...single, prompt: `  ${single.prompt}  ` };
    expect(computePsychoHash(padded)).toBe(computePsychoHash(single));
  });

  it("не зависит от цены и правила частичного кредита", () => {
    // PA-15d: scoring belongs to the TEST, so it never enters a question fingerprint.
    const scored = { ...single, points: 5, scoringJson: { mode: "partial" } } as typeof single;
    expect(computePsychoHash(scored)).toBe(computePsychoHash(single));
  });

  it("различает задания разных типов с одинаковым текстом", () => {
    const asMultiple = { ...single, type: "multiple", correctJson: { correctIndexes: [0] } };
    expect(computePsychoHash(asMultiple)).not.toBe(computePsychoHash(single));
  });

  it("у измерительного задания эталона нет, и это не мешает отпечатку", () => {
    // PA-15e: a `scale` without a key has an empty correctJson by construction.
    const measurement = {
      type: "scale",
      prompt: "Мне стало безразлично, что происходит с коллегами",
      dataJson: { min: 1, max: 5 },
      correctJson: {},
    };
    expect(computePsychoHash(measurement)).toHaveLength(64);
    expect(computePsychoHash(measurement)).toBe(computePsychoHash({ ...measurement }));
  });

  it("различает сопоставление с разными парами", () => {
    const matching = {
      type: "matching",
      prompt: "Сопоставьте роль и зону ответственности",
      dataJson: { left: ["Руководитель", "Аналитик"], right: ["Решение", "Данные"] },
      correctJson: { pairs: [[0, 0], [1, 1]] },
    };
    const swapped = { ...matching, correctJson: { pairs: [[0, 1], [1, 0]] } };
    expect(computePsychoHash(swapped)).not.toBe(computePsychoHash(matching));
  });

  it("возвращает шестнадцатеричный SHA-256", () => {
    expect(computePsychoHash(single)).toMatch(/^[0-9a-f]{64}$/);
  });
});
