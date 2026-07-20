/**
 * @module docker/scripts/create-admin
 * @description Creates (or promotes) an administrator account on a running
 * instance. Designed to run INSIDE the application container via `docker exec`,
 * so it reuses the container's `DATABASE_URL`, `@vvlad1973/crypto` and `pg` — the
 * same seam as {@link module:docker/scripts/set-password}, but it can create a new
 * account rather than only reset an existing one.
 *
 * Idempotent. If the email already exists the account is promoted: its password is
 * reset, its status set to active, and the administrator role ensured. The email
 * is encrypted with the SAME construction as `server/utils/crypto.ts` (so the app
 * can decrypt it for display), and the lookup hash mirrors `hashEmail`.
 *
 * The plaintext password is passed base64-encoded to avoid shell-quoting issues.
 *
 * Environment:
 *   CA_EMAIL         account email (required)
 *   CA_PASSWORD_B64  password, base64-encoded UTF-8 (required)
 *   CA_NAME          display name (optional, default "Администратор")
 *
 * Exit codes: 0 ok, 1 bad input/env, 3 DB error.
 */
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
// Runs from /app inside the container (docker cp -> /app/create-admin.mjs), so the
// baked config loader (server/config-loader.mjs) and config file are reachable
// relative to /app — identical to set-password.mjs.
import { loadEnv, loadConfiguration } from "./server/config-loader.mjs";

const EMAIL = (process.env.CA_EMAIL ?? "").trim();
const PASSWORD_B64 = process.env.CA_PASSWORD_B64 ?? "";
const NAME = (process.env.CA_NAME ?? "").trim() || "Администратор";

// Resolve the connection string + encryption secrets through the standard loader
// (config maps database.url / encryption.* to their env references), so the values
// match exactly what the running app uses.
loadEnv();
const cfg = await loadConfiguration();
const DATABASE_URL = cfg.database?.url ?? "";

if (!EMAIL || !PASSWORD_B64) {
  console.error("ERROR: CA_EMAIL and CA_PASSWORD_B64 are required.");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set inside the container.");
  process.exit(1);
}

const password = Buffer.from(PASSWORD_B64, "base64").toString("utf8");
if (!password) {
  console.error("ERROR: decoded password is empty.");
  process.exit(1);
}

const normalizedEmail = EMAIL.toLowerCase().trim();
// Mirror server/utils/crypto.ts#hashEmail: sha256(lowercase(trim(email))).
const emailHash = createHash("sha256").update(normalizedEmail).digest("hex");

// Mirror server/utils/crypto.ts: scrypt password hash + AES email encryption with
// the SAME Crypto construction (SHA512 / 10000 / keyLength 32 / fixed IV derived
// from password+salt), so the app verifies the password and decrypts the email.
const cryptoMod = await import("@vvlad1973/crypto");
const Crypto = cryptoMod.default;
const hashPassword = cryptoMod.hashPassword;
const encPassword = cfg.encryption?.password || "dev-default-key";
const encSalt = cfg.encryption?.salt || "dev-default-salt";
const ivSeed = createHash("sha256").update(encPassword + encSalt).digest().slice(0, 16);
const emailCipher = new Crypto({
  password: encPassword,
  salt: encSalt,
  algorithm: "SHA512",
  iterations: 10000,
  keyLength: 32,
  iv: ivSeed,
});
const encryptedEmail = emailCipher.encrypt(normalizedEmail);
const passwordHash = await hashPassword(password);

const client = new pg.Client({ connectionString: DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");

  const existing = await client.query("SELECT id FROM users WHERE email_hash = $1", [emailHash]);
  let userId;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE users
          SET password_hash = $1,
              name = COALESCE(name, $2),
              status = 'active',
              must_change_password = false
        WHERE id = $3`,
      [passwordHash, NAME, userId],
    );
    console.log(`Existing account promoted: ${EMAIL} (id=${userId})`);
  } else {
    userId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, email_hash, password_hash, name, status,
                          must_change_password, gdpr_consent, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', false, true, now())`,
      [userId, encryptedEmail, emailHash, passwordHash, NAME],
    );
    console.log(`Account created: ${EMAIL} (id=${userId})`);
  }

  // Ensure the administrator role (unique index on (user_id, role) makes it a no-op
  // when already present).
  await client.query(
    `INSERT INTO user_roles (id, user_id, role, granted_at)
     VALUES ($1, $2, 'administrator', now())
     ON CONFLICT (user_id, role) DO NOTHING`,
    [randomUUID(), userId],
  );

  await client.query("COMMIT");
  console.log(`OK: ${EMAIL} is now an administrator (status=active, no forced change).`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ERROR: " + (err instanceof Error ? err.message : String(err)));
  process.exit(3);
} finally {
  await client.end().catch(() => {});
}
