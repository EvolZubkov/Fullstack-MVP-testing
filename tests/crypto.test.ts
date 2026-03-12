import { describe, it, expect, beforeAll } from "vitest";

// Set env vars before importing crypto module
beforeAll(() => {
  process.env.ENCRYPTION_PASSWORD = "test-password-abc123";
  process.env.ENCRYPTION_SALT = "test-salt-xyz789";
  process.env.NODE_ENV = "test";
});

// Dynamic import so env vars are set first
const getCrypto = () => import("../server/utils/crypto");

describe("encryptEmail / decryptEmail", () => {
  it("encrypts and decrypts back to original email", async () => {
    const { encryptEmail, decryptEmail } = await getCrypto();
    const email = "kate@example.com";
    const encrypted = encryptEmail(email);
    expect(encrypted).not.toBe(email);
    expect(decryptEmail(encrypted)).toBe(email);
  });

  it("normalizes to lowercase before encrypting", async () => {
    const { encryptEmail, decryptEmail } = await getCrypto();
    const encrypted = encryptEmail("Kate@Example.COM");
    expect(decryptEmail(encrypted)).toBe("kate@example.com");
  });

  it("trims whitespace before encrypting", async () => {
    const { encryptEmail, decryptEmail } = await getCrypto();
    const encrypted = encryptEmail("  kate@example.com  ");
    expect(decryptEmail(encrypted)).toBe("kate@example.com");
  });

  it("produces same ciphertext for same email (deterministic)", async () => {
    const { encryptEmail } = await getCrypto();
    const e1 = encryptEmail("same@email.com");
    const e2 = encryptEmail("same@email.com");
    expect(e1).toBe(e2);
  });

  it("produces different ciphertext for different emails", async () => {
    const { encryptEmail } = await getCrypto();
    const e1 = encryptEmail("alice@email.com");
    const e2 = encryptEmail("bob@email.com");
    expect(e1).not.toBe(e2);
  });

  it("decryptEmail returns empty string for invalid input", async () => {
    const { decryptEmail } = await getCrypto();
    expect(decryptEmail("not-valid-ciphertext")).toBe("");
  });
});

describe("hashEmail", () => {
  it("returns a sha256 hex string", async () => {
    const { hashEmail } = await getCrypto();
    const hash = hashEmail("kate@example.com");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes to lowercase before hashing", async () => {
    const { hashEmail } = await getCrypto();
    expect(hashEmail("Kate@Example.COM")).toBe(hashEmail("kate@example.com"));
  });

  it("trims before hashing", async () => {
    const { hashEmail } = await getCrypto();
    expect(hashEmail("  kate@example.com  ")).toBe(hashEmail("kate@example.com"));
  });

  it("different emails produce different hashes", async () => {
    const { hashEmail } = await getCrypto();
    expect(hashEmail("alice@test.com")).not.toBe(hashEmail("bob@test.com"));
  });
});

describe("verifyEmailHash", () => {
  it("returns true for matching email and hash", async () => {
    const { hashEmail, verifyEmailHash } = await getCrypto();
    const email = "kate@example.com";
    const hash = hashEmail(email);
    expect(verifyEmailHash(email, hash)).toBe(true);
  });

  it("returns true with different case email", async () => {
    const { hashEmail, verifyEmailHash } = await getCrypto();
    const hash = hashEmail("kate@example.com");
    expect(verifyEmailHash("KATE@EXAMPLE.COM", hash)).toBe(true);
  });

  it("returns false for wrong email", async () => {
    const { hashEmail, verifyEmailHash } = await getCrypto();
    const hash = hashEmail("kate@example.com");
    expect(verifyEmailHash("other@example.com", hash)).toBe(false);
  });

  it("returns false for tampered hash", async () => {
    const { verifyEmailHash } = await getCrypto();
    expect(verifyEmailHash("kate@example.com", "0".repeat(64))).toBe(false);
  });
});
