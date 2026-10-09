/**
 * @module tests/formula-render
 * @description Формулы (PRD-57 §4.2, FR-06 — FR-10). Рендер серверный, в пакет уезжает
 * только SVG: ни библиотеки, ни шрифтов, ни таблицы стилей там нет.
 */
import { describe, it, expect } from "vitest";

import { renderFormula } from "../server/services/formula-render";

describe("renderFormula", () => {
  it("превращает запись LaTeX в автономный SVG", () => {
    const out = renderFormula("\\frac{a}{b}");
    expect(out.svg).toContain("<svg");
    expect(out.svg).toContain("</svg>");
    // Автономность: ни ссылок на шрифты, ни классов библиотеки.
    expect(out.svg).not.toContain("@font-face");
    expect(out.svg.toLowerCase()).not.toContain("katex");
  });

  it("даёт ЯВНЫЕ размеры — без них html2canvas печатает SVG непредсказуемо", () => {
    const out = renderFormula("x^2");
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    expect(out.svg).toMatch(/width="[^"]+"/);
    expect(out.svg).toMatch(/height="[^"]+"/);
  });

  it("несёт текстовую альтернативу (FR-09)", () => {
    const out = renderFormula("\\sqrt{2}");
    expect(out.alt).toContain("\\sqrt{2}");
  });

  it("двумерная нотация действительно двумерная", () => {
    // Дробь выше строки: высота записи в две строки заметно больше, чем у простого «ab».
    const frac = renderFormula("\\frac{a}{b}");
    const plain = renderFormula("ab");
    expect(frac.height).toBeGreaterThan(plain.height);
  });

  it("ошибка в записи не роняет рендер и называет себя (FR-10)", () => {
    const out = renderFormula("\\frac{a}{");
    expect(out.error).toBeTruthy();
    // Участнику при неразобранной записи показывается исходный текст, а не пустое место
    // и не сообщение об ошибке — за это отвечает подстановка, но SVG здесь пуст.
    expect(out.svg).toBe("");
  });

  it("пустая запись формулой не считается", () => {
    expect(renderFormula("   ").error).toBeTruthy();
  });
});
