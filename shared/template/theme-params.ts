/**
 * @module shared/template/theme-params
 *
 * Resolves a test's stored design settings into the shape both the editor and the
 * two renderers need: what paints ONCE, and what paints per theme (PRD-23).
 *
 * Design settings historically held one flat `params` map — one value per manifest
 * key. That is exactly right for a template with a single palette and wrong for a
 * template with two: a white «фон экрана» written once repaints the dark palette
 * too, and the learner gets white behind the template's near-white dark text.
 * PRD-23 adds `paramsByTheme`, and this module is the single place that decides how
 * the two live together:
 *
 *   - a template WITHOUT themes keeps everything flat — nothing changes for it;
 *   - a template WITH themes splits colours out per theme, while non-colour params
 *     (font, logo, progress mode) stay flat: they do not depend on the palette;
 *   - a colour saved FLAT by an older build is read as the value of EVERY theme
 *     (FR-17). Migration is therefore a read-time rule, not a data migration: the
 *     author's palette survives switching the test onto a themed template, and the
 *     flat value is rewritten into `paramsByTheme` on the next save.
 *
 * Pure — no DOM, no Node — safe to bundle for the browser and to unit-test.
 */
import { declaredThemes, readTestTheme, supportsThemes, type TestTheme, type ThemeId } from "./themes";

/** Manifest param definition, in the part this module reads. */
export interface ThemeAwareParamDef {
  key: string;
  type?: string;
}

/** Design settings as stored on the test (`tests.design_settings_json`). */
export interface StoredDesignSettings {
  params?: Record<string, unknown> | null;
  paramsByTheme?: Partial<Record<ThemeId, Record<string, unknown>>> | null;
  theme?: unknown;
}

/** Design params split the way the renderer and the editor consume them. */
export interface ResolvedThemeParams {
  /** Author's theme choice; `auto` when unset or unknown. */
  theme: TestTheme;
  /** True when the template declares a choice of palettes. */
  themed: boolean;
  /** Params that paint the same in every theme (and everything, when not themed). */
  base: Record<string, unknown>;
  /**
   * Colour overrides per declared theme. Empty object for a template without
   * themes — its colours live in {@link base}.
   */
  byTheme: Partial<Record<ThemeId, Record<string, unknown>>>;
}

/** Keys the manifest declares as colours — the only params that split per theme. */
export function colorParamKeys(params: ThemeAwareParamDef[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const def of params ?? []) {
    if (def && def.type === "color" && typeof def.key === "string") out.add(def.key);
  }
  return out;
}

/**
 * Splits stored design settings into base params and per-theme colour overrides.
 *
 * @param design   Stored design settings (`params`, `paramsByTheme`, `theme`).
 * @param manifest Template manifest — `params[]` says which keys are colours and
 *                 `themes[]` whether the template splits at all.
 */
export function resolveThemeParams(
  design: StoredDesignSettings | null | undefined,
  manifest: { params?: ThemeAwareParamDef[]; themes?: unknown } | null | undefined,
): ResolvedThemeParams {
  const theme = readTestTheme(design?.theme);
  const flat = (design?.params ?? {}) as Record<string, unknown>;

  if (!supportsThemes(manifest)) {
    return { theme, themed: false, base: { ...flat }, byTheme: {} };
  }

  const colors = colorParamKeys(manifest?.params);
  const base: Record<string, unknown> = {};
  const flatColors: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (colors.has(key)) flatColors[key] = value;
    else base[key] = value;
  }

  const stored = design?.paramsByTheme ?? {};
  const byTheme: Partial<Record<ThemeId, Record<string, unknown>>> = {};
  for (const { id } of declaredThemes(manifest)) {
    // The flat value is the FLOOR, not the winner: a colour the author has already
    // set for this theme must not be overwritten by the pre-theme leftover.
    byTheme[id] = { ...flatColors, ...((stored[id] ?? {}) as Record<string, unknown>) };
  }
  return { theme, themed: true, base, byTheme };
}

/**
 * Params that paint under `themeId` — base params plus that theme's colours.
 * This is what a single-theme consumer (a pinned test, one preview pane) needs.
 */
export function paramsForTheme(
  resolved: ResolvedThemeParams,
  themeId: ThemeId,
): Record<string, unknown> {
  return { ...resolved.base, ...(resolved.byTheme[themeId] ?? {}) };
}
