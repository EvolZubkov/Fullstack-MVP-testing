/**
 * @module shared/template/params-css.test
 *
 * Locks the param → CSS-variable mapping that themes both hosts (PRD-12 parity).
 * This is the canonical copy the SCORM runtime (`templateCore.js`) delegates to,
 * so these expectations also guard against drift between the two.
 */
import { describe, it, expect } from "vitest";
import { buildTemplateCssVars, DEFAULT_PARAM_CSS_VARS } from "./params-css";

describe("buildTemplateCssVars", () => {
  it("maps the default colour/font param keys to their CSS variables", () => {
    const manifestParams = [
      { key: "backgroundColor" },
      { key: "foregroundColor" },
      { key: "cardColor" },
      { key: "primaryColor" },
      { key: "fontFamily" },
    ];
    const vars = buildTemplateCssVars(
      {
        backgroundColor: "0 0% 100%",
        foregroundColor: "0 0% 9%",
        cardColor: "0 0% 98%",
        primaryColor: "217 91% 42%",
        fontFamily: "Roboto",
      },
      manifestParams,
    );
    expect(vars).toEqual({
      "--background": "0 0% 100%",
      "--foreground": "0 0% 9%",
      "--card": "0 0% 98%",
      "--primary": "217 91% 42%",
      "--font-sans": "Roboto",
    });
  });

  it("falls back to the param default when the effective value is absent", () => {
    const vars = buildTemplateCssVars(
      { backgroundColor: "0 0% 100%" },
      [
        { key: "backgroundColor", default: "225 7% 7%" },
        { key: "foregroundColor", default: "0 0% 98%" },
      ],
    );
    expect(vars["--background"]).toBe("0 0% 100%"); // effective value wins
    expect(vars["--foreground"]).toBe("0 0% 98%"); // default fills the gap
  });

  it("honours an explicit cssVar and numeric cssUnit", () => {
    const vars = buildTemplateCssVars(
      { radius: 12 },
      [{ key: "radius", cssVar: "--radius", cssUnit: "px" }],
    );
    expect(vars["--radius"]).toBe("12px");
  });

  it("skips params with neither a mapped cssVar nor a value", () => {
    const vars = buildTemplateCssVars(
      { companyName: "Acme" },
      [
        { key: "companyName" }, // no default mapping → skipped
        { key: "logoUrl", default: null }, // null → skipped
      ],
    );
    expect(vars).toEqual({});
  });

  it("returns an empty map for nullish inputs", () => {
    expect(buildTemplateCssVars(null, [{ key: "backgroundColor" }])).toEqual({});
    expect(buildTemplateCssVars({ backgroundColor: "x" }, null)).toEqual({});
  });

  it("exposes the canonical default mapping", () => {
    expect(DEFAULT_PARAM_CSS_VARS.backgroundColor).toBe("--background");
    expect(DEFAULT_PARAM_CSS_VARS.foregroundColor).toBe("--foreground");
    expect(DEFAULT_PARAM_CSS_VARS.fontFamily).toBe("--font-sans");
  });
});
