/**
 * @module components/app-sidebar
 *
 * Author-side primary navigation, rendered with the design-system `Sidebar`
 * (`@universityrt/ui-kit`) inside the DS `AppShell` (see pages/author/layout).
 * Replaces the former shadcn `Sidebar` shell so the app frame matches the rest
 * of the DS-based UI (see docs/PLAN_appshell_migration.md).
 *
 * Nav items are gated by capability (PRD-13): each entry is shown only when the
 * current user `can(perm)`. The active item is derived from the current route
 * (wouter); selecting an item performs SPA navigation. The footer holds the
 * signed-in user and the logout action.
 */
import { useLocation } from "wouter";
import {
  BookOpen,
  FolderOpen,
  FileQuestion,
  ClipboardList,
  LayoutTemplate,
  BarChart3,
  Users,
  UsersRound,
  Import,
  type LucideIcon,
} from "lucide-react";
import { Sidebar } from "@universityrt/ui-kit";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { Capability } from "@shared/access";

/** Nav entry: route + icon + the capability that gates it (PRD-13). */
interface NavEntry {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  perm: Capability;
}

const NAV: NavEntry[] = [
  { id: "topics", href: "/author/topics", label: t.navigation.topics, icon: FolderOpen, perm: "topics.manage" },
  { id: "questions", href: "/author/questions", label: t.navigation.questions, icon: FileQuestion, perm: "questions.manage" },
  { id: "tests", href: "/author/tests", label: t.navigation.tests, icon: ClipboardList, perm: "tests.read" },
  { id: "templates", href: "/author/templates", label: t.navigation.templates, icon: LayoutTemplate, perm: "adminTemplates.manage" },
  { id: "analytics", href: "/author/analytics", label: t.navigation.analytics, icon: BarChart3, perm: "analytics.read" },
  { id: "users", href: "/author/users", label: t.navigation.users, icon: Users, perm: "users.read" },
  { id: "groups", href: "/author/groups", label: t.navigation.groups, icon: UsersRound, perm: "groups.manage" },
  { id: "import", href: "/author/import", label: t.navigation.import, icon: Import, perm: "questions.importExport" },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { can } = useAuth();

  const allowed = NAV.filter((n) => can(n.perm));
  const activeId = allowed.find((n) => location.startsWith(n.href))?.id;
  const hrefById = new Map(NAV.map((n) => [n.id, n.href]));

  const items = allowed.map((n) => ({
    id: n.id,
    label: n.label,
    icon: <n.icon size={16} />,
  }));

  return (
    <Sidebar
      groups={[{ items }]}
      activeId={activeId}
      onSelect={(id) => {
        const href = hrefById.get(id);
        if (href) setLocation(href);
      }}
      brand={
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setLocation("/");
          }}
          className="flex items-center gap-2 text-inherit no-underline"
        >
          <span className="ou-shell__brand-mark">
            <BookOpen size={16} />
          </span>
          <span className="font-semibold">{t.auth.appName}</span>
        </a>
      }
    />
  );
}
