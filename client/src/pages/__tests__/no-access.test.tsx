/**
 * @module pages/__tests__/no-access.test
 * @description Tests for the "no access" screen (PRD-13): renders the warning
 * card and invokes `logout` from the auth context when «Выйти» is clicked.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const logout = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ logout }),
}));

import NoAccessPage from "../no-access";

describe("<NoAccessPage />", () => {
  it("renders the no-access message", () => {
    render(<NoAccessPage />);
    expect(screen.getByRole("heading", { name: "Нет доступа" })).toBeInTheDocument();
    expect(screen.getByText(/не назначено ни одной роли/)).toBeInTheDocument();
  });

  it("calls logout when «Выйти» is clicked", () => {
    render(<NoAccessPage />);
    fireEvent.click(screen.getByRole("button", { name: /Выйти/ }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
