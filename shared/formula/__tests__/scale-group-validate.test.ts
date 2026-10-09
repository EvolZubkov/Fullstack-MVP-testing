import { describe, expect, it } from "vitest";
import { validate } from "../validate";
import { collectStringLiterals } from "../outcome-literals";

const REFS = { scaleKeys: new Set(["cel", "vdo", "kom", "pro"]) };
const MIXED = { cel: "none", pro: "percent", vdo: "none", kom: "none" };

describe("валидация topGroup", () => {
  it("code — строка, count и max — числа", () => {
    expect(validate('topGroup(["cel","pro"], 5).code', "string", REFS).returnType).toBe("string");
    expect(validate('topGroup(["cel","pro"], 5).count', "number", REFS).returnType).toBe("number");
    expect(validate('topGroup(["cel","pro"], 5).max', "number", REFS).returnType).toBe("number");
  });

  it("требует хотя бы две шкалы в группе", () => {
    const result = validate('topGroup(["cel"], 5).code', "string", REFS);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("scale-group-small");
  });

  it("ловит неизвестную шкалу", () => {
    const result = validate('topGroup(["cel","нет"], 5).code', "string", REFS);
    expect(result.errors.map((e) => e.code)).toContain("unknown-scale");
  });

  it("ловит неверный порог", () => {
    const result = validate('topGroup(["cel","pro"], "десять").code', "string", REFS);
    expect(result.errors.map((e) => e.code)).toContain("scale-group-threshold");
  });

  it("подсказывает, что коды исходов — наборы ключей", () => {
    const result = validate('topGroup(["cel","pro"], 5).code', "string", REFS);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("scale-group-code");
  });

  it("предупреждает о разной нормализации шкал группы при абсолютном пороге", () => {
    const result = validate('topGroup(["cel","pro"], 5).code', "string", {
      ...REFS,
      scaleNormalizations: MIXED,
    });
    expect(result.warnings.map((w) => w.code)).toContain("scale-group-normalization");
  });

  it("не предупреждает о нормализации при долевом пороге", () => {
    const result = validate('topGroup(["cel","pro"], "10%").code', "string", {
      ...REFS,
      scaleNormalizations: MIXED,
    });
    expect(result.warnings.map((w) => w.code)).not.toContain("scale-group-normalization");
  });

  it("ключи группы и порог-строка не считаются кодами исходов", () => {
    expect(collectStringLiterals('topGroup(["cel","pro"], "10%").code')).toEqual([]);
  });
});
