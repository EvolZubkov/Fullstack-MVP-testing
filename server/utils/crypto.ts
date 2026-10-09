import { createHash, createHmac } from "crypto";
import { logger } from "../logger";
import { config } from "../config";

/**
 * Lazy loader for the ESM-only `@vvlad1973/crypto` package. The package is kept
 * external to the production CJS bundle (`scripts/build/build.ts` forceExternal), so it
 * must be reached through dynamic `import()` — a static import would compile to
 * `require()`, which cannot load an ES module. The promise is memoized so the
 * module is evaluated once.
 */
let cryptoModulePromise: Promise<typeof import("@vvlad1973/crypto")> | null = null;
function loadCryptoModule(): Promise<typeof import("@vvlad1973/crypto")> {
  return (cryptoModulePromise ??= import("@vvlad1973/crypto"));
}

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

  const { default: Crypto } = await loadCryptoModule();
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

/** Разделитель частей псевдонима. NUL в ФИО, табельном коде и названии организации не встречается. */
const PARTICIPANT_KEY_SEPARATOR = "\u0000";

/**
 * Псевдоним участника импортированного прохождения (PRD-54 раздел 4).
 *
 * HMAC под ключом инстанса, а не голый хеш: пространство ФИО мало, и по голому sha-256 участника
 * подбирают перебором за минуты. Метка назначения `prd54:participant` отделяет этот ключ от ключа
 * шифрования почт — один секрет, разные производные, чтобы утечка одного не вскрывала другое.
 *
 * Нормализация до HMAC обязательна: иначе « Иванов » и «иванов» разъедутся в разные ключи, и один
 * человек посчитается двумя.
 *
 * Части склеиваются ЧЕРЕЗ РАЗДЕЛИТЕЛЬ, а не встык. Встык «Иванов» + «Ивк1» и «ИвановИв» + «к1»
 * дают одну строку и один ключ — два разных человека слились бы в одного молча.
 *
 * СОСТАВ ПОЛЕЙ (решение владельца 2026-09-25): ФИО, организация, подразделение и должность.
 * Табельный код в него НЕ входит — в реальных выгрузках он пуст, а поле, которое то есть, то
 * нет, разводит одного человека на два ключа. Организация одна на всю выгрузку и тёзок не
 * различает; различают отдел и должность, поэтому они и взяты.
 *
 * ЦЕНА ЭТОГО ВЫБОРА, принятая осознанно: должность и отдел МЕНЯЮТСЯ, и после перевода человек
 * получит другой ключ. Разъезд не прячется: оба поля хранятся рядом с прохождением
 * (`scorm_attempts.lms_user_unit`, `lms_user_position`), и два ключа с одним именем и разными
 * отделами читаются как перевод либо как тёзки — разбирает это человек, а не система молча.
 *
 * @param name ФИО из колонки «Пользователь»
 * @param org значение колонки «Организация» (может быть пустым)
 * @param unit значение колонки «Подразделение» (может быть пустым)
 * @param position значение колонки «Должность» (может быть пустым)
 * @returns 64 шестнадцатеричных знака
 */
export function participantKey(name: string, org: string, unit: string, position: string): string {
  const norm = (v: string) => String(v ?? "").trim().toLowerCase();
  const secret = (config.encryption.password || "dev-default-key") + "|prd54:participant";
  const material = [norm(name), norm(org), norm(unit), norm(position)]
    .join(PARTICIPANT_KEY_SEPARATOR);
  return createHmac("sha256", secret).update(material).digest("hex");
}

/** Вид `external_id`, который даёт {@link participantKey}: 64 шестнадцатеричных знака в нижнем регистре. */
const OWN_EXTERNAL_ID = /^[0-9a-f]{64}$/;

/**
 * Похож ли `external_id` на построенный НАШИМ алгоритмом (PRD-66 FR-43).
 *
 * Скрипт обезличивания обязан выдавать ровно то же, что {@link participantKey} (PRD-54 BR-54-22),
 * поэтому значение другого вида — `ext-1`, табельный номер, UUID, тот же хеш в верхнем регистре —
 * ЗАВЕДОМО построено иначе. Обратное неверно: чужой HMAC-SHA256 с другим секретом тоже даст 64
 * знака, и такой случай этой проверкой не ловится — это её осознанное слепое пятно.
 *
 * @param key значение `participant_key` импортированного прохождения
 * @returns `true`, если вид совпадает с нашим
 */
