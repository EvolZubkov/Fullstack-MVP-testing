// @vitest-environment jsdom
/**
 * @module tests/question-scene-layout
 * @description Ревизия «Стандартный» на ui-kit: question.html на сцене. Проверяем, что
 * реальный макет через общий рендер даёт скелет сцены (шапка с картой ou-quiz и
 * прогрессом, тело со слотами, ou-tag темы), связывает контекст и не оставляет
 * незакрытых плейсхолдеров.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";

const layout = fs.readFileSync(
  path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "question.html"),
  "utf8",
);

function render(): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, {
    layout,
    context: {
      course: { title: "Основы ИБ" },
      design: { logoUrl: "" },
      state: {
        questionCounterLabel: "Вопрос 3 из 8",
        questionHint: "Выберите один вариант ответа",
        sectionName: "Пароли",
        questionsProgress: {
          scopeLabel: "Вопросы теста",
          answeredCount: 2,
          skippedCount: 1,
          states: [
            { index: 0, number: 1, statusClass: "is-answered", clickable: true, ariaLabel: "Вопрос 1" },
            { index: 1, number: 2, statusClass: "is-skipped", clickable: true, ariaLabel: "Вопрос 2" },
            { index: 2, number: 3, statusClass: "is-current", clickable: false, ariaLabel: "Вопрос 3" },
          ],
        },
      },
    },
    slots: {
      "question-text": "Какой пароль надёжнее?",
      "question-media": "",
      "question-interaction": '<div class="ou-radio-group"></div>',
      "question-feedback": "",
    },
  });
  return root;
}

describe("question.html — scene chrome", () => {
  it("renders the ou-quiz map, progress bar and interaction slot", () => {
    const root = render();
    expect(root.querySelector(".tb-scene")).toBeTruthy();
    expect(root.querySelector(".ou-quiz")).toBeTruthy();
    expect(root.querySelectorAll(".ou-quiz__dot").length).toBe(3);
    expect(root.querySelector(".tb-scene__progress")).toBeTruthy();
    expect(root.querySelector('[data-slot="question-interaction"]')).toBeTruthy();
  });

  it("binds the title, counter and topic tag, and wires pill goto actions", () => {
    const root = render();
    expect(root.querySelector('[data-path="course.title"]')?.textContent).toBe("Основы ИБ");
    expect(root.querySelector('[data-path="state.questionCounterLabel"]')?.textContent).toBe("Вопрос 3 из 8");
    expect(root.querySelector(".ou-tag")?.textContent).toBe("Пароли");
    expect(root.querySelector('.ou-quiz__dot[data-action="goto:2"]')).toBeTruthy();
    // the current (non-clickable) pill is disabled
    expect((root.querySelector('.ou-quiz__dot[data-action="goto:2"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("fills the question text slot and leaves no unclosed placeholders", () => {
    const root = render();
    expect(root.querySelector(".tb-scene__qtitle")?.textContent).toContain("Какой пароль");
    expect(root.querySelector(".tb-scene__qhint")?.textContent).toContain("Выберите один вариант");
    expect(root.innerHTML).not.toContain("{{");
  });
});
