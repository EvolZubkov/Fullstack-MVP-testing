/**
 * @module components/__tests__/theme-toggle.test
 * @description Tests for the header appearance switch: the accessible name
 * is in Russian and names the appearance the click leads to, and a click
 * flips the shell appearance.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../theme-provider";
import { ThemeToggle } from "../theme-toggle";

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
});

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  it("offers the dark appearance while the shell is light", () => {
    renderToggle();
    const button = screen.getByRole("button", { name: "Включить тёмную тему" });
    expect(button).toHaveAttribute("title", "Включить тёмную тему");
  });

  it("switches the appearance and renames itself on click", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: "Включить тёмную тему" }));
    expect(document.body.classList.contains("ou--dark")).toBe(true);
    expect(screen.getByRole("button", { name: "Включить светлую тему" })).toBeInTheDocument();
  });
});
