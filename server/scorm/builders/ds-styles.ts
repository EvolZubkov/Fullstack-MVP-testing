/**
 * @module server/scorm/builders/ds-styles
 *
 * Vendors the UniversityRT design system and its brand font INTO the SCORM package
 * (revision «Стандартный» on ui-kit). The learner screens render from `.ou-*` markup;
 * for the package to look identical to the web host OFFLINE inside the LMS, the DS
 * stylesheet and the `RostelecomBasis` woff2 must travel in the zip — a CDN/font the
 * LMS cannot reach would drop the scene to system fonts and unstyled markup.
 *
 * The package `styles.css` sits at the zip ROOT, so the DS `@font-face`
 * `url('../fonts/…')` (authored relative to the ui-kit `css/` dir) is rewritten to the
 * packaged font dir, and trimmed to the woff2 source — the only format vendored, so
 * the woff/otf fallbacks do not 404 in the LMS.
 *
 * Pure/Node file I/O only — reads from the repo source tree (present at runtime, like
 * the template dirs {@link module:server/scorm/builders/template-copy}).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPaletteBridge } from "@shared/template/palette-bridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: this module lives at `server/scorm/builders/`. */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** In-package font directory, relative to `styles.css` at the zip root. */
export const PACKAGE_FONT_DIR = "assets/fonts";

/** Brand-font weights vendored into the package (woff2 only). */
export const PACKAGE_FONT_FILES = [
  "RostelecomBasis-Light.woff2",
  "RostelecomBasis-Regular.woff2",
  "RostelecomBasis-Medium.woff2",
  "RostelecomBasis-Bold.woff2",
];

/**
 * Rewrite the DS `@font-face` rules for the package: point every `src` at the packaged
 * font dir and keep ONLY the woff2 source (drop the woff/otf fallbacks that are not
 * vendored and would 404). The multi-format `src` list up to the `;` is replaced.
 */
export function rewriteDsFontFaces(dsCss: string): string {
  return dsCss.replace(
    /src:\s*url\('\.\.\/fonts\/([^']+\.woff2)'\)[^;]*;/g,
    `src: url('${PACKAGE_FONT_DIR}/$1') format('woff2');`,
  );
}

/** Read the DS stylesheet (source of truth) and rewrite its font faces for the package. */
export function readVendorDsCss(): string {
  const p = path.join(REPO_ROOT, "vendor", "ui-kit", "css", "university-rt.css");
  return rewriteDsFontFaces(fs.readFileSync(p, "utf8"));
}

/**
 * Brand-font files to embed under {@link PACKAGE_FONT_DIR}, keyed by their in-zip path.
 * A weight missing from the source tree is skipped rather than failing the export.
 */
export function readPackageFontFiles(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const file of PACKAGE_FONT_FILES) {
    const src = path.join(REPO_ROOT, "client", "public", "fonts", file);
    try {
      out[`${PACKAGE_FONT_DIR}/${file}`] = fs.readFileSync(src);
    } catch {
      /* weight not present — skip */
    }
  }
  return out;
}

/**
 * Assemble the package stylesheet: DS first (tokens + components + font), then the
 * template's own `theme.css` (+ `base.css` until the layouts move to the scene model)
 * OVER it, then the palette bridge — so the DS accent follows the test's `--primary`
 * (baked on `document.documentElement` by `templateCore.applyCssVarsToRoot`). Empty
 * parts are dropped so the order stays stable.
 *
 * @param dsCss    Rewritten DS stylesheet ({@link readVendorDsCss}).
 * @param themeCss Template `theme.css`.
 * @param baseCss  Template `base.css` (kept until the scene-model migration removes it).
 */
export function assemblePackageStyles(dsCss: string, themeCss: string, baseCss: string): string {
  // The package always bakes --primary/--background/… from params (manifest defaults),
  // so the bridge fires unconditionally; a template without .ou markup simply has no
  // element for the (inert) `.ou{}` block to touch.
  const bridge = buildPaletteBridge({ primary: "1", background: "1", card: "1", border: "1" });
  return [dsCss, themeCss, baseCss, bridge].filter(Boolean).join("\n");
}
