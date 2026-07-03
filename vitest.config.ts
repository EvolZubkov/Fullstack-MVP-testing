import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./client/src/test/setup.ts", "./tests/setup-config.ts"],
    include: [
      "client/src/**/*.{test,spec}.{js,ts,jsx,tsx}",
      "server/**/*.{test,spec}.{js,ts}",
      "shared/**/*.{test,spec}.{js,ts}",
      "tests/**/*.{test,spec}.{js,ts}",
    ],
    exclude: ["node_modules", "dist"],
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
      ],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
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
