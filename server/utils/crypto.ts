import Crypto from "@vvlad1973/crypto";
import { createHash } from "crypto";

// Проверяем наличие обязательных переменных окружения
const ENCRYPTION_PASSWORD = process.env.ENCRYPTION_PASSWORD;
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;

if (!ENCRYPTION_PASSWORD || !ENCRYPTION_SALT) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CRITICAL: ENCRYPTION_PASSWORD and ENCRYPTION_SALT environment variables must be set.\n" +
      "Generate secure values using: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  console.warn(
    "\n⚠️  WARNING: ENCRYPTION_PASSWORD and ENCRYPTION_SALT are not set!\n" +
    "   Using default values for development only.\n" +
    "   Generate secure values for production:\n" +
    "   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n"
  );
}

// В dev режиме используем дефолты, в prod — упадёт раньше на throw
const PASSWORD = ENCRYPTION_PASSWORD ?? "dev-default-key";
const SALT = ENCRYPTION_SALT ?? "dev-default-salt";

// Фиксированный IV (генерируем из пароля и соли для воспроизводимости)
const IV_SEED = createHash("sha256")
  .update(PASSWORD + SALT)
  .digest()
  .slice(0, 16); // 16 байт для AES

// Создаём единственный экземпляр с фиксированным IV
const cryptoInstance = new Crypto({
  password: PASSWORD,
  salt: SALT,
  algorithm: "SHA512",
  iterations: 10000,
  keyLength: 32,
  iv: IV_SEED,
});

/**
 * Шифрует email для хранения в базе
 */
export function encryptEmail(email: string): string {
  const normalizedEmail = email.toLowerCase().trim();
  return cryptoInstance.encrypt(normalizedEmail);
}

/**
 * Дешифрует email из базы
 */
export function decryptEmail(encryptedEmail: string): string {
  try {
    return cryptoInstance.decrypt(encryptedEmail);
  } catch (error) {
    console.error("Failed to decrypt email:", error);
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