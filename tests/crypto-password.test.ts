/**
 * @module tests/crypto-password.test
 * @description The single password-hashing seam (server/utils/crypto). Exercises
 * the real bcrypt-backed wrappers end-to-end — hashPassword produces a verifiable
 * bcrypt hash and verifyPassword accepts only the correct password.
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, dummyVerifyPassword } from "../server/utils/crypto";

describe("password hashing seam", () => {
  it("hashPassword produces a verifiable bcrypt hash", async () => {
    const hash = await hashPassword("s3cret");
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt format
    expect(hash).not.toBe("s3cret");
    expect(await verifyPassword("s3cret", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("dummyVerifyPassword always resolves (timing-equalizing miss)", async () => {
    await expect(dummyVerifyPassword("anything")).resolves.toBeUndefined();
  });
});
