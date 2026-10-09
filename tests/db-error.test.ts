/**
 * @module tests/db-error.test
 * @description Unit tests for the deploy-script error helpers: the cause chain,
 * an AggregateError of a refused connection, and SQLSTATE lookup.
 */

import { describe, it, expect } from "vitest";
import { describeError, errorCode } from "../scripts/db/db-error";

describe("describeError", () => {
  it("joins the outer message with the driver's cause", () => {
    const driver = Object.assign(new Error('password authentication failed for user "app"'), { code: "28P01" });
    const wrapped = new Error("Failed query: SELECT 1", { cause: driver });
    expect(describeError(wrapped)).toBe('Failed query: SELECT 1 | password authentication failed for user "app"');
  });

  it("unpacks an AggregateError with an empty message (refused connection)", () => {
    const refused = new AggregateError(
      [new Error("connect ECONNREFUSED ::1:5432"), new Error("connect ECONNREFUSED 127.0.0.1:5432")],
      "",
    );
    const wrapped = new Error("Failed query: SELECT 1\nparams: ", { cause: refused });
    expect(describeError(wrapped)).toBe(
      "Failed query: SELECT 1\nparams: | connect ECONNREFUSED ::1:5432 | connect ECONNREFUSED 127.0.0.1:5432",
    );
  });

  it("falls back to String() when nothing carries a message", () => {
    expect(describeError("boom")).toBe("boom");
  });
});

describe("errorCode", () => {
  it("finds the SQLSTATE in a nested cause", () => {
    const driver = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    expect(errorCode(new Error("Failed query", { cause: driver }))).toBe("42P01");
  });

  it("returns undefined when no level has a code", () => {
    expect(errorCode(new Error("plain"))).toBeUndefined();
  });
});
