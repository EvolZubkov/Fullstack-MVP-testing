/**
 * @module tests/code-listing-templates
 * @description Слот текста задания и оформление листинга (PRD-57 FR-03d, FR-04, FR-05).
 *
 * В заголовке по HTML допустим только строчный контент, поэтому блочный листинг в `<h2>`
 * не поставить. Тег слота меняется на `div` с ролью заголовка: вид прежний, экранный
 * диктор по-прежнему слышит заголовок второго уровня, а блок становится валидным.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

describe.each(TEMPLATE_IDS)("шаблон %s", (id) => {
  const layout = fs.readFileSync(templateFile(id, "layouts/question.html"), "utf8");
  const css = fs.readFileSync(templateFile(id, "styles/theme.css"), "utf8");

  it("слот текста задания больше не заголовок", () => {
    expect(layout).not.toMatch(/<h2[^>]*data-slot="question-text"/);
    expect(layout).toMatch(/<div class="tb-scene__qtitle" role="heading" aria-level="2" data-slot="question-text">/);
  });

  it("блок кода прокручивается сам, а не страницей (FR-04)", () => {
    expect(css).toMatch(/\.tb-code\s*\{[^}]*overflow-x:\s*auto/);
    // Перенос в коде меняет смысл: строки НЕ переносятся.
    expect(css).toMatch(/\.tb-code\s*\{[^}]*white-space:\s*pre/);
  });

  it("шрифт кода берётся из шаблона, а не из системы участника (FR-05)", () => {
    expect(css).toMatch(/\.tb-code[^{]*\{[^}]*--ou-font-family-mono/);
    expect(css).toMatch(/\.tb-code-inline\s*\{[^}]*--ou-font-family-mono/);
  });

  it("пять ролей подсветки одеты токенами темы (FR-03c)", () => {
    for (const role of ["kw", "str", "num", "com", "fn"]) {
      expect(css).toContain(`.tb-code__${role}`);
    }
    expect(css).not.toContain("hljs");
  });
});
