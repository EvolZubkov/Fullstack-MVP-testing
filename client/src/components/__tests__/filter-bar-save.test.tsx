/**
 * @module components/__tests__/filter-bar-save
 * @description Сохранение фильтра в ui-kit `FilterBar` (решение владельца 2026-10-05, эскиз
 * approved/filters-unified.html, состояние «Сохранение фильтра»): действие стоит в ряду условий и
 * есть только когда сохранять есть что; изменённый набор — «Обновить» и «Сохранить как новый»;
 * меню «Сохранённые» только выбирает и удаляет.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterBar } from "../../../../vendor/ui-kit/src/components/FilterBar";

const APPLIED = [
  { id: "source", label: "Источник: веб" },
  { id: "outcome", label: "Исход: не сдал" },
];
const SETS = [{ id: "s1", name: "Не сдавшие" }];

describe("FilterBar — сохранение", () => {
  it("условия отобраны, набора нет: «Сохранить фильтр» в ряду условий, название предложено из условий", async () => {
    const onSaveSet = vi.fn();
    render(<FilterBar applied={APPLIED} count={2} onSaveSet={onSaveSet} onApplySet={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Сохранить фильтр" }));
    const field = await screen.findByRole("textbox", { name: "Название" });
    expect((field as HTMLInputElement).value).toBe("Источник: веб · Исход: не сдал");
    await waitFor(() => expect(field).toHaveFocus());

    await userEvent.keyboard("{Enter}");
    expect(onSaveSet).toHaveBeenCalledWith("Источник: веб · Исход: не сдал");
    expect(screen.queryByRole("textbox", { name: "Название" })).toBeNull();
  });

  it("без условий сохранять нечего — кнопки нет", () => {
    render(<FilterBar applied={[]} onSaveSet={() => {}} onApplySet={() => {}} />);
    expect(screen.queryByRole("button", { name: "Сохранить фильтр" })).toBeNull();
  });

  it("применён набор и условия не менялись — ни сохранения, ни обновления", () => {
    render(
      <FilterBar applied={APPLIED} savedSets={SETS} activeSetId="s1" onSaveSet={() => {}} onUpdateSet={() => {}} onApplySet={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Не сдавшие" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Сохранить/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Обновить/ })).toBeNull();
  });

  it("набор изменён — «Обновить «имя»» и «Сохранить как новый»", async () => {
    const onUpdateSet = vi.fn();
    const onSaveSet = vi.fn();
    render(
      <FilterBar applied={APPLIED} savedSets={SETS} activeSetId="s1" dirty onSaveSet={onSaveSet} onUpdateSet={onUpdateSet} onApplySet={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Обновить «Не сдавшие»" }));
    expect(onUpdateSet).toHaveBeenCalledWith("s1");

    await userEvent.click(screen.getByRole("button", { name: "Сохранить как новый" }));
    const field = await screen.findByRole("textbox", { name: "Название" });
    await userEvent.clear(field);
    await userEvent.type(field, "Не сдавшие, веб");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onSaveSet).toHaveBeenCalledWith("Не сдавшие, веб");
  });

  it("пустое меню «Сохранённые» подсказывает, где сохраняют; поля названия в меню нет", async () => {
    render(<FilterBar applied={APPLIED} onSaveSet={() => {}} onApplySet={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Сохранённые" }));
    expect(await screen.findByText("Наборов пока нет: отберите условия и нажмите «Сохранить фильтр»")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Название" })).toBeNull();
  });

  it("пустое название не сохраняется", async () => {
    const onSaveSet = vi.fn();
    render(<FilterBar applied={APPLIED} onSaveSet={onSaveSet} suggestedName="" onApplySet={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Сохранить фильтр" }));
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    expect(onSaveSet).not.toHaveBeenCalled();
  });
});
