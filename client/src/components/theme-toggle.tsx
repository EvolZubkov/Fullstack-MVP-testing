/**
 * @module components/theme-toggle
 *
 * Header button that switches the shell between the light and dark
 * appearance. The icon shows where the click leads (moon while light, sun
 * while dark), and the accessible name says the same in words.
 */
import { Moon, Sun } from "lucide-react";
import { IconButton } from "@skillum/ui-kit";
import { useTheme } from "./theme-provider";

/** Appearance switch for the author and learner headers. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const toDark = theme === "light";
  const label = toDark ? "Включить тёмную тему" : "Включить светлую тему";

  return (
    <IconButton
      variant="ghost"
      onClick={toggleTheme}
      data-testid="button-theme-toggle"
      aria-label={label}
      title={label}
      icon={toDark ? <Moon size={20} /> : <Sun size={20} />}
    />
  );
}
