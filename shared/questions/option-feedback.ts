/**
 * @module shared/questions/option-feedback
 *
 * Feedback texts bound to individual answer options of a single-choice question
 * (`questions.option_feedback_json`). An option's text OVERRIDES the question's own
 * feedback for the learner who picked that option; an option without a text falls back
 * to the question's rule (general text or the correct/incorrect branch). The verdict
 * itself never changes — only the explanation under it.
 *
 * Storage shape: an array aligned BY POSITION with `data_json.options`; `null` (or a
 * missing tail) means «no override for this option». The whole column is `NULL` when no
 * option carries a text, so questions that never used the feature keep an empty column
 * and baked packages stay byte-identical.
 *
 * Why a column of its own and not a field inside `data_json`: the PRD-66 fingerprint is
 * computed over `data_json`, and editing an explanation must not break a psychometric
 * observation series — the measured instrument did not change.
 *
 * Scope is deliberately ONE question type (`single`). Every other type stores `NULL`.
 *
 * Pure and framework-free: the server, the web host and the SCORM runtime bundle all
 * import it, so the three agree on which text a learner sees.
 */

/** The only question type option feedback applies to. */
export const OPTION_FEEDBACK_TYPE = "single";

/** Stored value: one entry per option, `null` = no override for that option. */
export type OptionFeedback = Array<string | null>;

/**
 * Bring an incoming value to its stored form.
 *
 * - a type other than {@link OPTION_FEEDBACK_TYPE} stores nothing;
 * - entries that are not strings, or are blank after `normalizeText`, become `null`;
 * - entries past `optionCount` are dropped — they would belong to no option;
 * - trailing `null`s are trimmed, and an array with no text left becomes `null`.
 *
 * @param value - Raw value from a request, an import row or the editor state.
 * @param type - Question type the value is saved with.
 * @param optionCount - Number of options the question is saved with.
 * @param normalizeText - Author-text canonicalisation applied to every entry
 *   (the server passes its `normalizeAuthorText`); identity trimming by default.
 * @returns The stored form, or `null` when nothing is left to store.
 */
export function normalizeOptionFeedback(
  value: unknown,
  type: string | null | undefined,
  optionCount: number,
  normalizeText: (text: string) => string = (text) => text.trim(),
): OptionFeedback | null {
  if (type !== OPTION_FEEDBACK_TYPE || !Array.isArray(value)) return null;
  const limit = Math.max(0, Math.min(value.length, optionCount));
  const entries: OptionFeedback = [];
  for (let i = 0; i < limit; i++) {
    const raw = value[i];
    const text = typeof raw === "string" ? normalizeText(raw) : "";
    entries.push(text.trim() === "" ? null : text);
  }
  while (entries.length > 0 && entries[entries.length - 1] === null) entries.pop();
  return entries.length > 0 ? entries : null;
}

/**
 * Number of answer options in a question's `data_json`; `0` for any other shape.
 *
 * @param dataJson - The question's `data_json`.
 * @returns Length of `options`, or `0`.
 */
export function optionCountOf(dataJson: unknown): number {
  if (!dataJson || typeof dataJson !== "object") return 0;
  const options = (dataJson as { options?: unknown }).options;
  return Array.isArray(options) ? options.length : 0;
}

/**
 * The override text for one option, or `null` when that option has none.
 *
 * @param value - The stored column (any shape is tolerated: a legacy or foreign row
 *   must not crash the learner screen).
 * @param optionIndex - ORIGINAL position of the chosen option in `data_json.options`,
 *   never its position on screen after shuffling.
 * @returns The text to show instead of the question's feedback, or `null`.
 */
export function optionFeedbackAt(value: unknown, optionIndex: number | null | undefined): string | null {
  if (!Array.isArray(value)) return null;
  if (typeof optionIndex !== "number" || !Number.isInteger(optionIndex) || optionIndex < 0) return null;
  const text = value[optionIndex];
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/**
 * Whether the stored column carries at least one override text.
 *
 * @param value - The stored column.
 * @returns `true` when some option has a non-blank text.
 */
export function hasOptionFeedback(value: unknown): boolean {
  return Array.isArray(value) && value.some((text) => typeof text === "string" && text.trim() !== "");
}
