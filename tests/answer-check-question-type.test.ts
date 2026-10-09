import { describe, it, expect } from "vitest";
import { QUESTION_TYPES, isTextEntry, isMeasurementOnly, hasOptionList } from "../shared/questions/question-type";

describe("тип «Короткий ответ»", () => {
  it("объявлен в перечне типов", () => {
    expect(QUESTION_TYPES).toContain("short");
  });

  it("узнаётся признаком текстового ввода", () => {
    expect(isTextEntry("short")).toBe(true);
    expect(isTextEntry("single")).toBe(false);
  });

  it("не несёт списка вариантов", () => {
    expect(hasOptionList("short")).toBe(false);
  });

  it("без правил неоцениваем — как шкала без эталона", () => {
    expect(isMeasurementOnly({ type: "short", correctJson: {} })).toBe(true);
    expect(isMeasurementOnly({ type: "short", correctJson: { answerKind: "text", join: "any", rules: [] } })).toBe(true);
  });

  it("с правилами оценивается", () => {
    const correctJson = {
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "РТН" }],
    };
    expect(isMeasurementOnly({ type: "short", correctJson })).toBe(false);
  });
});
