/**
 * @module shared/recipients/parse-recipient-list
 * @description PRD-28 раздел 16 (FR-25 — FR-28, FR-30): reads a hand-typed
 * recipient list into the SAME rows `parseParticipantsWorkbook` yields, so the
 * classification, the preview table and the run behind them stay single.
 *
 * It lives in `shared/` rather than in the browser because the rows it produces
 * are a contract with the server: the parser and the pipeline that consumes them
 * must not be able to drift, and a rule proven by a unit test here is proven for
 * whoever calls it next.
 */

/** One recipient, in the shape the workbook parser produces. */
export interface RecipientRow {
  /**
   * Position among the entries that were typed, zero-based. A collapsed repeat
   * leaves a GAP here, exactly as a collapsed row of a workbook does — the
   * preview counts entries by the last position and reports the difference.
   */
  index: number;
  email: string;
  name: string | null;
}

/**
 * Cut the text into entries.
 *
 * Newline, `;` and `,` all separate, but neither inside quotes nor inside angle
 * brackets: a mail client hands over `"Петров, Иван" <p@example.com>; …`, and a
 * naive split on the comma would tear that display name in half — precisely the
 * cleanup this feature exists to spare the operator.
 */
function splitEntries(text: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;

  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; current += ch; continue; }
    if (!quoted && ch === "<") { angled = true; current += ch; continue; }
    if (!quoted && ch === ">") { angled = false; current += ch; continue; }
    if (!quoted && !angled && (ch === "\n" || ch === "\r" || ch === ";" || ch === ",")) {
      entries.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  entries.push(current);
  return entries;
}

/** `Имя <адрес>` / `"Имя" <адрес>` / `<адрес>` / `адрес`. */
const ANGLED = /^(.*)<([^<>]*)>$/;

/** Split one entry into an address and the display name in front of it. */
function readEntry(entry: string): { email: string; name: string | null } {
  const trimmed = entry.trim();
  const angled = ANGLED.exec(trimmed);
  if (!angled) return { email: trimmed, name: null };
  const name = angled[1].trim().replace(/^"(.*)"$/, "$1").trim();
  return { email: angled[2].trim(), name: name || null };
}

/**
 * Read a typed list into recipient rows.
 *
 * An entry that is not an address at all is KEPT, verbatim, so that it reaches
 * the preview as an «Некорректный адрес» row: dropping it silently would leave
 * the operator counting recipients to notice that their list was understood only
 * in part. A repeated address collapses on its first occurrence, as in a
 * workbook, and the position it occupied stays behind as a gap in {@link
 * RecipientRow.index}.
 *
 * @param text What the operator typed or pasted.
 * @returns Rows in typing order. No ceiling is applied here — the row limit is a
 *   system setting, and the route that owns it checks it.
 */
export function parseRecipientList(text: string): RecipientRow[] {
  const seen = new Set<string>();
  const rows: RecipientRow[] = [];
  let index = 0;

  for (const entry of splitEntries(text)) {
    if (!entry.trim()) continue;
    const position = index++;
    const { email, name } = readEntry(entry);
    const key = email.toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    rows.push({ index: position, email, name });
  }
  return rows;
}
