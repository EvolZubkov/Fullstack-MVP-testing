import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Явно загружаем .env файл
config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

console.log("DATABASE_URL:", process.env.DATABASE_URL); // Для отладки

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});