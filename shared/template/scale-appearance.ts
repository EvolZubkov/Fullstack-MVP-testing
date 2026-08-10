/**
 * @module shared/template/scale-appearance
 *
 * The LOOK the author gave each scale — colour and pictogram — as it travels from the design
 * template's variant settings to the rose (PRD-46 §7).
 *
 * Where it lives, and why not on the scale. A scale states WHAT is measured: its domain, its
 * bands, whether one end is the good one. Colour and pictogram state how that is DRAWN, and
 * drawing is what a design template brings. So the look is stored as ONE settings field of the
 * «Итоги» variant whose value is a MAP keyed by scale key — not a field per scale, because the
 * set of scales is unknown when the template is written, and not `config_json` of the scale,
 * because a template that draws no rose would then be carrying settings it never reads.
 *
 * Keyed by the scale KEY and not by its name or position: the key is stable, so renaming a
 * scale keeps its colour, and deleting one leaves an orphan entry that costs nothing and
 * hurts nothing.
 *
 * Everything here is DEFENSIVE. The value arrives from `settings_json` — author-editable JSON
 * that no migration ever rewrites — and from a SCORM package baked by an older build. A
 * malformed entry must therefore degrade to «no look declared» (the palette answers instead),
 * never to a broken `fill` attribute that renders the sector invisible.
 *
 * Pure — no DOM, no Node.
 */

import { parseHsl, type HslTriple } from "./level-ramp";

/** Key of the settings field that carries the map, in every manifest that declares one. */
export const SCALE_APPEARANCE_KEY = "scaleAppearance";

/** The look of ONE scale, as the author stored it. */
export interface ScaleAppearance {
  /**
   * HSL triple, the platform colour format (see `level-ramp`). The editor's picker speaks HEX
   * and converts on save: a value carrying its own `hsl(...)` or `#rrggbb` wrapper would be
   * dropped here, because the layouts wrap it themselves.
   */
  color?: HslTriple;
  /**
   * Name of the lucide glyph the author picked. This is what the EDITOR stores; the name alone
   * never reaches a chart.
   */
  icon?: string;
  /**
   * Contours of {@link ScaleAppearance.icon}, resolved from the icon library by the HOST —
   * the web host when it hands over the results context, the packer when it bakes TEST_DATA.
   * Inside a SCORM package there is nothing to resolve a name against: no React, no icon font,
   * no library, so the geometry has to be there before the package is opened.
   *
   * Written by the host, never by the editor. An entry that carries a name but no contours
   * simply draws no glyph — a caption without an icon is a normal state, not a failure.
   */
  iconPaths?: string[];
}

/** Scale key → its look. Absent keys simply have no look declared. */
export type ScaleAppearanceMap = Record<string, ScaleAppearance>;

/** What one axis of the chart may receive from the map. */
interface AppearanceTarget {
  key: string;
  color?: HslTriple;
  iconPaths?: string[];
}

/**
 * Read the stored map, keeping only what is usable.
 *
 * A colour survives only if it parses as a design-param triple; an icon name only if it is a
 * non-empty string. An entry left with neither is dropped entirely, so callers can treat
 * «present in the map» as «the author declared something».
 */
export function parseScaleAppearance(raw: unknown): ScaleAppearanceMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ScaleAppearanceMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const look: ScaleAppearance = {};
    if (typeof entry.color === "string" && parseHsl(entry.color)) look.color = entry.color.trim();
    if (typeof entry.icon === "string" && entry.icon.trim() !== "") look.icon = entry.icon.trim();
    const paths = Array.isArray(entry.iconPaths)
      ? entry.iconPaths.filter((p): p is string => typeof p === "string" && p.trim() !== "")
      : [];
    if (paths.length) look.iconPaths = paths;
    if (look.color === undefined && look.icon === undefined) continue;
    out[key] = look;
  }
  return out;
}

/**
 * Put the author's look onto the axes, by key.
 *
 * The author's choice OUTRANKS whatever the host put on the axis: the host's value is a
 * default, this one was stated. Axes absent from the map pass through untouched — the rose
 * then reaches for its categorical palette slot, and the slot is reserved by POSITION, so
 * painting one scale never shifts the hue of its neighbours.
 *
 * Note what is NOT decided here: whether the colour is honoured at all. That rule belongs to
 * the rose — colour carries identity only in a typology, and where a direction is declared the
 * colour states the verdict (PRD-46 §7). Applying the map unconditionally keeps this module
 * about transport and leaves the one rule in the one place that draws.
 */
export function applyScaleAppearance<T extends AppearanceTarget>(
  axes: readonly T[],
  map: ScaleAppearanceMap,
): T[] {
  return axes.map((axis) => {
    const look = map[axis.key];
    if (!look) return axis;
    const paths = look.iconPaths ?? [];
    if (!look.color && paths.length === 0) return axis;
    return {
      ...axis,
      ...(look.color ? { color: look.color } : {}),
      ...(paths.length ? { iconPaths: paths } : {}),
    };
  });
}
