/**
 * @module shared/template/themes.test
 * @description The closed theme registry (PRD-23): what a template may declare,
 * what a test may store, and what the validator refuses. The declaration is the
 * only thing that tells the platform a template ships more than one palette, so a
 * malformed entry has to be reported rather than silently dropped.
 */
import { describe, it, expect } from "vitest";
import {
  THEME_IDS,
  declaredThemes,
  isTestTheme,
  isThemeId,
  readTestTheme,
  supportsThemes,
  validateManifestThemes,
} from "./themes";

/** Both palettes present — shape of the certification template's theme.css. */
const CSS_BOTH = `
:root, :root[data-theme="light"] { --background: 240 4% 93%; --primary: 15 100% 45%; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --background: 240 10% 10%; }
}
:root[data-theme="dark"] { --background: 240 10% 10%; --primary: 15 100% 52%; }
`;

/** One palette only — shape of the default template's theme.css. */
const CSS_SINGLE = `:root { --background: 225 7% 7%; --primary: 217 91% 42%; }`;

const BOTH = [
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" },
];

describe("theme registry", () => {
  it("recognises only the closed set of ids", () => {
    expect(THEME_IDS).toEqual(["light", "dark"]);
    expect(isThemeId("light")).toBe(true);
    expect(isThemeId("sepia")).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });

  it("accepts auto only as a TEST choice, never as a template theme", () => {
    expect(isTestTheme("auto")).toBe(true);
    expect(isThemeId("auto")).toBe(false);
  });

  it("reads an absent or unknown stored choice as auto", () => {
    expect(readTestTheme("dark")).toBe("dark");
    expect(readTestTheme(undefined)).toBe("auto");
    expect(readTestTheme(null)).toBe("auto");
    // A test saved by a newer build must stay openable, not throw.
    expect(readTestTheme("sepia")).toBe("auto");
  });
});

describe("declaredThemes", () => {
  it("returns declared themes in order", () => {
    expect(declaredThemes({ themes: BOTH })).toEqual(BOTH);
  });

  it("returns nothing when the manifest declares no themes", () => {
    expect(declaredThemes({})).toEqual([]);
    expect(declaredThemes(null)).toEqual([]);
    expect(declaredThemes({ themes: "light,dark" })).toEqual([]);
  });

  it("drops malformed entries — the validator reports them", () => {
    const themes = [
      { id: "sepia", label: "Сепия" },
      { id: "light" },
      { id: "dark", label: "Тёмная" },
      { id: "dark", label: "Тёмная ещё раз" },
    ];
    expect(declaredThemes({ themes })).toEqual([{ id: "dark", label: "Тёмная" }]);
  });
});

describe("supportsThemes", () => {
  it("is true only when the author actually gets a choice", () => {
    expect(supportsThemes({ themes: BOTH })).toBe(true);
    expect(supportsThemes({ themes: [BOTH[0]] })).toBe(false);
    expect(supportsThemes({})).toBe(false);
  });
});

describe("validateManifestThemes", () => {
  it("passes a well-formed declaration backed by the stylesheet", () => {
    expect(validateManifestThemes({ themes: BOTH }, CSS_BOTH)).toEqual([]);
  });

  it("passes a manifest without themes when the template ships one palette", () => {
    expect(validateManifestThemes({}, CSS_SINGLE)).toEqual([]);
  });

  it("warns when a second palette ships undeclared — the author cannot reach it", () => {
    const issues = validateManifestThemes({}, CSS_BOTH);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].theme).toBe("dark");
  });

  it("blocks a themes field that is not an array", () => {
    const issues = validateManifestThemes({ themes: "light,dark" });
    expect(issues).toEqual([
      { theme: "", level: "blocking", message: "themes должен быть массивом" },
    ]);
  });

  it("blocks an id outside the registry and names it", () => {
    const issues = validateManifestThemes({ themes: [...BOTH, { id: "sepia", label: "Сепия" }] });
    const bad = issues.find((i) => i.level === "blocking");
    expect(bad?.message).toContain('"sepia"');
    expect(bad?.message).toContain("light, dark");
  });

  it("blocks a repeated theme", () => {
    const issues = validateManifestThemes({ themes: [...BOTH, BOTH[1]] });
    expect(issues).toEqual([
      { theme: "dark", level: "blocking", message: "тема объявлена дважды" },
    ]);
  });

  it("blocks a theme with no label — nothing to write in the column header", () => {
    const issues = validateManifestThemes({ themes: [BOTH[0], { id: "dark" }] });
    expect(issues[0].theme).toBe("dark");
    expect(issues[0].level).toBe("blocking");
    expect(issues[0].message).toContain("label");
  });

  it("blocks a theme the stylesheet does not back with tokens", () => {
    const issues = validateManifestThemes({ themes: BOTH }, CSS_SINGLE);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ theme: "dark", level: "blocking" });
  });

  it("checks the declaration alone when no stylesheet is supplied (activation gate)", () => {
    expect(validateManifestThemes({ themes: BOTH })).toEqual([]);
  });

  it("warns when a single theme is declared — that is not a choice", () => {
    const issues = validateManifestThemes({ themes: [BOTH[0]] }, CSS_BOTH);
    expect(issues).toEqual([
      {
        theme: "",
        level: "warning",
        message:
          "объявлена одна тема — платформа считает, что шаблон тем не поддерживает; " +
          "для выбора вида теста нужны обе",
      },
    ]);
  });
});

describe("пустая запись в themes[]", () => {
  it("declaredThemes пропускает null, не падая на нём", () => {
    expect(declaredThemes({ themes: [null, { id: "light", label: "Светлая" }] })).toEqual([
      { id: "light", label: "Светлая" },
    ]);
  });

  it("validateManifestThemes называет пустую запись её номером", () => {
    const issues = validateManifestThemes({ themes: [null, { id: "dark", label: "Тёмная" }] });
    expect(issues.some((i) => i.theme === "#1" && i.level === "blocking")).toBe(true);
  });
});
