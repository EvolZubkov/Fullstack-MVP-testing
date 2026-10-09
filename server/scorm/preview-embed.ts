/**
 * @module server/scorm/preview-embed
 * @description Shared helpers for embedding standalone preview.html files into
 * iframe modals. Both the template-preview route (PRD-7 S12-G2 / FR-30, sources
 * branding params from query) and the page-preview route (PRD-7 S13.4-G17b /
 * FR-44, sources a single content_page from the DB) wrap the same preview.html
 * into the design-tab/structure-tab dialog: same chrome to hide, same brand
 * @font-face declarations, same `</head>` and `</body>` injection points.
 *
 * The route-specific override script (param defaults vs single-page render) is
 * supplied by the caller as a plain string; this module only owns the CSS
 * overrides and the substitution mechanics.
 */

/**
 * Embed CSS injected into the iframe's <head>. Hides the standalone preview
 * chrome (sidebar, dialog head/foot, caption) so only the staged content area
 * remains, re-registers the DS brand typeface inside the iframe document, and
 * neutralises flex-layout collapses that the standalone shell would normally
 * cause when its sibling chrome is hidden.
 */
export const PREVIEW_EMBED_CSS = `
<style id="prd1-preview-embed-overrides">
  /* DS base typeface (Roboto) - @font-face declarations are scoped per-document,
     so even though the host loads them via vendor/skillum-ds.css, the iframe is a
     separate document and needs its own registration. The variable woff2 files live
     in client/public/fonts/ and are served from the same origin as this iframe;
     one file per unicode subset covers the whole 100-900 weight scale. */
  @font-face { font-family: 'Roboto'; src: url('/fonts/Roboto-latin.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  @font-face { font-family: 'Roboto'; src: url('/fonts/Roboto-latin-ext.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
  @font-face { font-family: 'Roboto'; src: url('/fonts/Roboto-cyrillic.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
  @font-face { font-family: 'Roboto'; src: url('/fonts/Roboto-cyrillic-ext.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F; }
  html, body { background: transparent !important; height: 100% !important; min-height: 0 !important; overflow: hidden !important; width: 100% !important; max-width: none !important; display: block !important; }
  /* Drop the standalone shell's flex layout: hidden chrome (.pv-sidebar / .pv-main)
     would otherwise leave .pv-overlay as a content-sized flex item (~860px),
     producing whitespace to the right of the dialog in the embed iframe.
     'width: 100%; max-width: none' defends against templates that constrain
     body/shell (e.g. rtk-storyline sets 'body { max-width: 51.5625cqw }'). */
  .shell { display: block !important; min-height: 0 !important; height: 100% !important; width: 100% !important; max-width: none !important; }
  .pv-sidebar, .shell > .pv-sidebar { display: none !important; }
  .pv-main { display: none !important; }
  .pv-overlay { position: static !important; padding: 0 !important; background: transparent !important; inset: auto !important; width: 100% !important; height: 100% !important; }
  .pv-dialog { max-width: 100% !important; max-height: 100% !important; height: 100% !important; box-shadow: none !important; border-radius: 0 !important; border: 0 !important; }
  /* Hide standalone-preview chrome that duplicates host-modal UI. */
  .pv-dialog-head, .pv-dialog-foot, .pv-caption { display: none !important; }
  /* Enable vertical scrolling in the stage area. */
  .pv-stage { flex-shrink: 0 !important; max-height: none !important; }
  .pv-stage-wrap { overflow-y: auto !important; }
  /* Align rail typography with the host DS font stack. */
  .pv-nav { font-family: 'Roboto', 'Inter', 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif !important; }
</style>
`;

/**
 * Inserts the embed CSS into `<head>` and an arbitrary script body before
 * `</body>`. The script body is opaque to this helper - the caller wraps it
 * in `<script>...</script>` already and is responsible for safe JSON escaping
 * of any embedded data.
 */
export function injectIntoPreview(html: string, scriptTag: string): string {
  let out = html.replace(/<\/head>/i, `${PREVIEW_EMBED_CSS}</head>`);
  out = out.replace(/<\/body>/i, `${scriptTag}</body>`);
  return out;
}

/**
 * Encodes a JS payload as a JSON literal safe to embed inside a `<script>` tag:
 * neutralises any `</script` sequences that would close the surrounding tag.
 */
export function encodeJsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/<\/script/gi, "<\\/script");
}
