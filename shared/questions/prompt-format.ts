/**
 * @module shared/questions/prompt-format
 *
 * Формат, в котором написан текст задания (PRD-57 §4.3).
 *
 * Текст задания перестал быть всегда разметкой: автор набирает его в одном из трёх режимов —
 * «Разметка», «Форматированный», «HTML», — и формат хранится рядом с текстом.
 *
 * Написание повторяет то, что в продукте уже принято для авторских текстов
 * (`feedbackContentSchema.format` у обратной связи, `tests.description_format` у описания
 * теста): второй словарь форматов — это способ завести два разных «Форматированных» и
 * однажды показать автору не тот редактор.
 *
 * `richText` и `html` хранят ОДНО И ТО ЖЕ — разметку. Различаются они не данными, а тем,
 * каким редактором автор её правит, и помнить это надо: набравший текст визуально должен
 * вернуться в визуальный редактор, а не в поле с тегами.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */
import { htmlToMarkdown } from "../text/html-to-markdown";
import { renderPlainText, stripMarkdown } from "../text/plain";

/** Режимы ввода текста задания, в порядке переключателя. */
export const PROMPT_FORMATS = ["markdown", "richText", "html"] as const;

export type PromptFormat = (typeof PROMPT_FORMATS)[number];

/** Задание в том виде, в каком его читают хосты и сервер. */
export interface FormattedPrompt {
  promptFormat?: unknown;
}

/**
 * Формат задания.
 *
 * @param question Вопрос из хранилища, из книги или из черновика редактора.
 * @returns Один из трёх режимов; всё непонятное — разметка.
 *
 * Умолчание не косметическое: заданий, написанных до §4.3, тысячи, и у них колонки нет
 * вовсе. Прочитать их как разметку — единственный способ ничего им не изменить.
 */
export function promptFormatOf(question: FormattedPrompt | null | undefined): PromptFormat {
  const value = question?.promptFormat;
  return (PROMPT_FORMATS as readonly unknown[]).indexOf(value) >= 0
    ? (value as PromptFormat)
    : "markdown";
}

/**
 * Хранится ли текст РАЗМЕТКОЙ (а не подмножеством markdown)?
 *
 * По этому признаку каждый потребитель текста решает, снимать ли теги: выдача, проекции в
 * плоский текст, подбор кегля, книга Excel. Спрашивать «формат равен html» в сорока местах
 * значило бы забыть про `richText` в половине из них.
 */
export function isMarkupFormat(format: PromptFormat): boolean {
  return format === "richText" || format === "html";
}

/**
 * Текст задания СЛОВАМИ — для машин (PRD-57 §4.3).
 *
 * Плоскую проекцию читают выгрузка, подбор кегля и аналитика. У разметки она была и раньше;
 * у текста, написанного разметкой, сначала снимаются теги — иначе читатель увидит `<p>Что
 * выведет`, а подбор кегля посчитает длину вместе с тегами и выберет не тот размер.
 *
 * Разметка сводится к подмножеству markdown тем же переводчиком, каким пользуются импорт
 * книги и вставка из буфера (`htmlToMarkdown`): второй перевод HTML в текст разошёлся бы с
 * первым, и один и тот же вопрос читался бы по-разному в выгрузке и в предпросмотре.
 *
 * @param question Задание с текстом и форматом.
 * @returns Текст без разметки.
 */
export function plainPromptOf(question: FormattedPrompt & { prompt?: unknown }): string {
  const source = typeof question?.prompt === "string" ? question.prompt : "";
  if (source === "") return "";
  const text = isMarkupFormat(promptFormatOf(question)) ? htmlToMarkdown(source) : source;
  return stripMarkdown(text);
}

/**
 * Текст задания СЛОВАМИ — для читателя: обзор, PDF, комментарий рецензента.
 *
 * Отличается от {@link plainPromptOf} ровно тем же, чем `renderPlainText` отличается от
 * `stripMarkdown`: здесь есть типографика, потому что текст показывают человеку рядом с
 * остальными экранами продукта, а там — нет, потому что его сравнивают и считают.
 *
 * @param question Задание с текстом и форматом.
 * @returns Текст без разметки, с кавычками и тире.
 */
export function readablePromptOf(question: FormattedPrompt & { prompt?: unknown }): string {
  const source = typeof question?.prompt === "string" ? question.prompt : "";
  if (source === "") return "";
  const text = isMarkupFormat(promptFormatOf(question)) ? htmlToMarkdown(source) : source;
  return renderPlainText(text);
}
