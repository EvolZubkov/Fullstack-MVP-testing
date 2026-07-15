/**
 * @module components/__tests__/theme-provider.test
 * @description Tests for the theme context/provider: initial theme resolution
 * (stored value > OS preference > light), the `<html>`/`<body>` class mirroring
 * the UniversityRT DS expects, localStorage persistence, toggle/set actions, and
 * the `useTheme` provider guard.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../theme-provider";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.body.className = "";
});
afterEach(() => vi.unstubAllGlobals());

describe("ThemeProvider initial resolution", () => {
  it("defaults to light when nothing is stored and the OS is not dark", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.body.classList.contains("ou--light")).toBe(true);
    expect(document.body.classList.contains("ou")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("reads a stored theme in preference to the OS setting", () => {
    localStorage.setItem("theme", "dark");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
    expect(document.body.classList.contains("ou--dark")).toBe(true);
  });

  it("uses the OS dark preference when nothing is stored", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
  });
});

describe("ThemeProvider actions", () => {
  it("toggleTheme flips light <-> dark and updates the classes", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.body.classList.contains("ou--dark")).toBe(true);
    expect(document.body.classList.contains("ou--light")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("dark");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
  });

  it("setTheme applies the given theme explicitly", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("useTheme guard", () => {
  it("throws when used outside a ThemeProvider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Consumer() {
      useTheme();
      return null;
    }
    expect(() => render(<Consumer />)).toThrow(/must be used within a ThemeProvider/);
    errSpy.mockRestore();
  });

  it("shares the theme with a consuming component", () => {
    function Consumer() {
      const { theme } = useTheme();
      return <span>theme:{theme}</span>;
    }
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    expect(screen.getByText("theme:light")).toBeInTheDocument();
  });
});
