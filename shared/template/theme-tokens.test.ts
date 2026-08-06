/**
 * @module shared/template/theme-tokens.test
 * @description Reading a template's palette out of its stylesheet — the values the
 * «Цвета» pane shows for parameters the template leaves to its theme, and the
 * evidence the manifest validator uses to confirm a declared theme exists.
 */
import { describe, it, expect } from "vitest";
import { extractThemeTokens, hasDarkTheme } from "./theme-tokens";

// Shape of the certification template's theme.css: a light base, a dark palette
// behind the system media query, and an explicit dark override for the toggle.
const CERTIFICATION_CSS = `
/* comment with a decoy: :root { --primary: 0 0% 0%; } */
:root,
:root[data-theme="light"] {
  --background: 240 4% 93%;
  --primary: 15 100% 45%;
  --font-sans: 'Rostelecom Basis', sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --background: 240 10% 10%;
    --primary: 15 100% 52%;
  }
}

:root[data-theme="dark"] {
  --background: 240 10% 10%;
  --primary: 15 100% 52%;
}

.btn { background: hsl(var(--primary)); }
`;

describe("extractThemeTokens", () => {
  it("reads the light palette from the :root base", () => {
    const tokens = extractThemeTokens(CERTIFICATION_CSS);
    expect(tokens.light["--primary"]).toBe("15 100% 45%");
    expect(tokens.light["--background"]).toBe("240 4% 93%");
    expect(tokens.light["--font-sans"]).toBe("'Rostelecom Basis', sans-serif");
  });

  it("attributes the dark media query and the explicit dark selector to dark", () => {
    const tokens = extractThemeTokens(CERTIFICATION_CSS);
    expect(tokens.dark["--primary"]).toBe("15 100% 52%");
    expect(tokens.dark["--background"]).toBe("240 10% 10%");
    // The dark values must not leak into the light palette.
    expect(tokens.light["--primary"]).not.toBe(tokens.dark["--primary"]);
  });

  it("ignores declarations inside comments and non-:root rules", () => {
    const tokens = extractThemeTokens(CERTIFICATION_CSS);
    expect(tokens.light["--primary"]).not.toBe("0 0% 0%");
    expect(Object.keys(tokens.light)).not.toContain("--nope");
  });

  it("reports whether the template ships a dark palette", () => {
    expect(hasDarkTheme(extractThemeTokens(CERTIFICATION_CSS))).toBe(true);
    expect(hasDarkTheme(extractThemeTokens(":root { --primary: 0 0% 0%; }"))).toBe(false);
  });

  it("survives empty, malformed and non-string input", () => {
    expect(extractThemeTokens("")).toEqual({ light: {}, dark: {} });
    expect(extractThemeTokens(":root { --a: 1")).toEqual({ light: {}, dark: {} });
    expect(extractThemeTokens(undefined as never)).toEqual({ light: {}, dark: {} });
  });

  it("descends into conditional groups other than @media", () => {
    const tokens = extractThemeTokens("@supports (color: hsl(1 1% 1%)) { :root { --primary: 1 2% 3%; } }");
    expect(tokens.light["--primary"]).toBe("1 2% 3%");
  });
});
