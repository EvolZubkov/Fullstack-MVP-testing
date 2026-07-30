/**
 * @module tests/magic-scope-rules
 * @description Unit tests for the magic-link scope rule table and its path matcher:
 * exact matches, parameter capture, method sensitivity, and the deny-by-default
 * behaviour for anything absent from the table.
 */
import { describe, it, expect } from "vitest";
import { matchMagicScopeRule } from "../server/middleware/magic-scope-rules";

describe("matchMagicScopeRule", () => {
  it("matches a static allowed path", () => {
    const m = matchMagicScopeRule("GET", "/api/auth/me");
    expect(m?.rule.bind).toBe("none");
  });

  it("captures the test id and asks for a test binding", () => {
    const m = matchMagicScopeRule("GET", "/api/tests/t1/resume");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("t1");
  });

  it("captures the attempt id and asks for an attempt binding", () => {
    const m = matchMagicScopeRule("POST", "/api/attempts/a1/finish");
    expect(m?.rule.bind).toBe("attempt");
    expect(m?.params.attemptId).toBe("a1");
  });

  it("captures both segments of the screen-template path", () => {
    const m = matchMagicScopeRule("GET", "/api/tests/t1/screen-template/question");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("t1");
    expect(m?.params.screen).toBe("question");
  });

  it("is method sensitive", () => {
    expect(matchMagicScopeRule("DELETE", "/api/auth/me")).toBeNull();
  });

  it("denies anything absent from the table", () => {
    expect(matchMagicScopeRule("GET", "/api/learner/attempts")).toBeNull();
    expect(matchMagicScopeRule("GET", "/api/home")).toBeNull();
    expect(matchMagicScopeRule("POST", "/api/auth/change-password")).toBeNull();
    expect(matchMagicScopeRule("GET", "/api/tests")).toBeNull();
  });

  it("does not let a longer path slip through a shorter rule", () => {
    expect(matchMagicScopeRule("GET", "/api/tests/t1/resume/extra")).toBeNull();
  });

  it("returns null instead of throwing on malformed percent-encoding in a parameter segment", () => {
    expect(matchMagicScopeRule("GET", "/api/tests/%/resume")).toBeNull();
  });

  it("still matches the same rule when the path has a trailing slash", () => {
    const m = matchMagicScopeRule("GET", "/api/auth/me/");
    expect(m?.rule.bind).toBe("none");
  });

  it("denies a path with a doubled slash", () => {
    expect(matchMagicScopeRule("GET", "/api/tests//resume")).toBeNull();
  });

  it("matches a cased path (Express 5 routes case-insensitively) while keeping the captured parameter's original case", () => {
    const m = matchMagicScopeRule("GET", "/API/Tests/T1/Resume");
    expect(m?.rule.bind).toBe("test");
    expect(m?.params.testId).toBe("T1");
  });
});
