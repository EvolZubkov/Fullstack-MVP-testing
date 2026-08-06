/**
 * @module tests/scorm-ds-styles
 * @description Ревизия «Стандартный» на ui-kit: DS и брендовый шрифт вложены в пакет.
 * Проверяем, что собранный `styles.css` несёт токены/компоненты DS, @font-face
 * RostelecomBasis с путём внутри пакета (woff2, без ../fonts и без otf/woff), мост
 * палитры, и что woff2-файлы шрифта отдаются в zip под assets/fonts/.
 */
import { describe, it, expect } from "vitest";
import {
  rewriteDsFontFaces,
  readVendorDsCss,
  readPackageFontFiles,
  assemblePackageStyles,
  PACKAGE_FONT_DIR,
} from "../server/scorm/builders/ds-styles";

describe("rewriteDsFontFaces", () => {
  it("points @font-face at the packaged font dir and keeps only woff2", () => {
    const src = `@font-face {
  font-family: 'RostelecomBasis';
  src: url('../fonts/RostelecomBasis-Regular.woff2') format('woff2'),
       url('../fonts/RostelecomBasis-Regular.woff') format('woff'),
       url('../fonts/RostelecomBasis-Regular.otf') format('opentype');
  font-weight: 400;
}`;
    const out = rewriteDsFontFaces(src);
    expect(out).toContain(`url('${PACKAGE_FONT_DIR}/RostelecomBasis-Regular.woff2') format('woff2')`);
    expect(out).not.toContain("../fonts/");
    expect(out).not.toContain(".otf");
    expect(out).not.toContain("format('woff')");
  });
});

describe("readVendorDsCss + assemblePackageStyles", () => {
  it("assembles DS tokens/components + font + bridge over the template CSS", () => {
    const ds = readVendorDsCss();
    // DS actually vendored.
    expect(ds).toContain("--ou-space-3");
    expect(ds).toContain(".ou-radio-card");
    expect(ds).toContain("@font-face");
    expect(ds).toContain("RostelecomBasis");
    expect(ds).toContain(`${PACKAGE_FONT_DIR}/RostelecomBasis-Regular.woff2`);

    const styles = assemblePackageStyles(ds, ":root{--primary:217 91% 42%}", "body{margin:0}");
    // DS first, template CSS present, palette bridge appended.
    expect(styles.indexOf("--ou-space-3")).toBeLessThan(styles.indexOf("--primary:217"));
    expect(styles).toContain(".ou{");
    expect(styles).toContain("--ou-purple-500");
    expect(styles).toContain("hsl(var(--primary))");
  });
});

describe("readPackageFontFiles", () => {
  it("returns woff2 buffers keyed by their in-zip path", () => {
    const fonts = readPackageFontFiles();
    const key = `${PACKAGE_FONT_DIR}/RostelecomBasis-Regular.woff2`;
    expect(Object.keys(fonts)).toContain(key);
    expect(Buffer.isBuffer(fonts[key])).toBe(true);
    expect(fonts[key].length).toBeGreaterThan(1000);
  });
});
