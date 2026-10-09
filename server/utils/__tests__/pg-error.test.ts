/**
 * @module server/utils/__tests__/pg-error
 * @description Код ошибки PostgreSQL находится и на самой ошибке, и в обёртке Drizzle (`cause`).
 */
import { describe, expect, it } from "vitest";

import { isUniqueViolation, pgErrorCode } from "../pg-error";

describe("pgErrorCode", () => {
  it("код на самой ошибке драйвера", () => {
    expect(pgErrorCode(Object.assign(new Error("dup"), { code: "23505" }))).toBe("23505");
  });

  it("код в причине ошибки Drizzle — и глубже", () => {
    const driver = Object.assign(new Error("dup"), { code: "23503" });
    expect(pgErrorCode(Object.assign(new Error("Failed query"), { cause: driver }))).toBe("23503");
    expect(pgErrorCode({ cause: { cause: { code: "23505" } } })).toBe("23505");
  });

  it("не ошибка базы — undefined; системные коды узла не принимаются за SQLSTATE", () => {
    expect(pgErrorCode(new Error("boom"))).toBeUndefined();
    expect(pgErrorCode(Object.assign(new Error("net"), { code: "ECONNREFUSED" }))).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });

  it("петля в цепочке причин не зацикливает", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(pgErrorCode(loop)).toBeUndefined();
  });
});

describe("isUniqueViolation", () => {
  it("23505 на любом уровне — да, иное — нет", () => {
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });
});
