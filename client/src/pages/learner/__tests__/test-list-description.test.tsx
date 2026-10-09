/**
 * @module client/src/pages/learner/__tests__/test-list-description
 *
 * PRD-59 FR-21: the learner's test card prints the description as ONE line, without
 * markup and without line breaks, cut to length.
 *
 * The card is the one place in the product where the decision went the other way:
 * formatting is shown everywhere the carrier allows it, but not here. The cards are
 * laid out as a grid, a grid row takes the height of its tallest card, and a
 * three-paragraph description lifted the whole row — which it already did before the
 * track, with no markup involved at all.
 */
import { describe, it, expect } from "vitest";
import { richTextToOneLine, ONE_LINE_LIMIT } from "@shared/template/rich-text";

describe("описание в карточке теста", () => {
  it("сводит абзацы и списки в одну строку", () => {
    expect(
      richTextToOneLine("<p>Курс</p><ul><li>паспорт</li><li>доступ</li></ul>", "richText"),
    ).toBe("Курс паспорт доступ");
  });

  it("не пропускает разметку в подзаголовок", () => {
    const out = richTextToOneLine("<p>Курс для <strong>новых</strong></p>", "richText");
    expect(out).toBe("Курс для новых");
    expect(out).not.toContain("<");
  });

  it("обрезает длинное описание по границе слова", () => {
    const long = "Курс для новых сотрудников компании. ".repeat(10);
    const out = richTextToOneLine(long, "plain");
    expect(out.length).toBeLessThanOrEqual(ONE_LINE_LIMIT + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("\n");
  });

  it("короткое описание оставляет целым, без многоточия", () => {
    expect(richTextToOneLine("Годовая аттестация.", "plain")).toBe("Годовая аттестация.");
  });

  it("пустое описание даёт пустую строку — карточка покажет один заголовок", () => {
    expect(richTextToOneLine(null, "plain")).toBe("");
  });
});
