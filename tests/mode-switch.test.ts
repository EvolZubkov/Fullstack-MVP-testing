/**
 * @module tests/mode-switch
 * @description Отчёт о потерях при смене режима ввода (PRD-57 FR-09c).
 *
 * Требование говорит прямо: переход в режим, где часть разметки непредставима, показывает,
 * ЧТО именно будет потеряно, ДО согласия автора. Значит отчёт обязан называть находки
 * числами — «таблиц 1, классов 2», — а не общими словами: автор решает, соглашаться ли, и
 * решает по тому, сколько он теряет.
 */
import { describe, it, expect } from "vitest";

import { describeModeSwitch, convertPrompt } from "../shared/text/mode-switch";

const find = (report: ReturnType<typeof describeModeSwitch>, what: string) =>
  report.losses.find((loss: { what: string }) => loss.what === what);

describe("разметка → HTML", () => {
  const report = describeModeSwitch("markdown", "html", "Текст **жирный**, [ссылка](https://a.b)\n\n```sql\nSELECT 1;\n```");

  it("переход возможен, но о нём предупреждают", () => {
    expect(report.canConvert).toBe(true);
    expect(report.notes.join(" ")).toContain("тегами");
  });

  it("говорит про листинг: угловые скобки придётся экранировать руками", () => {
    expect(report.notes.join(" ")).toContain("экранировать");
  });

  it("обещает, что формула и пропуск переживут переход", () => {
    expect(report.notes.join(" ")).toMatch(/формул|пропуск/i);
  });

  it("потерь как таковых нет: разметка выразима тегами целиком", () => {
    expect(report.losses).toEqual([]);
  });

  it("говорит, что типографика продолжает работать (FR-09d)", () => {
    // До решения владельца 2026-09-18 переход в HTML типографику отключал, и первая
    // редакция эскиза обещала именно это. Автор, помнящий прежнее поведение, иначе решит,
    // что кавычки в новом тексте придётся ставить руками.
    expect(report.notes.join(" ")).toMatch(/типографик/i);
    expect(report.notes.join(" ")).not.toMatch(/больше не работает/i);
  });
});

describe("HTML → разметка", () => {
  const source = [
    "<p>Текст</p>",
    "<table><tr><td>1</td></tr></table>",
    '<p style="color:red" class="lead">Стиль</p>',
    '<p class="x">Класс</p>',
    '<img src="/a.png" alt="рисунок">',
  ].join("");
  const report = describeModeSwitch("html", "markdown", source);

  it("называет непредставимое числами", () => {
    expect(find(report, "Таблица")?.count).toBe(1);
    expect(find(report, "Стиль на абзаце")?.count).toBe(1);
    expect(find(report, "Атрибут class")?.count).toBe(2);
    expect(find(report, "Изображение")?.count).toBe(1);
  });

  it("каждая находка говорит, что с ней СТАНЕТ", () => {
    expect(find(report, "Таблица")?.becomes).toContain("строк");
    expect(find(report, "Стиль на абзаце")?.becomes).toContain("снят");
    // Перевод в разметку оставляет от картинки подпись — это и есть потеря.
    expect(find(report, "Изображение")?.becomes).toContain("подпись");
  });

  it("текст без непредставимого переходит без потерь", () => {
    const clean = describeModeSwitch("html", "markdown", "<p>Просто <b>текст</b></p>");
    expect(clean.losses).toEqual([]);
    expect(clean.canConvert).toBe(true);
  });
});

describe("HTML → форматированный", () => {
  const report = describeModeSwitch(
    "html",
    "richText",
    '<table><tr><td>1</td></tr></table><p style="color:red">Стиль</p>',
  );

  it("называет то, что снимет панель", () => {
    expect(find(report, "Таблица")).toBeTruthy();
    expect(find(report, "Стиль на абзаце")).toBeTruthy();
  });

  it("обещает, что механики не пострадают: они атомарны", () => {
    expect(report.notes.join(" ")).toMatch(/листинг|формул|пропуск/i);
  });

  it("картинка сохраняется, а не становится подписью", () => {
    // Данные при этом переходе те же самые теги — терять картинку нечему. Общая с
    // разметкой формулировка обещала автору потерю, которой не происходит; согласованный
    // эскиз (`s-switch-html`) говорит «сохранится».
    const withImage = describeModeSwitch("html", "richText", '<img src="/a.png" alt="рисунок">');
    expect(find(withImage, "Изображение")?.becomes).toBe("сохранится");
  });
});

describe("переходы без потерь", () => {
  it("форматированный → HTML: данные одни и те же", () => {
    const report = describeModeSwitch("richText", "html", "<p>Текст</p>");
    expect(report.losses).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  it("режим в самого себя ничего не сообщает", () => {
    expect(describeModeSwitch("html", "html", "<p>Текст</p>").losses).toEqual([]);
  });
});

describe("пограничное", () => {
  it("пустой текст не даёт находок", () => {
    expect(describeModeSwitch("html", "markdown", "").losses).toEqual([]);
  });

  it("теги внутри листинга находками НЕ считаются: это показанный автором код", () => {
    const report = describeModeSwitch(
      "html",
      "markdown",
      "<pre><code>&lt;table&gt;&lt;/table&gt;</code></pre>",
    );
    expect(report.losses).toEqual([]);
  });
});

/**
 * Сам перевод текста. Отчёт говорит, что произойдёт; перевод это делает, и делает теми же
 * средствами, которыми продукт уже переводит текст в обе стороны, — иначе однажды
 * предупреждение и результат разойдутся.
 */
describe("перевод текста между режимами", () => {
  it("разметка становится тегами", () => {
    const html = convertPrompt("markdown", "html", "Текст **жирный**");
    expect(html).toContain("<strong>жирный</strong>");
  });

  it("листинг разметки становится <pre><code> с языком", () => {
    const html = convertPrompt("markdown", "html", "```sql\nSELECT 1;\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("SELECT 1;");
  });

  it("формула и пропуск переживают перевод в обе стороны", () => {
    const html = convertPrompt("markdown", "html", "Доля $$E = mc^2$$ и {{city}}");
    expect(html).toContain("$$E = mc^2$$");
    expect(html).toContain("{{city}}");
    const back = convertPrompt("html", "markdown", html);
    expect(back).toContain("$$E = mc^2$$");
    expect(back).toContain("{{city}}");
  });

  it("теги становятся разметкой", () => {
    expect(convertPrompt("html", "markdown", "<p>Текст <b>жирный</b></p>")).toContain("**жирный**");
  });

  it("между форматированным и HTML текст не трогается вовсе", () => {
    const source = '<p class="lead">Текст</p>';
    expect(convertPrompt("richText", "html", source)).toBe(source);
    expect(convertPrompt("html", "richText", source)).toBe(source);
  });

  it("режим в самого себя оставляет текст как есть", () => {
    expect(convertPrompt("markdown", "markdown", "Текст **жирный**")).toBe("Текст **жирный**");
  });
});
