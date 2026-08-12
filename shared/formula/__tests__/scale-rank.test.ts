/**
 * @module shared/formula/__tests__/scale-rank
 *
 * Ranking a group of scales (PRD-44 §5) — the arithmetic behind `topScale` / `bottomScale`.
 *
 * The rules under test all exist because the reference questionnaire exposed them:
 * two of its four styles tie at 34 points, and the source spreadsheet resolves that
 * silently — `MATCH(MAX(...))` simply returns whichever column stands further left. A
 * silent resolution is the one thing a report must not inherit, so the tie is both
 * DECIDED (by the authored order of the test's scales, identically on every host) and
 * VISIBLE (`tiedCount`, `margin`).
 */
import { describe, expect, it } from "vitest";
import { rankScales, scaleAtRank } from "../scale-rank";
import type { ScaleResult } from "../types";

const scale = (normalized: number, over: Partial<ScaleResult> = {}): ScaleResult => ({
  raw: normalized,
  normalized,
  percent: normalized,
  level: "",
  label: "",
  hasValue: true,
  ...over,
});

/** Authored order of the test's scales — what breaks ties (FR-21). */
const ORDER = ["cel", "vdo", "kom", "pro"];

const CHIL = {
  cel: scale(34, { level: "high", label: "Высокий" }),
  vdo: scale(16),
  kom: scale(14),
  pro: scale(34),
};

describe("рейтинг шкал", () => {
  it("строится по убыванию нормализованного значения", () => {
    const ranked = rankScales(ORDER, CHIL, ORDER);
    expect(ranked.map((r) => r.key)).toEqual(["cel", "pro", "vdo", "kom"]);
  });

  it("ранжирует по НОРМАЛИЗОВАННОМУ, а не по сырому значению (FR-20)", () => {
    // Сырые значения шкал с разными доменами несравнимы, а `direction: inverse`
    // уже учтён в нормализованном.
    const values = {
      a: scale(10, { raw: 1000 }),
      b: scale(90, { raw: 5 }),
    };
    expect(rankScales(["a", "b"], values, ["a", "b"]).map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("шкалы без значения в рейтинг не входят", () => {
    const values = { a: scale(10), b: scale(0, { hasValue: false }), c: scale(5) };
    expect(rankScales(["a", "b", "c"], values, ["a", "b", "c"]).map((r) => r.key)).toEqual(["a", "c"]);
  });

  it("неизвестный ключ молча пропускается, а не ломает рейтинг", () => {
    expect(rankScales(["a", "нет-такой"], { a: scale(3) }, ["a"]).map((r) => r.key)).toEqual(["a"]);
  });

  it("пустой список ключей даёт пустой рейтинг", () => {
    expect(rankScales([], CHIL, ORDER)).toEqual([]);
  });
});

describe("правило ничьей (FR-21, FR-22)", () => {
  it("при равенстве выше идёт шкала, которая раньше в авторском порядке", () => {
    const ranked = rankScales(ORDER, CHIL, ORDER);
    expect(ranked[0].key).toBe("cel");
    expect(ranked[1].key).toBe("pro");
  });

  it("авторский порядок решает, а не порядок ключей в формуле", () => {
    // Тот же набор, перечисленный в формуле наоборот, даёт ТОТ ЖЕ рейтинг:
    // иначе один ответ при пересчёте в вебе и в пакете дал бы разного лидера.
    const ranked = rankScales(["pro", "kom", "vdo", "cel"], CHIL, ORDER);
    expect(ranked.map((r) => r.key)).toEqual(["cel", "pro", "vdo", "kom"]);
  });

  it("ничья видима: tiedCount считает делящих место", () => {
    const ranked = rankScales(ORDER, CHIL, ORDER);
    expect(ranked[0].tiedCount).toBe(2);
    expect(ranked[1].tiedCount).toBe(2);
    expect(ranked[2].tiedCount).toBe(1);
  });

  it("отрыв считается до следующего ПО ЗНАЧЕНИЮ, а не до соседа по списку", () => {
    const ranked = rankScales(ORDER, CHIL, ORDER);
    expect(ranked[0].margin).toBe(18); // 34 -> 16, а не 34 -> 34
    expect(ranked[1].margin).toBe(18);
    expect(ranked[2].margin).toBe(2); // 16 -> 14
  });

  it("у последнего места отрыв нулевой", () => {
    const ranked = rankScales(ORDER, CHIL, ORDER);
    expect(ranked[ranked.length - 1].margin).toBe(0);
  });
});

describe("доступ по месту (FR-18, FR-19, FR-23)", () => {
  it("первое место сверху — ведущая шкала", () => {
    expect(scaleAtRank(ORDER, CHIL, ORDER, 1, false)?.key).toBe("cel");
  });

  it("первое место снизу — слабая шкала", () => {
    expect(scaleAtRank(ORDER, CHIL, ORDER, 1, true)?.key).toBe("kom");
  });

  it("второе место сверху и снизу", () => {
    expect(scaleAtRank(ORDER, CHIL, ORDER, 2, false)?.key).toBe("pro");
    expect(scaleAtRank(ORDER, CHIL, ORDER, 2, true)?.key).toBe("vdo");
  });

  it("счёт мест идёт с единицы", () => {
    expect(scaleAtRank(ORDER, CHIL, ORDER, 0, false)).toBeNull();
  });

  it("место больше числа шкал в рейтинге даёт null", () => {
    expect(scaleAtRank(ORDER, CHIL, ORDER, 5, false)).toBeNull();
  });

  it("пустой рейтинг даёт null", () => {
    const none = { a: scale(0, { hasValue: false }) };
    expect(scaleAtRank(["a"], none, ["a"], 1, false)).toBeNull();
  });

  it("свойства места полны: ключ, подпись уровня, значение, отрыв, ничья", () => {
    expect(scaleAtRank(ORDER, CHIL, ORDER, 1, false)).toEqual({
      key: "cel",
      label: "Высокий",
      value: 34,
      margin: 18,
      tiedCount: 2,
    });
  });

  it("подпись уровня пуста, когда полосы интерпретации не заданы", () => {
    expect(scaleAtRank(ORDER, CHIL, ORDER, 1, true)?.label).toBe("");
  });
});
