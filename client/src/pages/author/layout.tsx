/**
 * @module pages/author/layout
 *
 * Author-area shell: the design-system `AppShell` (`@universityrt/ui-kit`) with
 * the primary {@link AppSidebar} in the side slot. The header carries (right
 * edge) the theme toggle and the signed-in user; the user avatar opens a menu
 * with the logout action. Replaces the former shadcn `SidebarProvider` frame
 * (see docs/PLAN_appshell_migration.md). Mobile/off-canvas is out of scope for
 * now; the DS shell is desktop-first.
 */
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { AppShell, AppShellActions, AppShellUser, MenuTrigger, MenuItem } from "@universityrt/ui-kit";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";
import { formatRoles } from "@/lib/roles";
import { t } from "@/lib/i18n";

interface AuthorLayoutProps {
  children: ReactNode;
}

export function AuthorLayout({ children }: AuthorLayoutProps) {
  const { user, logout } = useAuth();
  const initials = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <AppShell
      side={<AppSidebar />}
      header={
        <AppShellActions>
          <ThemeToggle />
          <MenuTrigger
            placement="bottom-end"
            trigger={
              <AppShellUser
                avatar={initials}
                name={user?.name || user?.email}
                role={formatRoles(user?.roles)}
              />
            }
          >
            <MenuItem
              icon={<LogOut size={16} />}
              title={t.navigation.logout}
              danger
              data-testid="button-logout"
              onClick={() => void logout()}
            />
          </MenuTrigger>
        </AppShellActions>
      }
    >
      {children}
    </AppShell>
  );
}
