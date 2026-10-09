/**
 * @module features/users/__tests__/org-field-control.test
 * @description The profile field for an org-structure value (org-structure
 * plan, Р-3): choose a value that is already in use or create a new one — no
 * free text, because a typo would silently split one unit into two slices.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrgFieldControl } from "../org-field-control";

const values = [
  { value: "Отдел продаж", users: 14, attempts: 212 },
  { value: "Отдел продаж корпоративным клиентам", users: 0, attempts: 31 },
];

function open() {
  fireEvent.click(screen.getByRole("combobox", { name: "Подразделение" }));
}

describe("<OrgFieldControl />", () => {
  it("lists the values in use with how often they occur", () => {
    render(<OrgFieldControl label="Подразделение" value="" options={values} onChange={() => {}} />);
    open();
    expect(screen.getByText("14 пользователей · 212 прохождений")).toBeInTheDocument();
    // A value known only from passages is the spelling an LMS export brought in.
    expect(screen.getByText("31 прохождение")).toBeInTheDocument();
  });

  it("picks an existing value", () => {
    const onChange = vi.fn();
    render(<OrgFieldControl label="Подразделение" value="" options={values} onChange={onChange} />);
    open();
    fireEvent.click(screen.getByText("Отдел продаж"));
    expect(onChange).toHaveBeenCalledWith("Отдел продаж");
  });

  it("creates a new value from what was typed", () => {
    const onChange = vi.fn();
    render(<OrgFieldControl label="Подразделение" value="" options={values} onChange={onChange} />);
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Подразделение" }), { target: { value: "  Юридический   отдел " } });
    fireEvent.click(screen.getByRole("button", { name: "+ Создать «Юридический отдел»" }));
    expect(onChange).toHaveBeenCalledWith("Юридический отдел");
  });

  it("offers no creation for a value that already exists in another case", () => {
    render(<OrgFieldControl label="Подразделение" value="" options={values} onChange={() => {}} />);
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Подразделение" }), { target: { value: "отдел продаж" } });
    expect(screen.queryByRole("button", { name: /Создать/ })).not.toBeInTheDocument();
  });

  it("shows a stored value whose spelling differs from the folded one", () => {
    // The dictionary folds «ОТДЕЛ ПРОДАЖ» into «Отдел продаж»; a profile that
    // stores the other spelling must still show its value, not «Не указано».
    render(<OrgFieldControl label="Подразделение" value="ОТДЕЛ ПРОДАЖ" options={values} onChange={() => {}} />);
    expect(screen.getByText("ОТДЕЛ ПРОДАЖ")).toBeInTheDocument();
    expect(screen.queryByText("Не указано")).toBeNull();
  });

  it("keeps the current value selectable even when nobody else has it", () => {
    render(<OrgFieldControl label="Подразделение" value="Склад №3" options={values} onChange={() => {}} />);
    expect(screen.getByText("Склад №3")).toBeInTheDocument();
  });
});
