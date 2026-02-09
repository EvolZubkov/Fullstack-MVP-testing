import { createHash } from "crypto";

// Секретный ключ для шифрования (из переменных окружения)
const ENCRYPTION_PASSWORD = process.env.ENCRYPTION_PASSWORD || "default-encryption-key-change-me";
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || "default-salt-change-me";

// Фиксированный IV (генерируем из пароля и соли для воспроизводимости)
const IV_SEED = createHash("sha256")
  .update(ENCRYPTION_PASSWORD + ENCRYPTION_SALT)
  .digest()
  .slice(0, 16); // 16 байт для AES

// Lazy initialization for ESM module compatibility
let cryptoInstance: any = null;

async function getCryptoInstance() {
  if (!cryptoInstance) {
    const { default: Crypto } = await import("@vvlad1973/crypto");
    cryptoInstance = new Crypto({
      password: ENCRYPTION_PASSWORD,
      salt: ENCRYPTION_SALT,
      algorithm: "SHA512",
      iterations: 10000,
      keyLength: 32,
      iv: IV_SEED,
    });
  }
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
    console.error("Failed to decrypt email:", error);
    return "";
  }
}

/**
 * Создаёт хеш email для поиска в базе
 * Используем SHA-256 — быстрый и достаточный для поиска
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