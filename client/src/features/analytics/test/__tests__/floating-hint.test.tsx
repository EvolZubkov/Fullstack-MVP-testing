/**
 * @module features/analytics/test/__tests__/floating-hint
 * @description PRD-66 FR-14b, FR-30c: подсказка поверх страницы.
 *
 * Пузырь подсказки дизайн-системы жил внутри таблицы и обрезался её рамкой, а скрытый раздувал
 * её прокрутку (приёмка этапа 6). Здесь проверяется, что пузырь выводится ВНЕ триггера и только
 * по наведению или фокусу, а текст пояснения всегда доступен экранному диктору.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FloatingHint } from "../floating-hint";

function renderInTable() {
  return render(
    <table>
      <tbody>
        <tr>
          <td data-testid="cell">
            <FloatingHint title="Градации ответа" content="Никогда — 10 %">
              <span>гистограмма</span>
            </FloatingHint>
          </td>
        </tr>
      </tbody>
    </table>,
  );
}

describe("FloatingHint", () => {
  it("закрытым не рисует пузыря, но пояснение связано с триггером", () => {
    renderInTable();
    const trigger = screen.getByText("гистограмма").parentElement!;

    expect(document.querySelector(".tb-float-hint")).toBeNull();
    const described = document.getElementById(trigger.getAttribute("aria-describedby")!);
    expect(described?.textContent).toBe("Градации ответа: Никогда — 10 %");
  });

  it("по наведению выводит пузырь вне таблицы, по уходу убирает", () => {
    renderInTable();
    const trigger = screen.getByText("гистограмма").parentElement!;

    fireEvent.mouseEnter(trigger);
    const bubble = document.querySelector(".tb-float-hint")!;
    expect(bubble).not.toBeNull();
    // Портал: пузырь не внутри ячейки, значит рамка таблицы его не обрежет.
    expect(screen.getByTestId("cell").contains(bubble)).toBe(false);
    expect(bubble.querySelector(".tb-float-hint__title")?.textContent).toBe("Градации ответа");

    fireEvent.mouseLeave(trigger);
    expect(document.querySelector(".tb-float-hint")).toBeNull();
  });

  it("открывается и с клавиатуры", () => {
    renderInTable();
    const trigger = screen.getByText("гистограмма").parentElement!;

    expect(trigger.tabIndex).toBe(0);
    fireEvent.focus(trigger);
    expect(document.querySelector(".tb-float-hint")).not.toBeNull();
    fireEvent.blur(trigger);
    expect(document.querySelector(".tb-float-hint")).toBeNull();
  });
});
