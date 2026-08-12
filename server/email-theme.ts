/**
 * @module server/email-theme
 * @description Design-system colours resolved into plain literals for e-mail.
 *
 * The application takes colour from DS tokens (`--ou-*`), but a letter cannot:
 * mail clients (Outlook, the Gmail web client, most mobile readers) strip CSS
 * custom properties and do not implement `color-mix()`. So the DS values are
 * resolved ONCE here — anchors copied from `vendor/ui-kit/css/university-rt.css`,
 * soft tints computed with the same oklch mix the design system uses — and the
 * letters in `server/email.ts` reference nothing else. `tests/email-ds-colors`
 * re-derives every entry straight from the ui-kit stylesheet, so a change on the
 * design-system side turns the suite red instead of silently drifting.
 *
 * Only the light theme is resolved: a letter has no theme switch, and DS light
 * is the product's default surface.
 */

// ── oklch mixing (CSS Color 4) ───────────────────────────────────────────────
// White is achromatic, so its hue is "powerless" and an oklch mix with white
// reduces to a plain oklab interpolation — which is what `tintWithWhite` does.

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Convert `#rrggbb` to oklab (L, a, b). */
function hexToOklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** Convert oklab (L, a, b) back to an upper-case `#RRGGBB`, clipped to sRGB. */
function oklabToHex([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255));
  return `#${channels.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/**
 * Lighten a DS anchor towards white exactly as the ui-kit ramp does
 * (`color-mix(in oklch, #fff <percent>%, <anchor>)`).
 *
 * @param anchor Anchor colour as `#rrggbb`.
 * @param whitePercent Share of white, 0-100.
 * @returns The mixed colour as `#RRGGBB`.
 */
export function tintWithWhite(anchor: string, whitePercent: number): string {
  const w = whitePercent / 100;
  const a = hexToOklab(anchor);
  const white = hexToOklab("#ffffff");
  return oklabToHex([0, 1, 2].map((i) => white[i] * w + a[i] * (1 - w)) as [number, number, number]);
}

// ── DS anchors (1:1 with vendor/ui-kit/css/university-rt.css) ────────────────

const PURPLE_500 = "#7700FF";
const WARNING_500 = "#FFB608";

/**
 * Roles used by the letters, named after the DS semantic tokens they resolve:
 * `accent` = `--ou-accent-default`, `page` = `--ou-bg-page`, `fg` =
 * `--ou-fg-default`, and so on.
 */
export const EMAIL_COLORS = {
  /** `--ou-accent-default` (purple-500) — header band and call-to-action. */
  accent: PURPLE_500,
  /** `--ou-fg-on-accent` (neutral-0) — text on the accent. */
  accentText: "#FFFFFF",
  /** `--ou-accent-soft` (purple-50) — brand-tinted callout background. */
  accentSoft: tintWithWhite(PURPLE_500, 92),
  /** `--ou-bg-page` (neutral-50) — letter body background. */
  page: "#F4F4F5",
  /** `--ou-bg-surface-1` (neutral-0) — raised blocks on the body. */
  surface: "#FFFFFF",
  /** `--ou-bg-surface-3` (neutral-100) — quiet inset blocks (raw link, meta). */
  sunken: "#E7E8EA",
  /** `--ou-border-soft`..`default` (neutral-200) — hairlines. */
  border: "#D0D2D7",
  /** `--ou-fg-default` (neutral-900) — body text. */
  fg: "#1D2533",
  /** `--ou-fg-muted` (neutral-500) — footer and secondary lines. */
  fgMuted: "#5D6371",
  /** `--ou-warning-500` — border of the caution block. */
  warning: WARNING_500,
  /** `--ou-warning-50` — background of the caution block. */
  warningSoft: tintWithWhite(WARNING_500, 90),
} as const;
