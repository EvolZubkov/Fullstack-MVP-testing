import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Явно загружаем .env файл
config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.password = databaseUrl.password ? "******" : "";
console.log("DATABASE_URL:", databaseUrl.toString());

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
