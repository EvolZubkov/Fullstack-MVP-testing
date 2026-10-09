/**
 * @module server/services/prompt-html
 *
 * Готовая разметка текста задания для ХОСТОВ (PRD-57 FR-03a).
 *
 * Один вход для обоих путей выдачи: веб-хост получает её вместе с вопросами попытки,
 * пакет — запечённой в `test.json`. Оба пути серверные, и это то, что позволяет держать
 * подсветку синтаксиса на сервере, не отправляя библиотеку ни в чей браузер.
 *
 * Исходный текст ОСТАЁТСЯ на месте и никуда не девается: по нему считается хеш
 * содержимого, работает книга Excel, печатается обзор через `renderPlainText` и живут
 * пины комментариев рецензента. Разметка — производная, и хост берёт её только для показа.
 */
import { renderBlockMarkdown, renderInlineMarkdown } from "@shared/text/markdown";
import { applyTypographyToHtml } from "@shared/text";
import { sanitizeHtml } from "@shared/security/html-sanitize";
import { isMarkupFormat, promptFormatOf } from "@shared/questions/prompt-format";

import { highlightCodeBlocks } from "./code-highlight";
import { renderFormula } from "./formula-render";

/** Есть ли в тексте задания то, ради чего разметку вообще стоит считать заранее. */
function needsPrerender(prompt: unknown): prompt is string {
  return typeof prompt === "string" && (prompt.indexOf("`") !== -1 || prompt.indexOf("$$") !== -1);
}

/** Оболочка формулы, какой её печатает грамматика. */
const FORMULA_SLOT = /<span class="tb-formula" data-latex="([^"]*)">([\s\S]*?)<\/span>/g;

/**
 * Подставить SVG вместо оболочек формул (PRD-57 FR-07).
 *
 * Готовая картинка берётся из ЗАПАСА вопроса, если он есть: требование прямо говорит, что
 * при переносе теста между установками SVG едет вместе с вопросом, а не пересчитывается
 * на приёмнике — иначе вид формулы зависит от версии библиотеки на чужом контуре. Когда
 * запаса нет (старое задание, импорт), формула считается на месте: показать её важнее.
 *
 * Неразобранная запись остаётся ИСХОДНЫМ ТЕКСТОМ (FR-10): участник видит формулу, как её
 * набрал автор, а не пустое место и не сообщение об ошибке — про ошибку узнаёт автор.
 */
function substituteFormulas(html: string, stored: Record<string, string> | null): string {
  FORMULA_SLOT.lastIndex = 0;
  return html.replace(FORMULA_SLOT, (whole, latex: string, fallback: string) => {
    const source = unescapeAttr(latex);
    const ready = stored?.[source];
    if (typeof ready === "string" && ready !== "") return wrapFormula(ready, source);
    const rendered = renderFormula(source);
    return rendered.svg === "" ? whole : wrapFormula(rendered.svg, source);
  });
}

/** Обёртка формулы: класс держит оформление, запись остаётся для правки и для машин. */
function wrapFormula(svg: string, latex: string): string {
  return `<span class="tb-formula" data-latex="${escapeAttr(latex)}">${svg}</span>`;
}

