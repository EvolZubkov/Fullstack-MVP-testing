/**
 * @module tests/choice-option-inline-markup
 * @description Текст варианта ответа с разметкой (ссылка, жирный) печатается одним
 * абзацем, а не колонками.
 *
 * `.ou-radio-card__title` в дизайн-системе — `inline-flex`: так заголовок карточки
 * держит рядом пилюлю. Вариант же рендерится через markdown, и голый адрес становится
 * `<a>`: текст до ссылки и сама ссылка оказывались двумя flex-элементами, то есть двумя
 * колонками. Рендерер обязан вернуть заголовку блочную вёрстку.
 */
import { describe, it, expect } from "vitest";
import { renderMultiple, renderSingleChoice } from "../shared/template/question-interaction";

const OPTION =
  "Запись в ФГИС «Аршин», доступная по https://fgis.gost.ru/fundmetrology/registry";

/** The inline style of every option title in the rendered markup. */
function titleStyles(html: string): string[] {
  return [...html.matchAll(/class="ou-radio-card__title" style="([^"]*)"/g)].map((m) => m[1]);
}

describe("вариант ответа с разметкой", () => {
  it.each([
    ["single", renderSingleChoice],
    ["multiple", renderMultiple],
  ])("%s: адрес становится ссылкой, заголовок — блочный", (_type, render) => {
    const html = render({ type: "single", dataJson: { options: [OPTION, "Другой"] } }, undefined);

    expect(html).toContain('<a href="https://fgis.gost.ru/fundmetrology/registry"');
    const styles = titleStyles(html);
    expect(styles).toHaveLength(2);
    for (const style of styles) expect(style).toContain("display:block");
  });
});
