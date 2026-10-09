import { describe, it, expect } from "vitest";
import { matchWildcard } from "../shared/answer-check/wildcard";

describe("matchWildcard", () => {
  it("сравнивает буквально, когда знаков нет", () => {
    expect(matchWildcard("ростехнадзор", "ростехнадзор")).toBe(true);
    expect(matchWildcard("ростехнадзор", "ростехнадзора")).toBe(false);
  });

  it("* заменяет любое продолжение, в том числе пустое", () => {
    expect(matchWildcard("федеральная служба по * надзору", "федеральная служба по атомному надзору")).toBe(true);
    expect(matchWildcard("рос*", "ростехнадзор")).toBe(true);
    expect(matchWildcard("рос*", "рос")).toBe(true);
    expect(matchWildcard("*надзор", "ростехнадзор")).toBe(true);
  });

  it("? заменяет ровно один символ", () => {
    expect(matchWildcard("гост ?", "гост р")).toBe(true);
    expect(matchWildcard("гост ?", "гост рв")).toBe(false);
    expect(matchWildcard("гост ?", "гост ")).toBe(false);
  });

  it("несколько звёзд подряд равны одной", () => {
    expect(matchWildcard("**надзор**", "ростехнадзор")).toBe(true);
  });

  it("образец из одних звёзд подходит всему, включая пустое", () => {
    expect(matchWildcard("*", "")).toBe(true);
    expect(matchWildcard("*", "что угодно")).toBe(true);
  });

  it("пустой образец подходит только пустому ответу", () => {
    expect(matchWildcard("", "")).toBe(true);
    expect(matchWildcard("", "ответ")).toBe(false);
  });

  it("не разворачивает откат на образце из чередующихся звёзд", () => {
    const started = Date.now();
    expect(matchWildcard("*а*а*а*а*а*а*а*а*б", "а".repeat(200))).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
