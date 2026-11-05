import { describe, it, expect } from "vitest";
import { plainTextToHtml, sanitizePastedHtml, stripPastedPresentation } from "../rte-paste";

describe("sanitizePastedHtml", () => {
  it("снимает встроенные шрифты и размеры Word, оставляя жирный и абзацы", () => {
    const html =
      '<meta charset="utf-8"><!--StartFragment--><p class="MsoNormal" style="font-family:\'Times New Roman\';font-size:12pt">' +
      '<b style="mso-bidi-font-weight:normal"><span style="font-family:\'Times New Roman\'">Целевой уровень</span></b> говорит о…</p><!--EndFragment-->';
    const out = sanitizePastedHtml(html);
    expect(out).toBe("<p><b>Целевой уровень</b> говорит о…</p>");
    expect(out).not.toMatch(/style|font|Times/i);
  });

  it("div и заголовки становятся абзацами, span и font — просто текстом", () => {
    expect(sanitizePastedHtml("<div>Один</div><h2>Два</h2><font face=Arial>три</font>")).toBe("<p>Один</p><p>Два</p>три");
  });

  it("ссылки оставляет только http(s) и mailto, без прочих атрибутов", () => {
    expect(sanitizePastedHtml('<a href="https://a.ru" style="color:red" onclick="x()">я</a>')).toBe('<a href="https://a.ru">я</a>');
    expect(sanitizePastedHtml('<a href="javascript:alert(1)">я</a>')).toBe("я");
  });

  it("выбрасывает script и style вместе с содержимым", () => {
    expect(sanitizePastedHtml("<style>p{}</style><script>alert(1)</script><p>Текст</p>")).toBe("<p>Текст</p>");
  });

  it("списки сохраняются", () => {
    expect(sanitizePastedHtml('<ul style="x"><li class="a">Раз</li></ul>')).toBe("<ul><li>Раз</li></ul>");
  });
});

describe("plainTextToHtml", () => {
  it("строки становятся абзацами, разметка экранируется", () => {
    expect(plainTextToHtml("Раз\n\n<b>два</b>")).toBe("<p>Раз</p><p>&lt;b&gt;два&lt;/b&gt;</p>");
  });
});

describe("stripPastedPresentation", () => {
  it("снимает фон и цвет, принесённые из источника в тёмной теме", () => {
    const html =
      '<!--StartFragment--><div style="background-color: rgb(17, 21, 30); color: rgb(244, 244, 245);">' +
      '<span style="background-color: rgb(17, 21, 30); color: rgb(255, 255, 255);">Уважаемые сотрудники!</span>' +
      "<p>Текст <b>жирный</b></p></div><!--EndFragment-->";
    const out = stripPastedPresentation(html);
    expect(out).not.toMatch(/style|background|color/i);
    expect(out).toContain("<span>Уважаемые сотрудники!</span>");
    expect(out).toContain("<p>Текст <b>жирный</b></p>");
  });

  it("снимает шрифт и кегль Word, но оставляет прочие стили", () => {
    const out = stripPastedPresentation(
      "<p style=\"font-family: 'Times New Roman'; font-size: 12pt; text-align: center; font-weight: 700;\">Т</p>",
    );
    expect(out).not.toMatch(/Times|12pt/);
    expect(out).toMatch(/text-align: center/);
    expect(out).toMatch(/font-weight: 700/);
  });

  it("снимает сокращённое свойство background целиком", () => {
    expect(stripPastedPresentation('<div style="background: #000 url(x.png) no-repeat">Т</div>')).toBe("<div>Т</div>");
  });

  it("снимает bgcolor и цвет, гарнитуру и кегль у font", () => {
    expect(stripPastedPresentation('<table bgcolor="#000"><tbody><tr><td bgcolor="#111"><font color="#fff" face="Arial" size="3">Т</font></td></tr></tbody></table>'))
      .toBe("<table><tbody><tr><td><font>Т</font></td></tr></tbody></table>");
  });

  it("сохраняет структуру: заголовки, картинки, ссылки", () => {
    const html = '<h2>Заголовок</h2><img src="media/a.png" alt="a"><a href="https://a.ru" style="color: red">я</a>';
    expect(stripPastedPresentation(html)).toBe('<h2>Заголовок</h2><img src="media/a.png" alt="a"><a href="https://a.ru">я</a>');
  });
});