export function hasOwnExternalIdFormat(key: string): boolean {
  return OWN_EXTERNAL_ID.test(key);
}

/**
 * True when a stored hash is a legacy bcrypt value (`$2a$`/`$2b$`/`$2y$`) rather
 * than the current scrypt format (`scrypt$…`). Callers use it to route verification
 * to the temporary bcrypt path and to trigger a lazy rehash on login (PRD-9 Этап 2).
 * The argument is nullable because `users.password_hash` itself became nullable
 * (PRD-28: an external participant has no password), so callers that read a raw
 * row — the `scripts/db/bcrypt-residual.ts` audit among them — hold a
 * `string | null` and could not call this at all with a `string`-only signature.
 * A missing hash simply classifies as "not bcrypt".
 * @param stored - The stored password hash to classify, or null when there is none
 * @returns True when the value is a legacy bcrypt hash
 */
export function isLegacyBcryptHash(stored: string | null): boolean {
  return stored != null && /^\$2[aby]\$/.test(stored);
}

/**
 * The single seam for password hashing: callers never touch the primitive
 * directly. Hash a plaintext password for storage using `@vvlad1973/crypto` scrypt
 * (PRD-9). New hashes are always scrypt; legacy bcrypt hashes are migrated on login
 * (see the users repository `validatePassword`).
 * @param plain - The plaintext password
 * @returns The scrypt password hash for storage in `users.passwordHash`
 */
export async function hashPassword(plain: string): Promise<string> {
  const { hashPassword: scryptHash } = await loadCryptoModule();
  return scryptHash(plain, scryptTestOverride());
}

/**
 * Production always uses the package's fixed OWASP scrypt profile (PRD-9 ADR). Tests
 * may set `PASSWORD_SCRYPT_TEST_N` to a small power of two to avoid the default
 * profile's ~128 MiB-per-hash cost under parallel workers. The variable is never set
 * in production, so prod hashing is unchanged; either way the parameters are recorded
 * in every stored hash, so verification needs no override.
 * @returns Cheap scrypt params when the test knob is set, otherwise `undefined`.
 */
function scryptTestOverride(): { params: { N: number } } | undefined {
  const n = Number(process.env.PASSWORD_SCRYPT_TEST_N);
  return Number.isInteger(n) && n > 1 ? { params: { N: n } } : undefined;
}

/**
 * Verify a plaintext password against a stored hash. Transparently supports both the
 * current scrypt format and legacy bcrypt hashes during the PRD-9 migration window.
 * @param plain - The plaintext password to check
 * @param stored - The stored password hash
 * @returns True when the password matches
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (isLegacyBcryptHash(stored)) {
    return verifyLegacyBcrypt(plain, stored);
  }
  const { verifyPassword: scryptVerify } = await loadCryptoModule();
  return scryptVerify(plain, stored);
}

/**
 * Legacy-only bcrypt verification (PRD-9 Этап 2). `bcryptjs` is a temporary,
 * dynamically-imported dependency kept external to the main bundle; verifying an
 * existing `$2a$…` hash requires a real bcrypt implementation (we never reimplement
 * bcrypt). This whole function — and the `bcryptjs` dependency — is removed in Этап 3
 * once the `auth.legacy_bcrypt_rehash` metric has drained to zero.
 * @param plain - The plaintext password to check
 * @param stored - The stored legacy bcrypt hash
 * @returns True when the password matches
 */
async function verifyLegacyBcrypt(plain: string, stored: string): Promise<boolean> {
  const { default: bcrypt } = await import("bcryptjs");
  logger.warn(
    "Verifying a legacy bcrypt password hash; it will be rehashed to scrypt on success (PRD-9).",
    "auth",
  );
  return bcrypt.compare(plain, stored);
}

// A fixed hash (same cost as a real one) to compare against when the account
// does not exist, so a failed login costs the same time whether or not the email
// is registered. Computed once, lazily.
let dummyHash: string | undefined;

/**
 * Spend the same time as a real password verification without an account —
 * call it when the user is not found so response time does not leak whether the
 * email exists (defeats timing-based user enumeration). Uses the same scrypt cost
 * as a real verification. Always resolves.
 * @param plain - The submitted password (compared against a throwaway hash)
 */
export async function dummyVerifyPassword(plain: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword("dummy-password");
  await verifyPassword(plain, dummyHash);
}
