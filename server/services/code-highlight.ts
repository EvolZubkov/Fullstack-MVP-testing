/**
 * @module server/services/code-highlight
 *
 * Подсветка синтаксиса в листинге кода (PRD-57 FR-03 — FR-03c).
 *
 * Живёт на СЕРВЕРЕ и только на сервере. Пакет уходит в чужую LMS автономным, и класть в
 * каждый ZIP библиотеку подсветки — это и вес, и вторая копия кода, которую придётся
 * держать в паритете (FR-03a). Клиентский бандл не получает её по той же причине.
 *
 * Считается при ВЫДАЧЕ, а не при сохранении: путей записи текста задания четыре (ящик,
 * импорт книги, перенос теста, восстановление из снимка), а путей выдачи два — веб-хост и
 * выпечка `test.json`, — и оба серверные. Забытый путь записи дал бы задание без
 * подсветки, причину которой ищут в шаблоне; хранимая разметка вдобавок протухает при
 * первой же правке подсветки.
 *
 * Классы СВОИ, а не библиотечные (FR-03c): вывод переводится в пять ролей, цвета которых
 * лежат в `theme.css` шаблона. Так замена движка меняет один переводчик, а не тему каждого
 * шаблона; и пять ролей — это то, что различимо на экране, тогда как палитра из двух
 * десятков классов на тёмном фоне сцены сливается в три оттенка.
 */
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";

hljs.registerLanguage("python", python);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("javascript", javascript);

/** Языки, которые умеет подсвечивать продукт (FR-03: обязательные три). */
const LANGUAGES: Record<string, string> = {
  python: "python",
  sql: "sql",
  javascript: "javascript",
  js: "javascript",
};

/**
 * Перевод классов библиотеки в ПЯТЬ ролей продукта.
 *
 * Список закрытый и намеренно грубый: всё, что не названо, теряет обёртку и печатается
 * обычным цветом. Это лучше, чем пропустить незнакомый класс в разметку: тогда цвет взялся
 * бы из палитры библиотеки, которой в теме шаблона нет, и кусок листинга остался бы
 * невидимым на тёмном фоне.
 */
const ROLE_OF: Record<string, string> = {
  keyword: "kw",
  built_in: "kw",
  literal: "kw",
  type: "kw",
  string: "str",
  regexp: "str",
  number: "num",
  comment: "com",
  title: "fn",
  "title function_": "fn",
  "function_": "fn",
  name: "fn",
  attr: "fn",
  variable: "fn",
  params: "",
  operator: "",
  punctuation: "",
};

/** Блок кода, каким его печатает грамматика (`shared/text/markdown`). */
const CODE_BLOCK = /<pre class="tb-code"(?: data-lang="([^"]+)")?><code>([\s\S]*?)<\/code><\/pre>/g;

/** `<span class="hljs-…">` — единственная разметка, которую производит библиотека. */
const HLJS_SPAN = /<span class="hljs-([^"]+)">/g;

/**
 * Раскрасить все блоки кода в готовом HTML текста задания.
 *
 * @param html Результат `renderBlockMarkdown` / `renderInlineMarkdown`.
 * @returns Тот же HTML, где содержимое блоков с известным языком обёрнуто ролями.
 */
export function highlightCodeBlocks(html: string): string {
  if (typeof html !== "string" || html.indexOf('class="tb-code"') === -1) return html;
  CODE_BLOCK.lastIndex = 0;
  return html.replace(CODE_BLOCK, (whole, lang: string | undefined, code: string) => {
    const language = lang ? LANGUAGES[lang.toLowerCase()] : undefined;
    if (!language) return whole;
    try {
      // Вход УЖЕ экранирован грамматикой, поэтому библиотеке отдаётся расэкранированный
      // текст, а её вывод экранирует сам движок подсветки: двойное экранирование
      // превратило бы `&quot;` в `&amp;quot;` прямо в листинге.
      const source = unescapeHtml(code);
      const marked = hljs.highlight(source, { language, ignoreIllegals: true }).value;
      const attr = lang ? ` data-lang="${lang}"` : "";
      return `<pre class="tb-code"${attr}><code>${toRoles(marked)}</code></pre>`;
    } catch {
      // Библиотека не справилась — блок остаётся без подсветки. Задание должно
      // показаться в любом случае: листинг без цвета читается, отсутствие листинга нет.
      return whole;
    }
  });
}

/** Перевести разметку библиотеки в наши роли, неизвестные классы снимая. */
function toRoles(marked: string): string {
  HLJS_SPAN.lastIndex = 0;
  return marked.replace(HLJS_SPAN, (_whole, classes: string) => {
    const role = ROLE_OF[classes] ?? ROLE_OF[classes.split(" ")[0]] ?? "";
    return role === "" ? "<span>" : `<span class="tb-code__${role}">`;
  });
}

/** Обратное экранирование: грамматика уже экранировала текст, библиотека сделает это сама. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
