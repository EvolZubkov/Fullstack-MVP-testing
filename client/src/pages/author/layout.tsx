/**
 * @module pages/author/layout
 *
 * Author-area shell: the design-system `AppShell` (`@universityrt/ui-kit`) with
 * the primary {@link AppSidebar} in the side slot. The header carries (right
 * edge) the theme toggle and the signed-in user; the user avatar opens a menu
 * with the full role set and the logout action. Replaces the former shadcn
 * `SidebarProvider` frame (see docs/PLAN_appshell_migration.md). Mobile/off-canvas
 * is out of scope for now; the DS shell is desktop-first.
 *
 * The caption under the name names only the highest-privilege role: the header
 * user entry has no width cap, so a comma-separated list stretched the header on
 * multi-role accounts. The whole set stays one click away in the menu header.
 */
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import {
  AppShell,
  AppShellActions,
  AppShellUser,
  MenuTrigger,
  MenuItem,
  MenuHeader,
  MenuDivider,
} from "@universityrt/ui-kit";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";
import { formatRoles, formatPrimaryRole } from "@/lib/roles";
import { t } from "@/lib/i18n";

interface AuthorLayoutProps {
  children: ReactNode;
}

export function AuthorLayout({ children }: AuthorLayoutProps) {
  const { user, logout } = useAuth();
  const initials = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  const displayName = user?.name || user?.email;
  const allRoles = formatRoles(user?.roles);

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
                name={displayName}
                role={formatPrimaryRole(user?.roles)}
              />
            }
          >
            <MenuHeader
              avatar={<span className="ou-shell__avatar">{initials}</span>}
              title={displayName}
              meta={allRoles || undefined}
            />
            <MenuDivider />
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
