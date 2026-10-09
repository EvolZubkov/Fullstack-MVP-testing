/**
 * @module features/tests/editor/sections/__tests__/item-unlock-fields
 * @description «Открывается» / «Каких пунктов» в свойствах пункта роутера («Сценарий в ИС», техдолг
 * №8; эскиз «роутер: кольцо не предлагается»): пункт, выбор которого замкнул бы кольцо, в списке не
 * предлагается, а подсказка в подвале говорит, какой и почему; «Сразу» снимает правило.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ItemUnlockFields, type UnlockItemOption } from "../item-unlock-fields";
import type { RouterUnlockRule } from "../../test-editor.types";

const ITEMS: UnlockItemOption[] = [
  { key: "t1", number: 1, name: "О компании" },
  { key: "t2", number: 2, name: "Корпоративные финансы" },
  { key: "scenario:s", number: 3, name: "Работа с документами в СЭД" },
  { key: "t4", number: 4, name: "Технологии" },
];

function renderFields(rules: Record<string, RouterUnlockRule>, onChange = vi.fn()) {
  render(
    <ItemUnlockFields
      itemKey="scenario:s"
      kind="scenario"
      items={ITEMS}
      rules={rules}
      onChange={onChange}
      field="scenarioItems[0].unlock"
    />,
  );
  return onChange;
}

describe("ItemUnlockFields", () => {
  it("без правила — «Сразу», списка пунктов нет", () => {
    renderFields({});
    expect(screen.getByText("Сразу")).toBeInTheDocument();
    expect(screen.queryByText("Каких пунктов")).not.toBeInTheDocument();
  });

  it("кольцевой пункт не предлагается, подсказка называет его", () => {
    renderFields({
      t2: { mode: "after_sections_completed", sectionIds: ["scenario:s"] },
      "scenario:s": { mode: "after_sections_completed", sectionIds: [] },
    });
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.click(input);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["1. О компании", "4. Технологии"]));
    expect(options.some((o) => o?.includes("Корпоративные финансы"))).toBe(false);
    expect(options.some((o) => o?.includes("Работа с документами"))).toBe(false);
    expect(
      screen.getByText("Не предлагается «2. Корпоративные финансы»: он сам открывается после этого сценария."),
    ).toBeInTheDocument();
  });

  it("выбор пункта пишет условие, «Сразу» снимает правило", () => {
    const onChange = renderFields({ "scenario:s": { mode: "after_sections_passed", sectionIds: [] } });
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.click(input);
    fireEvent.click(screen.getByRole("option", { name: /1\. О компании/ }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: "after_sections_passed", sectionIds: ["t1"] });

    fireEvent.click(screen.getByRole("button", { name: /Открывается|После успешного прохождения пунктов/ }));
    fireEvent.click(screen.getByRole("option", { name: "Сразу" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
