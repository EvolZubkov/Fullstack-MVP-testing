import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import os from "os";

// Cap fork concurrency on memory-constrained hosts. The pglite (WASM Postgres)
// DAL tests under tests/storage/** plus v8 coverage instrumentation are memory
// heavy; the default of one fork per core can exhaust RAM and crash workers
// ("Worker exited unexpectedly"). Budget roughly one fork per 0.5 GB of free
// memory, floored at 2 and capped at the core count — so well-provisioned CI
// boxes still run at full parallelism while a loaded laptop stays reliable.
const maxForks = Math.max(2, Math.min(os.cpus().length, Math.floor(os.freemem() / (0.5 * 1024 ** 3))));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    // The DAL tests under tests/storage/** each spin up an in-process pglite
    // (WASM Postgres) in a beforeAll that applies the full schema; several such
    // hooks running concurrently in the parallel pool can exceed the default
    // 10s hook timeout, so give hooks more headroom.
    hookTimeout: 30000,
    // Vitest 4: worker-count limits are top-level (poolOptions was removed).
    maxWorkers: maxForks,
    minWorkers: 1,
    setupFiles: ["./client/src/test/setup.ts", "./tests/setup-config.ts"],
    include: [
      "client/src/**/*.{test,spec}.{js,ts,jsx,tsx}",
      "server/**/*.{test,spec}.{js,ts}",
      "shared/**/*.{test,spec}.{js,ts}",
      "tests/**/*.{test,spec}.{js,ts}",
    ],
    // Integration tests (tests/it/*.it.test.ts) spin up an in-process pglite per
    // file; run them separately via `npm run test:it` (vitest.it.config.ts) so
    // several WASM Postgres instances do not contend under the parallel unit run.
    exclude: ["node_modules", "dist", "tests/it/**"],
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "text-summary", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["client/src/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"],
      exclude: [
        "node_modules",
        "dist",
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "client/src/test/**",
        "client/src/components/ui/**",
        "**/*.config.{ts,js}",
        "**/index.ts",
        // Bootstrap/glue with no unit-testable logic (same rationale as index.ts):
        // DB pool wiring, the dev-only Vite middleware and prod static serving.
        "server/db.ts",
        "server/vite.ts",
        "server/static.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      clean: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      // Vendored design-system source (see vite.config.ts). `/css` before bare.
      "@universityrt/ui-kit/css": path.resolve(import.meta.dirname, "vendor", "ui-kit", "css", "university-rt.css"),
      "@universityrt/ui-kit": path.resolve(import.meta.dirname, "vendor", "ui-kit", "src", "index.ts"),
      // Same React deduplication as in vite.config.ts — see comment there.
      react: path.resolve(import.meta.dirname, "node_modules", "react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules", "react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
});
