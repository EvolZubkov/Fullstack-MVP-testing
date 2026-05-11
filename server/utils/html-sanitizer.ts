/**
 * @module server/utils/html-sanitizer
 * @description Lightweight server-side HTML sanitizer for richText and html placeholder values.
 * Strips known XSS vectors: script tags, iframe tags, on* event handlers, and javascript: URIs.
 * Does not depend on a DOM — safe for use in Node.js.
 */

/** Strips script tags and their content, iframe tags, on* event handlers, and javascript: URIs. */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<(object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(object|embed|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(/(href|src)\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '$1="#"')
    .replace(/\s(src|href)\s*=\s*(["'])https?:\/\/[^"']*\2/gi, "")
    .replace(/\s(src|href)\s*=\s*https?:\/\/[^\s>]*/gi, "");
}

/**
 * Sanitizes all richText and html fields within a values record,
 * based on the placeholder type definitions from a template manifest.
 */
export function sanitizeValues(
  values: Record<string, unknown>,
  placeholders: Array<{ key: string; type: string }>,
): Record<string, unknown> {
  const result = { ...values };
  for (const ph of placeholders) {
    if (ph.type === "richText" || ph.type === "html") {
      const v = result[ph.key];
      if (typeof v === "string") {
        result[ph.key] = sanitizeHtml(v);
      }
    }
  }
  return result;
}
