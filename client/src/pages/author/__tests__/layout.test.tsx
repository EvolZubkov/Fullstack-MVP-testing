/**
 * @module pages/author/__tests__/layout.test
 * @description Tests for the author shell header: with several roles the caption
 * under the user name must stay a SINGLE label (the highest-privilege one), so a
 * multi-role account cannot stretch the header; the full role set stays reachable
 * in the profile menu opened by the avatar.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The sidebar reads build-time defines (`__APP_VERSION__`) that Vite injects but
// vitest does not; it is not the subject here, so it is stubbed out entirely.
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: () => null,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Иван Петров", roles: ["author", "developer", "manager"] },
    can: () => false,
    logout: vi.fn(),
  }),
}));

import { ThemeProvider } from "@/components/theme-provider";
import { AuthorLayout } from "../layout";

/** The header hosts the theme toggle, so the shell needs the theme context. */
function renderShell() {
  render(
    <ThemeProvider>
      <AuthorLayout><div /></AuthorLayout>
    </ThemeProvider>,
  );
}

/** The header user entry is the button carrying the signed-in user's name. */
function userTrigger() {
  return screen.getByRole("button", { name: /Иван Петров/ });
}

describe("AuthorLayout header", () => {
  it("shows only the highest-privilege role under the name", () => {
    renderShell();
    const trigger = userTrigger();
    expect(trigger).toHaveTextContent("Разработчик");
    expect(trigger).not.toHaveTextContent("Автор");
    expect(trigger).not.toHaveTextContent("Менеджер по обучению");
  });

  it("keeps the full role set in the profile menu", () => {
    renderShell();
    fireEvent.click(userTrigger());
    expect(screen.getByText("Разработчик, Автор, Менеджер по обучению")).toBeInTheDocument();
  });
});
