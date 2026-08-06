/**
 * @module shared/text/typography.test
 * @description Behaviour table for the Russian typography pass applied to author
 * text (question prompts, answer options, page text fields) before it reaches a
 * learner screen.
 */
import { describe, it, expect } from "vitest";
import { applyTypography } from "./typography";

/** Non-breaking space, spelled out so expectations stay readable in a diff. */
const NB = String.fromCharCode(160);

describe("applyTypography — quotes", () => {
  it("turns a straight quote pair into Russian guillemets", () => {
    expect(applyTypography('Слово "важное" здесь')).toBe("Слово «важное» здесь");
  });

  it("pairs quotes across the whole text, not per word", () => {
    expect(applyTypography('"два слова" и "ещё два"')).toBe(`«два слова» и${NB}«ещё${NB}два»`);
  });

  it("leaves an unpaired quote as an opening guillemet rather than breaking the text", () => {
    expect(applyTypography('Он сказал "и ушёл')).toBe(`Он${NB}сказал «и${NB}ушёл`);
  });
});

describe("applyTypography — dashes", () => {
  it("turns a spaced hyphen into an em dash", () => {
    expect(applyTypography("Москва - столица")).toBe("Москва — столица");
  });

  it("turns a leading hyphen into an em dash, as a list item would need", () => {
    expect(applyTypography("- первый пункт")).toBe("— первый пункт");
  });

  it("turns a hyphen after sentence punctuation into an em dash", () => {
    expect(applyTypography("Ответ, - сказал он")).toBe("Ответ, — сказал он");
  });

  it("keeps a hyphen inside a compound word", () => {
    expect(applyTypography("из-за чего-то")).toBe("из-за чего-то");
  });

  it("keeps a hyphen between digits and before a negative number", () => {
    expect(applyTypography("диапазон 5-10 и -3 градуса")).toBe(
      `диапазон 5-10 и${NB}-3 градуса`,
    );
  });

  it("normalises spacing around an em dash the author typed himself", () => {
    expect(applyTypography("Москва  —   столица")).toBe("Москва — столица");
  });
});

describe("applyTypography — hanging words", () => {
  it("binds a preposition from the dictionary to the word after it", () => {
    expect(applyTypography("в Москве")).toBe(`в${NB}Москве`);
  });

  it("binds a long word from the dictionary, which no length rule would catch", () => {
    expect(applyTypography("каждый день")).toBe(`каждый${NB}день`);
  });

  it("binds any word of one or two letters, dictionary or not", () => {
    expect(applyTypography("яд опасен")).toBe(`яд${NB}опасен`);
  });

  it("leaves a three-letter word outside the dictionary alone", () => {
    expect(applyTypography("дом Иванова")).toBe("дом Иванова");
  });

  it("leaves a latin short word alone, the rules are Russian", () => {
    expect(applyTypography("the cat")).toBe("the cat");
  });

  it("binds every occurrence in a sentence", () => {
    expect(applyTypography("Он был в доме и на улице")).toBe(
      `Он${NB}был в${NB}доме и${NB}на${NB}улице`,
    );
  });

  it("binds a hyphenated dictionary word as one word", () => {
    expect(applyTypography("кто-то дома")).toBe(`кто-то${NB}дома`);
  });

  it("leaves a trailing dictionary word alone when nothing follows it", () => {
    expect(applyTypography("идём в")).toBe("идём в");
  });
});

describe("applyTypography — empty input", () => {
  it("returns an empty string untouched, an unfilled field is not an error", () => {
    expect(applyTypography("")).toBe("");
  });
});

describe("applyTypography — idempotence", () => {
  it("is a no-op on its own output, so re-rendering stored text cannot drift it", () => {
    const source = 'Он сказал: "жди - я в пути", и ушёл';
    const once = applyTypography(source);
    expect(applyTypography(once)).toBe(once);
  });
});
