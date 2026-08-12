/**
 * @module server/services/scale-icons
 *
 * Resolves the pictogram NAME an author picked into the contours a chart can draw (PRD-46 §8).
 *
 * The name is what the editor stores; the geometry is what the renderers need. Resolution
 * happens HERE, on the host, and never in the SCORM package: a package is static files with no
 * React and no icon library, so by the time it is opened the contours have to already be inside
 * it. The web host resolves when it hands over the results context, the packer when it bakes
 * TEST_DATA — both through this one function, so a name can never mean two different glyphs.
 *
 * The glyph table is a generated file (`npm run icons:gen`); see
 * `scripts/build/gen-lucide-icons.ts` for why it is data rather than a call into the library.
 */

import GLYPHS from "@shared/template/lucide-icons.generated.json";
import { SCALE_APPEARANCE_KEY, parseScaleAppearance } from "@shared/template/scale-appearance";

const TABLE = GLYPHS as Record<string, string[]>;

/** Contours of `name`, or `null` for a name this build does not know. */
export function iconContours(name: string): string[] | null {
  const paths = TABLE[name];
  return Array.isArray(paths) && paths.length > 0 ? paths : null;
}

/** Every glyph name this build can draw, sorted — the editor's picker reads the same set. */
export function iconNames(): string[] {
  return Object.keys(TABLE);
}

/**
 * A copy of the variant settings whose appearance map carries resolved contours.
 *
 * Returns the settings UNCHANGED when there is nothing to resolve, so the common case — a test
 * with no rose, or a rose with no pictograms — allocates nothing and the object identity the
 * callers already rely on is preserved.
 *
 * A name the current build cannot resolve is left WITHOUT contours rather than dropped: the
 * caption simply draws no glyph, which is a normal state, and the author's choice stays in the
 * data so a later build (or a re-run of the generator after a library upgrade) can honour it.
 */
export function withResolvedScaleIcons<T extends object>(settings: T): T {
  const map = parseScaleAppearance((settings as Record<string, unknown> | null)?.[SCALE_APPEARANCE_KEY]);
  const keys = Object.keys(map).filter((k) => map[k].icon);
  if (keys.length === 0) return settings;

  const resolved: Record<string, unknown> = {};
  for (const [key, look] of Object.entries(map)) {
    const paths = look.icon ? iconContours(look.icon) : null;
    // Rebuilt rather than spread over: contours baked by an EARLIER build must not survive a
    // change of name, and a stale glyph beside a new name is the hardest kind of wrong to see.
    resolved[key] = {
      ...(look.color ? { color: look.color } : {}),
      ...(look.icon ? { icon: look.icon } : {}),
      ...(paths ? { iconPaths: paths } : {}),
    };
  }
  return { ...settings, [SCALE_APPEARANCE_KEY]: resolved };
}
