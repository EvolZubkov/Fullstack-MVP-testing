function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Author text (question prompt, feedback) as HTML: the markdown subset plus the
 * typography pass, rendered by the SHARED pipeline the web host uses
 * (`TBTemplate.renderInlineMarkdown`). Inline only — the prompt lands in the
 * scene's heading.
 *
 * Falls back to plain escaping when the shared bundle is absent, so a package
 * built before the pipeline existed still renders its text, just without markup.
 *
 * @param {string} text author text as stored
 * @returns {string} HTML
 */
function authorTextHtml(text) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (TB && typeof TB.renderInlineMarkdown === 'function') {
    return TB.renderInlineMarkdown(text == null ? '' : String(text));
  }
  return escapeHtml(text);
}

/**
 * Author text as PLAIN text — markdown markers removed, typography applied.
 * Used where the value is not rendered but reported: the `description` of an LMS
 * interaction, which lands in someone's report and must not carry `**`.
 *
 * @param {string} text author text as stored
 * @returns {string} plain text
 */
function authorTextPlain(text) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (TB && typeof TB.renderPlainText === 'function') {
    return TB.renderPlainText(text == null ? '' : String(text));
  }
  return text == null ? '' : String(text);
}
