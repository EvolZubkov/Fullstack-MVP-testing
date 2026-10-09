/**
 * @module shared/template/rich-text
 *
 * Авторский текст → разметка, которую печатает макет через `{{& … }}`.
 *
 * ЗАЧЕМ. Обратная связь теста, толкование уровня шкалы и исход показателя пишутся в
 * редакторе, который с PRD-7 предлагает автору ТРИ формата: «Обычный», «Форматированный»
 * и «HTML» (`feedbackContentSchema.format`). Формат доезжал до базы и там оставался: до
 * выдачи ехал один голый `text`, макеты печатали его экранированной строкой, и слушатель
 * получал методичку одним сплошным абзацем — а автор был уверен, что оформил её.
 *
 * ПОЛИТИКА РАЗМЕТКИ повторяет ту, что продукт уже применяет к полям контентной страницы
 * (`renderPlaceholder` в {@link module:shared/template/render-screen}):
 *
 * - `plain` — экранируется, переводы строк становятся `<br>`. Абзацы автора сохраняются,
 *   разметка в тексте показывается текстом, как он её и написал;
 * - `richText` и `html` — печатаются как есть. Источник тот же самый — автор теста, — и
 *   разной трактовки одного источника в двух местах продукта быть не должно.
 *
 * САНИТАЙЗЕРА ЗДЕСЬ НЕТ, и это не упущение: сырую разметку автора продукт уже вставляет
 * на контентных страницах тем же способом. Появится он — появится для обоих мест сразу,
 * потому что оба зовут этот модуль.
 *
 * Чистый модуль: ни DOM, ни Node.
 */

/** Формат, в котором автор написал текст (`feedbackContentSchema.format`). */
export type RichTextFormat = "plain" | "richText" | "html";

/** Экранирование под вставку в разметку — те же символы, что бережёт DSL. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Разметка авторского текста, готовая для `{{& … }}`.
 *
 * @param text Текст как его написал автор.
 * @param format Формат из `feedback_json`. Отсутствие = `plain`: так приходят и старые
 *   записи, и всякий хост, который про формат ещё не знает, — и для них поведение
 *   остаётся прежним, с точностью до сохранённых переводов строк.
 * @returns HTML-строка; пустая, когда печатать нечего.
 */
export function richTextToHtml(text: unknown, format?: RichTextFormat | null): string {
  const source = typeof text === "string" ? text : "";
  if (!source.trim()) return "";
  if (format === "richText" || format === "html") return source;
  return escapeHtml(source).replace(/\r\n|\r|\n/g, "<br>");
}

/** Closing tags that end a visual block — each becomes a line break. */
const BLOCK_END = /<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|section|article|tr|figure)\s*>/gi;

/** Explicit line break. */
const LINE_BREAK = /<br\s*\/?>/gi;

/** Anything else in angle brackets — dropped, its text content stays. */
const ANY_TAG = /<[^>]*>/g;

/**
 * Named entities the author's editor can produce. A short closed table on purpose:
 * the module is dependency-free, and an unknown name is left as written rather than
 * guessed at.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…",
};

/** Expands `&amp;`, `&#1090;` and `&#x43f;`; leaves an unknown name as it stands. */
function decodeEntities(value: string): string {
  return value.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Author's text as a reader without markup sees it: the e-mail's text part, the
 * package's XML metadata, the editor's mode switch.
 *
 * Line breaks are the point of this function. Stripping tags through `textContent`
 * glues paragraphs into one line, and an author who laid a description out in three
 * paragraphs gets a single run of words in the letter — which is exactly the defect
 * this closes.
 *
 * @param text Author's text.
 * @param format Its format. Absent or `plain` = already plain: returned as written.
 * @returns Plain text; empty when there is nothing to print.
 */
export function richTextToPlain(text: unknown, format?: RichTextFormat | null): string {
  const source = typeof text === "string" ? text : "";
  if (!source.trim()) return "";
  if (format !== "richText" && format !== "html") return source;
  const broken = source.replace(LINE_BREAK, "\n").replace(BLOCK_END, "\n");
  return decodeEntities(broken.replace(ANY_TAG, ""))
    .replace(/\r\n|\r/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Default cut for the learner card's subtitle (PRD-59 FR-21). */
export const ONE_LINE_LIMIT = 120;

/**
 * Author's text as an INDEX ENTRY: one line, no markup, no line breaks, cut to
 * length. The learner's test card is the only consumer.
 *
 * The card is not a reading surface. Its list is laid out as a grid, and a grid row
 * takes the height of its tallest card — so one long description lifts the whole row.
 * Cutting by LENGTH rather than by rendered lines keeps the result independent of the
 * card's width and of how a browser counts lines inside nested blocks.
 *
 * @param text Author's text.
 * @param format Its format.
 * @param limit Characters to keep; the ellipsis is added on top of it.
 * @returns One line, ending in an ellipsis when something was dropped.
 */
export function richTextToOneLine(
  text: unknown,
  format?: RichTextFormat | null,
  limit: number = ONE_LINE_LIMIT,
): string {
  const flat = richTextToPlain(text, format).replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return head.replace(/[\s.,;:!?-]+$/u, "") + "…";
}
