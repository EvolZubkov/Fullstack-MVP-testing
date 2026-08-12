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
  /* DS brand typeface (RostelecomBasis) - @font-face declarations are scoped
     per-document, so even though the host loads them via vendor/university-rt.css,
     the iframe is a separate document and needs its own registration. Files live
     in client/public/fonts/ and are served from the same origin as this iframe. */
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Light.woff2') format('woff2'),   url('/fonts/RostelecomBasis-Light.woff') format('woff'),   url('/fonts/RostelecomBasis-Light.otf') format('opentype');   font-weight: 300; font-style: normal; font-display: swap; }
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Regular.woff2') format('woff2'), url('/fonts/RostelecomBasis-Regular.woff') format('woff'), url('/fonts/RostelecomBasis-Regular.otf') format('opentype'); font-weight: 400; font-style: normal; font-display: swap; }
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Medium.woff2') format('woff2'),  url('/fonts/RostelecomBasis-Medium.woff') format('woff'),  url('/fonts/RostelecomBasis-Medium.otf') format('opentype');  font-weight: 500; font-style: normal; font-display: swap; }
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Bold.woff2') format('woff2'),    url('/fonts/RostelecomBasis-Bold.woff') format('woff'),    url('/fonts/RostelecomBasis-Bold.otf') format('opentype');    font-weight: 700; font-style: normal; font-display: swap; }
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
  .pv-nav { font-family: 'RostelecomBasis', 'Inter', 'Manrope', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important; }
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
