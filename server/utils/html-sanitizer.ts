/**
 * @module server/utils/html-sanitizer
 * @description Back-compat re-export. The sanitiser itself now lives in
 * `shared/security/html-sanitize` so BOTH sides apply the same rules: the server
 * on save and on package build, and the editor when normalising a pasted
 * fragment (PRD-22 FR-34). Two copies of these rules would drift, and the author
 * would be told at save time about markup the editor had accepted moments ago.
 */
export {
  sanitizeHtml,
  sanitizeHtmlWithDiagnostics,
  sanitizeValues,
  sanitizeValuesWithDiagnostics,
  type SanitizeRemoval,
  type SanitizeDiagnostics,
} from "@shared/security/html-sanitize";
