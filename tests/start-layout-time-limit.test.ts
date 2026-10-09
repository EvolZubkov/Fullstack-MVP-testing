/**
 * @module tests/start-layout-time-limit
 * @description Каждый поставляемый стартовый макет печатает лимит времени
 * ГОТОВОЙ строкой из контекста, а не числом минут с зашитой в вёрстку единицей.
 *
 * Единица в разметке (`<span data-path="course.timeLimitMinutes"></span> мин`)
 * означала, что двухнедельный бюджет выходит к ученику как «20160 мин»: DSL
 * намеренно без хелперов, и посчитать дни в макете нельзя. Тесты держат оба
 * поставляемых шаблона на общем построителе — новый макет, забывший про
 * `course.timeLimitLabel`, здесь и обнаружится.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildStartState } from "../shared/template/start-state";
import { renderScreenInto } from "../shared/template/render-screen";
import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

/** Стартовые макеты ВСЕХ шаблонов, включая вариант с картинкой. */
const LAYOUTS = TEMPLATE_IDS.flatMap((id) => [
  templateFile(id, "layouts/start.html"),
  templateFile(id, "layouts/start.image-right.html"),
]);

/** Рендерит стартовый экран с заданным лимитом и возвращает его текст. */
function renderStart(layoutPath: string, timeLimitMinutes: number | null): string {
  const layout = readFileSync(layoutPath, "utf8");
  const { course, state } = buildStartState({
    info: { title: "Тест", questionCount: 64, timeLimitMinutes },
    maxAttempts: null,
    completedAttempts: 0,
    hasCompletedResults: false,
    canStartNew: true,
  });
  const root = document.createElement("div");
  renderScreenInto(root, { layout, context: { course, state, design: {} } });
  return root.textContent ?? "";
}

describe.each(LAYOUTS)("%s", (layoutPath) => {
  it("печатает двухнедельный лимит днями", () => {
    const text = renderStart(layoutPath, 20160);
    expect(text).toContain("14 дней");
    expect(text).not.toContain("20160");
  });

  it("печатает короткий лимит минутами", () => {
    expect(renderStart(layoutPath, 45)).toContain("45 мин");
  });

  it("без лимита не печатает факт времени", () => {
    const text = renderStart(layoutPath, null);
    expect(text).not.toContain("на прохождение");
  });
});
