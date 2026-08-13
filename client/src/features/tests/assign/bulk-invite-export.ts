/**
 * @module features/tests/assign/bulk-invite-export
 * @description The links workbook of PRD-28 раздел 7, assembled ON THE CLIENT
 * from the run report the tab already holds.
 *
 * There is no second request for the links, and there cannot be one: only the
 * SHA-256 of an access token is stored, so the raw links exist exactly once —
 * in the response of the run — and only for as long as that response is on the
 * screen. Building the file here is what keeps that window from needing a
 * server-side store of live keys.
 *
 * ExcelJS is pulled in dynamically so its bundle is fetched the first time an
 * operator actually saves a file, and not on every page that can open the
 * assignment dialog.
 */

/** One line of the report the export can draw on (see `bulk-invite-tab`). */
export interface LinksWorkbookRow {
  email: string;
  name: string | null;
  /** Preview status the recipient came in with; rendered as its Russian label. */
  status: string;
  /** Present only when a one-time link was minted for this recipient. */
  magicLink?: string;
  delivered: boolean;
}

export interface LinksWorkbookOptions {
  /** Названиe теста — попадает в свойства книги, чтобы файл не терял контекст. */
  testTitle: string;
  results: readonly LinksWorkbookRow[];
  /**
   * Срок, до которого действуют ссылки, как его задал оператор (ISO или
   * `гггг-мм-дд`). `null` — оператор его не задавал, и книга не выдумывает дату:
   * настоящий срок разрешается на сервере (срок сдачи, иначе +30 дней).
   */
  expiresAt: string | null;
}

/** Column headers, verbatim as the acceptance criteria name them. */
const HEADERS = ["Адрес", "Имя", "Статус", "Ссылка", "Действует до"];

/** Russian label per preview status; an unknown one is passed through as is. */
const STATUS_LABELS: Record<string, string> = {
  new: "Новый",
  external: "Внешний участник",
  learner: "Штатный учащийся",
  privileged: "Аккаунт с правами",
  assigned: "Уже назначен",
};

/**
 * `гггг-мм-дд` (or a full ISO stamp) as `дд.мм.гггг`.
 *
 * Deliberately string surgery rather than `Date.toLocaleDateString`: the value
 * is a calendar date the operator typed, and putting it through a Date would
 * shift it by a day for anyone west of Greenwich.
 */
function formatExpiry(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : value;
}

/**
 * File name for the saved book: the test it belongs to, plus the day it was
 * made. Everything a file system may object to collapses into `_`, so a title
 * with a slash or a quote cannot produce an unsavable name.
 */
export function linksWorkbookFileName(testTitle: string, now: Date = new Date()): string {
  const slug = testTitle
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "test";
  return `links_${slug}_${now.toISOString().slice(0, 10)}.xlsx`;
}

/**
 * Build the workbook of issued links.
 *
 * Only recipients who actually got a one-time link are written: a privileged
 * account is assigned the test but never handed a passwordless way in (rule
 * D-3), and a row with an empty link column would read as a link that failed to
 * arrive. An undelivered letter, on the other hand, IS written — the link is
 * live, and this file is the only way its owner ever gets it.
 *
 * @returns The `.xlsx` bytes, ready to be wrapped in a `Blob` and saved.
 */
export async function buildLinksWorkbook(opts: LinksWorkbookOptions): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.title = opts.testTitle;
  const ws = wb.addWorksheet("Ссылки");
  ws.columns = [{ width: 34 }, { width: 28 }, { width: 20 }, { width: 62 }, { width: 16 }];
  ws.addRow(HEADERS);
  const expiry = formatExpiry(opts.expiresAt);
  for (const row of opts.results) {
    if (!row.magicLink) continue;
    ws.addRow([
      row.email,
      row.name ?? "",
      STATUS_LABELS[row.status] ?? row.status,
      row.magicLink,
      expiry,
    ]);
  }

  // ExcelJS answers with whatever its build calls a buffer: a plain ArrayBuffer,
  // a Node Buffer, or the Uint8Array-backed polyfill of the browser bundle. The
  // caller is promised one shape, so the view is copied out — which also
  // detaches it from any pooled memory behind a Node Buffer.
  const written = (await wb.xlsx.writeBuffer()) as unknown;
  if (written instanceof ArrayBuffer) return written;
  const view = written as Uint8Array;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}
