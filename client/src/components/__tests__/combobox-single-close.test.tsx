/**
 * @module client/src/components/__tests__/combobox-single-close
 * @description `Combobox` в одиночном режиме закрывает список после выбора (ui-kit HANDOFF §14.1).
 *
 * Выбор закрывал список и возвращал фокус в поле ввода, а `onFocus` поля открывал список снова:
 * выбранное значение тут же накрывалось меню, будто выбор не сработал. Осознанный щелчок по полю
 * после выбора обязан открывать список, как прежде; множественный режим держит список открытым.
 *
 * Щелчки идут через `user-event`, а не `fireEvent`: дефект живёт в переносе фокуса — нажатие на
 * строку списка уводит фокус из поля, и возврат фокуса снова вызывает `onFocus`. `fireEvent.click`
 * фокус не двигает и дефекта не видит.
 *
 * Лежит в `client/src`, а не в `tests/`: `vitest` берёт из `tests` только `.ts`, а тест
 * компонента написан с JSX.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Combobox, type ComboboxOption } from "../../../../vendor/ui-kit/src/components/Combobox";

const OPTIONS: ComboboxOption[] = [
  { value: "a", label: "Первый тест" },
  { value: "b", label: "Второй тест" },
];

/** Controlled single-mode host, as the product screens use it. */
function SingleHost() {
  const [value, setValue] = useState<string | null>(null);
  return <Combobox label="Тест" options={OPTIONS} value={value} onChange={setValue} />;
}

/** Controlled multi-mode host. */
function MultiHost() {
  const [values, setValues] = useState<string[]>([]);
  return <Combobox label="Тесты" multiple options={OPTIONS} values={values} onValuesChange={setValues} />;
}

describe("Combobox: single mode closes the list after a pick", () => {
  it("does not reopen the list when focus returns to the input", async () => {
    const user = userEvent.setup();
    render(<SingleHost />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Второй тест" }));

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Второй тест")).toBeTruthy();
  });

  it("reopens the list on a deliberate click after the pick", async () => {
    const user = userEvent.setup();
    render(<SingleHost />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Первый тест" }));
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("closes the list after a keyboard pick too", async () => {
    const user = userEvent.setup();
    render(<SingleHost />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens the list when focus arrives by Tab", async () => {
    const user = userEvent.setup();
    render(<SingleHost />);
    await user.tab();

    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("keeps the list open after a pick in multi mode", async () => {
    const user = userEvent.setup();
    render(<MultiHost />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Первый тест" }));

    expect(screen.getByRole("listbox")).toBeTruthy();
  });
});
