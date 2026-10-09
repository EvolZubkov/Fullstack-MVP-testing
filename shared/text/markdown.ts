/**
 * @module shared/text/markdown
 *
 * The markdown subset authors may type into question prompts and answer options,
 * rendered to a fixed, safe set of tags.
 *
 * The pipeline is safe by construction, in this order:
 *   1. links and addresses are masked out, so nothing below can reach inside a URL;
 *   2. the remaining text goes through the typography pass;
 *   3. that text is HTML-escaped — author markup becomes visible characters;
 *   4. emphasis markers are turned into `<strong>` / `<em>`;
 *   5. masks are replaced by anchors built from a protocol whitelist.
 *
 * Because escaping happens BEFORE any tag is generated, the only tags in the
 * output are the ones this module emitted. That is why the stored value can stay
 * plain text: nothing downstream has to trust it.
 *
 * Pure `string -> string`, no DOM — the same code runs on the web host and inside
 * the SCORM package.
 */
import { escapeHtml } from "./escape";
import { applyTypography } from "./typography";

/** `[label](url)` — the label may not span lines, the URL may not contain spaces. */
const MD_LINK = /\[([^\]\n]+)\]\(([^\s)]+)\)/;
/**
 * A bare http(s) address. It may not END on sentence punctuation: authors write
 * «смотри https://example.com.», and the full stop belongs to the sentence, not
 * to the address.
 */
const BARE_URL = /https?:\/\/[^\s<>()]*[^\s<>().,;:!?]/;
/** A bare e-mail address. */
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** All link-ish spans, tried in that order, so a markdown link wins over its own URL. */
const LINK_TOKEN_RE = new RegExp(
  `${MD_LINK.source}|${BARE_URL.source}|${EMAIL.source}`,
  "g",
);

/** Protocols an author link may use. Everything else is shown as plain text. */
const SAFE_PROTOCOL = /^(https?:\/\/|mailto:)/i;

/**
 * Mask character: it survives the typography and escaping passes untouched, and
 * an author cannot type it into a form field.
 */
const MASK = "\u0000";

/**
 * Инлайн-код: `фрагмент` (PRD-57 FR-01). Внутри — ни типографики, ни разметки.
 */
