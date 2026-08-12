/**
 * @module shared/template/start-image
 *
 * Resolution of the START screen's illustration — the ONE rule both hosts and both
 * editor previews follow.
 *
 * The start layouts bind `design.startImageUrl` (PRD-7 branding). Since PRD-22 the
 * variant that actually shows an illustration (`start.image-right`) declares it as
 * its own page PROPERTY (`settings[].image`), so the author sets the picture where
 * the variant is chosen — in «Структура», on the start page — instead of hunting for
 * a test-wide branding param that the standard start variant ignores anyway.
 *
 * The branding param stays as the FALLBACK: tests that filled «Изображение старта»
 * before the page property existed keep their picture, and a template may still
 * ship one illustration for the whole test.
 *
 * Value shapes differ by origin and both are accepted here:
 *   - a page property stores a PLAIN URL string (`ImagePlaceholderControl`);
 *   - a design param stores the media envelope `{ url, name, … }` (`MediaParamRow`),
 *     or a bare string for legacy values.
 *
 * Pure string processing — no DOM, no Node — so it is safe to bundle into the SCORM
 * package (`TBTemplate.resolveStartImageUrl`).
 */

/** Key of the illustration property on a start variant. */
export const START_IMAGE_KEY = "image";

/**
 * Unwraps a media value to a plain URL: the envelope `{ url, … }`, a bare string,
 * or `""` when there is nothing usable. The layouts bind a URL string, so every
 * host has to unwrap before rendering.
 */
export function mediaUrlOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const url = (value as { url?: unknown }).url;
    if (typeof url === "string") return url.trim();
  }
  return "";
}

/**
 * The illustration URL for the start screen: the start page's own property wins,
 * the test-wide branding param is the fallback.
 *
 * @param pageSettings `content_pages.settings_json` of the start page (the SCORM
 *   package carries it as `contentPages[].settings`). Absent ⇒ only the param.
 * @param designParams `design_settings_json.params` of the test.
 * @returns A plain URL, or `""` when neither source holds one — the layouts guard
 *   the media block with `{{#if design.startImageUrl}}`, so an empty string reads
 *   as «no illustration» and the variant shows its own empty state.
 */
export function resolveStartImageUrl(
  pageSettings: Record<string, unknown> | null | undefined,
  designParams: Record<string, unknown> | null | undefined,
): string {
  const own = mediaUrlOf(pageSettings ? pageSettings[START_IMAGE_KEY] : null);
  if (own) return own;
  return mediaUrlOf(designParams ? designParams.startImageUrl : null);
}

/** A start variant as the manifest declares it — only the properties are read. */
export interface StartVariantDecl {
  settings?: Array<{ key?: string; type?: string } | null | undefined> | null;
}

/** Does this variant own the illustration, i.e. declare it as a page property? */
export function variantDeclaresStartImage(variant: StartVariantDecl | null | undefined): boolean {
  const settings = variant?.settings;
  if (!Array.isArray(settings)) return false;
  return settings.some((s) => s?.key === START_IMAGE_KEY && s?.type === "image");
}

/**
 * The illustration a PREVIEW of `variant` must show for this page.
 *
 * A page property belongs to the variant that declares it: lending the page's
 * picture to a variant without the property made «Старт: стандартный» preview
 * exactly like «Старт: изображение справа», so switching options in the picker
 * repainted into the same screen and the preview looked frozen.
 *
 * A variant that does NOT declare the property shows NO illustration, even when the
 * test carries the branding one. Feeding it to every start variant made «Старт:
 * стандартный» render the same screen as «Старт: изображение справа», so the picker
 * looked frozen and the author could not tell the two options apart. The picture is
 * a property of the variant that has a place for it — the branding param only fills
 * that property in when the page itself has none (tests configured before it existed).
 *
 * The rule is the same in a RUN and in every preview, so what the author picks is
 * what the learner sees.
 */
export function startImageForVariant(
  variant: StartVariantDecl | null | undefined,
  pageSettings: Record<string, unknown> | null | undefined,
  designParams: Record<string, unknown> | null | undefined,
): string {
  return variantDeclaresStartImage(variant) ? resolveStartImageUrl(pageSettings, designParams) : "";
}
