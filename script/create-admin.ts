import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { encryptEmail, hashEmail } from "../server/utils/crypto";

const { Pool } = pg;

type Options = {
  email: string;
  password: string;
  name: string;
  mustChangePassword: boolean;
};

const usage = `Usage:
  npm run create-admin -- --email admin@example.com --password "strong-password" [--name "Admin Name"]

Environment variables are also supported:
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD="strong-password" npm run create-admin

Options:
  --email <email>            Admin email. Required unless ADMIN_EMAIL is set.
  --password <password>      Admin password. Required unless ADMIN_PASSWORD is set.
  --name <name>              Display name. Defaults to ADMIN_NAME or "Администратор".
  --must-change-password     Require password change on first login.
`;

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for --${name}`);
  }

  return value;
}

function parseOptions(): Options {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }

  const email = (getArg("email") ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = getArg("password") ?? process.env.ADMIN_PASSWORD ?? "";
  const name = (getArg("name") ?? process.env.ADMIN_NAME ?? "Администратор").trim();
  const mustChangePassword = process.argv.includes("--must-change-password");

  if (!email) {
    throw new Error("Admin email is required. Use --email or ADMIN_EMAIL.");
  }

  if (!password) {
    throw new Error("Admin password is required. Use --password or ADMIN_PASSWORD.");
  }

  if (password.length < 6) {
    throw new Error("Admin password must be at least 6 characters.");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set in .env or environment.");
  }

  return { email, password, name, mustChangePassword };
}

async function upsertAdmin(options: Options) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const passwordHash = await bcrypt.hash(options.password, 10);
    const encryptedEmail = await encryptEmail(options.email);
    const emailHash = hashEmail(options.email);
    const gdprConsentAt = new Date();

    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email_hash = $1 LIMIT 1",
      [emailHash],
    );

    // PRD-13 (T-10): the legacy `users.role` column was dropped — roles live in
    // `user_roles`. Upsert the user without a role column, then grant the
    // administrator role separately (idempotent).
    let result: { action: "created" | "updated"; id: string };

    if (existing.rowCount && existing.rows[0]) {
      const id = existing.rows[0].id;

      await pool.query(
        `UPDATE users
         SET email = $1,
             password_hash = $2,
             name = $3,
             status = 'active',
             must_change_password = $4,
             gdpr_consent = true,
             gdpr_consent_at = COALESCE(gdpr_consent_at, $5),
             expires_at = NULL
         WHERE id = $6`,
        [
          encryptedEmail,
          passwordHash,
          options.name,
          options.mustChangePassword,
          gdprConsentAt,
          id,
        ],
      );

      result = { action: "updated", id };
    } else {
      const id = randomUUID();

      await pool.query(
        `INSERT INTO users (
           id,
           email,
           email_hash,
           password_hash,
           name,
           status,
           must_change_password,
           gdpr_consent,
           gdpr_consent_at,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, 'active', $6, true, $7, NOW())`,
        [
          id,
          encryptedEmail,
          emailHash,
          passwordHash,
          options.name,
          options.mustChangePassword,
          gdprConsentAt,
        ],
      );

      result = { action: "created", id };
    }

    // Grant the administrator role (PRD-13). Unique (user_id, role) -> idempotent.
    await pool.query(
      `INSERT INTO user_roles (id, user_id, role)
       VALUES ($1, $2, 'administrator')
       ON CONFLICT (user_id, role) DO NOTHING`,
      [randomUUID(), result.id],
    );

    return result;
  } finally {
    await pool.end();
  }
}

async function main() {
  const options = parseOptions();
  const result = await upsertAdmin(options);

  console.log(
    result.action === "created"
      ? `Admin user created: ${options.email} (${result.id})`
      : `Admin user updated: ${options.email} (${result.id})`,
  );
  console.log("Role: administrator");
  console.log(`Status: active`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error("");
    console.error(usage);
    process.exit(1);
  });
