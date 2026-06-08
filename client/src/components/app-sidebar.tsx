import { useLocation, Link } from "wouter";
import {
  BookOpen,
  FolderOpen,
  FileQuestion,
  ClipboardList,
  LayoutTemplate,
  BarChart3,
  LogOut,
  User,
  Users,
  UsersRound,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { formatRoles } from "@/lib/roles";
import { t } from "@/lib/i18n";
import type { Capability } from "@shared/access";

/** Sidebar entries with the capability that gates each (PRD-13). */
const authorNavItems: Array<{ title: string; href: string; icon: LucideIcon; perm: Capability }> = [
  { title: t.navigation.topics, href: "/author/topics", icon: FolderOpen, perm: "topics.manage" },
  { title: t.navigation.questions, href: "/author/questions", icon: FileQuestion, perm: "questions.manage" },
  { title: t.navigation.tests, href: "/author/tests", icon: ClipboardList, perm: "tests.read" },
  { title: t.navigation.templates, href: "/author/templates", icon: LayoutTemplate, perm: "adminTemplates.manage" },
  { title: t.navigation.analytics, href: "/author/analytics", icon: BarChart3, perm: "analytics.read" },
  { title: t.navigation.users, href: "/author/users", icon: Users, perm: "users.read" },
  { title: t.navigation.groups, href: "/author/groups", icon: UsersRound, perm: "groups.manage" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, can } = useAuth();
  const navItems = authorNavItems.filter((item) => can(item.perm));

  const handleLogout = async () => {
    await logout();
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <span className="font-semibold text-lg">{t.auth.appName}</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t.sidebar.authorPanel}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.startsWith(item.href)}
                  >
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback>
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || user?.email}</p>
            <p className="text-xs text-muted-foreground">
              {formatRoles(user?.roles)}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={handleLogout}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {t.navigation.logout}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