const INLINE_CODE = /`([^`\n]+)`/g;

/**
 * Блок кода: ограждение из трёх обратных апострофов, необязательное имя языка в первой
 * строке. Ведущие пробелы и переносы сохраняются дословно.
 */
const CODE_BLOCK = /```([A-Za-zА-Яа-я0-9_+-]*)\n([\s\S]*?)```/g;

/**
 * Формула: `$$…$$` (PRD-57 FR-07a). Написание отраслевое — так формулу отгораживают
 * Jupyter, Obsidian и GitHub. Одиночный `$` ограждением НЕ является: он встречается в
 * обычных текстах («цена $100») и срабатывал бы там, где его не звали.
 */
const FORMULA = /\$\$([^$]+)\$\$/g;

/** Имя языка — только то, что мы умеем подсвечивать; прочее остаётся блоком без языка. */
const KNOWN_LANGS = ["python", "sql", "javascript", "js", "ts", "typescript", "json", "bash"];

/** Emphasis markers, longest first so `**` is never read as two italics. */
function applyEmphasis(html: string): string {
  return html
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

/** Normalise the line endings a paste from Windows or from a legacy field brings. */
function normaliseNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Turn newlines into `<br>`, capping a run of blank lines at one visual gap.
 * `<br>` rather than a paragraph on purpose: inline output has to stay valid
 * inside the heading the question prompt renders into.
 */
function renderLineBreaks(html: string): string {
  return html.replace(/\n/g, "<br>").replace(/(?:<br>){3,}/g, "<br><br>");
}

/** An anchor for an already-accepted URL. */
function anchor(url: string, label: string): string {
  const href = escapeHtml(url);
  // A mail client opens in place; a web page must not navigate the SCORM frame
  // away from the attempt, so it opens in a new window.
  const attrs = /^mailto:/i.test(url) ? "" : ' target="_blank" rel="noopener noreferrer"';
  return `<a href="${href}"${attrs}>${label}</a>`;
}

/**
 * Build the anchor HTML for one matched link token. Only a markdown link can name
 * its own protocol, so it is the only case that can be rejected — a rejected one
 * falls back to its own source text, which keeps the author's mistake visible
 * instead of swallowing it.
 */
function renderLinkToken(match: RegExpExecArray): string {
  const [source, mdLabel, mdUrl] = match;
  if (mdLabel !== undefined && mdUrl !== undefined) {
    if (!SAFE_PROTOCOL.test(mdUrl)) return escapeHtml(source);
    return anchor(mdUrl, applyEmphasis(escapeHtml(applyTypography(mdLabel))));
  }
  const url = /^https?:\/\//i.test(source) ? source : `mailto:${source}`;
  return anchor(url, escapeHtml(source));
}

/**
 * Render the inline markdown subset: bold, italic, links, auto-linked addresses.
 * Produces no block tags, so the result is safe inside a heading, a table cell or
 * an answer option.
 *
 * @param text Author text as stored (plain text with markdown markers).
 * @returns HTML built only from this module's own tags.
 */
export function renderInlineMarkdown(text: string): string {
  if (!text) return "";

  const links: string[] = [];
  // Код маскируется ПЕРВЫМ и тем же приёмом, что ссылки: типографика к моменту показа
  // уже подменила бы кавычки и дефисы, а в коде это меняет смысл (FR-02, PRD-33 §3.1).
  const source = maskFormulas(maskInlineCode(normaliseNewlines(text), links), links);
  LINK_TOKEN_RE.lastIndex = 0;
  const masked = source.replace(LINK_TOKEN_RE, (...args) => {
    const match = args.slice(0, -2) as unknown as RegExpExecArray;
    links.push(renderLinkToken(match));
    return `${MASK}${links.length - 1}${MASK}`;
  });

  const body = renderLineBreaks(applyEmphasis(escapeHtml(applyTypography(masked))));
  return body.replace(new RegExp(`${MASK}(\\d+)${MASK}`, "g"), (_, i: string) => links[Number(i)]);
}

/**
 * Спрятать формулу за маской и положить её ЗАГОТОВКУ в общий список подстановок.
 *
 * Здесь печатается только оболочка с исходной записью: сам SVG рисует СЕРВЕР (FR-07),
 * а этот модуль общий с пакетом, куда движок рендера не едет ни при каких
 * обстоятельствах. Пока подстановка не случилась, участник видит исходную запись — это
 * же поведение требует FR-10 для неразобранной формулы.
 */
function maskFormulas(text: string, slots: string[]): string {
  FORMULA.lastIndex = 0;
  return text.replace(FORMULA, (_match, body: string) => {
    const latex = body.trim();
    slots.push(
      `<span class="tb-formula" data-latex="${escapeHtml(latex)}">${escapeHtml(latex)}</span>`,
    );
    return `${MASK}${slots.length - 1}${MASK}`;
  });
}

/**
 * Спрятать инлайн-код за маской и положить готовый узел в общий список подстановок.
 *
 * Список тот же, что у ссылок: обе подстановки восстанавливаются одним проходом в конце,
 * и порядок их появления в тексте значения не имеет.
 */
function maskInlineCode(text: string, slots: string[]): string {
  INLINE_CODE.lastIndex = 0;
  return text.replace(INLINE_CODE, (_match, body: string) => {
    slots.push(`<code class="tb-code-inline">${escapeHtml(body)}</code>`);
    return `${MASK}${slots.length - 1}${MASK}`;
  });
}

/**
 * Вырезать блоки кода ДО разбора абзацев и вернуть готовые узлы отдельно.
 *
 * Блок обрабатывается раньше всего остального: внутри него нет ни абзацев, ни переносов
 * в `<br>`, ни типографики — `<pre>` печатает ровно то, что набрал автор (FR-01).
 */
function extractCodeBlocks(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  CODE_BLOCK.lastIndex = 0;
  const rest = text.replace(CODE_BLOCK, (_match, lang: string, body: string) => {
    const language = KNOWN_LANGS.indexOf(lang.toLowerCase()) === -1 ? "" : lang.toLowerCase();
    const attr = language === "" ? "" : ` data-lang="${language}"`;
    // Последний перенос перед ограждением — часть ограждения, а не кода.
    const code = body.replace(/\n$/, "");
    blocks.push(`<pre class="tb-code"${attr}><code>${escapeHtml(code)}</code></pre>`);
    return `\n\n${MASK}b${blocks.length - 1}${MASK}\n\n`;
  });
  return { text: rest, blocks };
}

/**
 * Render author text as paragraphs: a blank line opens a new `<p>`, a single line
 * break stays a `<br>` inside the current one. Each paragraph carries the full
 * inline subset.
 *
 * Use this where the value renders into a block container (page text fields); use
 * {@link renderInlineMarkdown} where it renders into a heading or an answer option.
 *
 * @param text Author text as stored (plain text with markdown markers).
 * @returns HTML built only from this module's own tags; empty for blank input.
 */
export function renderBlockMarkdown(text: string): string {
  if (!text) return "";
  const { text: withoutBlocks, blocks } = extractCodeBlocks(normaliseNewlines(text));
  return withoutBlocks
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => {
      const whole = new RegExp(`^${MASK}b(\\d+)${MASK}$`).exec(paragraph);
      // Блок кода — САМ по себе узел: заворачивать его в абзац нельзя, `<pre>` внутри
      // `<p>` невалиден, браузер закроет абзац за нас и разметка вокруг поедет.
      return whole ? blocks[Number(whole[1])] : `<p>${renderInlineMarkdown(paragraph)}</p>`;
    })
    .join("");
}
