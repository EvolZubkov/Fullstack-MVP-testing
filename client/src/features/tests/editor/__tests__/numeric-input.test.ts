/**
 * @module features/tests/editor/__tests__/numeric-input.test
 * @description Unit tests for the author numeric-field helpers: comma/dot decimal
 * parsing, comma-first formatting, negative preservation and live sanitisation.
 */
import { describe, expect, it } from "vitest";
import { formatAuthorNumber, parseAuthorNumber, sanitizeAuthorNumberInput } from "../numeric-input";

describe("parseAuthorNumber", () => {
  it("parses a comma decimal separator (ru locale)", () => {
    expect(parseAuthorNumber("0,5")).toBe(0.5);
    expect(parseAuthorNumber("1,25")).toBe(1.25);
  });

  it("accepts a dot as an alias", () => {
    expect(parseAuthorNumber("0.5")).toBe(0.5);
    expect(parseAuthorNumber("3")).toBe(3);
  });

  it("preserves negatives, including negative fractions", () => {
    expect(parseAuthorNumber("-1")).toBe(-1);
    expect(parseAuthorNumber("-0,5")).toBe(-0.5);
    expect(parseAuthorNumber("-10")).toBe(-10);
  });

  it("returns null for empty or incomplete input instead of coercing to 0", () => {
    expect(parseAuthorNumber("")).toBeNull();
    expect(parseAuthorNumber("   ")).toBeNull();
    expect(parseAuthorNumber("-")).toBeNull();
    expect(parseAuthorNumber(",")).toBeNull();
    expect(parseAuthorNumber("-,")).toBeNull();
  });

  it("rejects malformed numbers rather than corrupting the value", () => {
    expect(parseAuthorNumber("0,5,5")).toBeNull();
    expect(parseAuthorNumber("abc")).toBeNull();
    expect(parseAuthorNumber("1,2,3")).toBeNull();
  });

  it("treats a trailing separator as its integer part (typable intermediate)", () => {
    expect(parseAuthorNumber("1,")).toBe(1);
    expect(parseAuthorNumber("1.")).toBe(1);
  });
});

describe("formatAuthorNumber", () => {
  it("renders with a comma decimal separator", () => {
    expect(formatAuthorNumber(0.5)).toBe("0,5");
    expect(formatAuthorNumber(-0.5)).toBe("-0,5");
    expect(formatAuthorNumber(3)).toBe("3");
    expect(formatAuthorNumber(-10)).toBe("-10");
  });
});

describe("sanitizeAuthorNumberInput", () => {
  it("converts dots to commas so only the comma variant is shown", () => {
    expect(sanitizeAuthorNumberInput("0.5")).toBe("0,5");
  });

  it("drops characters that are not digit, comma or minus", () => {
    expect(sanitizeAuthorNumberInput("1a2b")).toBe("12");
    expect(sanitizeAuthorNumberInput("0,5кг")).toBe("0,5");
  });

  it("keeps only a single leading minus", () => {
    expect(sanitizeAuthorNumberInput("-5")).toBe("-5");
    expect(sanitizeAuthorNumberInput("5-")).toBe("5");
    expect(sanitizeAuthorNumberInput("-1-2")).toBe("-12");
  });
});
