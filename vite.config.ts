import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      // Vendored design-system source (no sibling-repo mount). The app consumes the
      // TS source directly via this alias — Vite compiles it in-tree. The `/css`
      // entry MUST precede the bare one (alias prefix-matching, first match wins).
      "@universityrt/ui-kit/css": path.resolve(import.meta.dirname, "vendor", "ui-kit", "css", "university-rt.css"),
      "@universityrt/ui-kit": path.resolve(import.meta.dirname, "vendor", "ui-kit", "src", "index.ts"),
      // Force `@universityrt/ui-kit` and any nested deps to resolve `react` /
      // `react-dom` from this project's node_modules — otherwise a stray React
      // copy makes hooks fail with «Cannot read properties of null (reading 'useId')».
      react: path.resolve(import.meta.dirname, "node_modules", "react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules", "react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
