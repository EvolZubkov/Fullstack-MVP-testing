/**
 * @module server/services/workbook-list-cell
 *
 * List cells of the «Вопросы» sheet: answer options, ranking items, matching sides and
 * «ОС по вариантам» are written into ONE cell, separated by `#`.
 *
 * A `#` inside an item is ordinary author text — an anchor in a link
 * (`https://…/page#section`), «C#», a number sign — so the export writes it as `\#`, and
 * the import splits only on a `#` WITHOUT a backslash in front. Without the escape the
 * round trip cut such an item in two and shifted every correct-answer number after it.
 *
 * Books written before the escape read exactly as before: they contain no `\#`, so every
 * `#` in them is still a separator.
 */

/** A separator: `#` not preceded by a backslash. */
const SEPARATOR = /(?<!\\)#/;

/** An escaped `#` inside an item. */
const ESCAPED = /\\#/g;

/**
 * Escape one item for a list cell.
 *
 * @param text Item text as stored.
 * @returns The text with every `#` written as `\#`.
 */
export function escapeListItem(text: string): string {
  return text.replace(/#/g, "\\#");
}

/**
 * Join items into a list cell.
 *
 * @param items Item texts as stored.
 * @param separator Separator between items; `#` with optional spaces around it.
 * @returns The cell value.
 */
export function joinListCell(items: readonly string[], separator = "#"): string {
  return items.map(escapeListItem).join(separator);
}

/**
 * Split a list cell into SLOTS on unescaped `#`, keeping empty slots and the spaces
 * around them. For cells where position matters more than content: an empty slot of
 * «ОС по вариантам» means «this option has no text of its own».
 *
 * @param cell The cell value.
 * @returns Slots with `\#` turned back into `#`.
 */
export function splitListCell(cell: string): string[] {
  return cell.split(SEPARATOR).map((part) => part.replace(ESCAPED, "#"));
}

/**
 * Read a list of items: split on unescaped `#`, or on `|` when the cell has no `#`
 * separator at all (the legacy spelling), trim each item and drop empty ones.
 *
 * @param cell The cell value.
 * @returns Non-empty items with `\#` turned back into `#`.
 */
export function readListCell(cell: string): string[] {
  const parts = SEPARATOR.test(cell)
    ? splitListCell(cell)
    : cell.split("|").map((part) => part.replace(ESCAPED, "#"));
  return parts.map((part) => part.trim()).filter(Boolean);
}
