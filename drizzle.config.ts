import { defineConfig } from "drizzle-kit";
import { config as loadDotenv } from "dotenv";
import fs from "node:fs";

// drizzle-kit loads this config synchronously (no async default export), so it
// cannot use the app's async getConfig loader. It loads the env file for the
// current NODE_ENV (same selection as server/config-loader.mjs#loadEnv) and reads
// the connection string directly from the environment — this is a build/migration
// tool, and DATABASE_URL is the same secret the config maps `database.url` to.
const env = process.env.NODE_ENV?.trim();
for (const rel of env ? [`.env.${env}`, ".env"] : [".env"]) {
  if (fs.existsSync(rel)) {
    loadDotenv({ path: rel, quiet: true });
    break;
  }
}

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const masked = new URL(databaseUrl);
masked.password = masked.password ? "******" : "";
console.log("DATABASE_URL:", masked.toString());

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
