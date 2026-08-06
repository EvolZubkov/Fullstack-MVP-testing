/**
 * @module shared/template/theme-params.test
 * @description Splitting stored design settings into «paints once» and «paints per
 * theme» (PRD-23). The barrier case is FR-17: a colour saved flat by an older build
 * must survive the test moving onto a template with two palettes — losing it would
 * repaint the learner's screen without the author touching anything.
 */
import { describe, it, expect } from "vitest";
import { colorParamKeys, paramsForTheme, resolveThemeParams } from "./theme-params";

const MANIFEST_FLAT = {
  params: [
    { key: "primaryColor", type: "color" },
    { key: "fontFamily", type: "select" },
  ],
};

const MANIFEST_THEMED = {
  ...MANIFEST_FLAT,
  themes: [
    { id: "light", label: "Светлая" },
    { id: "dark", label: "Тёмная" },
  ],
};

describe("colorParamKeys", () => {
  it("keeps only colour-typed params", () => {
    expect(colorParamKeys(MANIFEST_FLAT.params)).toEqual(new Set(["primaryColor"]));
    expect(colorParamKeys(undefined)).toEqual(new Set());
  });
});

describe("resolveThemeParams — template without themes", () => {
  it("keeps every param flat, colours included", () => {
    const r = resolveThemeParams(
      { params: { primaryColor: "217 91% 42%", fontFamily: "Inter" } },
      MANIFEST_FLAT,
    );
    expect(r.themed).toBe(false);
    expect(r.byTheme).toEqual({});
    expect(r.base).toEqual({ primaryColor: "217 91% 42%", fontFamily: "Inter" });
  });

  it("reads a missing or unknown theme choice as auto", () => {
    expect(resolveThemeParams({}, MANIFEST_FLAT).theme).toBe("auto");
    expect(resolveThemeParams({ theme: "sepia" }, MANIFEST_FLAT).theme).toBe("auto");
    expect(resolveThemeParams(null, null).theme).toBe("auto");
  });
});

describe("resolveThemeParams — template with themes", () => {
  it("splits colours per theme and leaves the rest flat", () => {
    const r = resolveThemeParams(
      {
        theme: "light",
        params: { fontFamily: "Rostelecom Basis" },
        paramsByTheme: { light: { primaryColor: "L" }, dark: { primaryColor: "D" } },
      },
      MANIFEST_THEMED,
    );
    expect(r.theme).toBe("light");
    expect(r.themed).toBe(true);
    expect(r.base).toEqual({ fontFamily: "Rostelecom Basis" });
    expect(r.byTheme).toEqual({ light: { primaryColor: "L" }, dark: { primaryColor: "D" } });
  });

  it("gives every declared theme an entry, even one the author never touched", () => {
    const r = resolveThemeParams({ paramsByTheme: { light: { primaryColor: "L" } } }, MANIFEST_THEMED);
    expect(Object.keys(r.byTheme).sort()).toEqual(["dark", "light"]);
    expect(r.byTheme.dark).toEqual({});
  });

  // FR-17 — the barrier case.
  it("reads a colour saved flat as the value of BOTH themes", () => {
    const r = resolveThemeParams({ params: { primaryColor: "OLD", fontFamily: "Inter" } }, MANIFEST_THEMED);
    expect(r.byTheme.light).toEqual({ primaryColor: "OLD" });
    expect(r.byTheme.dark).toEqual({ primaryColor: "OLD" });
    // The colour left the flat map — it now belongs to the themes.
    expect(r.base).toEqual({ fontFamily: "Inter" });
  });

  it("lets a per-theme value win over the flat leftover", () => {
    const r = resolveThemeParams(
      { params: { primaryColor: "OLD" }, paramsByTheme: { dark: { primaryColor: "NEW" } } },
      MANIFEST_THEMED,
    );
    expect(r.byTheme.light).toEqual({ primaryColor: "OLD" });
    expect(r.byTheme.dark).toEqual({ primaryColor: "NEW" });
  });
});

describe("paramsForTheme", () => {
  it("merges base params with the colours of one theme", () => {
    const r = resolveThemeParams(
      { params: { fontFamily: "Inter" }, paramsByTheme: { dark: { primaryColor: "D" } } },
      MANIFEST_THEMED,
    );
    expect(paramsForTheme(r, "dark")).toEqual({ fontFamily: "Inter", primaryColor: "D" });
    expect(paramsForTheme(r, "light")).toEqual({ fontFamily: "Inter" });
  });
});

describe("paramsForTheme — палитра, которой нет в хранении", () => {
  it("возвращает базовые параметры, а не падает", () => {
    // Шаблон без тем: byTheme пуст, но спросить про палитру можно — так делает
    // предпросмотр, пока автор не переключил шаблон.
    const flat = resolveThemeParams({ params: { fontFamily: "Inter" } }, MANIFEST_FLAT);
    expect(paramsForTheme(flat, "dark")).toEqual({ fontFamily: "Inter" });
  });
});
