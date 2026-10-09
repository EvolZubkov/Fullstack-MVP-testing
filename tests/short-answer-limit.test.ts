import { describe, it, expect } from "vitest";
import { effectiveMaxLength, withEffectiveMaxLength } from "../shared/questions/short-answer";

describe("effectiveMaxLength", () => {
  it("берёт авторский предел, когда он задан", () => {
    expect(effectiveMaxLength("short", { maxLength: 40 }, 250)).toBe(40);
  });

  it("без авторского предела действует системный потолок", () => {
    expect(effectiveMaxLength("short", {}, 250)).toBe(250);
    expect(effectiveMaxLength("short", null, 250)).toBe(250);
  });

  it("предел выше потолка урезается: ответ, который LMS не увезёт, хуже короткого поля", () => {
    expect(effectiveMaxLength("short", { maxLength: 4000 }, 250)).toBe(250);
  });

  it("мусор в поле читается как «не задано»", () => {
    expect(effectiveMaxLength("short", { maxLength: 0 }, 250)).toBe(250);
    expect(effectiveMaxLength("short", { maxLength: -5 }, 250)).toBe(250);
    expect(effectiveMaxLength("short", { maxLength: 12.5 }, 250)).toBe(250);
  });

  it("у прочих типов предела нет", () => {
    expect(effectiveMaxLength("single", { maxLength: 40 }, 250)).toBeNull();
  });
});

describe("withEffectiveMaxLength", () => {
  it("вписывает предел, не теряя прочего содержимого", () => {
    expect(withEffectiveMaxLength("short", { foo: 1 }, 250)).toEqual({ foo: 1, maxLength: 250 });
  });

  it("чужой тип отдаёт как есть, тем же объектом", () => {
    const data = { options: ["а", "б"] };
    expect(withEffectiveMaxLength("single", data, 250)).toBe(data);
  });
});
