/**
 * @module tests/rich-atoms
 * @description Атомарные узлы визуального редактора текста задания (PRD-57 FR-09b).
 *
 * Требование гарантирует по ПОСТРОЕНИЮ: листинг, формула и пропуск в визуальном редакторе
 * живут едиными объектами — курсор внутрь не попадает, форматирование их не рвёт, удаление
 * уносит узел целиком. Значит перед показом они заворачиваются в неразрывные узлы, а перед
 * сохранением разворачиваются обратно — байт в байт, иначе правка оформления потихоньку
 * съедала бы код и формулы.
 */
import { describe, it, expect } from "vitest";

import { toAtoms, fromAtoms, atomsFromRendered } from "../shared/text/rich-atoms";

describe("заворачивание", () => {
  it("листинг становится неразрывным узлом", () => {
    const out = toAtoms('<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>');
    expect(out).toContain('contenteditable="false"');
    expect(out).toContain('data-atom="code"');
    expect(out).toContain("SELECT 1;");
  });

  it("формула — тоже узел, и её запись видна автору", () => {
    const out = toAtoms("<p>Доля $$E = mc^2$$ большая</p>");
    expect(out).toContain('data-atom="formula"');
    expect(out).toContain("$$E = mc^2$$");
  });

  it("пропуск — узел с именем поля", () => {
    const out = toAtoms("<p>Столица — {{city}}.</p>");
    expect(out).toContain('data-atom="blank"');
    expect(out).toContain("{{city}}");
  });

  it("обычный текст не трогается вовсе", () => {
    const source = "<p>Просто <b>текст</b></p>";
    expect(toAtoms(source)).toBe(source);
  });

  it("доллары ВНУТРИ листинга формулой не становятся", () => {
    // Это показанный автором код, и подменять его — портить задание.
    const out = toAtoms('<pre><code class="language-bash">echo $$PID</code></pre>');
    expect(out).not.toContain('data-atom="formula"');
  });

  it("скобки внутри листинга пропуском не становятся", () => {
    const out = toAtoms("<pre><code>{{ шаблон }}</code></pre>");
    expect(out).not.toContain('data-atom="blank"');
  });
});

describe("разворачивание", () => {
  it("возвращает исходную разметку байт в байт", () => {
    for (const source of [
      '<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>',
      "<p>Доля $$E = mc^2$$ большая</p>",
      "<p>Столица — {{city}}.</p>",
      "<p>Просто <b>текст</b></p>",
    ]) {
      expect(fromAtoms(toAtoms(source))).toBe(source);
    }
  });

  it("узел, набранный редактором по-своему, всё равно разворачивается", () => {
    // Браузер вправе переписать атрибуты узла местами или добавить свои — разворачивание
    // опирается на признак атома, а не на точное написание тега.
    const edited = '<span data-atom="blank" class="tb-atom" contenteditable="false">{{city}}</span>';
    expect(fromAtoms(`<p>${edited}</p>`)).toBe("<p>{{city}}</p>");
  });

  it("текст без атомов проходит без изменений", () => {
    expect(fromAtoms("<p>Просто текст</p>")).toBe("<p>Просто текст</p>");
  });

  it("пустая строка не роняет ни одну сторону", () => {
    expect(toAtoms("")).toBe("");
    expect(fromAtoms("")).toBe("");
  });
});

/**
 * Вид атома «как у участника» (PRD-57 §4.3, согласованный эскиз).
 *
 * Подсветка листинга и картинка формулы считаются только на сервере, поэтому вид приходит
 * оттуда — готовой разметкой задания. Узел показывает ЕГО, а исходник несёт в себе: правка
 * оформления вокруг не должна превращать подсвеченный код обратно в текст со span-ами.
 */
describe("вид атома приходит с сервера", () => {
  const renderedCode = '<p>Код:</p><pre class="tb-code" data-lang="sql"><code>'
    + '<span class="tb-code__kw">SELECT</span> 1;</code></pre>';
  const renderedFormula = '<p>Доля <span class="tb-formula" data-latex="E = mc^2"><svg>…</svg></span>.</p>';

  it("листинг показан подсвеченным, а исходник лежит в узле", () => {
    const out = atomsFromRendered(renderedCode);
    expect(out).toContain("tb-code__kw");
    expect(out).toContain('data-atom="code"');
    expect(out).toContain("data-source=");
  });

  it("формула показана картинкой, а исходник — записью", () => {
    const out = atomsFromRendered(renderedFormula);
    expect(out).toContain("<svg>");
    expect(out).toContain('data-atom="formula"');
    // Исходник лежит в атрибуте КОДИРОВАННЫМ: сериализация атрибутов не экранирует
    // угловые скобки, и хранить разметку в нём как есть нельзя.
    expect(fromAtoms(out)).toContain("$$E = mc^2$$");
  });

  it("разворачивание возвращает ИСХОДНИК, а не показанный вид", () => {
    expect(fromAtoms(atomsFromRendered(renderedCode)))
      .toBe('<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>');
    expect(fromAtoms(atomsFromRendered(renderedFormula)))
      .toBe("<p>Доля $$E = mc^2$$.</p>");
  });

  it("пропуск остаётся собой: сервер его не меняет", () => {
    const out = atomsFromRendered("<p>Столица — {{city}}.</p>");
    expect(out).toContain('data-atom="blank"');
    expect(fromAtoms(out)).toBe("<p>Столица — {{city}}.</p>");
  });

  it("экранированное внутри кода переживает круг", () => {
    const rendered = '<pre class="tb-code" data-lang="javascript"><code>if (a &lt; b) {}</code></pre>';
    expect(fromAtoms(atomsFromRendered(rendered)))
      .toBe('<pre><code class="language-javascript">if (a &lt; b) {}</code></pre>');
  });

  it("блок без языка возвращается без класса языка", () => {
    const rendered = '<pre class="tb-code"><code>просто текст</code></pre>';
    expect(fromAtoms(atomsFromRendered(rendered))).toBe("<pre><code>просто текст</code></pre>");
  });
});
