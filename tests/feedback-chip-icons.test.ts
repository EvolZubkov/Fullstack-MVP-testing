/**
 * @module tests/feedback-chip-icons
 * @description Пиктограммы чипов обратной связи на экране итогов. На этом экране
 * курсы и мероприятия стоят в ОДНОМ ряду без подписей (в отчёте у каждого вида своя
 * секция с заголовком), поэтому значок — единственное, что их различает. Гарды ловят
 * два сценария потери смысла: значок пропал и значки у обоих видов стали одинаковыми
 * (ровно этот дефект был в авторском предпросмотре — `CalendarDays` импортировали, а
 * подставляли иконку ссылки).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LAYOUTS = [
  "server/scorm/templates/default/layouts/results.html",
  "server/scorm/templates/default/layouts/results.adaptive.html",
  "templates/certification/layouts/results.html",
  "templates/certification/layouts/results.adaptive.html",
];

const THEMES = [
  "server/scorm/templates/default/styles/theme.css",
  "templates/certification/styles/theme.css",
];

/** Читает файл репозитория. */
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

/**
 * Содержимое чипов заданного вида: `a` — курс, `span` — мероприятие.
 *
 * Захват доводится до `{{title}}`, а не до первого закрывающего тега: значок сам
 * обёрнут в `<span>`, и нежадный поиск `</span>` обрывал бы чип мероприятия на
 * вложенном теге.
 */
function chips(html: string, tag: "a" | "span"): string[] {
  const re = new RegExp(`<${tag} class="tb-rec"[^>]*>([\\s\\S]*?\\{\\{title\\}\\})</${tag}>`, "g");
  return [...html.matchAll(re)].map((m) => m[1]);
}

describe.each(LAYOUTS)("чипы обратной связи: %s", (rel) => {
  const html = read(rel);

  it("оба вида чипов несут пиктограмму", () => {
    const courses = chips(html, "a");
    const events = chips(html, "span");
    expect(courses.length, "нет чипов курсов").toBeGreaterThan(0);
    expect(events.length, "нет чипов мероприятий").toBeGreaterThan(0);
    for (const c of [...courses, ...events]) {
      expect(c).toContain('class="tb-rec__ico"');
      expect(c).toContain("<svg");
      // Значок декоративный: смысл несёт подпись чипа, дублировать его для
      // скринридера не нужно.
      expect(c).toContain('aria-hidden="true"');
    }
  });

  it("значок стоит ПЕРЕД подписью", () => {
    for (const c of [...chips(html, "a"), ...chips(html, "span")]) {
      expect(c.indexOf("tb-rec__ico")).toBeLessThan(c.indexOf("{{title}}"));
    }
  });

  it("у курса и мероприятия РАЗНЫЕ значки", () => {
    const glyph = (s: string) => (s.match(/<svg[\s\S]*?<\/svg>/) || [""])[0];
    const course = glyph(chips(html, "a")[0]);
    const event = glyph(chips(html, "span")[0]);
    expect(course).not.toBe("");
    expect(event).not.toBe("");
    expect(course, "значки курса и мероприятия совпали — чипы неразличимы").not.toBe(event);
  });
});

describe.each(THEMES)("стили пиктограммы: %s", (rel) => {
  const css = read(rel);

  it("класс значка объявлен и не даёт ему сжиматься", () => {
    expect(css).toMatch(/\.tb-rec__ico\s*\{[^}]*flex:\s*none/);
  });
});

describe("авторский предпросмотр обратной связи", () => {
  const src = read("client/src/features/tests/editor/sections/feedback-preview.tsx");

  it("мероприятия помечены календарём, а не иконкой ссылки", () => {
    const events = src.match(/title="Мероприятия"[\s\S]{0,120}/);
    expect(events).toBeTruthy();
    expect(events![0]).toContain("CalendarDays");
  });

  it("курсы помечены иконкой ссылки", () => {
    const courses = src.match(/title="Курсы"[\s\S]{0,120}/);
    expect(courses).toBeTruthy();
    expect(courses![0]).toContain("LinkIcon");
  });
});
