/**
 * @module components/app-sidebar
 *
 * Author-side primary navigation, rendered with the design-system `Sidebar`
 * (`@skillum/ui-kit`) inside the DS `AppShell` (see pages/author/layout).
 * Replaces the former shadcn `Sidebar` shell so the app frame matches the rest
 * of the DS-based UI (see docs/PLAN_appshell_migration.md).
 *
 * Nav items are gated by capability (PRD-13): each entry is shown only when the
 * current user `can(perm)`. The active item is derived from the current route
 * (wouter); selecting an item performs SPA navigation. The footer shows the build
 * stamp (app version + short git SHA) so a deployed instance advertises exactly
 * what it runs — the quick answer to «did this deploy actually ship the new code».
 */
import { useLocation } from "wouter";
import {
  BookOpen,
  FolderTree,
  Home,
  ClipboardList,
  LayoutTemplate,
  BarChart3,
  Users,
  UsersRound,
  Import,
  type LucideIcon,
} from "lucide-react";
import { Cluster, Sidebar, Text } from "@skillum/ui-kit";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { IMPORT_CAPABILITIES, type Capability } from "@shared/access";

/** Nav entry: route + icon + the capability that gates it (PRD-13); a list means ANY of them. */
interface NavEntry {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  perm: Capability | readonly Capability[];
}

const NAV: NavEntry[] = [
  // PRD-25: главная доступна любому аутентифицированному пользователю, поэтому
  // гейтится правом `auth.self`, которое есть у каждой роли.
  { id: "home", href: "/", label: t.navigation.home, icon: Home, perm: "auth.self" },
  // «Тесты» стоят выше «Тем и вопросов»: тест — основной объект работы автора,
  // а его вопросы видны и правятся прямо из ящика теста.
  { id: "tests", href: "/author/tests", label: t.navigation.tests, icon: ClipboardList, perm: "tests.read" },
  // PRD-16: «Темы» и «Вопросы» объединены в единый раздел «Темы и вопросы».
  { id: "content", href: "/author/content", label: t.navigation.topicsAndQuestions, icon: FolderTree, perm: "topics.manage" },
  { id: "templates", href: "/author/templates", label: t.navigation.templates, icon: LayoutTemplate, perm: "adminTemplates.manage" },
  { id: "analytics", href: "/author/analytics", label: t.navigation.analytics, icon: BarChart3, perm: "analytics.read" },
  { id: "users", href: "/author/users", label: t.navigation.users, icon: Users, perm: "users.read" },
  { id: "groups", href: "/author/groups", label: t.navigation.groups, icon: UsersRound, perm: "groups.manage" },
  // Э6: единая точка импорта — раздел открыт любым правом на импорт (менеджеру — ради выгрузок
  // LMS и списков пользователей), а виды файлов в нём — по правам.
  { id: "import", href: "/author/import", label: t.navigation.import, icon: Import, perm: IMPORT_CAPABILITIES },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { can } = useAuth();

  const allowed = NAV.filter((n) =>
    typeof n.perm === "string" ? can(n.perm) : n.perm.some((capability) => can(capability)),
  );
  // PRD-25: «/» требует ТОЧНОГО совпадения — префиксная проверка совпала бы с
  // любым маршрутом и подсвечивала бы «Главную» повсюду.
  const activeId = allowed.find((n) =>
    n.href === "/" ? location === "/" : location.startsWith(n.href),
  )?.id;
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
          className="ou-link-reset"
        >
          <Cluster gap={2} wrap={false}>
            <span className="ou-shell__brand-mark">
              <BookOpen size={16} />
            </span>
            <Text weight="semibold">{t.auth.appName}</Text>
          </Cluster>
        </a>
      }
      footer={
        <Text
          variant="caption"
          tone="subtle"
          truncate
          title={`Версия ${__APP_VERSION__}${__GIT_SHA__ ? ` · сборка ${__GIT_SHA__}` : ""}`}
        >
          {`v${__APP_VERSION__}${__GIT_SHA__ ? ` · ${__GIT_SHA__}` : ""}`}
        </Text>
      }
    />
  );
}
