/**
 * @module shared/report/report-assets
 *
 * PRD-27 FR-05 — where the report page's pictures come from.
 *
 * They come from the TEMPLATE. A report variant declares its background, logo and any
 * decorative image as ordinary `settings[]` fields of type `image` whose `default` is a
 * path INSIDE the template package; the test author may replace any of them with their
 * own media. Nothing about `pdf-bg-*.png` or `logo-light.png` is known to the product
 * code any more: before this, the report always printed one of three plates and the
 * «онлайн университет» logo, so a certification test shipped a stranger's branding.
 *
 * Two shapes of value therefore reach the report, and they resolve differently:
 *
 *  - the author's media (`{ url: "/uploads/media/x.png" }`, or a plain absolute URL) —
 *    already addressable, taken as is;
 *  - a template-relative path (`assets/report/bg.png`) — addressable only against the
 *    host's own base, because the same file lives at `template/…` inside a SCORM package
 *    and behind `/api/templates/<id>/assets/…` on the web.
 *
 * Both hosts resolve through the SAME function, or the report would print a picture in
 * the LMS and a broken image in the browser.
 *
 * Pure module: no DOM, no Node, no filesystem. Turning the resolved URLs into data URLs
 * needs a live browser and lives in {@link module:shared/report/export-pdf}.
 */

import type { SettingType } from "../template/field-types";
import type { ReportVariantDecl } from "./report-variants";

/** The one `settings[]` type that carries a picture (`SETTING_TYPES`, §8.2.1). */
const IMAGE_TYPE: SettingType = "image";

/** A value that is already addressable is left alone; everything else is a template path. */
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

/**
 * Keys of the variant's `settings[]` that carry an image.
 *
 * The host needs them twice: to resolve template paths into URLs, and to know which
 * values to inline as data URLs before rasterizing. Declaration order is kept so a
 * layout author reading the manifest sees the same order everywhere.
 *
 * @param variant Report variant declaration; `null` when the template declares none.
 * @returns Field keys, in declaration order.
 */
export function reportImageKeys(variant: ReportVariantDecl | null | undefined): string[] {
  const list = Array.isArray(variant?.settings) ? (variant?.settings as Array<Record<string, unknown>>) : [];
  const out: string[] = [];
  for (const field of list) {
    if (field?.type === IMAGE_TYPE && typeof field?.key === "string" && field.key) out.push(field.key);
  }
  return out;
}

/**
 * Resolve ONE image value into a URL the host can fetch.
 *
 * @param value Raw value: an author media envelope, a URL, or a template-relative path.
 * @param assetBase Where the template's own files live for this host, with a trailing
 *   slash (`template/` inside a package, `/api/templates/<id>/assets/` on the web).
 * @returns A URL, or an empty string when there is nothing to show — an absent picture
 *   is not an error, the layout simply gates the row on it.
 */
export function resolveReportImageValue(value: unknown, assetBase: string): string {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { url?: unknown }).url
      : value;
  const src = typeof raw === "string" ? raw.trim() : "";
  if (!src) return "";
  if (ABSOLUTE_URL.test(src)) return src;
  // A template path. `./` is noise; `../` would address files outside the template, so
  // it is dropped rather than passed on to a host that would have to defend itself.
  const rel = src.replace(/^\.\//, "");
  if (rel.split(/[\\/]/).some((seg) => seg === "..")) return "";
  return assetBase + rel;
}

/**
 * Resolve every image field of a report variant's values.
 *
 * @param values Values as {@link module:shared/report/report-variants resolveReportValues}
 *   produced them (author's input merged over the manifest defaults).
 * @param imageKeys Keys to resolve — see {@link reportImageKeys}.
 * @param assetBase Host's base for template files, with a trailing slash.
 * @returns A copy of `values` with those keys replaced by URL strings.
 */
export function resolveReportImageValues(
  values: Record<string, unknown> | null | undefined,
  imageKeys: readonly string[],
  assetBase: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(values ?? {}) };
  for (const key of imageKeys) {
    out[key] = resolveReportImageValue(out[key], assetBase);
  }
  return out;
}