function unescapeAttr(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Блок кода, записанный по-человечески: `<pre><code class="language-sql">`.
 *
 * Именно так его пишет автор в режиме HTML и так же выдаёт всякий внешний редактор. Внутри
 * продукта форма блока ОДНА (`<pre class="tb-code" data-lang="…">`), и приведение к ней
 * делается здесь: иначе пришлось бы держать два вида блока кода и учить им подсветку,
 * оформление шаблона, PDF-отчёт и пакет — каждого по отдельности.
 */
const HTML_CODE_BLOCK = /<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi;
const CODE_LANG_ATTR = /class="[^"]*\blanguage-([A-Za-z0-9_+-]+)\b[^"]*"/i;

/** Привести авторские блоки кода к внутренней форме, не трогая их содержимое. */
function adoptCodeBlocks(html: string): string {
  HTML_CODE_BLOCK.lastIndex = 0;
  return html.replace(HTML_CODE_BLOCK, (_whole, attrs: string, body: string) => {
    const lang = CODE_LANG_ATTR.exec(attrs ?? "");
    const attr = lang ? ` data-lang="${lang[1].toLowerCase()}"` : "";
    // Содержимое остаётся КАК ЕСТЬ: в нём уже экранированы угловые скобки, и второй проход
    // экранирования превратил бы `&lt;` в `&amp;lt;` — то есть показал бы участнику мусор.
    return `<pre class="tb-code"${attr}><code>${body}</code></pre>`;
  });
}


/**
 * Обернуть записи формул в тексте, набранном РАЗМЕТКОЙ (PRD-57 FR-09a).
 *
 * В режиме разметки оболочку печатает грамматика; в HTML её печатать некому, а писать
 * формулу автор обязан одинаково во всех режимах — значит оболочку ставит выдача.
 *
 * Проход идёт по токенам, как у типографики: внутрь тега, значения атрибута, `<pre>`,
 * `<code>` и `<style>` он не заходит. Два доллара внутри листинга — это два доллара, а не
 * формула, и подменять их значило бы портить показанный автором код.
 */
const MARKUP_TOKEN = /<(style|pre|code)\b[^>]*>[\s\S]*?<\/\1>|<[^>]*>|[^<]+/gi;
const FORMULA_SOURCE = /\$\$([^$]+)\$\$/g;

function wrapFormulas(html: string): string {
  MARKUP_TOKEN.lastIndex = 0;
  return html.replace(MARKUP_TOKEN, (token) => {
    if (token.startsWith("<")) return token;
    FORMULA_SOURCE.lastIndex = 0;
    return token.replace(FORMULA_SOURCE, (_whole, latex: string) => {
      const source = latex.trim();
      // Оболочка несёт ЗАПИСЬ формулы: по ней подстановка берёт готовый SVG из запаса
      // задания, а неразобранная формула остаётся исходным текстом (FR-10).
      return `<span class="tb-formula" data-latex="${escapeAttr(source)}">$$${source}$$</span>`;
    });
  });
}

/**
 * Поле `promptHtml` вопроса — или ничего, когда считать нечего.
 *
 * Пустой объект, а не `undefined` в поле: вопрос без листинга уезжает хосту байт в байт
 * таким же, каким уезжал до этого этапа, и ни один снимок, ни один тест паритета от
 * появления пустого ключа не дрогнет.
 *
 * @param question Вопрос, как его отдаёт хранилище.
 */
export function promptHtmlOf(
  question: { prompt?: unknown; dataJson?: unknown; promptFormat?: unknown },
): { promptHtml?: string } {
  const data = (question.dataJson ?? {}) as { formulas?: Record<string, string> };
  const stored = data.formulas && typeof data.formulas === "object" ? data.formulas : null;

  // PRD-57 §4.3: текст, набранный РАЗМЕТКОЙ, приходит хосту уже готовым — считать его на
  // выдаче нечего, кроме подсветки и формул. Санитайзер повторяется и здесь, при чтении:
  // задание могло быть записано до того, как правила очистки стали строже.
  if (isMarkupFormat(promptFormatOf({ promptFormat: question.promptFormat }))) {
    const source = typeof question.prompt === "string" ? question.prompt : "";
    if (source.trim() === "") return { promptHtml: "" };
    const safe = applyTypographyToHtml(sanitizeHtml(source));
    return { promptHtml: substituteFormulas(wrapFormulas(highlightCodeBlocks(adoptCodeBlocks(safe))), stored) };
  }

  if (!needsPrerender(question.prompt)) return {};
  // Блочный рендер: листинг — блочный узел, и в инлайновом выводе его нет по устройству.
  const html = question.prompt.indexOf("```") === -1
    ? renderInlineMarkdown(question.prompt)
    : renderBlockMarkdown(question.prompt);
  return { promptHtml: substituteFormulas(highlightCodeBlocks(html), stored) };
}

/**
 * Запас готовых формул вопроса — то, что кладётся В ЗАДАНИЕ при сохранении.
 *
 * Хранится именно он, а не подсветка листинга, и это не непоследовательность: требование
 * §4.2 прямо велит возить SVG вместе с вопросом при переносе между установками, тогда как
 * подсветка такого требования не несёт и считается на выдаче.
 *
 * @param prompt Текст задания.
 * @returns Словарь «запись → SVG»; пустой объект, когда формул нет.
 */
export function formulasFor(prompt: unknown): Record<string, string> {
  if (typeof prompt !== "string" || prompt.indexOf("$$") === -1) return {};
  const out: Record<string, string> = {};
  const found = prompt.match(/\$\$([^$]+)\$\$/g) ?? [];
  for (const whole of found) {
    const latex = whole.slice(2, -2).trim();
    if (latex === "" || out[latex]) continue;
    const rendered = renderFormula(latex);
    if (rendered.svg !== "") out[latex] = rendered.svg;
  }
  return out;
}
