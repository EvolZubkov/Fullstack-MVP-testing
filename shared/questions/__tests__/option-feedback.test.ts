/**
 * @module shared/questions/__tests__/option-feedback
 *
 * Stored form and lookup of per-option feedback texts. The rules live in one module that
 * the server, the web host and the SCORM runtime share, so they are proven here once.
 */
import { describe, expect, it } from "vitest";
import {
  hasOptionFeedback,
  normalizeOptionFeedback,
  optionCountOf,
  optionFeedbackAt,
} from "../option-feedback";

describe("normalizeOptionFeedback", () => {
  it("keeps texts by position and blanks out options without one", () => {
    expect(normalizeOptionFeedback([null, "  Почему B  ", ""], "single", 3)).toEqual([null, "Почему B"]);
  });

  it("stores nothing for any type other than single choice", () => {
    expect(normalizeOptionFeedback(["текст"], "multiple", 1)).toBeNull();
    expect(normalizeOptionFeedback(["текст"], "scale", 1)).toBeNull();
  });

  it("stores nothing when no option carries a text", () => {
    expect(normalizeOptionFeedback(["", "   ", null], "single", 3)).toBeNull();
    expect(normalizeOptionFeedback(undefined, "single", 3)).toBeNull();
    expect(normalizeOptionFeedback("текст", "single", 3)).toBeNull();
  });

  it("drops texts past the last option: they belong to no option", () => {
    expect(normalizeOptionFeedback(["A", "B", "C"], "single", 2)).toEqual(["A", "B"]);
  });

  it("treats a non-string entry as no text", () => {
    expect(normalizeOptionFeedback([42, "B"], "single", 2)).toEqual([null, "B"]);
  });

  it("applies the caller's text canonicalisation to every entry", () => {
    expect(normalizeOptionFeedback(["a", "b"], "single", 2, (t) => t.toUpperCase())).toEqual(["A", "B"]);
  });
});

describe("optionFeedbackAt", () => {
  it("returns the text of the chosen option", () => {
    expect(optionFeedbackAt([null, "Почему B"], 1)).toBe("Почему B");
  });

  it("returns null for an option without a text, past the end, or for a bad index", () => {
    expect(optionFeedbackAt([null, "Почему B"], 0)).toBeNull();
    expect(optionFeedbackAt([null, "Почему B"], 5)).toBeNull();
    expect(optionFeedbackAt([null, "Почему B"], -1)).toBeNull();
    expect(optionFeedbackAt([null, "Почему B"], 1.5)).toBeNull();
    expect(optionFeedbackAt([null, "Почему B"], null)).toBeNull();
  });

  it("tolerates a column of any shape", () => {
    expect(optionFeedbackAt(null, 0)).toBeNull();
    expect(optionFeedbackAt({ 0: "x" }, 0)).toBeNull();
    expect(optionFeedbackAt(["   "], 0)).toBeNull();
  });
});

describe("hasOptionFeedback / optionCountOf", () => {
  it("detects at least one non-blank text", () => {
    expect(hasOptionFeedback([null, "x"])).toBe(true);
    expect(hasOptionFeedback([null, " "])).toBe(false);
    expect(hasOptionFeedback(null)).toBe(false);
  });

  it("counts options of a data_json", () => {
    expect(optionCountOf({ options: ["a", "b", "c"] })).toBe(3);
    expect(optionCountOf({ items: ["a"] })).toBe(0);
    expect(optionCountOf(null)).toBe(0);
  });
});
