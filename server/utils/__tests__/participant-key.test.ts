/**
 * @module server/utils/__tests__/participant-key
 * @description PRD-54 раздел 4: псевдоним участника импортированного прохождения.
 */
import { describe, it, expect } from "vitest";
import { participantKey } from "../crypto";

describe("participantKey", () => {
  it("устойчив: одни и те же части дают один ключ", () => {
    expect(participantKey("Иванов Иван", "К-1", "ПАО")).toBe(participantKey("Иванов Иван", "К-1", "ПАО"));
  });

  it("не зависит от регистра и краевых пробелов", () => {
    expect(participantKey("  Иванов Иван ", "к-1", "ПАО")).toBe(participantKey("иванов иван", "К-1", "пао"));
  });

  it("разные участники дают разные ключи", () => {
    expect(participantKey("Иванов Иван", "", "ПАО")).not.toBe(participantKey("Петров Пётр", "", "ПАО"));
  });

  it("части не склеиваются двусмысленно", () => {
    // Без разделителя «Иванов»+«Ивк1» и «ИвановИв»+«к1» дали бы одну строку и один ключ.
    expect(participantKey("Иванов", "Ивк1", "")).not.toBe(participantKey("ИвановИв", "к1", ""));
  });

  it("не содержит исходных данных", () => {
    expect(participantKey("Иванов Иван", "К-1", "ПАО")).toMatch(/^[0-9a-f]{64}$/);
  });
});
