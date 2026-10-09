/**
 * @module shared/text/mode-switch
 *
 * Отчёт о потерях при смене режима ввода текста задания (PRD-57 FR-09c).
 *
 * Требование говорит прямо: переход в режим, где часть разметки непредставима, показывает,
 * ЧТО именно будет потеряно, ДО согласия автора. Отсюда две черты этого модуля.
 *
 * Первая: находки называются ЧИСЛАМИ — «таблиц 1, классов 2». Общие слова («часть
 * оформления будет потеряна») не дают решить, соглашаться ли: одно дело потерять класс на
 * абзаце, другое — таблицу, в которой лежит половина условия.
 *
 * Вторая: находки ищутся вне листинга. Теги внутри `<pre>`/`<code>` — это код, показанный
 * автором участнику, и считать их разметкой значило бы пугать автора его же содержимым.
 *
 * Чистый модуль, regex-разбор: работает и на сервере, и в браузере, как и весь текстовый
 * слой продукта.
 */

import type { PromptFormat } from "../questions/prompt-format";
import { htmlToMarkdown } from "./html-to-markdown";
import { renderBlockMarkdown } from "./markdown";

/** Одна находка: что нашли, сколько и что с этим станет. */
export interface ModeSwitchLoss {
  what: string;
  count: number;
  becomes: string;
}

export interface ModeSwitchReport {
  /** Перевод возможен всегда; отчёт говорит, какой ценой. */
  canConvert: boolean;
  /** Непредставимое — с числами. Пусто, когда терять нечего. */
  losses: ModeSwitchLoss[];
  /** Что важно сказать, даже когда потерь нет (например, про типографику). */
  notes: string[];
}

/** Убрать листинг: теги внутри него — содержимое задания, а не разметка. */
function withoutCode(html: string): string {
  return html.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

/** Сколько раз встречается выражение. */
function count(html: string, re: RegExp): number {
  const found = html.match(re);
  return found ? found.length : 0;
}

/**
 * Что непредставимо ни в разметке, ни в панели «Форматированного».
 *
 * Список ровно тот, что знает перевод HTML в разметку (`html-to-markdown`): пять
 * соответствий, всё прочее сводится к словам. Поэтому и отчёт перечисляет то же самое —
 * иначе он обещал бы автору не то, что произойдёт.
 */
function markupLosses(html: string, to: PromptFormat): ModeSwitchLoss[] {
  const body = withoutCode(html);
  const found: ModeSwitchLoss[] = [];

  const tables = count(body, /<table\b/gi);
  if (tables > 0) found.push({ what: "Таблица", count: tables, becomes: "станет строками текста" });

  const styles = count(body, /\sstyle\s*=/gi);
  if (styles > 0) found.push({ what: "Стиль на абзаце", count: styles, becomes: "будет снят" });

  const classes = count(body, /\sclass\s*=/gi);
  if (classes > 0) found.push({ what: "Атрибут class", count: classes, becomes: "будет снят" });

  // Картинку теряет только перевод в разметку: `htmlToMarkdown` оставляет от неё подпись.
  // В «Форматированном» данные те же самые теги, и картинка остаётся на месте — так и
  // обещает согласованный эскиз (`prd57-question-text.html`, состояние `s-switch-html`).
  // Общая формулировка на оба перехода пугала автора потерей, которой не происходит.
  const images = count(body, /<img\b/gi);
  if (images > 0) {
    found.push({
      what: "Изображение",
      count: images,
      becomes: to === "markdown" ? "станет подписью" : "сохранится",
    });
  }

  return found;
}

/**
 * Описать переход из одного режима в другой.
 *
 * @param from Режим, в котором текст написан сейчас.
 * @param to Режим, в который автор переключается.
 * @param text Текст задания как он есть.
 * @returns Отчёт: находки с числами и пояснения.
 */
export function describeModeSwitch(
  from: PromptFormat,
  to: PromptFormat,
  text: string,
): ModeSwitchReport {
  const source = typeof text === "string" ? text : "";
  if (from === to || source.trim() === "") return { canConvert: true, losses: [], notes: [] };

  // `richText` и `html` — один и тот же текст, и переход между ними ничего не меняет:
  // меняется редактор, а не данные.
  if (from !== "markdown" && to !== "markdown") {
    if (to === "richText") {
      return {
        canConvert: true,
        losses: markupLosses(source, to),
        notes: [
          "Листинг, формула и пропуск не пострадают: в режиме «Форматированный» они ведут себя как единые объекты — правятся целиком и не разрываются при наборе.",
        ],
      };
    }
    return { canConvert: true, losses: [], notes: [] };
  }

  if (from === "markdown") {
    // Разметка выразима тегами ЦЕЛИКОМ — терять нечего, но набор после перехода меняется,
    // и об этом честнее сказать заранее.
    return {
      canConvert: true,
      losses: [],
      notes: [
        "Жирный и курсив, списки и ссылки станут тегами.",
        "Листинг станет <pre><code>, и дальше экранировать угловые скобки внутри него придётся вручную.",
        "Формулы и пропуски сохранятся как есть — они пишутся одинаково во всех режимах.",
        // FR-09d. Сказать об этом важно ИМЕННО здесь: до решения владельца 2026-09-18
        // переход в HTML типографику отключал, и автор, помнящий то поведение, иначе
        // решит, что кавычки в новом тексте придётся ставить руками.
        "Кавычки и тире останутся такими, какими их сделала типографика: она работает во всех режимах одинаково и не заходит внутрь листинга, значений атрибутов и имён пропусков.",
      ],
    };
  }

  // HTML → разметка: пять соответствий, всё прочее становится словами.
  return {
    canConvert: true,
    losses: markupLosses(source, to),
    notes: [
      "Жирный, курсив, списки, ссылки и листинг переведутся в разметку; остальное станет словами.",
      "Формулы и пропуски сохранятся как есть — они пишутся одинаково во всех режимах.",
    ],
  };
}


/**
 * Вернуть формуле её ЗАПИСЬ после перевода разметки в теги.
 *
 * Грамматика разметки печатает формулу оболочкой `<span class="tb-formula" data-latex="…">`,
 * готовой под подстановку картинки. Автору в поле нужна не она, а `$$…$$`: писать формулу
 * он обязан одинаково во всех режимах (FR-09a), и оболочка в поле означала бы, что после
 * переключения он больше не может её править.
 */
const FORMULA_WRAPPER = /<span class="tb-formula" data-latex="([^"]*)">[\s\S]*?<\/span>/g;

