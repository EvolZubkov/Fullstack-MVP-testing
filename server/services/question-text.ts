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
import { normalizeAuthorText, looksLikeHtml, htmlToMarkdown, normalizeAuthorHtml } from "@shared/text";
import { sanitizeHtmlWithDiagnostics, type SanitizeRemoval } from "@shared/security/html-sanitize";
import { isMarkupFormat, type PromptFormat } from "@shared/questions/prompt-format";

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
  /**
   * The value this field holds now, when the incoming text may be its own export
   * coming back. If the incoming text equals it up to the canonical whitespace, it is
   * stored as is and `convertHtml` does not apply: the author's own text is not foreign
   * markup, and a tag they wrote on purpose must survive the round trip through the book.
   */
  stored?: unknown;
};

/** Code spans and fenced blocks: their content is literal, never markup to convert. */
const CODE_SPANS = /```[\s\S]*?```|`[^`\n]+`/g;

/** Placeholder of a parked code span; differs from the one `normalizeAuthorText` uses. */
const PARKED = /\u0000k(\d+)\u0000/g;

/**
 * Bring one incoming text value to its stored form: markup converted when the
 * caller asked for it, canonical whitespace always.
 *
 * Code spans and fenced blocks are parked before the markup check and the conversion:
 * `<div>` inside a listing is what the listing shows, and converting it would strip the
 * very tags the question asks about.
 */
export function normalizeIncomingText(value: string, options?: TextNormalizeOptions): string {
  if (!options?.convertHtml) return normalizeAuthorText(value);

  const plain = normalizeAuthorText(value);
  if (typeof options.stored === "string" && plain === normalizeAuthorText(options.stored)) return plain;

  const parked: string[] = [];
  const masked = value.replace(CODE_SPANS, (code) => {
    parked.push(code);
    return `\u0000k${parked.length - 1}\u0000`;
  });
  if (!looksLikeHtml(masked)) return plain;
  return htmlToMarkdown(masked).replace(PARKED, (_whole, index: string) => parked[Number(index)]);
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
 *
 * @param dataJson Incoming payload.
 * @param options How each text is normalised (`stored` is ignored here).
 * @param stored The `dataJson` the question holds now: each element is compared with
 *   the stored element at the same position of the same collection (see
 *   {@link TextNormalizeOptions.stored}).
 */
export function normalizeQuestionData<T>(dataJson: T, options?: TextNormalizeOptions, stored?: unknown): T {
  if (!dataJson || typeof dataJson !== "object" || Array.isArray(dataJson)) return dataJson;

  const source = dataJson as Record<string, unknown>;
  const previous = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...source };
  for (const key of TEXT_COLLECTIONS) {
    const collection = source[key];
    if (!Array.isArray(collection)) continue;
    const before = Array.isArray(previous[key]) ? (previous[key] as unknown[]) : [];
    result[key] = collection.map((item, i) =>
      typeof item === "string" ? normalizeIncomingText(item, { ...options, stored: before[i] }) : item,
    );
  }
  return result as T;
}

/**
 * Привести текст задания к хранимой форме ПО ЕГО ФОРМАТУ (PRD-57 §4.3).
 *
 * У разметки это прежний проход: канонические пробелы и типографика по строке. У текста,
 * написанного разметкой (`richText`, `html`), — сначала санитайзер, потом тот же проход, но
 * ПО ТЕКСТОВЫМ УЗЛАМ: типографика не должна заходить внутрь тега, значения атрибута,
 * `<pre>` и `<code>`, где каждый символ значим (FR-09d, тем же правилом, что бережёт
 * листинг и имя пропуска).
 *
 * Второй реализации ни санитайзера, ни типографики здесь не появляется: обе взяты у полей
 * страницы, которые ходят той же дорогой (`content-page-fields`).
 *
 * @param prompt Текст как его прислал редактор.
 * @param format Формат задания; отсутствие читается как разметка.
 * @returns Хранимая форма текста и то, что вырезал санитайзер (пусто у разметки).
 */
export function normalizePromptByFormat(
  prompt: string,
  format: PromptFormat,
): { prompt: string; removed: SanitizeRemoval[] } {
  if (!isMarkupFormat(format)) return { prompt: normalizeAuthorText(prompt), removed: [] };
  const { value, removed } = sanitizeHtmlWithDiagnostics(prompt);
  return { prompt: normalizeAuthorHtml(value), removed };
}
