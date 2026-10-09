/**
 * @module tests/short-answer-field-css
 * @description Поле текстового ввода на сцене участника (PRD-57 §6.5, §6.6). Разметку
 * печатает общий рендерер, а ширину и кегль задаёт ШАБЛОН — и до Э5 не задавал ни один
 * из трёх: классы `tb-answer-field` и `tb-answer-field--num` стояли в разметке, а правил
 * под них не было нигде. Числовое поле в половину колонки — требование §6.6 и решение
 * согласованного эскиза, поэтому гард сверяет все три шаблона сразу: встроенный и два
 * вынесенных.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

const THEMES = TEMPLATE_IDS.map((id) => templateFile(id, "styles/theme.css"));

describe.each(THEMES)("поле текстового ввода: %s", (abs) => {
  const css = fs.readFileSync(abs, "utf8");

  it("поле занимает колонку целиком, как остальные блоки ответа", () => {
    expect(css).toMatch(/\.tb-answer-field\s*\{[^}]*width:\s*100%/);
  });

  it("числовое поле — половина колонки (§6.6)", () => {
    expect(css).toMatch(/\.tb-answer-field--num\s*\{[^}]*width:\s*50%/);
  });

  it("кегль ответа общий с остальными типами", () => {
    expect(css).toMatch(/\.tb-answer-field[^{]*\.ou-field__input\s*\{[^}]*--tb-answer-fs/);
  });

  it("на узкой сцене половина колонки распускается на всю", () => {
    const narrow = css.slice(css.indexOf("@container tbscene (max-width: 520px)"));
    expect(narrow).toMatch(/\.tb-answer-field--num\s*\{[^}]*width:\s*100%/);
  });
});
