/**
 * @module features/tests/editor/sections/__tests__/tab-rail
 * @description Рейл вкладки: одиночные пункты, второй уровень и заблокированный
 * ребёнок. Эскиз — `docs/wireframes/ds-rail-nested.html`.
 *
 * Проверяется не облик, а поведение, которое от облика не видно: на какой пункт
 * встаёт вкладка, когда выбранный стал недоступен, и слышит ли скринридер причину
 * блокировки.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TabRail, flattenRail, type RailEntry } from "../tab-rail";

type Key = "answer" | "verdict" | "scales-list" | "scales-contrib" | "metrics";

function entries(over: { contribDisabled?: boolean } = {}): RailEntry<Key>[] {
  return [
    { key: "answer", label: "Оценка ответа" },
    { key: "verdict", label: "Вердикт" },
    {
      label: "Шкалы",
      items: [
        { key: "scales-list", label: "Список шкал" },
        {
          key: "scales-contrib",
          label: "Вклады вопросов",
          disabled: over.contribDisabled,
          disabledHint: over.contribDisabled
            ? "Появятся, когда будет хотя бы одна шкала."
            : undefined,
        },
      ],
    },
    { key: "metrics", label: "Показатели" },
  ];
}

function renderRail(active: Key, over: { contribDisabled?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <TabRail<Key>
      items={entries(over)}
      active={active}
      onChange={onChange}
      ariaLabel="Разделы вкладки"
      testIdPrefix="scoring"
    >
      <div>панель</div>
    </TabRail>,
  );
  return { onChange };
}

describe("рейл вкладки — второй уровень", () => {
  it("группа рисуется подписью и пунктами с отступом", () => {
    renderRail("scales-list");
    // Подпись группы — не кнопка: у неё нет своего экрана, нажимать не на что.
    const label = screen.getByText("Шкалы");
    expect(label.tagName).toBe("SPAN");
    expect(label).toHaveClass("ou-drawer__rail-grouplbl");

    const child = screen.getByTestId("scoring-rail-scales-list");
    expect(child).toHaveClass("ou-drawer__rail-item--child");
    // Одиночный пункт остаётся первого уровня.
    expect(screen.getByTestId("scoring-rail-verdict")).not.toHaveClass(
      "ou-drawer__rail-item--child",
    );
  });

  it("вложенные пункты связаны с подписью группы", () => {
    renderRail("scales-list");
    const group = screen.getByRole("group");
    const label = screen.getByText("Шкалы");
    expect(group.getAttribute("aria-labelledby")).toBe(label.id);
    expect(label.id).not.toBe("");
  });

  it("выбор ребёнка сообщается его ключом", () => {
    const { onChange } = renderRail("scales-list");
    fireEvent.click(screen.getByTestId("scoring-rail-scales-contrib"));
    expect(onChange).toHaveBeenCalledWith("scales-contrib");
  });

  it("заблокированный ребёнок остаётся ВИДИМЫМ и объясняет причину", () => {
    renderRail("scales-list", { contribDisabled: true });
    const item = screen.getByTestId("scoring-rail-scales-contrib");
    // Прятать нельзя: исчезнувший пункт читается как «такой настройки нет».
    expect(item).toBeInTheDocument();
    expect((item as HTMLButtonElement).disabled).toBe(true);
    const hint = screen.getByText("Появятся, когда будет хотя бы одна шкала.");
    expect(item.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("нажатие на заблокированный пункт ничего не выбирает", () => {
    const { onChange } = renderRail("scales-list", { contribDisabled: true });
    fireEvent.click(screen.getByTestId("scoring-rail-scales-contrib"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("выбранный пункт, ставший недоступным, откатывается на первый доступный", () => {
    // Так бывает после удаления последней шкалы: вклады больше не о чем.
    renderRail("scales-contrib", { contribDisabled: true });
    expect(screen.getByTestId("scoring-rail-answer")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("scoring-rail-scales-contrib")).not.toHaveAttribute("aria-current");
    // Панель показывает тот пункт, на который встали, а не тот, что просили.
    expect(screen.getByTestId("scoring-pane-answer")).toBeInTheDocument();
  });

  it("flattenRail отдаёт пункты обоих уровней в порядке показа", () => {
    expect(flattenRail(entries()).map((i) => i.key)).toEqual([
      "answer",
      "verdict",
      "scales-list",
      "scales-contrib",
      "metrics",
    ]);
  });
});
