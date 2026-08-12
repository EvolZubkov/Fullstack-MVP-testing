import { describe, it, expect } from "vitest";
import { renameTopicByNameInFormula } from "./rename";
import { parse } from "./parser";

describe("renameTopicByNameInFormula", () => {
  it("rewrites topicByName argument on rename", () => {
    expect(
      renameTopicByNameInFormula('topicByName("О компании").percent >= 70', "О компании", "Компания"),
    ).toBe('topicByName("Компания").percent >= 70');
  });

  it("rewrites every occurrence in a conjunction", () => {
    const f = 'topicByName("Этика").passed AND topicByName("Этика").percent >= 60';
    expect(renameTopicByNameInFormula(f, "Этика", "Этика и комплаенс")).toBe(
      'topicByName("Этика и комплаенс").passed AND topicByName("Этика и комплаенс").percent >= 60',
    );
  });

  it("leaves topicById and other accessors untouched", () => {
    const f = 'topicById("Этика").percent >= 70 AND scaleById("fin").raw >= 5';
    expect(renameTopicByNameInFormula(f, "Этика", "X")).toBe(f);
  });

  it("does not touch a different topic name that is a substring", () => {
    const f = 'topicByName("Финансы").percent >= 70';
    // Renaming "инанс" must not corrupt "Финансы" (literal full-token match only).
    expect(renameTopicByNameInFormula(f, "инанс", "Z")).toBe(f);
  });

  it("is a no-op when the name is unchanged or absent", () => {
    const f = 'topicByName("Право").percent >= 70';
    expect(renameTopicByNameInFormula(f, "Право", "Право")).toBe(f);
    expect(renameTopicByNameInFormula(f, "Этика", "X")).toBe(f);
  });

  it("escapes names safely and stays parseable", () => {
    const f = renameTopicByNameInFormula('topicByName("A").percent >= 1', "A", 'Имя с "кавычкой"');
    expect(f).toBe('topicByName("Имя с \\"кавычкой\\"").percent >= 1');
    expect(() => parse(f)).not.toThrow();
  });
});
