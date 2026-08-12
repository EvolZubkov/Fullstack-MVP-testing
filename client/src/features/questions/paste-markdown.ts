/**
 * @module client/features/questions/paste-markdown
 *
 * Paste handling for the question fields: an author who copies from Word, Google
 * Docs or a web page brings HTML on the clipboard, and the field stores plain
 * text with a markdown subset.
 *
 * Dropping the HTML in raw would store tags the learner screen shows as visible
 * characters; taking the clipboard's plain-text flavour instead would silently
 * lose the author's bold and links. So the markup is converted — by the SAME
 * function the Excel import uses ({@link module:shared/text/html-to-markdown}),
 * which is what keeps a pasted question and an imported one identical.
 *
 * The computation is a pure `input -> {value, caret}` so it can be tested without
 * a DOM; the component only reads the clipboard and writes the field.
 */
import type { ClipboardEvent } from "react";
import { looksLikeHtml, htmlToMarkdown } from "@shared/text";

/** The field state a paste applies to, plus the clipboard's HTML flavour. */
export interface PasteInput {
  /** Current field value. */
  value: string;
  /** Selection start (the caret when nothing is selected). */
  selectionStart: number;
  /** Selection end. */
  selectionEnd: number;
  /** The `text/html` clipboard flavour; empty when the source offered none. */
  html: string;
}

/** The value to write and where to leave the caret. */
export interface PasteResult {
  value: string;
  caret: number;
}

/**
 * Compute the field value after pasting clipboard markup.
 *
 * @returns The new value and caret, or `null` when the paste carries nothing the
 *   conversion would change — the caller then lets the browser paste normally,
 *   which yields the same text without a redundant re-render.
 */
export function pasteAsMarkdown(input: PasteInput): PasteResult | null {
  const { html, value, selectionStart, selectionEnd } = input;
  if (!html || !looksLikeHtml(html)) return null;

  const markdown = htmlToMarkdown(html);
  if (!markdown) return null;

  // Nothing but tag noise: the conversion produced exactly the text the default
  // paste would have inserted, so stay out of the way.
  const plain = html.replace(/<[^>]*>/g, "").trim();
  if (markdown === plain) return null;

  const next = value.slice(0, selectionStart) + markdown + value.slice(selectionEnd);
  return { value: next, caret: selectionStart + markdown.length };
}

/**
 * Wire a text field to {@link pasteAsMarkdown}: read the clipboard, write the
 * converted value through the caller's setter, and put the caret back where the
 * pasted fragment ends.
 *
 * Does nothing when the clipboard carries no markup — the browser then pastes as
 * usual, so plain-text copying keeps working exactly as before.
 *
 * @param event The paste event from an `<input>` or `<textarea>`.
 * @param onValue Applies the new value (form setter or state updater).
 */
export function handleMarkdownPaste(
  event: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  onValue: (value: string) => void,
): void {
  const element = event.currentTarget;
  const result = pasteAsMarkdown({
    value: element.value,
    selectionStart: element.selectionStart ?? element.value.length,
    selectionEnd: element.selectionEnd ?? element.value.length,
    html: event.clipboardData.getData("text/html"),
  });
  if (!result) return;

  event.preventDefault();
  onValue(result.value);
  // The value lands through React, so the caret can only be restored after the
  // re-render — otherwise it jumps to the end of the field.
  requestAnimationFrame(() => {
    element.setSelectionRange(result.caret, result.caret);
  });
}
