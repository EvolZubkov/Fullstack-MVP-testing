/**
 * @module shared/template/theme-css.test
 * @description Printing per-theme colour overrides (PRD-23). The cases that matter
 * are the cascade ones: the dark rule must beat the base rule when dark is in force,
 * and a pinned light theme must beat the system's dark setting.
 */
import { describe, it, expect } from "vitest";
import { baseParams, buildTemplateThemeCss, paramsOfTheme, sceneThemeAttribute } from "./theme-css";

const PARAMS = [
  { key: "primaryColor", type: "color", cssVar: "--primary" },
  { key: "backgroundColor", type: "color", cssVar: "--background" },
  { key: "fontFamily", type: "select", cssVar: "--font-sans" },
];

const THEMED = {
  params: PARAMS,
  themes: [
    { id: "light", label: "Светлая" },
    { id: "dark", label: "Тёмная" },
  ],
};

const FLAT = { params: PARAMS };

describe("buildTemplateThemeCss", () => {
  it("prints nothing for a template without themes — its params stay inline", () => {
    expect(buildTemplateThemeCss({ params: { primaryColor: "1 2% 3%" } }, FLAT)).toBe("");
  });

  it("prints nothing when the author overrode no colour", () => {
    expect(buildTemplateThemeCss({ params: { fontFamily: "Inter" } }, THEMED)).toBe("");
  });

  it("prints the light palette on the bare root", () => {
    const css = buildTemplateThemeCss({ paramsByTheme: { light: { primaryColor: "L" } } }, THEMED);
    expect(css).toBe(":root { --primary: L; }");
  });

  it("prints the dark palette twice: under the media query and under the pin", () => {
    const css = buildTemplateThemeCss({ paramsByTheme: { dark: { primaryColor: "D" } } }, THEMED);
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --primary: D; } }',
    );
    expect(css).toContain(':root[data-theme="dark"] { --primary: D; }');
  });

  // The cascade guarantee: a light pin must survive a dark system setting.
  it("excludes a light pin from the system-dark rule", () => {
    const css = buildTemplateThemeCss(
      { theme: "light", paramsByTheme: { light: { primaryColor: "L" }, dark: { primaryColor: "D" } } },
      THEMED,
    );
    const media = css.split("\n").find((l) => l.startsWith("@media"))!;
    expect(media).toContain(':not([data-theme="light"])');
    // …and the dark value never appears in the unconditional rule.
    expect(css.split("\n")[0]).toBe(":root { --primary: L; }");
  });

  // The shadow host is matched by the FUNCTIONAL form only: `:host[…]` is invalid,
  // the browser drops the rule, and the pinned palette silently does nothing.
  it("prints under the shadow-root selector in its functional form", () => {
    const css = buildTemplateThemeCss({ paramsByTheme: { dark: { primaryColor: "D" } } }, THEMED, {
      rootSelector: ":host",
    });
    expect(css).toContain(':host([data-theme="dark"])');
    expect(css).toContain(':host(:not([data-theme="light"]))');
    expect(css).not.toContain(":host[");
    expect(css).not.toContain(":root");
  });

  it("keeps non-colour params out of the printed block", () => {
    const css = buildTemplateThemeCss(
      { params: { fontFamily: "Inter" }, paramsByTheme: { light: { primaryColor: "L" } } },
      THEMED,
    );
    expect(css).not.toContain("--font-sans");
  });

  it("carries a colour saved flat into both palettes (FR-17)", () => {
    const css = buildTemplateThemeCss({ params: { backgroundColor: "OLD" } }, THEMED);
    expect(css).toContain(":root { --background: OLD; }");
    expect(css).toContain(':root[data-theme="dark"] { --background: OLD; }');
  });
});

describe("sceneThemeAttribute", () => {
  it("is null for auto — the attribute must be absent for the media query to work", () => {
    expect(sceneThemeAttribute({ theme: "auto" }, THEMED)).toBeNull();
    expect(sceneThemeAttribute({}, THEMED)).toBeNull();
  });

  it("is the pinned theme when the author fixed one", () => {
    expect(sceneThemeAttribute({ theme: "dark" }, THEMED)).toBe("dark");
    expect(sceneThemeAttribute({ theme: "light" }, THEMED)).toBe("light");
  });

  it("is null for a template without themes, whatever is stored", () => {
    expect(sceneThemeAttribute({ theme: "dark" }, FLAT)).toBeNull();
  });
});

describe("baseParams / paramsOfTheme", () => {
  it("keeps colours out of the base set for a themed template", () => {
    const design = { params: { fontFamily: "Inter", primaryColor: "OLD" } };
    expect(baseParams(design, THEMED)).toEqual({ fontFamily: "Inter" });
    expect(baseParams(design, FLAT)).toEqual({ fontFamily: "Inter", primaryColor: "OLD" });
  });

  it("merges base and one palette for a single-theme consumer", () => {
    const design = { params: { fontFamily: "Inter" }, paramsByTheme: { dark: { primaryColor: "D" } } };
    expect(paramsOfTheme(design, THEMED, "dark")).toEqual({ fontFamily: "Inter", primaryColor: "D" });
  });
});

// Caught on the local SCORM player: the printed block carried `--font-sans` into
// every palette. `buildTemplateCssVars` falls back to each manifest `default`, so
// any defaulted param leaked into the theme rules — harmless-looking, and wrong.
describe("buildTemplateThemeCss — only what the palette actually sets", () => {
  const WITH_DEFAULTS = {
    params: [
      { key: "primaryColor", type: "color", cssVar: "--primary", default: "1 2% 3%" },
      { key: "fontFamily", type: "select", cssVar: "--font-sans", default: "Inter" },
    ],
    themes: [
      { id: "light", label: "Светлая" },
      { id: "dark", label: "Тёмная" },
    ],
  };

  it("does not print a param the author never set for that palette", () => {
    const css = buildTemplateThemeCss({ paramsByTheme: { dark: { primaryColor: "D" } } }, WITH_DEFAULTS);
    expect(css).not.toContain("--font-sans");
    // …and the palette that was left alone gets no rule of its own.
    expect(css).not.toContain(":root { ");
    expect(css).toContain(':root[data-theme="dark"] { --primary: D; }');
  });

  it("stays empty when the template defaults everything and the author set nothing", () => {
    expect(buildTemplateThemeCss({ params: { fontFamily: "Inter" } }, WITH_DEFAULTS)).toBe("");
  });
});
