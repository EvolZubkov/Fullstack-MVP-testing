/**
 * @module tests/scorm-ds-assets
 *
 * Packaging contract for the DS stylesheet and the brand font that
 * `server/scorm/builders/ds-styles` vendors INTO every SCORM package
 * (commit e5fdead). Both were read straight from the repo source tree
 * (`vendor/ui-kit/css`, `client/public/fonts`) — neither directory exists in the
 * production image, and in the bundled server the module's `__dirname` collapses
 * to `dist/`, so the repo-root arithmetic pointed outside the app entirely.
 * Result on test/prod: `generateScormPackage` threw ENOENT, so SCORM export and
 * the debug player answered 500 while dev worked.
 *
 * The fix treats both as build-time assets copied into `dist/scorm/assets`, so
 * these tests pin BOTH halves: the build step ships them, and the readers find
 * them in a dist-only layout (no repo source tree in sight).
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyDsAssetsInto,
  readVendorDsCss,
  readPackageFontFiles,
  PACKAGE_FONT_FILES,
} from "../server/scorm/builders/ds-styles";

const cwd = process.cwd();
const temps: string[] = [];

/** Temp dir removed after the test. */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-ds-assets-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(cwd);
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("DS-ассеты SCORM-пакета в прод-раскладке", () => {
  it("сборка укладывает DS-стиль и шрифты в dist", () => {
    const dist = path.join(tempDir(), "dist");
    copyDsAssetsInto(dist);

    const css = path.join(dist, "scorm", "assets", "ds", "university-rt.css");
    expect(fs.existsSync(css)).toBe(true);
    expect(fs.readFileSync(css, "utf8")).toContain(".ou-");
    for (const file of PACKAGE_FONT_FILES) {
      expect(fs.existsSync(path.join(dist, "scorm", "assets", "fonts", file)), file).toBe(true);
    }
  });

  it("DS-стиль и шрифты читаются в dist-раскладке без исходного дерева", () => {
    const root = tempDir();
    copyDsAssetsInto(path.join(root, "dist"));
    // The deployed image has dist/ and no vendor//client/ — reproduce exactly that.
    process.chdir(root);

    const css = readVendorDsCss();
    expect(css).toContain(".ou-");
    // Font faces are rewritten to the in-package dir, not the ui-kit-relative one.
    expect(css).not.toContain("url('../fonts/");

    const fonts = readPackageFontFiles();
    expect(Object.keys(fonts).length).toBe(PACKAGE_FONT_FILES.length);
    for (const file of PACKAGE_FONT_FILES) {
      expect(fonts[`assets/fonts/${file}`]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
