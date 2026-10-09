/**
 * @module shared/template/__tests__/start-cover-description
 *
 * PRD-59 FR-13/FR-14. The cover of the start screen prints the test description as
 * MARKUP, through the controlled-HTML channel, in both shipped templates and in both
 * variants of the screen.
 *
 * The layouts are read from disk on purpose: what is under test is the shipped file,
 * not a fixture that could drift away from it. Two failures this guards against, both
 * of which look like «the markup just does not show up»:
 *
 *   - a `data-path` left on the block. The DOM pass fills `[data-path]` by assigning
 *     `textContent` AFTER the DSL pass, so it would silently wipe the markup the
 *     interpolation had just printed;
 *   - the gate moved from the STRING to the markup field. The block must be gated on
 *     `course.description`, so an empty description prints nothing at all.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderTemplate } from "../dsl";
import { buildStartState } from "../start-state";
import { TEMPLATE_IDS, templateFile } from "../../../tests/helpers/template-roots";

/** Every template, both variants of the start screen. */
const LAYOUTS = TEMPLATE_IDS.flatMap((id) => [
  templateFile(id, "layouts/start.html"),
  templateFile(id, "layouts/start.image-right.html"),
]);

function layout(abs: string): string {
  return fs.readFileSync(abs, "utf-8");
}

function render(rel: string, info: Parameters<typeof buildStartState>[0]["info"]): string {
  const { course, state } = buildStartState({
    info,
    maxAttempts: null,
    completedAttempts: 0,
    hasCompletedResults: false,
    canStartNew: true,
  });
  return renderTemplate(layout(rel), { course, state });
}

describe("обложка стартового экрана: описание теста", () => {
  for (const rel of LAYOUTS) {
    describe(rel, () => {
      it("печатает размеченное описание разметкой", () => {
        const html = render(rel, {
          title: "Пожарная безопасность",
          description: "<p>Курс для <strong>новых</strong></p><ul><li>паспорт</li></ul>",
          descriptionFormat: "richText",
        });
        expect(html).toContain("<strong>новых</strong>");
        expect(html).toContain("<li>паспорт</li>");
        expect(html).not.toContain("&lt;p&gt;");
      });

      it("не несёт data-path на блоке описания", () => {
        expect(layout(rel)).not.toContain('data-path="course.description"');
      });

      it("плоское описание экранирует и сохраняет переводы строк", () => {
        const html = render(rel, {
          title: "Т",
          description: "Сравните a < b\nВторая строка",
          descriptionFormat: "plain",
        });
        expect(html).toContain("a &lt; b<br>Вторая строка");
      });

      it("пустое описание не печатает блок", () => {
        const html = render(rel, { title: "Т" });
        expect(html).not.toContain("tb-cover__desc");
      });
    });
  }
});
