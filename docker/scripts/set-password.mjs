/**
 * @module docker/scripts/set-password
 * @description Sets (resets) the password for a single user account, identified
 * by email. Designed to run INSIDE the application container via `docker exec`,
 * so it reuses the container's `DATABASE_URL`, `@vvlad1973/crypto` and `pg` — no
 * superuser DB access required (the app role owns the `users` table).
 *
 * The account is looked up by `email_hash` (SHA-256 of the normalized email),
 * identical to `server/utils/crypto.ts#hashEmail`, so it matches how the app
 * stores it. The plaintext password is passed base64-encoded to avoid any
 * shell-quoting issues with special characters.
 *
 * Environment:
 *   SP_EMAIL           target account email (required)
 *   SP_PASSWORD_B64    new password, base64-encoded UTF-8 (required)
 *   SP_FORCE_CHANGE    "true" to force a password change on next login
 *                      (default "false" — the new password works as-is)
 *
 * Exit codes: 0 ok, 1 bad input/env, 2 user not found, 3 DB error.
 */
import { createHash } from "node:crypto";
import { hashPassword } from "@vvlad1973/crypto";
import pg from "pg";
// Runs from /app inside the container (docker cp -> /app/set-password.mjs), so
// the baked config loader (server/config-loader.mjs) and the MOUNTED config volume
// (/app/config) are reachable relative to /app.
import { loadEnv, loadConfiguration } from "./server/config-loader.mjs";

const EMAIL = (process.env.SP_EMAIL ?? "").trim();
const PASSWORD_B64 = process.env.SP_PASSWORD_B64 ?? "";
const FORCE_CHANGE = process.env.SP_FORCE_CHANGE === "true";

// Resolve the connection string through the standard getConfig loader (config
// maps database.url -> { env: "DATABASE_URL" }). loadEnv reads the mounted
// .env.<NODE_ENV>/.env; getConfig resolves the reference.
loadEnv();
const cfg = await loadConfiguration();
const DATABASE_URL = cfg.database?.url ?? "";

if (!EMAIL || !PASSWORD_B64) {
  console.error("ERROR: SP_EMAIL and SP_PASSWORD_B64 are required.");
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

// Mirror server/utils/crypto.ts#hashEmail: sha256(lowercase(trim(email))).
const emailHash = createHash("sha256")
  .update(EMAIL.toLowerCase().trim())
  .digest("hex");

// Mirror server/utils/crypto.ts#hashPassword: scrypt via @vvlad1973/crypto (PRD-9).
const passwordHash = await hashPassword(password);

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  // PRD-13 (T-10): the legacy `users.role` column was dropped — roles live in
  // `user_roles`. This tool only resets the password, so it neither reads nor
  // writes roles; `RETURNING role` here would fail with "column role does not
  // exist" on a migrated DB.
  const { rows } = await client.query(
    `UPDATE users
        SET password_hash = $1,
            must_change_password = $2,
            status = CASE WHEN status = 'pending' THEN 'active' ELSE status END
      WHERE email_hash = $3
      RETURNING id, status`,
    [passwordHash, FORCE_CHANGE, emailHash],
  );

  if (rows.length === 0) {
    console.error(
      `ERROR: no account found for "${EMAIL}" (email_hash=${emailHash.slice(0, 12)}…).`,
    );
    console.error(
      "Hint: the account may not exist, or its email_hash column is empty.",
    );
    process.exit(2);
  }

  for (const r of rows) {
    console.log(
      `OK: password set for ${EMAIL} -> id=${r.id} ` +
        `status=${r.status} mustChangePassword=${FORCE_CHANGE}`,
    );
  }
} catch (err) {
  console.error("ERROR: " + (err instanceof Error ? err.message : String(err)));
  process.exit(3);
} finally {
  await client.end().catch(() => {});
}
