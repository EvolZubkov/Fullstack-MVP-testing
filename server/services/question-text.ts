/**
 * @module server/services/question-text
 *
 * Write-path normalisation of question texts, shared by the question routes and
 * the Excel import so both store the same canonical form (see
 * {@link module:shared/text/normalize} for what canonical means and why it is
 * only the invisible part of the text).
 *
 * In the import path this MUST run before the content hash is computed:
 * the hash is what deduplicates imported questions and what pins a published
 * snapshot, so hashing a value that the write path is about to rewrite would
 * produce a hash no stored row can ever match again.
 */
import { normalizeAuthorText, looksLikeHtml, htmlToMarkdown } from "@shared/text";

/** Answer collections whose elements are author text, by question type. */
const TEXT_COLLECTIONS = ["options", "items", "left", "right"] as const;

/** How a single text value is brought to its stored form. */
export type TextNormalizeOptions = {
  /**
   * Convert incoming markup into the markdown subset instead of storing it as
   * literal characters. Set on the IMPORT path, where cells produced by other
   * systems carry `<b>`/`<br>`/Word noise the author never typed. Off in the
   * editor, where the paste handler has already converted what the author pasted.
   */
  convertHtml?: boolean;
};

/**
 * Bring one incoming text value to its stored form: markup converted when the
 * caller asked for it, canonical whitespace always.
 */
export function normalizeIncomingText(value: string, options?: TextNormalizeOptions): string {
  if (options?.convertHtml && looksLikeHtml(value)) return htmlToMarkdown(value);
  return normalizeAuthorText(value);
}

/**
 * Normalise a text field of a partial update.
 *
 * `undefined` and `null` pass through unchanged: on a PUT they mean «field not
 * sent» and «clear the field», and normalising either into an empty string would
 * silently wipe stored content.
 */
export function normalizeOptionalText<T>(value: T): T | string {
  if (typeof value !== "string") return value;
  return normalizeAuthorText(value);
}

/**
 * Normalise the author texts inside a question's `dataJson` — the answer options,
 * ranking items or matching sides — leaving every other field of the payload as
 * it was. A value that is not an object is returned untouched.
 */
export function normalizeQuestionData<T>(dataJson: T, options?: TextNormalizeOptions): T {
  if (!dataJson || typeof dataJson !== "object" || Array.isArray(dataJson)) return dataJson;

  const source = dataJson as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };
  for (const key of TEXT_COLLECTIONS) {
    const collection = source[key];
    if (!Array.isArray(collection)) continue;
    result[key] = collection.map((item) =>
      typeof item === "string" ? normalizeIncomingText(item, options) : item,
    );
  }
  return result as T;
}
