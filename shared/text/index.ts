/**
 * @module shared/text
 *
 * Author-text pipeline shared by both runtime hosts (PRD-12 unified rendering):
 * the web player imports it directly, the SCORM package gets it through the
 * `TBTemplate` runtime bundle. One implementation, so a question prompt reads the
 * same in the browser and in the LMS.
 *
 * What the author types stays PLAIN TEXT in the database — markdown markers and
 * nothing else. Markup is produced at render time, from a fixed set of tags, and
 * the author's own text is escaped before any of them is generated. Nothing
 * downstream has to trust the stored value.
 *
 * Pick the entry point by where the value lands:
 *   - {@link renderInlineMarkdown} — heading or answer option (no block tags);
 *   - {@link renderBlockMarkdown} — block container, e.g. a page text field;
 *   - {@link renderPlainText} — screens that show text only (review, PDF);
 *   - {@link stripMarkdown} — machine paths (export, hashing, font metrics);
 *   - {@link escapeHtml} — raw interpolation of a value that carries no markdown.
 */
export { escapeHtml } from "./escape";
export { normalizeAuthorText } from "./normalize";
export { looksLikeHtml, htmlToMarkdown } from "./html-to-markdown";
export { applyTypography } from "./typography";
export { renderInlineMarkdown, renderBlockMarkdown } from "./markdown";
export { stripMarkdown, renderPlainText } from "./plain";
