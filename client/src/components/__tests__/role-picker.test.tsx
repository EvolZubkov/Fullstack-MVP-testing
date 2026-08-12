/**
 * @module components/__tests__/role-picker.test
 * @description Tests for the multi-role selector (PRD-13, WF-1). Verifies the
 * ordered checkbox list with labels/descriptions, the assignment ceiling that
 * disables roles above the actor's ceiling, the read-only `disabled` mode, and
 * that toggling a checkbox emits the updated role set through `onChange`.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ROLES } from "@shared/access";
import { ROLE_LABELS } from "@/lib/roles";
import { RolePicker } from "../role-picker";

function checkboxFor(label: string): HTMLInputElement {
  // Each row is a <label> wrapping the visible text and the checkbox input.
  const labelEl = screen.getByText(label).closest("label") as HTMLLabelElement;
  return within(labelEl).getByRole("checkbox") as HTMLInputElement;
}

describe("<RolePicker />", () => {
  it("renders the five stored roles in priority order with descriptions", () => {
    render(<RolePicker value={[]} onChange={() => {}} actorRoles={[ROLES.SUPERADMIN]} />);
    const group = screen.getByRole("group", { name: "Роли пользователя" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(5);
    expect(screen.getByText(ROLE_LABELS[ROLES.ADMINISTRATOR])).toBeInTheDocument();
    expect(screen.getByText(ROLE_LABELS[ROLES.DEVELOPER])).toBeInTheDocument();
    expect(screen.getByText(ROLE_LABELS[ROLES.LEARNER])).toBeInTheDocument();
  });

  it("a superadmin actor may assign every stored role (none disabled)", () => {
    render(<RolePicker value={[]} onChange={() => {}} actorRoles={[ROLES.SUPERADMIN]} />);
    for (const cb of screen.getAllByRole("checkbox")) {
      expect(cb).not.toBeDisabled();
    }
  });

  it("an administrator actor cannot assign the administrator role", () => {
    render(<RolePicker value={[]} onChange={() => {}} actorRoles={[ROLES.ADMINISTRATOR]} />);
    expect(checkboxFor(ROLE_LABELS[ROLES.ADMINISTRATOR])).toBeDisabled();
    expect(checkboxFor(ROLE_LABELS[ROLES.DEVELOPER])).not.toBeDisabled();
    expect(checkboxFor(ROLE_LABELS[ROLES.AUTHOR])).not.toBeDisabled();
    expect(checkboxFor(ROLE_LABELS[ROLES.MANAGER])).not.toBeDisabled();
  });

  it("reflects the selected roles as checked", () => {
    render(<RolePicker value={[ROLES.AUTHOR]} onChange={() => {}} actorRoles={[ROLES.SUPERADMIN]} />);
    expect(checkboxFor(ROLE_LABELS[ROLES.AUTHOR])).toBeChecked();
    expect(checkboxFor(ROLE_LABELS[ROLES.MANAGER])).not.toBeChecked();
  });

  it("adds a role to the set when a checkbox is checked", () => {
    const onChange = vi.fn();
    render(<RolePicker value={[]} onChange={onChange} actorRoles={[ROLES.SUPERADMIN]} />);
    fireEvent.click(checkboxFor(ROLE_LABELS[ROLES.AUTHOR]));
    expect(onChange).toHaveBeenCalledWith([ROLES.AUTHOR]);
  });

  it("removes a role from the set when a checked box is unchecked", () => {
    const onChange = vi.fn();
    render(
      <RolePicker value={[ROLES.AUTHOR, ROLES.MANAGER]} onChange={onChange} actorRoles={[ROLES.SUPERADMIN]} />,
    );
    fireEvent.click(checkboxFor(ROLE_LABELS[ROLES.AUTHOR]));
    expect(onChange).toHaveBeenCalledWith([ROLES.MANAGER]);
  });

  it("renders read-only (all disabled) when `disabled` is set", () => {
    render(<RolePicker value={[ROLES.AUTHOR]} onChange={() => {}} actorRoles={[ROLES.SUPERADMIN]} disabled />);
    for (const cb of screen.getAllByRole("checkbox")) {
      expect(cb).toBeDisabled();
    }
  });

  it("a manager may assign learner only while creating a user", () => {
    const { rerender } = render(
      <RolePicker value={[]} onChange={() => {}} actorRoles={[ROLES.MANAGER]} />,
    );
    // Not at creation: manager can assign nothing.
    expect(checkboxFor(ROLE_LABELS[ROLES.LEARNER])).toBeDisabled();
    rerender(<RolePicker value={[]} onChange={() => {}} actorRoles={[ROLES.MANAGER]} atCreation />);
    expect(checkboxFor(ROLE_LABELS[ROLES.LEARNER])).not.toBeDisabled();
  });
});