function unwrapFormulas(html: string): string {
  FORMULA_WRAPPER.lastIndex = 0;
  return html.replace(FORMULA_WRAPPER, (_whole, latex: string) => {
    const source = latex
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    return `$$${source}$$`;
  });
}


/**
 * Привести блок кода к АВТОРСКОЙ записи — `<pre><code class="language-sql">`.
 *
 * Грамматика разметки печатает его во внутренней форме (`class="tb-code" data-lang="…"`),
 * которую понимает выдача. Автору в режиме HTML нужна не она, а стандартная запись: её он
 * узнаёт, её же обещает эскиз («листинг станет `<pre><code>`»), и именно её понимает всякий
 * внешний редактор. Обратно во внутреннюю форму блок приводит выдача.
 */
const INTERNAL_CODE = /<pre class="tb-code"(?: data-lang="([^"]*)")?><code>([\s\S]*?)<\/code><\/pre>/g;

function authorCodeBlocks(html: string): string {
  INTERNAL_CODE.lastIndex = 0;
  return html.replace(INTERNAL_CODE, (_whole, lang: string | undefined, body: string) => {
    const attr = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${attr}>${body}</code></pre>`;
  });
}

/**
 * Перевести текст задания из одного режима в другой (PRD-57 FR-09c).
 *
 * Перевод делают ТЕ ЖЕ средства, которыми продукт уже переводит текст в обе стороны:
 * грамматика разметки в одну и `htmlToMarkdown` в другую. Свой перевод здесь означал бы,
 * что предупреждение {@link describeModeSwitch} однажды разойдётся с результатом.
 *
 * Формула и пропуск не трогаются ни в одну сторону: они пишутся одинаково во всех режимах
 * (FR-09a), и любая их «конвертация» была бы порчей.
 *
 * @param from Текущий режим.
 * @param to Режим, в который переводим.
 * @param text Текст задания.
 * @returns Текст в новом режиме.
 */
export function convertPrompt(from: PromptFormat, to: PromptFormat, text: string): string {
  const source = typeof text === "string" ? text : "";
  if (from === to || source === "") return source;

  // `richText` и `html` — один и тот же текст: меняется редактор, а не данные.
  if (from !== "markdown" && to !== "markdown") return source;

  if (from === "markdown") return authorCodeBlocks(unwrapFormulas(renderBlockMarkdown(source)));
  return htmlToMarkdown(source);
}
