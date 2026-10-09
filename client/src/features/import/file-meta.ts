/**
 * @module features/import/file-meta
 *
 * Подписи строки выбранного файла в разделе «Импорт» (Э6 UX-аудита): вид файла, его числа и
 * размер — «книга с вопросами · 4 листа · 48 КБ». Одни правила на все виды, чтобы строка файла
 * читалась одинаково, какой бы файл ни принесли.
 */

/**
 * Число со словом в нужном падеже: «1 строка», «3 строки», «12 строк».
 *
 * @param n количество
 * @param forms три формы: для 1, для 2-4, для 5 и больше
 */
export function plural(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${forms[2]}`;
  if (mod10 === 1) return `${n} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

/**
 * Размер файла: килобайты до мегабайта, дальше мегабайты с одним знаком — «48 КБ», «1,8 МБ».
 *
 * @param bytes размер в байтах
 */
export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${mb.toFixed(1).replace(".", ",")} МБ`;
}

/**
 * Подпись строки файла: части через «·», пустые пропускаются.
 *
 * @param parts вид файла, числа, размер
 */
export function fileMeta(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" · ");
}
