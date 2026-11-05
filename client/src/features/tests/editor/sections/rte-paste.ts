/**
 * @module features/tests/editor/sections/rte-paste
 * @description Очистка вставки в форматированный редактор (`FeedbackEditorModal`, режим richText).
 *
 * Зачем. Область ввода — `contenteditable`, и вставка из Word, письма или другой страницы
 * приносит с собой встроенные стили (`font-family: 'Times New Roman'`, `font-size: 12pt`,
 * цвета, `mso-*`). Продукт печатает форматированный текст КАК ЕСТЬ (`richTextToHtml`), а
 * встроенный стиль сильнее любого CSS шаблона, поэтому текст автора выходил на экране итогов
 * и в отчёте чужим шрифтом. Чистить нужно на входе: оставляем только то, что умеет сам
 * редактор (абзацы, жирный, курсив, подчёркивание, ссылки, списки), остальное — текст.
 *
 * `stripPastedPresentation` is the softer variant for content fields (test description,
 * content-page fields): structure stays, only the source's colours and fonts go.
 *
 * Чистый модуль относительно React; DOM нужен только для разбора разметки.
 */

/** Теги, которые редактор умеет создавать сам, — они проходят как есть, без атрибутов. */
const KEEP = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI"]);
/** Блочные теги, которых у редактора нет: каждый становится абзацем. */
const BLOCK_TO_P = new Set(["DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "TR"]);
/** Вырезаются вместе с содержимым: это не текст автора. */
const DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "XML", "TEMPLATE", "IFRAME", "OBJECT"]);

function safeHref(href: string | null): string | null {
  if (!href) return null;
  const value = href.trim();
  return /^(https?:|mailto:)/i.test(value) ? value : null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml((node.textContent ?? "").replace(/ /g, " "));
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag)) return "";
  const inner = Array.from(el.childNodes).map(walk).join("");
  if (tag === "A") {
    const href = safeHref(el.getAttribute("href"));
    return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
  }
  if (tag === "BR") return "<br>";
  if (KEEP.has(tag)) {
    const name = tag.toLowerCase();
    return `<${name}>${inner}</${name}>`;
  }
  if (BLOCK_TO_P.has(tag)) return inner.trim() === "" ? "" : `<p>${inner}</p>`;
  // `span`, `font`, `o:p` и прочее: оболочка с оформлением снимается, текст остаётся.
  return inner;
}

/** Разметка из буфера обмена → только то, что редактор умеет сам. */
export function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = Array.from(doc.body.childNodes).map(walk).join("");
  // Пустые абзацы, оставшиеся от обёрток Word, не нужны.
  return out.replace(/<p>(?:\s|<br>)*<\/p>/g, "");
}

/**
 * Inline style properties a paste brings from its SOURCE's look rather than from the
 * author's intent: a dark-mode page copies its own dark `background-color` and light `color`,
 * Word as `font-family: 'Times New Roman'; font-size: 12pt`. Printed as is, they beat the
 * template's CSS and ignore its theme — a dark plaque on a light cover.
 */
const PASTED_PRESENTATION = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "font-family",
  "font-size",
]);

/** Legacy presentational attributes that carry the same look outside `style`. */
const PRESENTATION_ATTRS = ["bgcolor"];
const FONT_ATTRS = ["color", "face", "size"];

/**
 * Pasted markup → the same markup without the source's colours and fonts.
 *
 * Unlike {@link sanitizePastedHtml}, the structure is kept whole: headings, tables,
 * images and the remaining inline styles (alignment, weight, indents) stay. Meant for
 * content fields whose formatted mode accepts more than the editor's own toolbar
 * produces — the test description and content-page fields. Applied to the PASTED
 * fragment only: colours the author wrote deliberately in HTML mode are not touched.
 *
 * @param html Fragment from the clipboard (`text/html`).
 * @returns The fragment with colour and font declarations removed; an attribute left
 *   without declarations is dropped.
 */
export function stripPastedPresentation(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const style = (el as HTMLElement).style;
    if (style && el.hasAttribute("style")) {
      for (const prop of Array.from(style)) {
        if (PASTED_PRESENTATION.has(prop) || prop.startsWith("background-")) style.removeProperty(prop);
      }
      if (!style.length) el.removeAttribute("style");
    }
    for (const attr of PRESENTATION_ATTRS) el.removeAttribute(attr);
    if (el.tagName === "FONT") for (const attr of FONT_ATTRS) el.removeAttribute(attr);
  }
  return doc.body.innerHTML;
}

/** Обычный текст из буфера → абзацы по строкам. */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
