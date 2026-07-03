/**
 * @module script/reencrypt-emails
 * @description One-time migration that re-encrypts the `users.email` column when the
 * email-encryption keys (`ENCRYPTION_PASSWORD` / `ENCRYPTION_SALT`) are rotated.
 *
 * Rotating the encryption keys makes every previously encrypted email undecryptable,
 * because the AES key and the derived IV both depend on password + salt
 * (see {@link module:server/utils/crypto}). This script decrypts each email with the
 * OLD keys and re-encrypts it with the NEW keys inside a single transaction.
 *
 * The `email_hash` column is a plain SHA-256 of the normalized email and does NOT
 * depend on the encryption keys, so it is left untouched and lookups keep working.
 *
 * Required environment variables:
 *   - DATABASE_URL              target database
 *   - OLD_ENCRYPTION_PASSWORD   current key (the one used to encrypt existing rows)
 *   - OLD_ENCRYPTION_SALT
 *   - NEW_ENCRYPTION_PASSWORD   new key to migrate to
 *   - NEW_ENCRYPTION_SALT
 *   - DRY_RUN                   "false" to apply changes; anything else = dry run (default)
 *
 * Run a dry run first, inspect the report, then re-run with DRY_RUN=false in a
 * service window. See docs/RUNBOOK_SECRET_ROTATION.md.
 */

import { createHash } from "crypto";
import pg from "pg";
import { loadEnv, loadConfiguration } from "../server/config-loader.mjs";

const { Pool } = pg;

interface KeyPair {
  password: string;
  salt: string;
}

/**
 * Builds a Crypto instance mirroring server/utils/crypto.ts exactly, so that
 * ciphertext produced here is byte-compatible with the running application.
 * @param keys - password/salt pair
 * @returns initialized Crypto instance
 */
async function makeCrypto(keys: KeyPair): Promise<any> {
  const ivSeed = createHash("sha256")
    .update(keys.password + keys.salt)
    .digest()
    .slice(0, 16);

  const { default: Crypto } = await import("@vvlad1973/crypto");
  return new Crypto({
    password: keys.password,
    salt: keys.salt,
    algorithm: "SHA512",
    iterations: 10000,
    keyLength: 32,
    iv: ivSeed,
  });
}

/**
 * Reads a required environment variable or aborts with a clear message.
 * @param name - variable name
 * @returns the value
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[reencrypt-emails] Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  loadEnv();
  const cfg = await loadConfiguration();
  const databaseUrl = (cfg.database as { url?: string } | undefined)?.url ?? "";
  if (!databaseUrl) {
    console.error("[reencrypt-emails] DATABASE_URL must be set");
    process.exit(1);
  }

  const oldKeys: KeyPair = {
    password: requireEnv("OLD_ENCRYPTION_PASSWORD"),
    salt: requireEnv("OLD_ENCRYPTION_SALT"),
  };
  const newKeys: KeyPair = {
    password: requireEnv("NEW_ENCRYPTION_PASSWORD"),
    salt: requireEnv("NEW_ENCRYPTION_SALT"),
  };

  const apply = process.env.DRY_RUN === "false";
  console.log(`[reencrypt-emails] mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const oldCrypto = await makeCrypto(oldKeys);
  const newCrypto = await makeCrypto(newKeys);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  let total = 0;
  let migrated = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: string; email: string }>(
      "SELECT id, email FROM users",
    );
    total = rows.length;

    for (const row of rows) {
      // Decrypt with the OLD keys. Failure here means the supplied OLD keys do not
      // match what the data was encrypted with — abort instead of corrupting data.
      let plaintext: string;
      try {
        plaintext = oldCrypto.decrypt(row.email);
      } catch (err) {
        throw new Error(
          `Failed to decrypt user ${row.id} with OLD keys — wrong OLD_ENCRYPTION_* ? ` +
            `(${(err as Error).message})`,
        );
      }

      if (!plaintext) {
        // Empty plaintext is treated as a decryption failure (crypto returns "" on error paths).
        throw new Error(`Empty plaintext for user ${row.id} — OLD keys likely incorrect`);
      }

      const reEncrypted = newCrypto.encrypt(plaintext);

      // Verify round-trip with the NEW keys before trusting the value.
      const verify = newCrypto.decrypt(reEncrypted);
      if (verify !== plaintext) {
        throw new Error(`Round-trip verification failed for user ${row.id}`);
      }

      if (apply) {
        await client.query("UPDATE users SET email = $1 WHERE id = $2", [reEncrypted, row.id]);
      }
      migrated++;
    }

    if (apply) {
      await client.query("COMMIT");
      console.log(`[reencrypt-emails] COMMITTED: ${migrated}/${total} rows re-encrypted`);
    } else {
      await client.query("ROLLBACK");
      console.log(
        `[reencrypt-emails] DRY RUN ok: ${migrated}/${total} rows would be re-encrypted, ` +
          `${skipped} skipped. No changes written.`,
      );
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[reencrypt-emails] ABORTED, rolled back: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
