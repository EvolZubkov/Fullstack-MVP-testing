/**
 * @module tests/tb-components-probe-css
 * @description Раскладка строки пробы, связки между правилами и состояния черновика
 * (PRD-57 §6.3). Эскиз `prd57-answer-rule.html` держал эти три класса в собственном
 * `<style>` под заголовком «Кандидаты в tb-components.css» — Э6 переносит их в продукт.
 *
 * Гард сверяет ОБЕ копии `tb-components.css`: продуктовую и ту, что подключают эскизы.
 * Копии уже расходились, и расхождение выглядит как «в эскизе всё правильно, а в
 * продукте поехало» — то есть как дефект вёрстки, а не как забытая строка в файле.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const COPIES = [
  path.join(ROOT, "client", "src", "styles", "tb-components.css"),
  path.join(ROOT, "docs", "wireframes", "tb-components.css"),
];

const CLASSES = [".tb-probe", ".tb-rules__join", ".tb-dirty", ".tb-rxbar", ".tb-mono"];

describe.each(COPIES)("tb-components.css: %s", (file) => {
  const css = fs.readFileSync(file, "utf8");

  it.each(CLASSES)("определяет %s", (selector) => {
    expect(css).toContain(`${selector} {`);
  });

  it("строка пробы — сетка «поле тянется, вердикт по содержимому»", () => {
    expect(css).toMatch(/\.tb-probe\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  });

  it("скрытая группа состояния действительно скрыта", () => {
    // `hidden` не побеждает собственный `display: flex` — нужна явная пара.
    expect(css).toMatch(/\.tb-dirty\[hidden\]\s*\{\s*display:\s*none/);
  });
});

describe("эскиз больше не держит эти правила у себя", () => {
  it("кандидаты переехали из <style> эскиза в общий файл", () => {
    const wireframe = fs.readFileSync(
      path.join(ROOT, "docs", "wireframes", "approved", "prd57-answer-rule.html"),
      "utf8",
    );
    const style = wireframe.slice(wireframe.indexOf("<style"), wireframe.indexOf("</style>"));
    for (const selector of CLASSES) {
      expect(style).not.toContain(`${selector} {`);
    }
  });
});
