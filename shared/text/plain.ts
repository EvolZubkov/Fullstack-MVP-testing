/**
 * @module shared/text/plain
 *
 * Plain-text projections of author markdown, in two flavours that differ by who
 * reads the result.
 *
 * {@link stripMarkdown} is for MACHINES: Excel export, content hashing, fitting
 * the font to the longest answer. It removes markup and nothing else, so the text
 * that leaves the service is the text that was stored — an export/import round
 * trip cannot silently rewrite a question and invalidate its content hash.
 *
 * {@link renderPlainText} is for READERS: the review screen and the PDF, which
 * show text without markup but must look like every other learner screen, dashes
 * and guillemets included.
 *
 * Pure `string -> string`, no DOM.
 */
import { renderBlanksText } from "../questions/blanks-render";
import { applyTypography } from "./typography";

/** `[label](url)` — the same shape the renderer accepts. */
const MD_LINK = /\[([^\]\n]+)\]\(([^\s)]+)\)/g;
/** Bold markers. Applied before italics so `**` is never read as two italics. */
const MD_BOLD = /\*\*([^*\n]+)\*\*/g;
/** Italic markers. */
const MD_ITALIC = /\*([^*\n]+)\*/g;

/**
 * Remove markdown markup, changing nothing else. A link collapses to its label;
 * a bare address stays as it was written, because it reads as an address.
 *
 * @param text Author text as stored.
 * @returns The same text without markup.
 */
export function stripMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(MD_LINK, "$1")
    .replace(MD_BOLD, "$1")
    .replace(MD_ITALIC, "$1");
}

/**
 * Remove markdown markup and apply the typography pass — the text form of a
 * learner screen.
 *
 * @param text Author text as stored.
 * @returns Typographically normalised text without markup.
 */
export function renderPlainText(text: string): string {
  if (!text) return "";
  // PRD-57 FR-24i: маркер пропуска не должен утекать туда, где полей ввода нет — в
  // обзор, в PDF-отчёт, в комментарий рецензента. Сырой `{{organ}}` там читается как
  // сбой продукта. Подстановку делает общая функция, одна на все такие места.
  text = renderBlanksText(text, { mode: "dash" });
  return applyTypography(stripMarkdown(text));
}
