/**
 * @module tests/deploy-image-docs
 *
 * Packaging contract for the downloadable authoring PDFs. `GET /api/docs/:doc`
 * (and the two section-local routes that share its registry) reads pre-built
 * artifacts from `docs/dist` at runtime (`resolveDocPath`), so the files must be
 * present next to the app inside the Docker image. The route tests alone cannot
 * catch a packaging gap: they pass in the repo, where the committed PDFs are
 * always on disk, while the deployed container answered 404 («Документ не
 * собран») because `docker/Dockerfile` never copied `docs/dist`.
 *
 * These checks are static (no Docker daemon needed): they assert the build
 * files ship every PDF the download registry advertises.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_DOWNLOADS } from "../server/services/doc-downloads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

describe("docs/dist в прод-сборке", () => {
  it("каждый документ из реестра скачивания собран и закоммичен", () => {
    expect(DOC_DOWNLOADS.length).toBeGreaterThan(0);
    for (const doc of DOC_DOWNLOADS) {
      expect(existsSync(path.resolve(ROOT, "docs", "dist", doc.file)), `docs/dist/${doc.file}`).toBe(true);
    }
  });

  it("Dockerfile копирует docs/dist в образ", () => {
    const dockerfile = readFileSync(path.resolve(ROOT, "docker", "Dockerfile"), "utf8");
    // The runtime resolves docs/dist relative to the WORKDIR, so the image must
    // carry the directory at /app/docs/dist.
    expect(dockerfile).toMatch(/^COPY[^\n]*\sdocs\/dist\s+\.\/docs\/dist\s*$/m);
  });

  it("контекст сборки не исключает docs/dist", () => {
    const ignoreFile = path.resolve(ROOT, "docker", ".dockerignore");
    const lines = readFileSync(ignoreFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    // `docs/` is excluded (the sources are not needed in the image), so the
    // generated PDFs must be re-included, mirroring the server/scorm/templates
    // pattern: Docker forbids re-including a path whose parent is excluded, so
    // the exclusion has to descend level by level.
    const excludesAllDocs = lines.some((l) => l === "docs/" || l === "docs");
    expect(excludesAllDocs, "docs/ must not be excluded wholesale").toBe(false);
    expect(lines).toContain("!docs/dist");
  });
});
