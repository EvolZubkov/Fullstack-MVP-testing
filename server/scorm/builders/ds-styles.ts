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
 * Node file I/O only. The two sources — the DS stylesheet and the brand font — live
 * OUTSIDE `server/`, so they are not part of the deployed server tree: the production
 * image carries `dist/` (plus the template dirs), never `vendor/` or `client/`. They are
 * therefore copied into `dist/scorm/assets` by the build ({@link copyDsAssetsInto}) and
 * resolved dev-source-first, dist-second — the same convention as
 * {@link module:server/scorm/assets/read-asset}. Resolution is relative to the process
 * CWD, not to this module: in the bundled server every module collapses into `dist/`, so
 * `__dirname` arithmetic towards a repo root points outside the application.
 */
import fs from "node:fs";
import path from "node:path";
import { buildPaletteBridge } from "@shared/template/palette-bridge";

/** In-package font directory, relative to `styles.css` at the zip root. */
export const PACKAGE_FONT_DIR = "assets/fonts";

/** DS stylesheet: source path in the repo, and the path the build writes into `dist`. */
const DS_CSS_SOURCE = path.join("vendor", "ui-kit", "css", "university-rt.css");
const DS_CSS_DIST = path.join("dist", "scorm", "assets", "ds", "university-rt.css");
/** Brand-font directories: repo source, and the one the build writes into `dist`. */
const FONT_SOURCE_DIR = path.join("client", "public", "fonts");
const FONT_DIST_DIR = path.join("dist", "scorm", "assets", "fonts");

/**
 * First existing candidate, resolved against the CWD: the repo source (dev) before the
 * built asset (production image). Returns `null` when neither is present.
 */
function resolveFromCwd(...relatives: string[]): string | null {
  for (const rel of relatives) {
    const abs = path.resolve(process.cwd(), rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

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
  const p = resolveFromCwd(DS_CSS_SOURCE, DS_CSS_DIST);
  if (!p) {
    throw new Error(
      `DS stylesheet not found. Tried: ${DS_CSS_SOURCE}, ${DS_CSS_DIST} (relative to ${process.cwd()}). ` +
        "The production build copies it into dist — run `npm run build`.",
    );
  }
  return rewriteDsFontFaces(fs.readFileSync(p, "utf8"));
}

/**
 * Brand-font files to embed under {@link PACKAGE_FONT_DIR}, keyed by their in-zip path.
 * A weight missing from both the source tree and the build output is skipped rather than
 * failing the export — a package without the brand font still renders.
 */
export function readPackageFontFiles(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const file of PACKAGE_FONT_FILES) {
    const src = resolveFromCwd(path.join(FONT_SOURCE_DIR, file), path.join(FONT_DIST_DIR, file));
    if (src) out[`${PACKAGE_FONT_DIR}/${file}`] = fs.readFileSync(src);
  }
  return out;
}

/**
 * Copy the DS stylesheet and the packaged brand-font weights into a build output dir
 * (`dist`), so the deployed server — which carries neither `vendor/` nor `client/` —
 * can still assemble the package stylesheet. Called by `script/build.ts`.
 *
 * @param distDir Build output directory (the repo's `dist`, or a temp dir in tests).
 */
export function copyDsAssetsInto(distDir: string): void {
  const cssTarget = path.join(distDir, "scorm", "assets", "ds", "university-rt.css");
  fs.mkdirSync(path.dirname(cssTarget), { recursive: true });
  fs.copyFileSync(path.resolve(process.cwd(), DS_CSS_SOURCE), cssTarget);

  const fontDir = path.join(distDir, "scorm", "assets", "fonts");
  fs.mkdirSync(fontDir, { recursive: true });
  for (const file of PACKAGE_FONT_FILES) {
    const src = path.resolve(process.cwd(), FONT_SOURCE_DIR, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(fontDir, file));
  }
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
export function assemblePackageStyles(
  dsCss: string,
  themeCss: string,
  baseCss: string,
  /**
   * PRD-27: таблица страницы ОТЧЁТА. Кладётся в собранный `styles.css`, а не читается
   * рантаймом отдельно: отчёт строится в главном документе пакета, и стиль обязан быть
   * там уже к моменту растеризации. Протечь она не может — вся скоуплена в `.tb-report`
   * (§6.3), поэтому на сцену не влияет и идёт последней.
   */
  reportCss = "",
): string {
  // The package always bakes --primary/--background/… from params (manifest defaults),
  // so the bridge fires unconditionally; a template without .ou markup simply has no
  // element for the (inert) `.ou{}` block to touch.
  const bridge = buildPaletteBridge({ primary: "1", background: "1", card: "1", border: "1" });
  return [dsCss, themeCss, baseCss, bridge, reportCss].filter(Boolean).join("\n");
}
