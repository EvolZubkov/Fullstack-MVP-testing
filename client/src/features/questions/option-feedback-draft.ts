/**
 * @module features/questions/option-feedback-draft
 *
 * Editor state of per-option feedback texts (single choice). Each option row carries a
 * switch «Переопределить обратную связь» and, while it is on, a text field. The draft
 * keeps the switch and the text apart, so turning the switch off and on again does not
 * throw away what the author typed; only saving drops the text of a switched-off option.
 *
 * The draft list is aligned BY POSITION with the editor's option list. Every operation
 * that reorders or removes options must be mirrored here, otherwise a text silently ends
 * up under a neighbouring option — these helpers are the one place that does it.
 *
 * Pure functions, no React: the drawer holds the array in state and calls these.
 */
/** One option's draft: whether the override is switched on, and its text. */
export interface OptionFeedbackDraft {
  on: boolean;
  text: string;
}

const OFF: OptionFeedbackDraft = { on: false, text: "" };

/**
 * Draft entry at a position; a position past the end reads as «switched off».
 *
 * @param drafts - Current draft list.
 * @param index - Option position.
 * @returns The entry, never `undefined`.
 */
export function draftAt(drafts: OptionFeedbackDraft[], index: number): OptionFeedbackDraft {
  return drafts[index] ?? OFF;
}

/**
 * Drafts from the stored column: an option with a text starts switched on.
 *
 * @param stored - `questions.option_feedback_json` (any shape is tolerated).
 * @returns Draft list (may be shorter than the option list).
 */
export function draftsFromStored(stored: unknown): OptionFeedbackDraft[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((text) =>
    typeof text === "string" && text.trim() !== "" ? { on: true, text } : OFF,
  );
}

/**
 * Replace one option's draft.
 *
 * @param drafts - Current draft list.
 * @param index - Option position.
 * @param patch - Fields to change.
 * @returns New draft list.
 */
export function updateDraft(
  drafts: OptionFeedbackDraft[],
  index: number,
  patch: Partial<OptionFeedbackDraft>,
): OptionFeedbackDraft[] {
  const next = drafts.slice();
  for (let i = next.length; i < index; i++) next[i] = OFF;
  next[index] = { ...draftAt(drafts, index), ...patch };
  return next;
}

/**
 * Mirror an option move (drag and drop) so the text travels with its option.
 *
 * @param drafts - Current draft list.
 * @param optionCount - Number of options before the move.
 * @param from - Source position.
 * @param to - Target position.
 * @returns New draft list.
 */
export function moveDraft(
  drafts: OptionFeedbackDraft[],
  optionCount: number,
  from: number,
  to: number,
): OptionFeedbackDraft[] {
  // Same splice the drawer applies to the option list itself.
  const next = Array.from({ length: Math.max(optionCount, drafts.length) }, (_, i) => draftAt(drafts, i));
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Mirror an option removal: the removed option's text goes with it.
 *
 * @param drafts - Current draft list.
 * @param index - Removed position.
 * @returns New draft list.
 */
export function removeDraft(drafts: OptionFeedbackDraft[], index: number): OptionFeedbackDraft[] {
  return drafts.filter((_, i) => i !== index);
}

/**
 * The value to send on save, aligned with the options that are actually saved.
 *
 * The editor drops blank options before saving, so the texts are filtered with the SAME
 * mask — otherwise every text after a blank option would shift onto its neighbour.
 * A switched-off or empty entry becomes `null`; no text at all yields `null`.
 *
 * @param options - Option texts as edited (blank ones included).
 * @param drafts - Draft list aligned with `options`.
 * @returns Array aligned with the saved options, or `null`.
 */
export function storedFromDrafts(options: string[], drafts: OptionFeedbackDraft[]): Array<string | null> | null {
  const kept: Array<string | null> = [];
  options.forEach((option, i) => {
    if (!option.trim()) return;
    const draft = draftAt(drafts, i);
    const text = draft.text.trim();
    kept.push(draft.on && text ? text : null);
  });
  return kept.some((text) => text !== null) ? kept : null;
}
