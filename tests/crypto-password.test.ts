/**
 * @module tests/crypto-password.test
 * @description The single password-hashing seam (server/utils/crypto). Exercises
 * the real scrypt-backed wrappers end-to-end — hashPassword produces a verifiable
 * scrypt hash, verifyPassword accepts only the correct password, and legacy bcrypt
 * hashes still verify through the temporary compatibility path (PRD-9 Этап 2).
 */
// Use a cheap scrypt cost here so the real end-to-end hashing does not incur the
// OWASP profile's ~128 MiB-per-hash memory pressure under parallel test workers.
// The format/routing logic under test is parameter-independent, and hashPassword
// reads this env var lazily at call time, so it is in effect before any test runs.
process.env.PASSWORD_SCRYPT_TEST_N = "16";

import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import {
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
  isLegacyBcryptHash,
} from "../server/utils/crypto";

describe("password hashing seam", () => {
  it("hashPassword produces a verifiable scrypt hash", async () => {
    const hash = await hashPassword("s3cret");
    expect(hash).toMatch(/^scrypt\$1\$/); // scrypt self-describing format
    expect(hash).not.toBe("s3cret");
    expect(await verifyPassword("s3cret", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("isLegacyBcryptHash distinguishes bcrypt from scrypt", async () => {
    const scryptHash = await hashPassword("s3cret");
    expect(isLegacyBcryptHash(scryptHash)).toBe(false);
    expect(isLegacyBcryptHash("$2a$10$abcdefghijklmnopqrstuv")).toBe(true);
    expect(isLegacyBcryptHash("$2b$10$abcdefghijklmnopqrstuv")).toBe(true);
    expect(isLegacyBcryptHash("$2y$10$abcdefghijklmnopqrstuv")).toBe(true);
  });

  it("verifyPassword still accepts a legacy bcrypt hash (migration path)", async () => {
    const legacy = await bcrypt.hash("old-pass", 10);
    expect(isLegacyBcryptHash(legacy)).toBe(true);
    expect(await verifyPassword("old-pass", legacy)).toBe(true);
    expect(await verifyPassword("nope", legacy)).toBe(false);
  });

  it("dummyVerifyPassword always resolves (timing-equalizing miss)", async () => {
    await expect(dummyVerifyPassword("anything")).resolves.toBeUndefined();
  });
});
