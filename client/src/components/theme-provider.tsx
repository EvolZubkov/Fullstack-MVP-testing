/**
 * @module components/theme-provider
 *
 * Light/dark appearance of the author and learner shells.
 *
 * The design system switches its semantic tokens by a class on `<body>`:
 * `.ou` is the always-present scope, `.ou--light` / `.ou--dark` pick the
 * palette. This module owns exactly that pair of classes and nothing else.
 *
 * Resolution order of the initial appearance:
 *  1. the choice the user made earlier, remembered in `localStorage`;
 *  2. the operating system preference (`prefers-color-scheme`);
 *  3. light.
 *
 * Only a recognised value is ever read back from storage, and every storage
 * access tolerates a browser that refuses it (private mode, blocked site
 * data): the appearance then still works for the session, it is just not
 * remembered.
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Appearance of the application shell. */
export type Theme = "light" | "dark";

/** What {@link useTheme} hands to consumers. */
export interface ThemeState {
  /** Appearance currently applied to the document. */
  theme: Theme;
  /** Switch to the opposite appearance. */
  toggleTheme: () => void;
  /** Apply the given appearance. */
  setTheme: (theme: Theme) => void;
}

/**
 * Storage key of the remembered choice. Kept as is on purpose: users who
 * already picked an appearance keep it.
 */
const STORAGE_KEY = "theme";

/** Class of the always-present design-system scope. */
const SCOPE_CLASS = "ou";

/** Palette class per appearance. */
const PALETTE_CLASS: Record<Theme, string> = {
  light: "ou--light",
  dark: "ou--dark",
};

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** The remembered choice, or `null` when there is none or it is unreadable. */
function rememberedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remember the choice; silently skipped when storage is unavailable. */
function rememberTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage refused: the appearance stays for this session only.
  }
}

/** Appearance requested by the operating system. */
function systemTheme(): Theme {
  const query = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
  return query?.matches ? "dark" : "light";
}

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return rememberedTheme() ?? systemTheme();
}

/** Put the design-system scope and the palette of `theme` on `<body>`. */
function paintBody(theme: Theme): void {
  const { classList } = document.body;
  classList.add(SCOPE_CLASS);
  for (const [name, cls] of Object.entries(PALETTE_CLASS)) {
    classList.toggle(cls, name === theme);
  }
}

const ThemeContext = createContext<ThemeState | null>(null);

/**
 * Keeps `<body>` painted in the current appearance and shares the state with
 * {@link useTheme}. Mounted once at the application root.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Layout effect: the palette lands before the browser paints, so switching
  // never shows a frame of the previous appearance.
  useLayoutEffect(() => {
    paintBody(theme);
    rememberTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const state = useMemo<ThemeState>(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme],
  );

  return <ThemeContext.Provider value={state}>{children}</ThemeContext.Provider>;
}

/**
 * Current appearance and the actions to change it.
 *
 * @throws {Error} When called outside {@link ThemeProvider}: a control that
 *   silently showed "light" without a provider would lie about the page.
 */
export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return state;
}
