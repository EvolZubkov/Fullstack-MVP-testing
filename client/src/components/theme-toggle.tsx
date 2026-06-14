import { Moon, Sun } from "lucide-react";
import { IconButton } from "@universityrt/ui-kit";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <IconButton
      variant="ghost"
      onClick={toggleTheme}
      data-testid="button-theme-toggle"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      icon={theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
    />
  );
}
