/**
 * @module client/src/components/__tests__/charts-bar-colors
 * @description `BarChart` красит столбики по категории, а не только по серии.
 *
 * Понадобилось распределению результатов (PRD-56 FR-13a): у него одна серия — количество
 * прохождений, — но цвет столбика говорит о сдаваемости корзины, и внутри серии он разный.
 * Обходной путь «три серии со стеком» дал бы в легенде и подсказках три величины там, где
 * величина одна.
 *
 * Лежит в `client/src`, а не в `tests/`: `vitest` берёт из `tests` только `.ts`, а тест
 * компонента написан с JSX.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarChart } from "../../../../vendor/ui-kit/src/components/Charts";

describe("BarChart — цвет столбика", () => {
  it("берёт цвет категории из `colors`, когда он задан", () => {
    const { container } = render(
      <BarChart
        categories={["0–9", "70–79", "90–100"]}
        series={[{
          id: "count",
          data: [1, 2, 3],
          color: "var(--ou-accent-default)",
          colors: [
            "var(--ou-error-default)",
            "var(--ou-warning-default)",
            "var(--ou-success-default)",
          ],
        }]}
      />,
    );

    const fills = [...container.querySelectorAll("rect.ou-chart__bar")]
      .map(rect => rect.getAttribute("fill"));
    expect(fills).toEqual([
      "var(--ou-error-default)",
      "var(--ou-warning-default)",
      "var(--ou-success-default)",
    ]);
  });

  it("рисует вертикаль-маркер с подписью", () => {
    // PRD-56 FR-13a: проходной балл, не кратный ширине корзины, проходит ВНУТРИ столбика —
    // и показать его можно только вертикалью на своём месте, а не границей между столбиками.
    const { container } = render(
      <BarChart
        categories={["60–69", "70–79"]}
        series={[{ id: "count", data: [1, 2] }]}
        xMarker={{ position: 0.75, label: "порог 75 %" }}
      />,
    );

    expect(container.querySelector("line.ou-chart__marker")).not.toBeNull();
    expect(container.textContent).toContain("порог 75 %");
  });

  it("оставляет цвет серии там, где цвета категории нет", () => {
    // Короткий список цветов не должен ломать хвост диаграммы: столбик без своего цвета
    // просто остаётся цветом серии.
    const { container } = render(
      <BarChart
        categories={["a", "b"]}
        series={[{ id: "count", data: [1, 2], color: "var(--ou-accent-default)", colors: ["var(--ou-error-default)"] }]}
      />,
    );

    const fills = [...container.querySelectorAll("rect.ou-chart__bar")]
      .map(rect => rect.getAttribute("fill"));
    expect(fills).toEqual(["var(--ou-error-default)", "var(--ou-accent-default)"]);
  });
});
