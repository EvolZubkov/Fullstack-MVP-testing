/**
 * @module tests/blanks-field-css
 * @description Оформление пропуска на сцене участника (PRD-57 FR-24). Эскиз
 * `prd57-question-input.html` прямо говорит, где место этим правилам: в `theme.css`
 * шаблона, потому что это оформление СЦЕНЫ, а она у веб-хоста и пакета одна.
 *
 * Гард сверяет все три шаблона: встроенный и два вынесенных.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

const THEMES = TEMPLATE_IDS.map((id) => templateFile(id, "styles/theme.css"));

describe.each(THEMES)("пропуск на сцене: %s", (abs) => {
  const css = fs.readFileSync(abs, "utf8");

  it("поле стоит в строке текста", () => {
    expect(css).toMatch(/\.tb-blank\s*\{[^}]*display:\s*inline-flex/);
  });

  it("ширина берётся из переменной, а не из класса", () => {
    // Поле на две цифры и поле на слово — разные подсказки о том, чего ждут.
    expect(css).toMatch(/\.tb-blank\s*\{[^}]*--tb-blank-w/);
  });

  it("подстановка вместо поля оформлена всеми тремя видами", () => {
    expect(css).toContain(".tb-blank-sub {");
    expect(css).toContain(".tb-blank-sub--dash");
    expect(css).toContain(".tb-blank-sub--etalon");
  });

  it("верный и неверный ответ различимы", () => {
    expect(css).toContain(".tb-blank-sub.correct-answer");
    expect(css).toContain(".tb-blank-sub.incorrect-answer");
  });

  it("эталон не красится зелёным: это не вердикт", () => {
    const etalon = css.slice(css.indexOf(".tb-blank-sub--etalon"), css.indexOf(".tb-blank-sub--etalon") + 200);
    expect(etalon).not.toContain("success");
  });
});
