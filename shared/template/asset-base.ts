/**
 * @module shared/template/asset-base
 *
 * PRD-22 FR-36: resolving RELATIVE links in author content against the template's
 * files.
 *
 * The author may reference the template's own assets exactly as they sit in the
 * package — `<img src="images/diagram.png">`. That single path cannot work on
 * both hosts as written: inside the SCORM package the template lives under
 * `template/`, while the web host serves it from its own route. So the value is
 * stored verbatim and the BASE is applied at render time, per host.
 *
 * Only relative references are touched. Absolute paths (`/uploads/media/…` —
 * author media), `data:` URIs, anchors, and protocol links are left alone;
 * external `http(s)` links never reach here because the sanitiser removes them.
 *
 * Framework-free and browser-safe: bundled verbatim into the SCORM package.
 */

/** Attributes whose value may point at a template asset. */
const URL_ATTRS = /\s(src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;

/** True when the reference is already absolute or otherwise host-independent. */
function isAbsoluteRef(url: string): boolean {
  const v = url.trim();
  if (v === "") return true;
  return (
    v.startsWith("/") ||
    v.startsWith("#") ||
    v.startsWith("data:") ||
    v.startsWith("blob:") ||
    // Any scheme: http(s), mailto, tel — the sanitiser handles what is allowed.
    /^[a-z][a-z0-9+.-]*:/i.test(v)
  );
}

/** Joins `base` and `path` with exactly one slash. */
function joinBase(base: string, path: string): string {
  if (!base) return path;
  return base.endsWith("/") ? base + path.replace(/^\/+/, "") : `${base}/${path.replace(/^\/+/, "")}`;
}

/**
 * Rewrites relative `src`/`href` references in a fragment of author HTML so they
 * point at the template's assets on THIS host.
 *
 * `base` is the host's template-assets prefix: `template/` inside a SCORM
 * package, the template-assets route on the web. An empty base returns the input
 * untouched, so a caller without a base degrades to today's behaviour instead of
 * mangling links.
 */
export function withTemplateAssetBase(html: string, base: string): string {
  if (!html || !base) return html;
  return html.replace(URL_ATTRS, (match, attr: string, _quoted: string, dq?: string, sq?: string) => {
    const url = dq !== undefined ? dq : (sq ?? "");
    if (isAbsoluteRef(url)) return match;
    const quote = dq !== undefined ? '"' : "'";
    return ` ${attr}=${quote}${joinBase(base, url)}${quote}`;
  });
}

/**
 * Applies {@link withTemplateAssetBase} to every string value of a content page.
 * Non-string values (image envelopes, resultField objects) pass through: an
 * `image` placeholder stores a plain URL that is either absolute author media or
 * — when it points at a template asset — resolved the same way.
 */
export function withTemplateAssetBaseInValues(
  values: Record<string, unknown> | null | undefined,
  base: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(values ?? {}) };
  if (!base) return out;
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = withTemplateAssetBase(value, base);
  }
  return out;
}
