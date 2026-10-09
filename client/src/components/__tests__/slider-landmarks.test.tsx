/**
 * @module client/src/components/__tests__/slider-landmarks
 * @description PRD-70 FR-31, FR-33: ориентиры DS `Slider` — треугольник над шкалой с подсказкой,
 * доступный с клавиатуры; щелчок по нему ползунок не двигает.
 *
 * Лежит в `client/src`, а не в `tests/`: `vitest` берёт из `tests` только `.ts`, а тест
 * компонента написан с JSX.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Slider } from "../../../../vendor/ui-kit/src/components/Slider";

const LANDMARK = {
  value: 40,
  label: "Сложность по ответам: 40",
  title: "По ответам: 40",
  hint: "Какой сложность оказалась у участников.",
};

describe("Slider landmarks", () => {
  it("рисует ориентир с именем и подсказкой, фокусируемый", () => {
    render(<Slider value={30} onChange={() => {}} ariaLabel="Сложность" landmarks={[LANDMARK]} />);

    const landmark = screen.getByLabelText("Сложность по ответам: 40");
    expect(landmark).toHaveAttribute("tabindex", "0");
    expect(landmark).toHaveClass("ou-slider__landmark");
    expect(screen.getByRole("tooltip")).toHaveTextContent("По ответам: 40");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Какой сложность оказалась у участников.");
  });

  it("щелчок по ориентиру не двигает ползунок", () => {
    const onChange = vi.fn();
    render(<Slider value={30} onChange={onChange} ariaLabel="Сложность" landmarks={[LANDMARK]} />);

    fireEvent.pointerDown(screen.getByLabelText("Сложность по ответам: 40"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("без ориентиров ничего лишнего нет", () => {
    render(<Slider value={30} onChange={() => {}} ariaLabel="Сложность" />);
    expect(document.querySelector(".ou-slider__landmark")).toBeNull();
  });
});
