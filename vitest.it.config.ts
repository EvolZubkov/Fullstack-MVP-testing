import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Integration tests (tests/it/*.it.test.ts) run the REAL DAL against an
 * in-process pglite (WASM Postgres) — see tests/it/db-harness.ts. Each file
 * creates its own database, so files run sequentially (`fileParallelism: false`)
 * to avoid several WASM instances contending for memory. Kept out of the main
 * `vitest.config.ts` (which excludes tests/it and stays fully parallel).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup-config.ts"],
    include: ["tests/it/**/*.it.test.{js,ts}"],
    exclude: ["node_modules", "dist"],
    fileParallelism: false,
    coverage: { enabled: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
});
