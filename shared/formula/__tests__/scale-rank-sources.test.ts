/**
 * @module shared/formula/__tests__/scale-rank-sources
 *
 * The `topScale(...)` / `bottomScale(...)` formula sources (PRD-44 FR-18 - FR-24): parsing,
 * evaluation and validation of «which scale of this group leads, and which trails».
 *
 * The form deliberately copies the existing `countScales(["k1","k2"], "level")` source and
 * adds property access, so an author who knows one knows the other. The set of scales is a
 * literal list in the formula rather than a stored «scale group» entity: a test may carry
 * service scales (a lie detector, say) that have no business in a style ranking, and an
 * explicit list makes that decision visible in the formula text (FR-25).
 */
import { describe, expect, it } from "vitest";
import { parse } from "../parser";
import { evaluate } from "../evaluator";
import { validate } from "../validate";
import { FormulaSyntaxError } from "../types";
import type { EvalContext, ScaleResult } from "../types";

const scale = (normalized: number, over: Partial<ScaleResult> = {}): ScaleResult => ({
  raw: normalized,
  normalized,
  percent: normalized,
  level: "",
  label: "",
  hasValue: true,
  ...over,
});

/** The reference filling: two styles tie at 34, «Целеустремленный» is authored first. */
const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  percent: 0,
  score: 0,
  topics: {},
  tags: {},
  sections: {},
  vars: {},
  scales: {
    cel: scale(34, { level: "high", label: "Высокий" }),
    vdo: scale(16),
    kom: scale(14),
    pro: scale(34),
  },
  scaleOrder: ["cel", "vdo", "kom", "pro"],
  ...over,
});

const evalSrc = (src: string, context: EvalContext = ctx()) => evaluate(parse(src), context);

describe("разбор источников ранга (FR-18)", () => {
  it("разбирает topScale со списком ключей, местом и свойством", () => {
    expect(parse('topScale(["cel","pro"], 1).key')).toEqual({
      type: "scaleRank",
      fn: "topScale",
      keys: ["cel", "pro"],
      place: 1,
      prop: "key",
    });
  });

  it("разбирает bottomScale", () => {
    expect(parse('bottomScale(["cel"], 2).value')).toMatchObject({ fn: "bottomScale", place: 2 });
  });

  it("отвергает несуществующее свойство", () => {
    expect(() => parse('topScale(["cel"], 1).колонка')).toThrow(FormulaSyntaxError);
  });

  it("требует место числом, а не строкой", () => {
    expect(() => parse('topScale(["cel"], "1").key')).toThrow(FormulaSyntaxError);
  });

  it("требует доступ к свойству — источник сам по себе не значение", () => {
    expect(() => parse('topScale(["cel"], 1)')).toThrow(FormulaSyntaxError);
  });
});

describe("вычисление (FR-19, FR-20, FR-21)", () => {
  it("ведущая шкала — первое место сверху", () => {
    expect(evalSrc('topScale(["cel","vdo","kom","pro"], 1).key')).toBe("cel");
  });

  it("слабая шкала — первое место снизу", () => {
    expect(evalSrc('bottomScale(["cel","vdo","kom","pro"], 1).key')).toBe("kom");
  });

  it("свойства: подпись уровня, значение, отрыв, число делящих место", () => {
    expect(evalSrc('topScale(["cel","vdo","kom","pro"], 1).label')).toBe("Высокий");
    expect(evalSrc('topScale(["cel","vdo","kom","pro"], 1).value')).toBe(34);
    expect(evalSrc('topScale(["cel","vdo","kom","pro"], 1).margin')).toBe(18);
    expect(evalSrc('topScale(["cel","vdo","kom","pro"], 1).tiedCount')).toBe(2);
  });

  it("ничья решается авторским порядком, а не порядком в формуле", () => {
    expect(evalSrc('topScale(["pro","kom","vdo","cel"], 1).key')).toBe("cel");
  });

  it("без авторского порядка в контексте берётся порядок ключей namespace", () => {
    // `computeScales` заполняет результат, перебирая шкалы в порядке `sort_order`,
    // поэтому порядок ключей объекта совпадает с авторским.
    const withoutOrder = ctx({ scaleOrder: undefined });
    expect(evaluate(parse('topScale(["pro","cel"], 1).key'), withoutOrder)).toBe("cel");
  });

  it("служебная шкала вне списка в рейтинг не попадает (FR-25)", () => {
    const withService = ctx();
    withService.scales.lie = scale(99);
    withService.scaleOrder = ["cel", "vdo", "kom", "pro", "lie"];
    expect(evaluate(parse('topScale(["cel","vdo","kom","pro"], 1).key'), withService)).toBe("cel");
  });

  it("место больше числа шкал даёт null (FR-23)", () => {
    expect(evalSrc('topScale(["cel","vdo"], 5).key')).toBeNull();
  });

  it("пустой рейтинг даёт null", () => {
    const noValues = ctx({ scales: { cel: scale(0, { hasValue: false }) } });
    expect(evaluate(parse('topScale(["cel"], 1).key'), noValues)).toBeNull();
  });

  it("сравнение с null ведёт себя как у прочих неопределённых значений", () => {
    expect(evalSrc('IF(topScale(["cel","vdo"], 9).key = "cel", "да", "нет")')).toBe("нет");
  });
});

describe("валидация (FR-24)", () => {
  const refs = { scaleKeys: new Set(["cel", "vdo", "kom", "pro"]) };

  it("неизвестный ключ шкалы — ошибка", () => {
    const out = validate('topScale(["cel","нетакой"], 1).key', "string", refs);
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.code === "unknown-scale")).toBe(true);
  });

  it("известные ключи проходят", () => {
    expect(validate('topScale(["cel","pro"], 1).key', "string", refs).valid).toBe(true);
  });

  it("свойство key даёт ПРЕДУПРЕЖДЕНИЕ про коды исходов, а не ошибку", () => {
    // Код приходит из данных, а не литералом, поэтому проверка «строковый показатель
    // возвращает только объявленные коды» здесь неприменима.
    const out = validate('topScale(["cel"], 1).key', "string", refs);
    expect(out.valid).toBe(true);
    expect(out.warnings.some((w) => w.code === "scale-rank-key")).toBe(true);
  });

  it("тип возврата выведен по свойству", () => {
    expect(validate('topScale(["cel"], 1).value', "number", refs).returnType).toBe("number");
    expect(validate('topScale(["cel"], 1).key', "string", refs).returnType).toBe("string");
    expect(validate('topScale(["cel"], 1).tiedCount', "number", refs).returnType).toBe("number");
  });

  it("несовпадение типа показателя и формулы — ошибка", () => {
    const out = validate('topScale(["cel"], 1).value', "string", refs);
    expect(out.errors.some((e) => e.code === "type-mismatch")).toBe(true);
  });

  it("место меньше единицы — ошибка редактирования, а не молчаливый null", () => {
    const out = validate('topScale(["cel"], 0).key', "string", refs);
    expect(out.errors.some((e) => e.code === "scale-rank-place")).toBe(true);
  });

  it("пустой список ключей — ошибка", () => {
    const out = validate("topScale([], 1).key", "string", refs);
    expect(out.errors.some((e) => e.code === "scale-rank-empty")).toBe(true);
  });
});
