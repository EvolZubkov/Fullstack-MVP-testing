import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { logger } from "../logger";
import { config } from "../config";

// Lazily-built cipher. Encryption keys are secrets read from the config
// (config.encryption, populated by initConfig) on first encrypt/decrypt — not at
// import time (the DI model). `hashEmail` below needs no keys.
let cryptoInstance: any = null;

async function getCryptoInstance() {
  if (cryptoInstance) return cryptoInstance;

  const encPassword = config.encryption.password;
  const encSalt = config.encryption.salt;

  if (!encPassword || !encSalt) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CRITICAL: ENCRYPTION_PASSWORD and ENCRYPTION_SALT environment variables must be set.\n" +
        "Generate secure values using: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    logger.warn(
      "\n⚠️  WARNING: ENCRYPTION_PASSWORD and ENCRYPTION_SALT are not set!\n" +
      "   Using default values for development only.\n" +
      "   Generate secure values for production:\n" +
      "   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n"
    );
  }

  // dev fallbacks (`||`: an unset reference resolves to "").
  const password = encPassword || "dev-default-key";
  const salt = encSalt || "dev-default-salt";
  // Fixed IV derived from password+salt for reproducibility (16 bytes for AES).
  const ivSeed = createHash("sha256").update(password + salt).digest().slice(0, 16);

  const { default: Crypto } = await import("@vvlad1973/crypto");
  cryptoInstance = new Crypto({
    password,
    salt,
    algorithm: "SHA512",
    iterations: 10000,
    keyLength: 32,
    iv: ivSeed,
  });
  return cryptoInstance;
}

/**
 * Encrypts email for database storage.
 * @param email - The email to encrypt
 * @returns Encrypted email string
 */
export async function encryptEmail(email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();
  const crypto = await getCryptoInstance();
  return crypto.encrypt(normalizedEmail);
}

/**
 * Decrypts email from database.
 * @param encryptedEmail - The encrypted email string
 * @returns Decrypted email or empty string on error
 */
export async function decryptEmail(encryptedEmail: string): Promise<string> {
  try {
    const crypto = await getCryptoInstance();
    return crypto.decrypt(encryptedEmail);
  } catch (error) {
    logger.error("Failed to decrypt email: " + (error as Error).message);
    return "";
  }
}

/**
 * Создаёт хеш email для поиска в базе
 */
export function hashEmail(email: string): string {
  const normalizedEmail = email.toLowerCase().trim();
  return createHash("sha256").update(normalizedEmail).digest("hex");
}

/**
 * Проверяет соответствие email хешу
 */
export function verifyEmailHash(email: string, hash: string): boolean {
  return hashEmail(email) === hash;
}

/** Cost factor for password hashing — the single point of configuration. */
const PASSWORD_HASH_ROUNDS = 10;

/**
 * The single seam for password hashing: callers never touch the primitive
 * directly, so the planned migration to `@vvlad1973/crypto` scrypt (PRD-9) is a
 * change to this file alone. Hash a plaintext password for storage.
 * @param plain - The plaintext password
 * @returns The password hash for storage in `users.passwordHash`
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_HASH_ROUNDS);
}

/**
 * Verify a plaintext password against a stored hash.
 * @param plain - The plaintext password to check
 * @param stored - The stored password hash
 * @returns True when the password matches
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return bcrypt.compare(plain, stored);
}
